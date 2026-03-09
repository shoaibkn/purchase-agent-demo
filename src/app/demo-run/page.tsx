"use client";

import { useState } from "react";
import Link from "next/link";

type ActionStatus = {
  action: string;
  status: "idle" | "loading" | "success" | "error";
  message: string;
};

export default function DemoRunPage() {
  const [actions, setActions] = useState<ActionStatus[]>([]);

  async function runAction(actionName: string) {
    setActions((prev) => [
      ...prev,
      { action: actionName, status: "loading", message: "Running..." },
    ]);

    try {
      const response = await fetch("/api/demo-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName }),
      });

      const payload = (await response.json()) as { message?: string; data?: unknown };

      setActions((prev) =>
        prev.map((a) =>
          a.action === actionName
            ? {
                ...a,
                status: response.ok ? "success" : "error",
                message: payload.message ?? (response.ok ? "Success" : "Failed"),
              }
            : a
        )
      );
    } catch (err) {
      setActions((prev) =>
        prev.map((a) =>
          a.action === actionName
            ? { ...a, status: "error", message: err instanceof Error ? err.message : "Error" }
            : a
        )
      );
    }
  }

  const quickActions = [
    {
      id: "create-sample-po",
      label: "Create Sample PO",
      description: "Creates a purchase order with the first supplier/material and triggers agent communication.",
    },
    {
      id: "run-ack-job",
      label: "Run ACK Reminder Job",
      description: "Executes the acknowledgment reminder scheduler for overdue POs.",
    },
    {
      id: "run-edd-job",
      label: "Run EDD Overdue Job",
      description: "Executes the EDD overdue check and sends follow-up emails.",
    },
    {
      id: "post-partial-receipt",
      label: "Post Partial Receipt",
      description: "Posts a partial goods receipt against the first open PO line.",
    },
  ];

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Demo Run</h1>
        <p className="text-[color:var(--muted)]">
          One-click actions to demonstrate the full purchase agent workflow. Use these for client walkthroughs.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {quickActions.map((action) => (
          <article
            key={action.id}
            className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5"
          >
            <h2 className="text-lg font-semibold">{action.label}</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">{action.description}</p>
            <button
              onClick={() => runAction(action.id)}
              className="mt-4 rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            >
              Run Action
            </button>
          </article>
        ))}
      </div>

      {actions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Action Results</h2>
          <div className="space-y-2">
            {actions.map((action, index) => (
              <div
                key={`${action.action}-${index}`}
                className={`rounded-lg border p-4 ${
                  action.status === "success"
                    ? "border-emerald-300 bg-emerald-50"
                    : action.status === "error"
                    ? "border-rose-300 bg-rose-50"
                    : action.status === "loading"
                    ? "border-amber-300 bg-amber-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <p className="font-medium">{action.action}</p>
                <p className="text-sm text-[color:var(--muted)]">{action.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5">
        <h2 className="text-lg font-semibold">Demo Workflow Guide</h2>
        <ol className="mt-3 space-y-2 text-sm text-[color:var(--muted)] list-decimal list-inside">
          <li>Click <strong className="text-[color:var(--foreground)]">Create Sample PO</strong> to generate a PO with agent communication.</li>
          <li>View the PO at <Link href="/purchase-orders" className="text-[color:var(--accent)] underline">/purchase-orders</Link> to see the timeline.</li>
          <li>Check <Link href="/dashboard" className="text-[color:var(--accent)] underline">/dashboard</Link> for updated KPIs.</li>
          <li>Click <strong className="text-[color:var(--foreground)]">Post Partial Receipt</strong> to simulate goods receiving.</li>
          <li>Run <strong className="text-[color:var(--foreground)]">ACK Reminder Job</strong> or <strong className="text-[color:var(--foreground)]">EDD Overdue Job</strong> to trigger scheduled tasks.</li>
        </ol>
      </div>
    </section>
  );
}
