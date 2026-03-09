import { NextResponse } from "next/server";

import { generateAgentDraft } from "@/lib/agent-processor";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: threadId } = await params;
    const draft = await generateAgentDraft(threadId);

    return NextResponse.json({ draft });
  } catch (error) {
    console.error("Generate draft error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to generate draft." },
      { status: 500 },
    );
  }
}
