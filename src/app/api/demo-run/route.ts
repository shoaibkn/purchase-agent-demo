import { NextResponse } from "next/server";

import { createPurchaseOrder } from "@/lib/purchase-order-service";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { action } = payload as { action: string };

    if (action === "create-sample-po") {
      const supplier = await db.supplier.findFirst({ orderBy: { createdAt: "asc" } });
      const material = await db.material.findFirst({ orderBy: { createdAt: "asc" } });

      if (!supplier || !material) {
        return NextResponse.json(
          { message: "Seed data missing. Run prisma seed first." },
          { status: 400 }
        );
      }

      const po = await createPurchaseOrder({
        supplierId: supplier.id,
        notes: "Demo purchase order created via quick action.",
        model: "gpt-4.1-mini",
        simulateReply: false,
        lines: [
          {
            materialId: material.id,
            orderedQty: 500,
            unitPrice: 50,
            requestedDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      });

      return NextResponse.json({
        message: "Sample PO created.",
        data: { poNumber: (po as { poNumber: string }).poNumber },
      });
    }

    if (action === "run-ack-job") {
      const { runAckReminderJob } = await import("@/lib/purchase-order-service");
      const result = await runAckReminderJob(10);
      return NextResponse.json({
        message: "ACK reminder job executed.",
        result,
      });
    }

    if (action === "run-edd-job") {
      const { runEddOverdueJob } = await import("@/lib/purchase-order-service");
      const result = await runEddOverdueJob(10);
      return NextResponse.json({
        message: "EDD overdue job executed.",
        result,
      });
    }

    if (action === "post-partial-receipt") {
      const { receiveGoodsAgainstPurchaseOrder } = await import("@/lib/purchase-order-service");
      const openPo = await db.purchaseOrder.findFirst({
        where: {
          status: { in: ["ACKNOWLEDGED", "PARTIALLY_RECEIVED"] },
        },
        include: { lines: { where: { openQty: { gt: 0 } } } },
        orderBy: { createdAt: "desc" },
      });

      if (!openPo || openPo.lines.length === 0) {
        return NextResponse.json(
          { message: "No PO with open lines to receive against." },
          { status: 400 }
        );
      }

      const line = openPo.lines[0];
      const receiveQty = Math.floor(Number(line.openQty.toString()) / 2) || 1;

      const result = await receiveGoodsAgainstPurchaseOrder(openPo.poNumber, {
        lines: [
          {
            lineId: line.id,
            acceptedQty: receiveQty,
            rejectedQty: 0,
          },
        ],
      });

      return NextResponse.json({
        message: `Posted partial receipt: ${receiveQty} against ${openPo.poNumber}.`,
        data: result,
      });
    }

    return NextResponse.json({ message: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Demo action failed.",
      },
      { status: 500 }
    );
  }
}
