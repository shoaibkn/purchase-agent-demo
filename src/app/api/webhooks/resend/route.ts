import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { parseSupplierReply } from "@/lib/email";
import {
  AgentRunStatus,
  AgentRunTrigger,
  MessageDirection,
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
  SenderType,
} from "@prisma/client";

const resendEventSchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
  }),
});

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const event = resendEventSchema.parse(payload);

    console.log("Resend webhook event:", event.type, event.data);

    if (event.type === "email.replied") {
      const emailData = event.data;
      const replyBody = emailData.text || emailData.html || "";
      const fromEmail = emailData.from || "";
      const subject = emailData.subject || "";

      const poNumberMatch = subject.match(/\[(PO-\d{8}-\d{3})\]/);
      if (!poNumberMatch) {
        return NextResponse.json({ message: "No PO number found in subject" }, { status: 400 });
      }

      const poNumber = poNumberMatch[1];
      const purchaseOrder = await db.purchaseOrder.findUnique({
        where: { poNumber },
        include: {
          supplier: true,
          lines: {
            include: {
              material: true,
            },
          },
          emailThreads: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!purchaseOrder) {
        return NextResponse.json({ message: "PO not found" }, { status: 404 });
      }

      if (purchaseOrder.supplier.primaryEmail.toLowerCase() !== fromEmail.toLowerCase()) {
        return NextResponse.json({ message: "Reply from unknown email" }, { status: 400 });
      }

      const thread =
        purchaseOrder.emailThreads[0] ??
        (await db.emailThread.create({
          data: {
            purchaseOrderId: purchaseOrder.id,
            supplierId: purchaseOrder.supplierId,
            subject: `[${poNumber}] Purchase Order Thread`,
          },
        }));

      const parsed = parseSupplierReply(replyBody);

      await db.emailMessage.create({
        data: {
          threadId: thread.id,
          direction: MessageDirection.INBOUND,
          senderType: SenderType.SUPPLIER,
          fromEmail: fromEmail,
          toEmails: [purchaseOrder.supplier.primaryEmail],
          subject: subject,
          body: replyBody,
          intent: parsed.acknowledged ? "supplier_ack_with_edd" : "supplier_reply",
          metadata: { resendMessageId: emailData.id, parsed },
        },
      });

      if (parsed.acknowledged && parsed.lineUpdates.length > 0) {
        const lineMap = new Map(purchaseOrder.lines.map((line) => [line.material.name.toLowerCase(), line]));

        for (const update of parsed.lineUpdates) {
          if (!update.proposedDate) continue;

          let matchedLine = purchaseOrder.lines[0];
          for (const line of purchaseOrder.lines) {
            if (line.openQty.toString() !== "0") {
              matchedLine = line;
              break;
            }
          }

          if (matchedLine) {
            const isApproved = !matchedLine.requestedDate || update.proposedDate <= matchedLine.requestedDate;

            await db.purchaseOrderLine.update({
              where: { id: matchedLine.id },
              data: {
                approvedDate: update.proposedDate,
                latestEdd: update.proposedDate,
                lineStatus: isApproved ? PurchaseOrderLineStatus.CONFIRMED : PurchaseOrderLineStatus.RESCHEDULED,
                deliveryCommitments: {
                  create: {
                    promisedDate: update.proposedDate,
                    promisedQty: update.quantity ?? matchedLine.openQty,
                    source: "Supplier",
                  },
                },
              },
            });
          }
        }

        await db.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: {
            status: PurchaseOrderStatus.ACKNOWLEDGED,
          },
        });
      }

      await db.agentRun.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          trigger: AgentRunTrigger.SUPPLIER_REPLY_RECEIVED,
          model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
          decision: `Inbound reply received via Resend webhook. Acknowledged: ${parsed.acknowledged}`,
          status: AgentRunStatus.SUCCESS,
        },
      });

      return NextResponse.json({ message: "Reply processed" });
    }

    if (event.type === "email.sent" || event.type === "email.delivered" || event.type === "email.opened") {
      console.log(`Email event ${event.type}:`, event.data.id);
      return NextResponse.json({ message: "Event received" });
    }

    return NextResponse.json({ message: "Unhandled event type" });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
