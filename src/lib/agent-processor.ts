import {
  AgentRunStatus,
  AgentRunTrigger,
  MessageDirection,
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
  ReminderTaskStatus,
  ReminderTaskType,
  SenderType,
} from "@prisma/client";
import { addDays, addHours, format, nextMonday, nextFriday } from "date-fns";

import { db } from "@/lib/db";
import { getModel } from "@/lib/ai";
import { parseSupplierReply } from "@/lib/email";
import { sendEmail } from "@/lib/email";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LineUpdate {
  materialName: string;
  proposedDate: string; // ISO date
  quantity?: number;
  note?: string;
}

interface AnalysisResult {
  acknowledged: boolean;
  lineUpdates: LineUpdate[];
  followUpBy?: string; // ISO date — when the supplier said they'd respond/confirm by
  summary: string;
  replyBody: string;
}

export interface ProcessingResult {
  success: boolean;
  summary: string;
  agentReplyId?: string;
  linesUpdated: number;
  poStatusChanged: boolean;
  followUpBy?: string; // ISO date — reminder scheduled for supplier's stated follow-up window
}

// ── Supplier Message Processing ────────────────────────────────────────────────

/**
 * Processes an inbound supplier message on a thread:
 *  1. Loads full PO + line context
 *  2. Analyzes the supplier message with AI (or regex fallback)
 *  3. Updates PO lines, commitments, statuses
 *  4. Posts an agent auto-reply confirming what was done
 *  5. Creates an AgentRun audit record
 */
