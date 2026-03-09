"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Material = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  uom: string;
  defaultLeadTimeDays: number | null;
};

type Props = {
  initialMaterials: Material[];
};

type Draft = {
  sku: string;
  name: string;
  description: string;
  uom: string;
  defaultLeadTimeDays: string;
};

const emptyDraft: Draft = {
  sku: "",
  name: "",
  description: "",
  uom: "",
  defaultLeadTimeDays: "",
};

function toPayload(draft: Draft) {
  return {
    sku: draft.sku,
    name: draft.name,
    description: draft.description || undefined,
    uom: draft.uom,
    defaultLeadTimeDays: draft.defaultLeadTimeDays ? Number(draft.defaultLeadTimeDays) : undefined,
  };
}

export function MaterialsManager({ initialMaterials }: Props) {
  const router = useRouter();
  const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft);
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>(() => {
    const map: Record<string, Draft> = {};
    for (const material of initialMaterials) {
      map[material.id] = {
        sku: material.sku,
        name: material.name,
        description: material.description ?? "",
        uom: material.uom,
        defaultLeadTimeDays: material.defaultLeadTimeDays?.toString() ?? "",
      };
    }
    return map;
  });

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setBusyId("create");

    try {
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(createDraft)),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to create material.");
      }

      setCreateDraft(emptyDraft);
      setMessage(payload.message ?? "Material created.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create material.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(id: string) {
    setMessage("");
    setError("");
    setBusyId(id);

    try {
      const response = await fetch(`/api/materials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(editDrafts[id])),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update material.");
      }

      setMessage(payload.message ?? "Material updated.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update material.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setMessage("");
    setError("");
    setBusyId(id);

    try {
      const response = await fetch(`/api/materials/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to delete material.");
      }

      setMessage(payload.message ?? "Material deleted.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to delete material.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="grid gap-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4 md:grid-cols-2">
        <input
          value={createDraft.sku}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, sku: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="SKU"
          required
        />
        <input
          value={createDraft.name}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, name: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="Material name"
          required
        />
        <input
          value={createDraft.uom}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, uom: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="UOM"
          required
        />
        <input
          type="number"
          min="0"
          value={createDraft.defaultLeadTimeDays}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, defaultLeadTimeDays: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="Default lead time (days)"
        />
        <input
          value={createDraft.description}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, description: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm md:col-span-2"
          placeholder="Description"
        />
        <button
          type="submit"
          disabled={busyId === "create"}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white md:w-fit"
        >
          {busyId === "create" ? "Creating..." : "Add Material"}
        </button>
      </form>

      {message ? <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">{message}</p> : null}
      {error ? <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900">{error}</p> : null}

      <div className="space-y-3">
        {initialMaterials.map((material) => (
          <article key={material.id} className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={editDrafts[material.id]?.sku ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [material.id]: { ...prev[material.id], sku: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
              />
              <input
                value={editDrafts[material.id]?.name ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [material.id]: { ...prev[material.id], name: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
              />
              <input
                value={editDrafts[material.id]?.uom ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [material.id]: { ...prev[material.id], uom: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
              />
              <input
                type="number"
                min="0"
                value={editDrafts[material.id]?.defaultLeadTimeDays ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [material.id]: { ...prev[material.id], defaultLeadTimeDays: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
              />
              <input
                value={editDrafts[material.id]?.description ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [material.id]: { ...prev[material.id], description: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm md:col-span-2"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleUpdate(material.id)}
                disabled={busyId === material.id}
                className="rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => handleDelete(material.id)}
                disabled={busyId === material.id}
                className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700"
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
