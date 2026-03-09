"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SupplierOption = {
  id: string;
  name: string;
};

type MaterialOption = {
  id: string;
  sku: string;
  name: string;
  uom: string;
};

type LineDraft = {
  materialId: string;
  orderedQty: string;
  unitPrice: string;
  requestedDate: string;
};

type CreatePoFormProps = {
  suppliers: SupplierOption[];
  materials: MaterialOption[];
};

const emptyLine: LineDraft = {
  materialId: "",
  orderedQty: "",
  unitPrice: "",
  requestedDate: "",
};

export function CreatePoForm({ suppliers, materials }: CreatePoFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const materialLabelById = useMemo(() => {
    return new Map(materials.map((material) => [material.id, `${material.sku} - ${material.name} (${material.uom})`]));
  }, [materials]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, idx) => (idx === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, { ...emptyLine }]);
  }

  function removeLine(index: number) {
    setLines((current) => {
      if (current.length === 1) {
        return current;
      }

      return current.filter((_, idx) => idx !== index);
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!supplierId) {
      setError("Select a supplier.");
      return;
    }

    const cleanedLines = lines
      .map((line) => ({
        materialId: line.materialId,
        orderedQty: Number(line.orderedQty),
        unitPrice: line.unitPrice ? Number(line.unitPrice) : undefined,
        requestedDate: line.requestedDate ? new Date(line.requestedDate).toISOString() : undefined,
      }))
      .filter((line) => line.materialId && Number.isFinite(line.orderedQty) && line.orderedQty > 0);

    if (cleanedLines.length === 0) {
      setError("Add at least one valid line item.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplierId,
          notes: notes || undefined,
          model,
          lines: cleanedLines,
        }),
      });

      const payload = (await response.json()) as {
        message?: string;
        data?: { poNumber?: string };
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to create purchase order.");
      }

      if (!payload.data?.poNumber) {
        throw new Error("Purchase order was created but PO number was missing in response.");
      }

      router.push(`/purchase-orders/${payload.data.poNumber}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create purchase order.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium">Supplier</span>
          <select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
            required
          >
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Agent Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
            placeholder="gpt-4.1-mini"
          />
        </label>
      </div>

      <label className="space-y-2 text-sm">
        <span className="font-medium">Notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="min-h-24 w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
          placeholder="Optional notes for supplier"
        />
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Line Items</h2>
          <button
            type="button"
            onClick={addLine}
            className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-1.5 text-sm font-medium"
          >
            Add line
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <article key={`${index}-${line.materialId}`} className="rounded-xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Line {index + 1}</p>
                <button type="button" onClick={() => removeLine(index)} className="text-xs text-[color:var(--muted)] underline-offset-4 hover:underline">
                  Remove
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1 text-sm lg:col-span-2">
                  <span>Material</span>
                  <select
                    value={line.materialId}
                    onChange={(event) => updateLine(index, { materialId: event.target.value })}
                    className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
                    required
                  >
                    <option value="">Select material</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {materialLabelById.get(material.id)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span>Ordered Qty</span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.orderedQty}
                    onChange={(event) => updateLine(index, { orderedQty: event.target.value })}
                    className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
                    required
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span>Unit Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={line.unitPrice}
                    onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                    className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span>Requested Date</span>
                  <input
                    type="date"
                    value={line.requestedDate}
                    onChange={(event) => updateLine(index, { requestedDate: event.target.value })}
                    className="w-full rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2"
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>

      {error ? <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Creating..." : "Create Purchase Order"}
        </button>
      </div>
    </form>
  );
}
