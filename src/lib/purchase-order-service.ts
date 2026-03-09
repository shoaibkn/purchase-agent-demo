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
import { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;
import { addDays, addHours, format } from "date-fns";
import { z } from "zod";

import { getModel } from "@/lib/ai";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";

async function sendOutboundEmail(tx: TxClient, params: {
  threadId: string;
  fromEmail: string;
  toEmails: string[];
  subject: string;
  body: string;
  intent?: string;
  senderType: SenderType;
}) {
  const { threadId, fromEmail, toEmails, subject, body, intent, senderType } = params;

  const appSetting = await tx.appSetting?.findFirst?.({ orderBy: { createdAt: "asc" } }) ?? await db.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
  const useRealEmail = appSetting?.useRealEmail ?? false;

  let messageId: string | undefined;

  if (useRealEmail) {
    const result = await sendEmail({
      to: toEmails,
      subject,
      body,
      replyTo: fromEmail,
    });

    if (result.success && result.messageId) {
      messageId = result.messageId;
    }
  }

  return tx.emailMessage.create({
    data: {
      threadId,
      direction: MessageDirection.OUTBOUND,
      senderType,
      fromEmail,
      toEmails,
      subject,
      body,
      intent,
      metadata: messageId ? { resendMessageId: messageId } : {},
    },
  });
}

const lineInputSchema = z.object({
  materialId: z.string().min(1),
  orderedQty: z.number().positive(),
  unitPrice: z.number().positive().optional(),
  requestedDate: z.string().datetime().optional(),
});

const inboundLineUpdateSchema = z.object({
  lineId: z.string().min(1),
  proposedDate: z.string().datetime(),
  note: z.string().max(500).optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  model: z.string().min(1).optional(),
  simulateReply: z.boolean().optional(),
  lines: z.array(lineInputSchema).min(1),
});

export const simulatedInboundEmailSchema = z.object({
  poNumber: z.string().min(1),
  fromEmail: z.string().email().optional(),
  body: z.string().min(1),
  lineUpdates: z.array(inboundLineUpdateSchema).min(1),
  model: z.string().min(1).optional(),
});

const receiptLineSchema = z.object({
  lineId: z.string().min(1),
  acceptedQty: z.number().min(0),
  rejectedQty: z.number().min(0).optional(),
});

export const receiveGoodsSchema = z.object({
  reference: z.string().max(120).optional(),
  receivedAt: z.string().datetime().optional(),
  lines: z.array(receiptLineSchema).min(1),
});

type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
type SimulatedInboundEmailInput = z.infer<typeof simulatedInboundEmailSchema>;
type ReceiveGoodsInput = z.infer<typeof receiveGoodsSchema>;

type TransactionClient = Prisma.TransactionClient;

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

async function nextPoNumber(tx: TransactionClient): Promise<string> {
  const prefix = `PO-${format(new Date(), "yyyyMMdd")}`;
  const count = await tx.purchaseOrder.count({
    where: {
      poNumber: {
        startsWith: `${prefix}-`,
      },
    },
  });

  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
}

async function draftOutboundPoEmail(input: {
  poNumber: string;
  supplierName: string;
  lines: Array<{ materialName: string; quantity: string; requestedDate?: Date | null }>;
  model: string;
}): Promise<string> {
  const fallbackBody = [
    `Hello ${input.supplierName},`,
    "",
    `A new purchase order ${input.poNumber} has been raised. Please acknowledge and confirm line-level delivery dates.`,
    "",
    ...input.lines.map((line, index) => {
      const dateText = line.requestedDate ? format(line.requestedDate, "yyyy-MM-dd") : "To be proposed by supplier";
      return `${index + 1}. ${line.materialName} - Qty ${line.quantity} - Requested Date: ${dateText}`;
    }),
    "",
    "Please reply with acknowledgment and feasible delivery plan.",
    "",
    "Regards,",
    "Purchase Team",
  ].join("\n");

  if (!process.env.OPENAI_API_KEY) {
    return fallbackBody;
  }

  try {
    const model = getModel(input.model);
    const response = await model.invoke([
      {
        role: "system",
        content:
          "You are a procurement coordinator. Draft concise supplier emails with clear line-level asks and professional tone.",
      },
      {
        role: "user",
        content: `Draft an email to supplier ${input.supplierName} for PO ${input.poNumber}. Mention each line and ask for acknowledgment and line-level EDD confirmation. Keep it under 140 words.\n${JSON.stringify(
          input.lines,
        )}`,
      },
    ]);

    const content = contentToText(response.content);
    return content || fallbackBody;
  } catch {
    return fallbackBody;
  }
}

function computeSupplierPromise(params: {
  requestedDate?: Date | null;
  leadTimeDays?: number | null;
}): { promisedDate: Date; lineStatus: PurchaseOrderLineStatus; reason: string } {
  const leadTime = params.leadTimeDays ?? 7;
  const earliestDate = addDays(new Date(), leadTime);

  if (!params.requestedDate) {
    return {
      promisedDate: earliestDate,
      lineStatus: PurchaseOrderLineStatus.CONFIRMED,
      reason: "Requested date not provided. Closest feasible date proposed.",
    };
  }

  if (params.requestedDate >= earliestDate) {
    return {
      promisedDate: params.requestedDate,
      lineStatus: PurchaseOrderLineStatus.CONFIRMED,
      reason: "Requested date approved.",
    };
  }

  return {
    promisedDate: earliestDate,
    lineStatus: PurchaseOrderLineStatus.RESCHEDULED,
    reason: "Requested date not feasible. Closest feasible date proposed.",
  };
}

function buildSupplierReplyEmail(input: {
  supplierName: string;
  poNumber: string;
  confirmations: Array<{
    materialName: string;
    orderedQty: Prisma.Decimal;
    requestedDate: Date | null;
    promisedDate: Date;
    reason: string;
  }>;
}): string {
  const intro = `Hello Purchase Team,\n\nAcknowledged ${input.poNumber}. Please find line-level commitment below:\n`;
  const rows = input.confirmations
    .map((item, index) => {
      const requested = item.requestedDate ? format(item.requestedDate, "yyyy-MM-dd") : "N/A";
      const promised = format(item.promisedDate, "yyyy-MM-dd");
      return `${index + 1}. ${item.materialName} | Qty ${item.orderedQty.toString()} | Requested ${requested} | Promised ${promised} | ${item.reason}`;
    })
    .join("\n");

  return `${intro}${rows}\n\nRegards,\n${input.supplierName}`;
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
    });

    if (!supplier) {
      throw new Error("Supplier not found.");
    }

    const materialIds = [...new Set(input.lines.map((line) => line.materialId))];
    const materials = await tx.material.findMany({
      where: { id: { in: materialIds } },
    });

    if (materials.length !== materialIds.length) {
      throw new Error("One or more materials are invalid.");
    }

    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const appSetting = await tx.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
    const selectedModel = input.model ?? appSetting?.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

    const poNumber = await nextPoNumber(tx);
    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: supplier.id,
        notes: input.notes,
        status: PurchaseOrderStatus.SENT,
      },
    });

    const createdLines = [] as Array<
      Prisma.PurchaseOrderLineGetPayload<{ include: { material: true } }>
    >;

    for (const line of input.lines) {
      const material = materialMap.get(line.materialId);
      if (!material) {
        throw new Error(`Material ${line.materialId} not found.`);
      }

      const requestedDate = line.requestedDate ? new Date(line.requestedDate) : null;
      const created = await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          materialId: material.id,
          orderedQty: line.orderedQty,
          openQty: line.orderedQty,
          unitPrice: line.unitPrice,
          requestedDate,
          lineStatus: requestedDate
            ? PurchaseOrderLineStatus.PENDING_CONFIRMATION
            : PurchaseOrderLineStatus.DATE_NEGOTIATION,
        },
        include: {
          material: true,
        },
      });

      createdLines.push(created);
    }

    const thread = await tx.emailThread.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        supplierId: supplier.id,
        subject: `[${poNumber}] New Purchase Order`,
      },
    });

    const outboundBody = await draftOutboundPoEmail({
      poNumber,
      supplierName: supplier.name,
      lines: createdLines.map((line) => ({
        materialName: line.material.name,
        quantity: line.orderedQty.toString(),
        requestedDate: line.requestedDate,
      })),
      model: selectedModel,
    });

    await sendOutboundEmail(tx, {
      threadId: thread.id,
      fromEmail: "buyer@demo-manufacturing.example",
      toEmails: [supplier.primaryEmail, ...supplier.ccEmails],
      subject: `[${poNumber}] New Purchase Order`,
      body: outboundBody,
      intent: "po_created_notification",
      senderType: SenderType.PURCHASER,
    });

    const agentRun = await tx.agentRun.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        trigger: AgentRunTrigger.PO_CREATED,
        model: selectedModel,
        decision: "PO notification sent. Awaiting supplier acknowledgment.",
        status: AgentRunStatus.PENDING,
      },
    });

    const confirmations = createdLines.map((line) => {
      const result = computeSupplierPromise({
        requestedDate: line.requestedDate,
        leadTimeDays: line.material.defaultLeadTimeDays,
      });

      return {
        line,
        ...result,
      };
    });

    for (const confirmation of confirmations) {
      await tx.purchaseOrderLine.update({
        where: { id: confirmation.line.id },
        data: {
          approvedDate: confirmation.promisedDate,
          latestEdd: confirmation.promisedDate,
          lineStatus: confirmation.lineStatus,
          deliveryCommitments: {
            create: {
              promisedDate: confirmation.promisedDate,
              promisedQty: confirmation.line.orderedQty,
              source: "Supplier",
            },
          },
        },
      });

      await tx.reminderTask.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          poLineId: confirmation.line.id,
          type: ReminderTaskType.EDD_OVERDUE_FOLLOWUP,
          runAt: confirmation.promisedDate,
          status: ReminderTaskStatus.PENDING,
        },
      });
    }

    const simulateReply = input.simulateReply ?? true;

    if (simulateReply) {
      const inboundBody = buildSupplierReplyEmail({
        supplierName: supplier.name,
        poNumber,
        confirmations: confirmations.map((confirmation) => ({
          materialName: confirmation.line.material.name,
          orderedQty: confirmation.line.orderedQty,
          requestedDate: confirmation.line.requestedDate,
          promisedDate: confirmation.promisedDate,
          reason: confirmation.reason,
        })),
      });

      await tx.emailMessage.create({
        data: {
          threadId: thread.id,
          direction: MessageDirection.INBOUND,
          senderType: SenderType.SUPPLIER,
          fromEmail: supplier.primaryEmail,
          toEmails: ["buyer@demo-manufacturing.example"],
          subject: `Re: [${poNumber}] New Purchase Order`,
          body: inboundBody,
          intent: "supplier_ack_with_edd",
        },
      });

      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          status: PurchaseOrderStatus.ACKNOWLEDGED,
        },
      });

      await tx.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.SUCCESS,
          decision: "PO notification sent and supplier acknowledgment simulated with line-level EDD commitments.",
        },
      });
    } else {
      await tx.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.SUCCESS,
          decision: "PO notification sent. Awaiting supplier acknowledgment.",
        },
      });
    }

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrder.id },
      include: {
        supplier: true,
        lines: {
          include: {
            material: true,
            deliveryCommitments: true,
          },
        },
        emailThreads: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        agentRuns: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });
}

