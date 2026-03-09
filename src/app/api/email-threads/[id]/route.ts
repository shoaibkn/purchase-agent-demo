import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const thread = await db.emailThread.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, primaryEmail: true } },
        purchaseOrder: {
          select: { id: true, poNumber: true, status: true, notes: true },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            thread: { select: { id: true, subject: true } },
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json({ message: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({ data: thread });
  } catch (error) {
    console.error("Get thread error:", error);
    return NextResponse.json({ message: "Failed to fetch thread" }, { status: 500 });
  }
}
