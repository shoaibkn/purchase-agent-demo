"use client";

import { useState } from "react";

type AppSettingsView = {
  id: string;
  defaultModel: string;
  supplierMode: "rule_based" | "ai_persona";
  ackReminderHours: number;
  useRealEmail: boolean;
};

type Props = {
  initialSettings: AppSettingsView;
};

export function SettingsForm({ initialSettings }: Props) {
  const [defaultModel, setDefaultModel] = useState(initialSettings.defaultModel);
  const [supplierMode, setSupplierMode] = useState<AppSettingsView["supplierMode"]>(initialSettings.supplierMode);
  const [ackReminderHours, setAckReminderHours] = useState(String(initialSettings.ackReminderHours));
  const [useRealEmail, setUseRealEmail] = useState(initialSettings.useRealEmail);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    const parsedHours = Number(ackReminderHours);
    if (!Number.isInteger(parsedHours) || parsedHours < 1 || parsedHours > 168) {
      setError("ACK reminder hours must be an integer between 1 and 168.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defaultModel,
          supplierMode,
          ackReminderHours: parsedHours,
          useRealEmail,
        }),
      });

      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to save settings.");
      }

      setMessage(payload.message ?? "Settings saved.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <label className="space-y-1 text-sm">
        <span className="font-medium">Default Agent Model</span>
        <input
          value={defaultModel}
          onChange={(event) => setDefaultModel(event.target.value)}
          className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
          placeholder="gpt-4.1-mini"
          required
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium">Supplier Simulation Mode</span>
        <select
          value={supplierMode}
          onChange={(event) => setSupplierMode(event.target.value as AppSettingsView["supplierMode"])}
          className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
        >
          <option value="rule_based">Rule-based (recommended for demos)</option>
          <option value="ai_persona">AI persona</option>
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium">ACK Reminder SLA (hours)</span>
        <input
          type="number"
          min="1"
          max="168"
          value={ackReminderHours}
          onChange={(event) => setAckReminderHours(event.target.value)}
          className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
          required
        />
      </label>

      <label className="flex items-center gap-3 rounded-lg border border-[color:var(--card-border)] bg-white p-4">
        <input
          type="checkbox"
          checked={useRealEmail}
          onChange={(event) => setUseRealEmail(event.target.checked)}
          className="h-5 w-5 rounded border-[color:var(--card-border)]"
        />
        <div>
          <span className="font-medium">Use Real Email (Resend)</span>
          <p className="text-xs text-[color:var(--muted)]">
            Send real emails via Resend. When disabled, emails are only logged in the database.
          </p>
        </div>
      </label>

      {message ? <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">{message}</p> : null}
      {error ? <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900">{error}</p> : null}

      <button
        type="submit"
        disabled={isSaving}
        className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSaving ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
