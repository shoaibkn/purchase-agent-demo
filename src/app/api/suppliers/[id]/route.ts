import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const supplierUpdateSchema = z.object({
  name: z.string().min(1).max(160),
  primaryEmail: z.string().email(),
  ccEmails: z.array(z.string().email()).default([]),
  timezone: z.string().max(80).optional(),
  paymentTerms: z.string().max(120).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = await request.json();
    const input = supplierUpdateSchema.parse(payload);

    const supplier = await db.supplier.update({
      where: { id },
      data: {
        name: input.name,
        primaryEmail: input.primaryEmail,
        ccEmails: input.ccEmails,
        timezone: input.timezone,
        paymentTerms: input.paymentTerms,
      },
    });

    return NextResponse.json({ message: "Supplier updated.", data: supplier });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid supplier payload.", issues: error.flatten() }, { status: 400 });
    }

    return NextResponse.json({ message: "Failed to update supplier." }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.supplier.delete({ where: { id } });
    return NextResponse.json({ message: "Supplier deleted." });
  } catch {
    return NextResponse.json({ message: "Failed to delete supplier. Ensure it is not referenced by purchase orders." }, { status: 500 });
  }
}
