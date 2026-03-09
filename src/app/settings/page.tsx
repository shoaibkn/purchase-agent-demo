import { db } from "@/lib/db";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const existing = await db.appSetting.findFirst({ orderBy: { createdAt: "asc" } });
  const settings =
    existing ??
    (await db.appSetting.create({
      data: {
        defaultModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        supplierMode: "rule_based",
        ackReminderHours: 24,
        useRealEmail: false,
      },
    }));

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-[color:var(--muted)]">
          Configure model selection, supplier simulation strategy, and acknowledgment SLA.
        </p>
      </div>

      <div className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5">
        <SettingsForm
          initialSettings={{
            id: settings.id,
            defaultModel: settings.defaultModel,
            supplierMode: settings.supplierMode as "rule_based" | "ai_persona",
            ackReminderHours: settings.ackReminderHours,
            useRealEmail: settings.useRealEmail ?? false,
          }}
        />
      </div>
    </section>
  );
}
