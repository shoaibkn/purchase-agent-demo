import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const materialUpdateSchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  uom: z.string().min(1).max(30),
  defaultLeadTimeDays: z.number().int().min(0).max(365).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await request.json();
    const input = materialUpdateSchema.parse(payload);

    const material = await db.material.update({
      where: { id },
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description,
        uom: input.uom,
        defaultLeadTimeDays: input.defaultLeadTimeDays,
      },
    });

    return NextResponse.json({ message: "Material updated.", data: material });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid material payload.", issues: error.flatten() }, { status: 400 });
    }

    return NextResponse.json({ message: "Failed to update material." }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.material.delete({ where: { id } });
    return NextResponse.json({ message: "Material deleted." });
  } catch {
    return NextResponse.json({ message: "Failed to delete material. Ensure it is not referenced by purchase orders." }, { status: 500 });
  }
}