export async function listPurchaseOrders() {
  return db.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: true,
      lines: {
        include: {
          material: true,
        },
      },
    },
    take: 50,
  });
}

export async function processSimulatedInboundEmail(input: SimulatedInboundEmailInput) {
  return db.$transaction(async (tx) => {
    const purchaseOrder = await tx.purchaseOrder.findUnique({
      where: { poNumber: input.poNumber },
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
      throw new Error("Purchase order not found.");
    }

    const appSetting = await tx.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
    const selectedModel = input.model ?? appSetting?.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

    const lineMap = new Map(purchaseOrder.lines.map((line) => [line.id, line]));
    for (const update of input.lineUpdates) {
      if (!lineMap.has(update.lineId)) {
        throw new Error(`Line ${update.lineId} does not belong to PO ${input.poNumber}.`);
      }
    }

    const thread =
      purchaseOrder.emailThreads[0] ??
      (await tx.emailThread.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId,
          subject: `[${purchaseOrder.poNumber}] Purchase Order Thread`,
        },
      }));

    await tx.emailMessage.create({
      data: {
        threadId: thread.id,
        direction: MessageDirection.INBOUND,
        senderType: SenderType.SUPPLIER,
        fromEmail: input.fromEmail ?? purchaseOrder.supplier.primaryEmail,
        toEmails: ["buyer@demo-manufacturing.example"],
        subject: `Re: [${purchaseOrder.poNumber}] Purchase Order Update`,
        body: input.body,
        intent: "supplier_update_manual",
      },
    });

    const agentRun = await tx.agentRun.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        trigger: AgentRunTrigger.SUPPLIER_REPLY_RECEIVED,
        model: selectedModel,
        decision: "Supplier inbound email received. Processing line-level EDD updates.",
        status: AgentRunStatus.PENDING,
      },
    });

    for (const update of input.lineUpdates) {
      const poLine = lineMap.get(update.lineId);
      if (!poLine) {
        continue;
      }

      const proposedDate = new Date(update.proposedDate);
      const isApprovedRequest = !poLine.requestedDate || proposedDate <= poLine.requestedDate;

      await tx.purchaseOrderLine.update({
        where: { id: poLine.id },
        data: {
          approvedDate: proposedDate,
          latestEdd: proposedDate,
          lineStatus: isApprovedRequest ? PurchaseOrderLineStatus.CONFIRMED : PurchaseOrderLineStatus.RESCHEDULED,
          deliveryCommitments: {
            create: {
              promisedDate: proposedDate,
              promisedQty: poLine.openQty,
              source: "Supplier",
            },
          },
        },
      });

      await tx.reminderTask.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          poLineId: poLine.id,
          type: ReminderTaskType.EDD_OVERDUE_FOLLOWUP,
          runAt: proposedDate,
          status: ReminderTaskStatus.PENDING,
        },
      });
    }

    const allLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: purchaseOrder.id },
    });
    const allConfirmed = allLines.every(
      (line) =>
        line.lineStatus === PurchaseOrderLineStatus.CONFIRMED ||
        line.lineStatus === PurchaseOrderLineStatus.RESCHEDULED,
    );

    if (allConfirmed) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          status: PurchaseOrderStatus.ACKNOWLEDGED,
        },
      });
    }

    await tx.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: AgentRunStatus.SUCCESS,
        decision: "Inbound supplier response processed and EDD updates recorded.",
      },
    });

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrder.id },
      include: {
        supplier: true,
        lines: {
          include: {
            material: true,
            deliveryCommitments: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
        emailThreads: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        agentRuns: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });
}

