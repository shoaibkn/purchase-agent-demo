import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const threadQuerySchema = z.object({
  search: z.string().optional(),
  supplierId: z.string().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  senderType: z.enum(["PURCHASER", "AGENT", "SUPPLIER"]).optional(),
  poStatus: z.enum(["CREATED", "SENT", "ACK_PENDING", "ACKNOWLEDGED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]).optional(),
  dateRange: z.enum(["today", "week", "month", "all"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = threadQuerySchema.parse({
      search: searchParams.get("search") ?? undefined,
      supplierId: searchParams.get("supplierId") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      senderType: searchParams.get("senderType") ?? undefined,
      poStatus: searchParams.get("poStatus") ?? undefined,
      dateRange: searchParams.get("dateRange") ?? undefined,
      page: searchParams.get("page") ?? 1,
      limit: searchParams.get("limit") ?? 20,
    });

    const { search, supplierId, direction, senderType, poStatus, dateRange, page, limit } = params;

    const dateFilter: { gte?: Date } | undefined = (() => {
      const now = new Date();
      switch (dateRange) {
        case "today":
          now.setHours(0, 0, 0, 0);
          return { gte: now };
        case "week":
          now.setDate(now.getDate() - 7);
          return { gte: now };
        case "month":
          now.setMonth(now.getMonth() - 1);
          return { gte: now };
        default:
          return undefined;
      }
    })();

    const messageFilter = {
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: "insensitive" as const } },
              { body: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(direction ? { direction } : {}),
      ...(senderType ? { senderType } : {}),
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    const hasMessageFilter = Object.keys(messageFilter).length > 0;

    const where = {
      ...(supplierId ? { supplierId } : {}),
      ...(poStatus ? { purchaseOrder: { status: poStatus } } : {}),
      ...(hasMessageFilter ? { messages: { some: messageFilter } } : {}),
    };

    const [threads, totalCount] = await Promise.all([
      db.emailThread.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, primaryEmail: true } },
          purchaseOrder: { select: { id: true, poNumber: true, status: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              direction: true,
              senderType: true,
              fromEmail: true,
              subject: true,
              body: true,
              createdAt: true,
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.emailThread.count({ where }),
    ]);

    const formattedThreads = threads.map((thread) => ({
      id: thread.id,
      subject: thread.subject,
      supplier: thread.supplier,
      purchaseOrder: thread.purchaseOrder,
      latestMessage: thread.messages[0] ?? null,
      messageCount: thread._count.messages,
      updatedAt: thread.updatedAt,
    }));

    return NextResponse.json({
      data: formattedThreads,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid query parameters", issues: error.flatten() },
        { status: 400 }
      );
    }
    console.error("Email threads list error:", error);
    return NextResponse.json({ message: "Failed to fetch email threads" }, { status: 500 });
  }
}
