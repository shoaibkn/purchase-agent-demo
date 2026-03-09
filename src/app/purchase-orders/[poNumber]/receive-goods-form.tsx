"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ReceivableLine = {
  id: string;
  materialName: string;
  openQty: number;
};

type Props = {
  poNumber: string;
  lines: ReceivableLine[];
};

type LineInput = {
  acceptedQty: string;
  rejectedQty: string;
};

export function ReceiveGoodsForm({ poNumber, lines }: Props) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [lineInputs, setLineInputs] = useState<Record<string, LineInput>>(() => {
    const initial: Record<string, LineInput> = {};
    for (const line of lines) {
      initial[line.id] = { acceptedQty: "", rejectedQty: "" };
    }
    return initial;
  });

  function updateLine(lineId: string, patch: Partial<LineInput>) {
    setLineInputs((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        ...patch,
      },
    }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const receiptLines = lines
      .map((line) => {
        const acceptedQty = Number(lineInputs[line.id]?.acceptedQty ?? 0);
        const rejectedQty = Number(lineInputs[line.id]?.rejectedQty ?? 0);
        return {
          lineId: line.id,
          acceptedQty,
          rejectedQty,
          openQty: line.openQty,
        };
      })
      .filter((line) => line.acceptedQty > 0 || line.rejectedQty > 0);

    if (receiptLines.length === 0) {
      setError("Enter at least one accepted or rejected quantity.");
      return;
    }

    const hasInvalidQty = receiptLines.some((line) => line.acceptedQty > line.openQty || line.acceptedQty < 0 || line.rejectedQty < 0);
    if (hasInvalidQty) {
      setError("Accepted quantity must be between 0 and open quantity. Rejected quantity must be non-negative.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/purchase-orders/${poNumber}/receive-goods`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference: reference || undefined,
          receivedAt: receivedAt ? new Date(receivedAt).toISOString() : undefined,
          lines: receiptLines.map((line) => ({
            lineId: line.lineId,
            acceptedQty: line.acceptedQty,
            rejectedQty: line.rejectedQty,
          })),
        }),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to post goods receipt.");
      }

      setReference("");
      setReceivedAt("");
      setLineInputs(() => {
        const reset: Record<string, LineInput> = {};
        for (const line of lines) {
          reset[line.id] = { acceptedQty: "", rejectedQty: "" };
        }
        return reset;
      });
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to post goods receipt.");
    } finally {
      setSubmitting(false);
    }
  }

  if (lines.length === 0) {
    return <p className="text-sm text-[color:var(--muted)]">All lines are fully received.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Receipt Reference</span>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
            placeholder="GRN-2026-001"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Received At</span>
          <input
            type="datetime-local"
            value={receivedAt}
            onChange={(event) => setReceivedAt(event.target.value)}
            className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.id} className="rounded-xl border border-[color:var(--card-border)] p-3">
            <p className="text-sm font-medium">{line.materialName}</p>
            <p className="text-xs text-[color:var(--muted)]">Open Qty: {line.openQty}</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Accepted Qty</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={lineInputs[line.id]?.acceptedQty ?? ""}
                  onChange={(event) => updateLine(line.id, { acceptedQty: event.target.value })}
                  className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Rejected Qty</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={lineInputs[line.id]?.rejectedQty ?? ""}
                  onChange={(event) => updateLine(line.id, { rejectedQty: event.target.value })}
                  className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Posting receipt..." : "Post Goods Receipt"}
      </button>
    </form>
  );
}
