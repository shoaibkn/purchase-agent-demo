import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { processSimulatedInboundEmail, simulatedInboundEmailSchema } from "@/lib/purchase-order-service";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = simulatedInboundEmailSchema.parse(payload);
    const purchaseOrder = await processSimulatedInboundEmail(input);

    return NextResponse.json({
      message: "Inbound supplier email processed.",
      data: purchaseOrder,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          message: "Invalid inbound email payload.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to process inbound email.",
      },
      { status: 500 },
    );
  }
}