export async function processSupplierMessage(
  threadId: string,
  supplierMessageBody: string,
): Promise<ProcessingResult> {
  const thread = await db.emailThread.findUnique({
    where: { id: threadId },
    include: {
      supplier: true,
      purchaseOrder: {
        include: {
          lines: {
            include: {
              material: true,
              deliveryCommitments: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!thread) {
    return { success: false, summary: "Thread not found.", linesUpdated: 0, poStatusChanged: false };
  }

  const po = thread.purchaseOrder;
  const supplier = thread.supplier;
  const openLines = po.lines.filter((l) => Number(l.openQty.toString()) > 0);

  if (openLines.length === 0) {
    return { success: true, summary: "No open lines to process.", linesUpdated: 0, poStatusChanged: false };
  }

  // ── Analyze with AI or fallback ──
  const appSetting = await db.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
  const selectedModel = appSetting?.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const useRealEmail = appSetting?.useRealEmail ?? false;

  let analysis: AnalysisResult;

  if (process.env.OPENAI_API_KEY) {
    analysis = await analyzeWithAI(supplierMessageBody, {
      poNumber: po.poNumber,
      supplierName: supplier.name,
      lines: openLines.map((l) => ({
        materialName: l.material.name,
        sku: l.material.sku,
        orderedQty: l.orderedQty.toString(),
        openQty: l.openQty.toString(),
        requestedDate: l.requestedDate ? format(l.requestedDate, "yyyy-MM-dd") : null,
        latestEdd: l.latestEdd ? format(l.latestEdd, "yyyy-MM-dd") : null,
        lineStatus: l.lineStatus,
      })),
      threadHistory: thread.messages.map((m) => ({
        direction: m.direction,
        senderType: m.senderType,
        body: m.body,
      })),
      model: selectedModel,
    });
  } else {
    analysis = analyzeWithFallback(supplierMessageBody, {
      supplierName: supplier.name,
      poNumber: po.poNumber,
      lines: openLines.map((l) => ({
        materialName: l.material.name,
        openQty: l.openQty.toString(),
      })),
    });
  }

  // ── Apply updates in a transaction ──
  return db.$transaction(async (tx) => {
    let linesUpdated = 0;
    let poStatusChanged = false;

    // Build a lookup: lowercase material name / sku -> PO line
    const lineByName = new Map(
      openLines.map((l) => [l.material.name.toLowerCase(), l]),
    );
    const lineBySku = new Map(
      openLines.map((l) => [l.material.sku.toLowerCase(), l]),
    );

    for (const update of analysis.lineUpdates) {
      const proposedDate = new Date(update.proposedDate);
      if (isNaN(proposedDate.getTime())) continue;

      // Match by material name (fuzzy) or SKU
      const key = update.materialName.toLowerCase();
      let matchedLine =
        lineByName.get(key) ??
        lineBySku.get(key) ??
        // Partial match
        [...lineByName.entries()].find(([name]) => name.includes(key) || key.includes(name))?.[1] ??
        [...lineBySku.entries()].find(([sku]) => sku.includes(key) || key.includes(sku))?.[1];

      // If only one open line and one update, use it
      if (!matchedLine && openLines.length === 1 && analysis.lineUpdates.length === 1) {
        matchedLine = openLines[0];
      }

      if (!matchedLine) continue;

      const isApproved =
        !matchedLine.requestedDate || proposedDate <= matchedLine.requestedDate;

      await tx.purchaseOrderLine.update({
        where: { id: matchedLine.id },
        data: {
          approvedDate: proposedDate,
          latestEdd: proposedDate,
          lineStatus: isApproved
            ? PurchaseOrderLineStatus.CONFIRMED
            : PurchaseOrderLineStatus.RESCHEDULED,
          deliveryCommitments: {
            create: {
              promisedDate: proposedDate,
              promisedQty: update.quantity ?? matchedLine.openQty,
              source: "Supplier",
            },
          },
        },
      });

      // Schedule EDD overdue followup for the new date
      await tx.reminderTask.create({
        data: {
          purchaseOrderId: po.id,
          poLineId: matchedLine.id,
          type: ReminderTaskType.EDD_OVERDUE_FOLLOWUP,
          runAt: proposedDate,
          status: ReminderTaskStatus.PENDING,
        },
      });

      linesUpdated++;

      // Remove from lookup so same line isn't matched twice
      lineByName.delete(matchedLine.material.name.toLowerCase());
      lineBySku.delete(matchedLine.material.sku.toLowerCase());
    }

    // Check if all lines are now confirmed/rescheduled -> update PO status
    if (analysis.acknowledged || linesUpdated > 0) {
      const allLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: po.id },
      });

      const allSettled = allLines.every(
        (l) =>
          l.lineStatus === PurchaseOrderLineStatus.CONFIRMED ||
          l.lineStatus === PurchaseOrderLineStatus.RESCHEDULED ||
          l.lineStatus === PurchaseOrderLineStatus.RECEIVED ||
          l.lineStatus === PurchaseOrderLineStatus.PARTIALLY_RECEIVED,
      );

      if (
        allSettled &&
        po.status !== PurchaseOrderStatus.ACKNOWLEDGED &&
        po.status !== PurchaseOrderStatus.CLOSED
      ) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PurchaseOrderStatus.ACKNOWLEDGED },
        });
        poStatusChanged = true;
      }
    }

    // ── Schedule follow-up reminder if supplier deferred confirmation ──
    let followUpBy: string | undefined;

    if (analysis.followUpBy) {
      const followUpDate = new Date(analysis.followUpBy);
      if (!isNaN(followUpDate.getTime()) && followUpDate > new Date()) {
        followUpBy = followUpDate.toISOString();

        await tx.reminderTask.create({
          data: {
            purchaseOrderId: po.id,
            type: ReminderTaskType.ACK_REMINDER,
            runAt: followUpDate,
            status: ReminderTaskStatus.PENDING,
          },
        });
      }
    }

    // ── Post agent auto-reply ──
    const replyBody =
      analysis.replyBody || buildDefaultAgentReply(analysis, linesUpdated, po.poNumber, followUpBy);

    if (useRealEmail) {
      try {
        await sendEmail({
          to: [supplier.primaryEmail, ...supplier.ccEmails],
          subject: `Re: [${po.poNumber}] Purchase Order Update`,
          body: replyBody,
          replyTo: "buyer@demo-manufacturing.example",
        });
      } catch {
        // Non-fatal: log and continue
      }
    }

    const agentMessage = await tx.emailMessage.create({
      data: {
        threadId,
        direction: MessageDirection.OUTBOUND,
        senderType: SenderType.AGENT,
        fromEmail: "buyer@demo-manufacturing.example",
        toEmails: [supplier.primaryEmail, ...supplier.ccEmails],
        subject: `Re: [${po.poNumber}] Purchase Order Update`,
        body: replyBody,
        intent: "agent_auto_reply",
      },
    });

    // ── Audit ──
    const summary =
      analysis.summary ||
      `Processed supplier reply: ${linesUpdated} line(s) updated, acknowledged: ${analysis.acknowledged}.`;

    await tx.agentRun.create({
      data: {
        purchaseOrderId: po.id,
        trigger: AgentRunTrigger.SUPPLIER_REPLY_RECEIVED,
        model: selectedModel,
        decision: summary,
        status: AgentRunStatus.SUCCESS,
      },
    });

    await tx.emailThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    return {
      success: true,
      summary,
      agentReplyId: agentMessage.id,
      linesUpdated,
      poStatusChanged,
      followUpBy,
    };
  });
}

