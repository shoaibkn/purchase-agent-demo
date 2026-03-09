import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const materialSchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  uom: z.string().min(1).max(30),
  defaultLeadTimeDays: z.number().int().min(0).max(365).optional(),
});

export async function GET() {
  try {
    const materials = await db.material.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ data: materials });
  } catch {
    return NextResponse.json({ message: "Failed to fetch materials." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = materialSchema.parse(payload);

    const material = await db.material.create({
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description,
        uom: input.uom,
        defaultLeadTimeDays: input.defaultLeadTimeDays,
      },
    });

    return NextResponse.json({ message: "Material created.", data: material }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid material payload.", issues: error.flatten() }, { status: 400 });
    }

    return NextResponse.json({ message: "Failed to create material." }, { status: 500 });
  }
}
