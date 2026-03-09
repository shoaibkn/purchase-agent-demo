import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";

const updateSettingsSchema = z.object({
  defaultModel: z.string().min(1).max(120),
  supplierMode: z.enum(["rule_based", "ai_persona"]),
  ackReminderHours: z.number().int().min(1).max(168),
  useRealEmail: z.boolean().optional(),
});

async function getOrCreateSettings() {
  const existing = await db.appSetting.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return db.appSetting.create({
    data: {
      defaultModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      supplierMode: "rule_based",
      ackReminderHours: 24,
      useRealEmail: false,
    },
  });
}

export async function GET() {
  try {
    const settings = await getOrCreateSettings();
    return NextResponse.json({ data: settings });
  } catch {
    return NextResponse.json({ message: "Failed to load settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json();
    const input = updateSettingsSchema.parse(payload);
    const settings = await getOrCreateSettings();

    const updated = await db.appSetting.update({
      where: { id: settings.id },
      data: {
        defaultModel: input.defaultModel,
        supplierMode: input.supplierMode,
        ackReminderHours: input.ackReminderHours,
        useRealEmail: input.useRealEmail,
      },
    });

    return NextResponse.json({
      message: "Settings updated successfully.",
      data: updated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          message: "Invalid settings payload.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ message: "Failed to update settings." }, { status: 500 });
  }
}