export async function receiveGoodsAgainstPurchaseOrder(poNumber: string, input: ReceiveGoodsInput) {
  return db.$transaction(async (tx) => {
    const purchaseOrder = await tx.purchaseOrder.findUnique({
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
      throw new Error("Purchase order not found.");
    }

    const lineMap = new Map(purchaseOrder.lines.map((line) => [line.id, line]));
    const receiptRows = input.lines
      .map((line) => ({
        lineId: line.lineId,
        acceptedQty: line.acceptedQty,
        rejectedQty: line.rejectedQty ?? 0,
      }))
      .filter((line) => line.acceptedQty > 0 || line.rejectedQty > 0);

    if (receiptRows.length === 0) {
      throw new Error("At least one receipt line must have accepted or rejected quantity.");
    }

    for (const row of receiptRows) {
      const poLine = lineMap.get(row.lineId);
      if (!poLine) {
        throw new Error(`Line ${row.lineId} is not part of purchase order ${poNumber}.`);
      }

      const openQty = Number(poLine.openQty.toString());
      if (row.acceptedQty > openQty) {
        throw new Error(`Accepted quantity exceeds open quantity for line ${poLine.id}.`);
      }
    }

    const goodsReceipt = await tx.goodsReceipt.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        reference: input.reference,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      },
    });

    for (const row of receiptRows) {
      const poLine = lineMap.get(row.lineId);
      if (!poLine) {
        continue;
      }

      await tx.goodsReceiptLine.create({
        data: {
          goodsReceiptId: goodsReceipt.id,
          poLineId: poLine.id,
          receivedQty: row.acceptedQty + row.rejectedQty,
          acceptedQty: row.acceptedQty,
          rejectedQty: row.rejectedQty,
        },
      });

      const currentOpenQty = Number(poLine.openQty.toString());
      const newOpenQty = Math.max(0, currentOpenQty - row.acceptedQty);

      await tx.purchaseOrderLine.update({
        where: { id: poLine.id },
        data: {
          openQty: newOpenQty,
          lineStatus: newOpenQty === 0 ? PurchaseOrderLineStatus.RECEIVED : PurchaseOrderLineStatus.PARTIALLY_RECEIVED,
        },
      });

      if (newOpenQty > 0 && poLine.latestEdd && poLine.latestEdd < new Date()) {
        await tx.reminderTask.create({
          data: {
            purchaseOrderId: purchaseOrder.id,
            poLineId: poLine.id,
            type: ReminderTaskType.EDD_OVERDUE_FOLLOWUP,
            runAt: addDays(new Date(), 1),
            status: ReminderTaskStatus.PENDING,
          },
        });
      }
    }

    const refreshedLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: purchaseOrder.id },
    });
    const allReceived = refreshedLines.every((line) => Number(line.openQty.toString()) === 0);
    const anyReceived = refreshedLines.some((line) => Number(line.openQty.toString()) < Number(line.orderedQty.toString()));

    let nextPoStatus: PurchaseOrderStatus = purchaseOrder.status;
    if (allReceived) {
      nextPoStatus = PurchaseOrderStatus.CLOSED;
    } else if (anyReceived) {
      nextPoStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;
    }

    await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        status: nextPoStatus,
      },
    });

    const thread =
      purchaseOrder.emailThreads[0] ??
      (await tx.emailThread.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId,
          subject: `[${purchaseOrder.poNumber}] Purchase Order Thread`,
        },
      }));

    await sendOutboundEmail(tx, {
      threadId: thread.id,
      fromEmail: "buyer@demo-manufacturing.example",
      toEmails: [purchaseOrder.supplier.primaryEmail, ...purchaseOrder.supplier.ccEmails],
      subject: `[${purchaseOrder.poNumber}] Goods Receipt Update`,
      body: `Goods receipt ${goodsReceipt.reference ?? goodsReceipt.id} recorded for PO ${purchaseOrder.poNumber}. Please review outstanding quantities for remaining lines if any.`,
      intent: "goods_receipt_posted",
      senderType: SenderType.PURCHASER,
    });

    await tx.agentRun.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        trigger: AgentRunTrigger.GOODS_RECEIPT_CREATED,
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        decision: `Goods receipt posted with ${receiptRows.length} lines. PO status set to ${nextPoStatus}.`,
        status: AgentRunStatus.SUCCESS,
      },
    });

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrder.id },
      include: {
        supplier: true,
        lines: {
          include: {
            material: true,
            deliveryCommitments: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
        goodsReceipts: {
          include: {
            lines: true,
          },
          orderBy: { createdAt: "desc" },
        },
        emailThreads: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
  });
}

