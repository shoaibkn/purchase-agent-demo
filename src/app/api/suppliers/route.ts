import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const supplierSchema = z.object({
  name: z.string().min(1).max(160),
  primaryEmail: z.string().email(),
  ccEmails: z.array(z.string().email()).default([]),
  timezone: z.string().max(80).optional(),
  paymentTerms: z.string().max(120).optional(),
});

export async function GET() {
  try {
    const suppliers = await db.supplier.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ data: suppliers });
  } catch {
    return NextResponse.json({ message: "Failed to fetch suppliers." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = supplierSchema.parse(payload);

    const supplier = await db.supplier.create({
      data: {
        name: input.name,
        primaryEmail: input.primaryEmail,
        ccEmails: input.ccEmails,
        timezone: input.timezone,
        paymentTerms: input.paymentTerms,
      },
    });

    return NextResponse.json({ message: "Supplier created.", data: supplier }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid supplier payload.", issues: error.flatten() }, { status: 400 });
    }

    return NextResponse.json({ message: "Failed to create supplier." }, { status: 500 });
  }
}
