import {
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
} from "@prisma/client";
import { format } from "date-fns";

import { getModel } from "@/lib/ai";
import type {
  LineUpdate,
  POLineWithDetails,
  PrismaTransaction,
  SkillContext,
} from "./types";

// ── LLM Response Helpers ───────────────────────────────────────────────────────

/** Extract text content from a LangChain AIMessage response. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }

  return "";
}

/** Strip markdown code fences and trim. */
export function cleanJsonResponse(text: string): string {
  return text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}

/** Invoke an LLM and return raw text. */
export async function invokeLLM(
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const model = getModel(modelName);
  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
  return contentToText(response.content);
}

/** Invoke LLM and parse JSON response. Returns null on failure. */
export async function invokeLLMJson<T>(
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<T | null> {
  try {
    const raw = await invokeLLM(modelName, systemPrompt, userPrompt);
    const cleaned = cleanJsonResponse(raw);
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ── Line Matching ──────────────────────────────────────────────────────────────

/**
 * Match a LineUpdate's materialName to a PO line using fuzzy matching.
 * Tries exact match on name, then SKU, then partial/contains match.
 *
 * Returns the matched line or undefined.
 */
export function matchLineUpdate(
  update: LineUpdate,
  availableLines: Map<string, POLineWithDetails>,
  availableSkus: Map<string, POLineWithDetails>,
): POLineWithDetails | undefined {
  const key = update.materialName.toLowerCase();

  // Exact name match
  const byName = availableLines.get(key);
  if (byName) return byName;

  // Exact SKU match
  const bySku = availableSkus.get(key);
  if (bySku) return bySku;

  // Partial name match (contains)
  for (const [name, line] of availableLines) {
    if (name.includes(key) || key.includes(name)) return line;
  }

  // Partial SKU match
  for (const [sku, line] of availableSkus) {
    if (sku.includes(key) || key.includes(sku)) return line;
  }

  return undefined;
}

/**
 * Build lookup maps for line matching.
 * Returns [nameMap, skuMap].
 */
export function buildLineLookups(
  lines: POLineWithDetails[],
): [Map<string, POLineWithDetails>, Map<string, POLineWithDetails>] {
  const byName = new Map(
    lines.map((l) => [l.material.name.toLowerCase(), l]),
  );
  const bySku = new Map(
    lines.map((l) => [l.material.sku.toLowerCase(), l]),
  );
  return [byName, bySku];
}

// ── Context Builders ───────────────────────────────────────────────────────────

/** Build the PO lines context string for LLM prompts. */
export function buildLinesContext(ctx: SkillContext): string {
  return ctx.openLines
    .map(
      (l, i) =>
        `  ${i + 1}. ${l.material.name} (SKU: ${l.material.sku}) — Ordered: ${l.orderedQty.toString()}, Open: ${l.openQty.toString()}, Requested: ${l.requestedDate ? format(l.requestedDate, "yyyy-MM-dd") : "N/A"}, Latest EDD: ${l.latestEdd ? format(l.latestEdd, "yyyy-MM-dd") : "N/A"}, Status: ${l.lineStatus}`,
    )
    .join("\n");
}

/** Build recent thread history string for LLM prompts. */
export function buildThreadContext(ctx: SkillContext, maxMessages = 6): string {
  return ctx.threadHistory
    .slice(-maxMessages)
    .map((m) => `[${m.direction}/${m.senderType ?? "UNKNOWN"}]: ${m.body.slice(0, 300)}`)
    .join("\n---\n");
}

// ── Commitment Versioning ──────────────────────────────────────────────────────

/**
 * Get the next commitment version for a PO line by querying the current max.
 */
export async function getNextCommitmentVersion(
  tx: PrismaTransaction,
  poLineId: string,
): Promise<number> {
  const result = await tx.deliveryCommitment.aggregate({
    where: { poLineId },
    _max: { version: true },
  });
  return (result._max.version ?? 0) + 1;
}

// ── PO Status Checks ───────────────────────────────────────────────────────────

/**
 * Check if all lines on a PO are settled (CONFIRMED, RESCHEDULED, RECEIVED, or PARTIALLY_RECEIVED).
 * If so and PO isn't already ACKNOWLEDGED/CLOSED, return true.
 */
export async function checkAndPromotePOStatus(
  tx: PrismaTransaction,
  poId: string,
  currentPoStatus: string,
): Promise<boolean> {
  if (
    currentPoStatus === PurchaseOrderStatus.ACKNOWLEDGED ||
    currentPoStatus === PurchaseOrderStatus.CLOSED
  ) {
    return false;
  }

  const allLines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId: poId },
  });

  const allSettled = allLines.every(
    (l) =>
      l.lineStatus === PurchaseOrderLineStatus.CONFIRMED ||
      l.lineStatus === PurchaseOrderLineStatus.RESCHEDULED ||
      l.lineStatus === PurchaseOrderLineStatus.RECEIVED ||
      l.lineStatus === PurchaseOrderLineStatus.PARTIALLY_RECEIVED,
  );

  if (allSettled) {
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: PurchaseOrderStatus.ACKNOWLEDGED },
    });
    return true;
  }

  return false;
}

// ── Agent Reply Builder ────────────────────────────────────────────────────────

/** Build a default agent reply when the LLM doesn't provide one. */
export function buildFallbackReply(
  poNumber: string,
  acknowledged: boolean,
  linesUpdated: number,
  followUpBy?: string,
  intent?: string,
  humanReviewReason?: string,
): string {
  const parts = [`Thank you for your response regarding PO ${poNumber}.`];

  if (acknowledged) {
    parts.push("Your acknowledgment has been recorded.");
  }

  if (linesUpdated > 0) {
    parts.push(
      `We have updated ${linesUpdated} line-level delivery commitment(s) based on your proposed dates.`,
    );
  }

  if (followUpBy) {
    const d = new Date(followUpBy);
    if (!isNaN(d.getTime())) {
      parts.push(
        `We have noted your intent to confirm by ${format(d, "yyyy-MM-dd")}. A follow-up reminder has been scheduled for that date.`,
      );
    }
  }

  if (humanReviewReason) {
    parts.push(
      `Note: ${humanReviewReason} This has been flagged for buyer review.`,
    );
  }

  if (
    linesUpdated === 0 &&
    !acknowledged &&
    !followUpBy &&
    intent === "general"
  ) {
    parts.push(
      "Your message has been noted. A member of the purchase team will review and respond if needed.",
    );
  }

  parts.push("", "Regards,", "Purchase Team");
  return parts.join("\n");
}
