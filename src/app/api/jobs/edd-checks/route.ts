import { NextResponse } from "next/server";

import { runEddOverdueJob } from "@/lib/purchase-order-service";

export async function POST() {
  try {
    const result = await runEddOverdueJob();
    return NextResponse.json({
      message: "EDD overdue check job completed.",
      result,
    });
  } catch {
    return NextResponse.json(
      {
        message: "EDD overdue check job failed.",
      },
      { status: 500 },
    );
  }
}
