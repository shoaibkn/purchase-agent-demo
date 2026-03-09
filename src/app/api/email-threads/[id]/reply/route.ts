import { NextResponse } from "next/server";
import { z } from "zod";
import { ZodError } from "zod";

import { db } from "@/lib/db";
import { MessageDirection, SenderType } from "@prisma/client";
import { processSupplierMessage } from "@/lib/agent-processor";

const replySchema = z.object({
  body: z.string().min(1).max(5000),
  senderType: z.enum(["PURCHASER", "AGENT", "SUPPLIER"]).default("PURCHASER"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const payload = await request.json();
    const input = replySchema.parse(payload);

    const thread = await db.emailThread.findUnique({
      where: { id: threadId },
      include: {
        supplier: true,
        purchaseOrder: true,
      },
    });

    if (!thread) {
      return NextResponse.json({ message: "Thread not found" }, { status: 404 });
    }

    // ── Compute direction, from/to, intent based on sender type ──

    const isSupplier = input.senderType === "SUPPLIER";
    const direction = isSupplier ? MessageDirection.INBOUND : MessageDirection.OUTBOUND;
    const senderType = SenderType[input.senderType];
    const fromEmail = isSupplier
      ? thread.supplier.primaryEmail
      : "buyer@demo-manufacturing.example";
    const toEmails = isSupplier
      ? ["buyer@demo-manufacturing.example"]
      : [thread.supplier.primaryEmail, ...thread.supplier.ccEmails];
    const intent = isSupplier
      ? "supplier_reply_manual"
      : input.senderType === "AGENT"
        ? "agent_reply"
        : "purchaser_reply";

    // ── Send real email only for outbound messages ──

    const appSetting = await db.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
    const useRealEmail = appSetting?.useRealEmail ?? false;

    let resendMessageId: string | undefined;

    if (useRealEmail && !isSupplier) {
      const { sendEmail } = await import("@/lib/email");
      const result = await sendEmail({
        to: [thread.supplier.primaryEmail, ...thread.supplier.ccEmails],
        subject: `Re: ${thread.subject}`,
        body: input.body,
        replyTo: "buyer@demo-manufacturing.example",
      });

      if (result.success && result.messageId) {
        resendMessageId = result.messageId;
      }
    }

    // ── Save the message ──

    const message = await db.emailMessage.create({
      data: {
        threadId,
        direction,
        senderType,
        fromEmail,
        toEmails,
        subject: `Re: ${thread.subject}`,
        body: input.body,
        intent,
        metadata: resendMessageId ? { resendMessageId } : {},
      },
    });

    await db.emailThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    // ── If supplier message, trigger agent auto-processing ──

    let agentProcessing = null;

    if (isSupplier) {
      try {
        agentProcessing = await processSupplierMessage(threadId, input.body);
      } catch (processingError) {
        console.error("Agent processing failed:", processingError);
        agentProcessing = {
          success: false,
          summary: processingError instanceof Error
            ? processingError.message
            : "Agent processing failed.",
          linesUpdated: 0,
          poStatusChanged: false,
        };
      }
    }

    return NextResponse.json({
      message: isSupplier
        ? "Supplier message saved. Agent processing complete."
        : "Reply sent successfully.",
      data: message,
      agentProcessing,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { message: "Invalid payload", issues: error.flatten() },
        { status: 400 }
      );
    }
    console.error("Reply error:", error);
    return NextResponse.json({ message: "Failed to send reply" }, { status: 500 });
  }
}
