import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { receiveGoodsAgainstPurchaseOrder, receiveGoodsSchema } from "@/lib/purchase-order-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ poNumber: string }> },
) {
  try {
    const { poNumber } = await params;
    const payload = await request.json();
    const input = receiveGoodsSchema.parse(payload);
    const purchaseOrder = await receiveGoodsAgainstPurchaseOrder(poNumber, input);

    return NextResponse.json({
      message: "Goods receipt posted successfully.",
      data: purchaseOrder,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          message: "Invalid goods receipt payload.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to post goods receipt.",
      },
      { status: 500 },
    );
  }
}
