import {
  AgentRunStatus,
  AgentRunTrigger,
  MessageDirection,
  Prisma,
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
  ReminderTaskStatus,
  ReminderTaskType,
} from "@prisma/client";
import { addDays, addHours, format } from "date-fns";
import { z } from "zod";

import { getModel } from "@/lib/ai";
import { db } from "@/lib/db";

const lineInputSchema = z.object({
  materialId: z.string().min(1),
  orderedQty: z.number().positive(),
  unitPrice: z.number().positive().optional(),
  requestedDate: z.string().datetime().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  model: z.string().min(1).optional(),
  lines: z.array(lineInputSchema).min(1),
});

type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

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

    await tx.emailMessage.create({
      data: {
        threadId: thread.id,
        direction: MessageDirection.OUTBOUND,
        fromEmail: "buyer@demo-manufacturing.example",
        toEmails: [supplier.primaryEmail, ...supplier.ccEmails],
        subject: `[${poNumber}] New Purchase Order`,
        body: outboundBody,
        intent: "po_created_notification",
      },
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
