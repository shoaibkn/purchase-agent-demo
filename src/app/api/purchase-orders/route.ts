import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createPurchaseOrder, createPurchaseOrderSchema, listPurchaseOrders } from "@/lib/purchase-order-service";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = createPurchaseOrderSchema.parse(payload);
    const purchaseOrder = await createPurchaseOrder(input);

    return NextResponse.json(
      {
        message: "Purchase order created and supplier communication processed.",
        data: purchaseOrder,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          message: "Invalid purchase order payload.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to create purchase order.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const purchaseOrders = await listPurchaseOrders();
    return NextResponse.json({ data: purchaseOrders });
  } catch {
    return NextResponse.json(
      {
        message: "Failed to fetch purchase orders.",
      },
      { status: 500 },
    );
  }
}
