import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    message: "Line-level EDD overdue check job scaffolded.",
  });
}