export async function scheduleAckReminderForUnacknowledged(poId: string, hours: number) {
  await db.reminderTask.create({
    data: {
      purchaseOrderId: poId,
      type: ReminderTaskType.ACK_REMINDER,
      runAt: addHours(new Date(), hours),
      status: ReminderTaskStatus.PENDING,
    },
  });
}

export async function runAckReminderJob(limit = 50) {
  const dueTasks = await db.reminderTask.findMany({
    where: {
      type: ReminderTaskType.ACK_REMINDER,
      status: ReminderTaskStatus.PENDING,
      runAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      runAt: "asc",
    },
    take: limit,
  });

  const result = {
    scanned: dueTasks.length,
    reminded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const task of dueTasks) {
    try {
      await db.$transaction(async (tx) => {
        const lock = await tx.reminderTask.updateMany({
          where: {
            id: task.id,
            status: ReminderTaskStatus.PENDING,
          },
          data: {
            status: ReminderTaskStatus.RUNNING,
          },
        });

        if (lock.count === 0) {
          return;
        }

        const currentTask = await tx.reminderTask.findUnique({
          where: { id: task.id },
          include: {
            purchaseOrder: {
              include: {
                supplier: true,
                emailThreads: {
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
        });

        if (!currentTask) {
          return;
        }

        const po = currentTask.purchaseOrder;

        if (po.status === PurchaseOrderStatus.ACKNOWLEDGED || po.status === PurchaseOrderStatus.CLOSED) {
          await tx.reminderTask.update({
            where: { id: currentTask.id },
            data: {
              status: ReminderTaskStatus.COMPLETED,
              attempts: {
                increment: 1,
              },
            },
          });
          result.skipped += 1;
          return;
        }

        const thread =
          po.emailThreads[0] ??
          (await tx.emailThread.create({
            data: {
              purchaseOrderId: po.id,
              supplierId: po.supplierId,
              subject: `[${po.poNumber}] Purchase Order Thread`,
            },
          }));

        await sendOutboundEmail(tx, {
          threadId: thread.id,
          fromEmail: "buyer@demo-manufacturing.example",
          toEmails: [po.supplier.primaryEmail, ...po.supplier.ccEmails],
          subject: `[${po.poNumber}] Reminder: Acknowledgment Pending`,
          body: `Hello ${po.supplier.name},\n\nThis is a reminder to acknowledge PO ${po.poNumber}. Please confirm line-level EDDs.\n\nRegards,\nPurchase Team`,
          intent: "ack_reminder_24h",
          senderType: SenderType.AGENT,
        });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: PurchaseOrderStatus.ACK_PENDING,
          },
        });

        await tx.agentRun.create({
          data: {
            purchaseOrderId: po.id,
            trigger: AgentRunTrigger.ACK_REMINDER_DUE,
            model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
            decision: "24-hour acknowledgment reminder sent to supplier.",
            status: AgentRunStatus.SUCCESS,
          },
        });

        await tx.reminderTask.update({
          where: { id: currentTask.id },
          data: {
            status: ReminderTaskStatus.COMPLETED,
            attempts: {
              increment: 1,
            },
          },
        });

        result.reminded += 1;
      });
    } catch {
      result.failed += 1;
      await db.reminderTask.update({
        where: { id: task.id },
        data: {
          status: ReminderTaskStatus.FAILED,
          attempts: {
            increment: 1,
          },
        },
      });
    }
  }

  return result;
}

export async function runEddOverdueJob(limit = 100) {
  const dueTasks = await db.reminderTask.findMany({
    where: {
      type: ReminderTaskType.EDD_OVERDUE_FOLLOWUP,
      status: ReminderTaskStatus.PENDING,
      runAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      runAt: "asc",
    },
    take: limit,
  });

  const result = {
    scanned: dueTasks.length,
    overdueFollowups: 0,
    skipped: 0,
    failed: 0,
  };

  for (const task of dueTasks) {
    try {
      await db.$transaction(async (tx) => {
        const lock = await tx.reminderTask.updateMany({
          where: {
            id: task.id,
            status: ReminderTaskStatus.PENDING,
          },
          data: {
            status: ReminderTaskStatus.RUNNING,
          },
        });

        if (lock.count === 0) {
          return;
        }

        const currentTask = await tx.reminderTask.findUnique({
          where: { id: task.id },
          include: {
            purchaseOrder: {
              include: {
                supplier: true,
                emailThreads: {
                  orderBy: { createdAt: "asc" },
                },
              },
            },
            poLine: {
              include: {
                material: true,
              },
            },
          },
        });

        if (!currentTask || !currentTask.poLine) {
          await tx.reminderTask.update({
            where: { id: task.id },
            data: {
              status: ReminderTaskStatus.COMPLETED,
              attempts: {
                increment: 1,
              },
            },
          });
          result.skipped += 1;
          return;
        }

        const po = currentTask.purchaseOrder;
        const line = currentTask.poLine;

        if (line.openQty.lte(0) || line.lineStatus === PurchaseOrderLineStatus.RECEIVED) {
          await tx.reminderTask.update({
            where: { id: task.id },
            data: {
              status: ReminderTaskStatus.COMPLETED,
              attempts: {
                increment: 1,
              },
            },
          });
          result.skipped += 1;
          return;
        }

        const thread =
          po.emailThreads[0] ??
          (await tx.emailThread.create({
            data: {
              purchaseOrderId: po.id,
              supplierId: po.supplierId,
              subject: `[${po.poNumber}] Purchase Order Thread`,
            },
          }));

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            lineStatus: PurchaseOrderLineStatus.OVERDUE,
          },
        });

        await sendOutboundEmail(tx, {
          threadId: thread.id,
          fromEmail: "buyer@demo-manufacturing.example",
          toEmails: [po.supplier.primaryEmail, ...po.supplier.ccEmails],
          subject: `[${po.poNumber}] Overdue Follow-up for ${line.material.name}`,
          body: `Hello ${po.supplier.name},\n\nDelivery for ${line.material.name} is overdue. Open quantity is ${line.openQty.toString()}. Please share revised line-level EDD and any staggered delivery split.\n\nRegards,\nPurchase Team`,
          intent: "edd_overdue_followup",
          senderType: SenderType.AGENT,
        });

        await tx.agentRun.create({
          data: {
            purchaseOrderId: po.id,
            trigger: AgentRunTrigger.EDD_OVERDUE,
            model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
            decision: `Overdue follow-up sent for line ${line.id}.`,
            status: AgentRunStatus.SUCCESS,
          },
        });

        await tx.reminderTask.update({
          where: { id: task.id },
          data: {
            status: ReminderTaskStatus.COMPLETED,
            attempts: {
              increment: 1,
            },
          },
        });

        await tx.reminderTask.create({
          data: {
            purchaseOrderId: po.id,
            poLineId: line.id,
            type: ReminderTaskType.EDD_OVERDUE_FOLLOWUP,
            runAt: addDays(new Date(), 1),
            status: ReminderTaskStatus.PENDING,
          },
        });

        result.overdueFollowups += 1;
      });
    } catch {
      result.failed += 1;
      await db.reminderTask.update({
        where: { id: task.id },
        data: {
          status: ReminderTaskStatus.FAILED,
          attempts: {
            increment: 1,
          },
        },
      });
    }
  }

  return result;
}
