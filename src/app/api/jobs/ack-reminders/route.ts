import { NextResponse } from "next/server";

import { runAckReminderJob } from "@/lib/purchase-order-service";

export async function POST() {
  try {
    const result = await runAckReminderJob();
    return NextResponse.json({
      message: "Acknowledgment reminder job completed.",
      result,
    });
  } catch {
    return NextResponse.json(
      {
        message: "Acknowledgment reminder job failed.",
      },
      { status: 500 },
    );
  }
}
