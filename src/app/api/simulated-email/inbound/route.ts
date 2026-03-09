import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      message: "Simulated inbound email endpoint scaffolded.",
    },
    { status: 202 },
  );
}