// ── AI Analysis ────────────────────────────────────────────────────────────────

async function analyzeWithAI(
  supplierMessage: string,
  context: {
    poNumber: string;
    supplierName: string;
    lines: Array<{
      materialName: string;
      sku: string;
      orderedQty: string;
      openQty: string;
      requestedDate: string | null;
      latestEdd: string | null;
      lineStatus: string;
    }>;
    threadHistory: Array<{
      direction: string;
      senderType: string | null;
      body: string;
    }>;
    model: string;
  },
): Promise<AnalysisResult> {
  const linesContext = context.lines
    .map(
      (l, i) =>
        `  ${i + 1}. ${l.materialName} (SKU: ${l.sku}) — Ordered: ${l.orderedQty}, Open: ${l.openQty}, Requested: ${l.requestedDate ?? "N/A"}, Latest EDD: ${l.latestEdd ?? "N/A"}, Status: ${l.lineStatus}`,
    )
    .join("\n");

  const recentHistory = context.threadHistory
    .slice(-6)
    .map((m) => `[${m.direction}/${m.senderType ?? "UNKNOWN"}]: ${m.body.slice(0, 300)}`)
    .join("\n---\n");

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const systemPrompt = `You are a procurement agent processing supplier email replies for purchase orders.

Given a supplier's email reply and the current PO context, you must:
1. Determine if the supplier acknowledged the PO.
2. Extract any proposed delivery dates and quantities per material/line.
3. Detect if the supplier indicated they will respond/confirm by a specific future date or timeframe (e.g. "by tomorrow", "within 2 days", "by end of week", "next Monday").
4. Write a brief summary of what the supplier communicated.
5. Draft a concise professional reply confirming what was understood and recorded.

Today's date is: ${todayStr}

Current PO: ${context.poNumber}
Supplier: ${context.supplierName}

Open PO Lines:
${linesContext}

Recent thread history:
${recentHistory}

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "acknowledged": true/false,
  "lineUpdates": [
    {
      "materialName": "exact material name from PO lines above",
      "proposedDate": "YYYY-MM-DD",
      "quantity": number or null,
      "note": "optional note"
    }
  ],
  "followUpBy": "YYYY-MM-DD or null",
  "summary": "One-line summary of what was extracted",
  "replyBody": "Professional reply email body confirming what was recorded. Keep under 120 words."
}

Rules:
- Use the exact materialName from the PO lines listed above.
- proposedDate must be a valid ISO date string (YYYY-MM-DD format).
- If the supplier did not mention a specific line, do not include it in lineUpdates.
- If the supplier mentions a date but not a specific material and there is only one open line, assign it to that line.
- Set acknowledged to true if the supplier explicitly or implicitly confirms receipt/acceptance of the PO.
- followUpBy: If the supplier says they will confirm/respond/revert later (e.g. "by tomorrow", "in 2 days", "by next week", "by end of day"), calculate the actual date from today (${todayStr}) and set it. If no such deferral is mentioned, set to null.
- If followUpBy is set, mention in the replyBody that a follow-up reminder has been noted for that date.`;

  try {
    const model = getModel(context.model);
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Supplier email:\n\n${supplierMessage}` },
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((part) =>
                typeof part === "string"
                  ? part
                  : typeof part === "object" && part !== null && "text" in part
                    ? String((part as { text?: unknown }).text ?? "")
                    : "",
              )
              .join("")
          : "";

    // Strip markdown code fences if present
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as AnalysisResult;

    // Normalize dates to ISO format
    parsed.lineUpdates = (parsed.lineUpdates ?? []).map((u) => ({
      ...u,
      proposedDate: new Date(u.proposedDate).toISOString(),
    }));

    // Normalize followUpBy
    if (parsed.followUpBy) {
      const followUpDate = new Date(parsed.followUpBy);
      parsed.followUpBy = isNaN(followUpDate.getTime()) ? undefined : followUpDate.toISOString();
    }

    return parsed;
  } catch (error) {
    console.error("AI analysis failed, falling back to regex parser:", error);
    return analyzeWithFallback(supplierMessage, {
      supplierName: context.supplierName,
      poNumber: context.poNumber,
      lines: context.lines.map((l) => ({
        materialName: l.materialName,
        openQty: l.openQty,
      })),
    });
  }
}

// ── Regex Fallback ─────────────────────────────────────────────────────────────

function analyzeWithFallback(
  supplierMessage: string,
  context: {
    supplierName: string;
    poNumber: string;
    lines: Array<{ materialName: string; openQty: string }>;
  },
): AnalysisResult {
  const parsed = parseSupplierReply(supplierMessage);

  const lineUpdates: LineUpdate[] = parsed.lineUpdates
    .filter((u) => u.proposedDate && !isNaN(u.proposedDate.getTime()))
    .map((u, i) => ({
      materialName: context.lines[i]?.materialName ?? `Line ${i + 1}`,
      proposedDate: u.proposedDate!.toISOString(),
      quantity: u.quantity,
      note: u.note,
    }));

  // Detect follow-up intent from natural language
  const followUpBy = detectFollowUpDate(supplierMessage);

  const summaryParts: string[] = [];
  if (parsed.acknowledged) {
    summaryParts.push(`Supplier acknowledged PO ${context.poNumber}`);
  } else {
    summaryParts.push(`Supplier reply received for PO ${context.poNumber}`);
  }
  if (lineUpdates.length > 0) {
    summaryParts.push(`${lineUpdates.length} date proposal(s) extracted`);
  }
  if (followUpBy) {
    summaryParts.push(`follow-up expected by ${format(new Date(followUpBy), "yyyy-MM-dd")}`);
  }
  const summary = summaryParts.join(". ") + ".";

  const replyBody = buildDefaultAgentReply(
    { acknowledged: parsed.acknowledged, lineUpdates, followUpBy, summary, replyBody: "" },
    lineUpdates.length,
    context.poNumber,
    followUpBy,
  );

  return {
    acknowledged: parsed.acknowledged,
    lineUpdates,
    followUpBy,
    summary,
    replyBody,
  };
}

/**
 * Detects relative date phrases in supplier messages and resolves to an ISO date.
 * Handles: "tomorrow", "by tomorrow", "in X days", "next week", "next Monday",
 * "end of week", "end of day", "within X hours/days", etc.
 */
function detectFollowUpDate(message: string): string | undefined {
  const lower = message.toLowerCase();
  const now = new Date();

  // "tomorrow" / "by tomorrow"
  if (/\b(by\s+)?tomorrow\b/.test(lower)) {
    return addDays(now, 1).toISOString();
  }

  // "in X day(s)" / "within X day(s)"
  const inDaysMatch = lower.match(/\b(?:in|within)\s+(\d+)\s+day/);
  if (inDaysMatch) {
    return addDays(now, parseInt(inDaysMatch[1], 10)).toISOString();
  }

  // "in X hour(s)" / "within X hour(s)"
  const inHoursMatch = lower.match(/\b(?:in|within)\s+(\d+)\s+hour/);
  if (inHoursMatch) {
    return addHours(now, parseInt(inHoursMatch[1], 10)).toISOString();
  }

  // "next week" / "by next week"
  if (/\b(?:by\s+)?next\s+week\b/.test(lower)) {
    return nextMonday(now).toISOString();
  }

  // "next monday"
  if (/\bnext\s+monday\b/.test(lower)) {
    return nextMonday(now).toISOString();
  }

  // "next friday" / "end of week" / "by end of week"
  if (/\bnext\s+friday\b/.test(lower) || /\b(?:by\s+)?end\s+of\s+(?:the\s+)?week\b/.test(lower)) {
    return nextFriday(now).toISOString();
  }

  // "end of day" / "by end of day" / "by EOD" / "by today"
  if (/\b(?:by\s+)?(?:end\s+of\s+(?:the\s+)?day|eod|today)\b/.test(lower)) {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 0);
    return endOfDay.toISOString();
  }

  // "by X days" (e.g. "by 2 days")
  const byDaysMatch = lower.match(/\bby\s+(\d+)\s+day/);
  if (byDaysMatch) {
    return addDays(now, parseInt(byDaysMatch[1], 10)).toISOString();
  }

  return undefined;
}

// ── Agent Draft Generation ─────────────────────────────────────────────────────

/**
 * Generates an AI-drafted email for the agent to send.
 * Called from the "Generate Draft" button in the Communications UI.
 */
export async function generateAgentDraft(threadId: string): Promise<string> {
  const thread = await db.emailThread.findUnique({
    where: { id: threadId },
    include: {
      supplier: true,
      purchaseOrder: {
        include: {
          lines: {
            include: {
              material: true,
              deliveryCommitments: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!thread) {
    return "Thread not found.";
  }

  const po = thread.purchaseOrder;
  const supplier = thread.supplier;

  // Template fallback if no API key
  if (!process.env.OPENAI_API_KEY) {
    return buildTemplateDraft(po, supplier.name);
  }

  const appSetting = await db.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
  const selectedModel = appSetting?.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const linesContext = po.lines
    .map(
      (l, i) =>
        `  ${i + 1}. ${l.material.name} (SKU: ${l.material.sku}) — Ordered: ${l.orderedQty.toString()}, Open: ${l.openQty.toString()}, Requested: ${l.requestedDate ? format(l.requestedDate, "yyyy-MM-dd") : "N/A"}, Latest EDD: ${l.latestEdd ? format(l.latestEdd, "yyyy-MM-dd") : "N/A"}, Status: ${l.lineStatus}`,
    )
    .join("\n");

  const recentMessages = thread.messages
    .slice(-8)
    .map((m) => `[${m.direction}/${m.senderType ?? "UNKNOWN"}]: ${m.body.slice(0, 400)}`)
    .join("\n---\n");

  const systemPrompt = `You are a procurement agent drafting an email to a supplier regarding a purchase order.

PO: ${po.poNumber} (Status: ${po.status})
Supplier: ${supplier.name} (${supplier.primaryEmail})

PO Lines:
${linesContext}

Recent thread:
${recentMessages}

Based on the PO status and thread history, draft a concise, professional follow-up email.
- If PO is ACK_PENDING or SENT, remind the supplier to acknowledge and confirm delivery dates.
- If lines are OVERDUE, ask for revised delivery dates.
- If lines are PARTIALLY_RECEIVED, confirm receipt and ask about remaining quantities.
- If lines are DATE_NEGOTIATION, propose dates or ask for the supplier's feasible dates.
- Keep the email under 120 words. Be direct and professional.
- Sign off as "Purchase Team".

Reply with ONLY the email body text. No subject line, no JSON.`;

  try {
    const model = getModel(selectedModel);
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: "Draft the follow-up email based on the current PO status and thread history.",
      },
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((part) =>
                typeof part === "string"
                  ? part
                  : typeof part === "object" && part !== null && "text" in part
                    ? String((part as { text?: unknown }).text ?? "")
                    : "",
              )
              .join("")
          : "";

    return text.trim() || buildTemplateDraft(po, supplier.name);
  } catch (error) {
    console.error("Draft generation failed, using template:", error);
    return buildTemplateDraft(po, supplier.name);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildDefaultAgentReply(
  analysis: AnalysisResult,
  linesUpdated: number,
  poNumber: string,
  followUpBy?: string,
): string {
  const parts = [`Thank you for your response regarding PO ${poNumber}.`];

  if (analysis.acknowledged) {
    parts.push("Your acknowledgment has been recorded.");
  }

  if (linesUpdated > 0) {
    parts.push(
      `We have updated ${linesUpdated} line-level delivery commitment(s) based on your proposed dates.`,
    );
  }

  if (followUpBy) {
    const followUpDate = new Date(followUpBy);
    if (!isNaN(followUpDate.getTime())) {
      parts.push(
        `We have noted your intent to confirm by ${format(followUpDate, "yyyy-MM-dd")}. A follow-up reminder has been scheduled for that date.`,
      );
    }
  }

  if (analysis.lineUpdates.length === 0 && !analysis.acknowledged && !followUpBy) {
    parts.push(
      "We were unable to extract specific delivery date proposals from your message. Please reply with line-level dates so we can update commitments.",
    );
  }

  parts.push("", "Regards,", "Purchase Team");
  return parts.join("\n");
}

function buildTemplateDraft(
  po: {
    poNumber: string;
    status: string;
    lines: Array<{
      material: { name: string };
      openQty: { toString(): string };
      lineStatus: string;
      latestEdd: Date | null;
    }>;
  },
  supplierName: string,
): string {
  const openLines = po.lines.filter((l) => Number(l.openQty.toString()) > 0);
  const parts = [`Hello ${supplierName},`];

  if (po.status === "SENT" || po.status === "ACK_PENDING") {
    parts.push(
      "",
      `This is a follow-up regarding PO ${po.poNumber}. We are awaiting your acknowledgment and line-level delivery date confirmations.`,
    );
  } else if (openLines.some((l) => l.lineStatus === "OVERDUE")) {
    const overdueNames = openLines
      .filter((l) => l.lineStatus === "OVERDUE")
      .map((l) => l.material.name)
      .join(", ");
    parts.push(
      "",
      `Delivery for the following items on PO ${po.poNumber} is overdue: ${overdueNames}. Please share revised delivery dates.`,
    );
  } else if (openLines.some((l) => l.lineStatus === "PARTIALLY_RECEIVED")) {
    parts.push(
      "",
      `We have received partial delivery for PO ${po.poNumber}. Please confirm the schedule for remaining quantities.`,
    );
  } else {
    parts.push(
      "",
      `Please provide an update on PO ${po.poNumber} and confirm line-level delivery dates.`,
    );
  }

  if (openLines.length > 0) {
    parts.push("", "Open lines:");
    openLines.forEach((l, i) => {
      const edd = l.latestEdd ? format(l.latestEdd, "yyyy-MM-dd") : "TBD";
      parts.push(`  ${i + 1}. ${l.material.name} — Open Qty: ${l.openQty.toString()}, EDD: ${edd}`);
    });
  }

  parts.push("", "Regards,", "Purchase Team");
  return parts.join("\n");
}
