"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Supplier = {
  id: string;
  name: string;
  primaryEmail: string;
  ccEmails: string[];
  timezone: string | null;
  paymentTerms: string | null;
};

type Props = {
  initialSuppliers: Supplier[];
};

type Draft = {
  name: string;
  primaryEmail: string;
  ccEmails: string;
  timezone: string;
  paymentTerms: string;
};

const emptyDraft: Draft = {
  name: "",
  primaryEmail: "",
  ccEmails: "",
  timezone: "",
  paymentTerms: "",
};

function toPayload(draft: Draft) {
  return {
    name: draft.name,
    primaryEmail: draft.primaryEmail,
    ccEmails: draft.ccEmails
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    timezone: draft.timezone || undefined,
    paymentTerms: draft.paymentTerms || undefined,
  };
}

export function SuppliersManager({ initialSuppliers }: Props) {
  const router = useRouter();
  const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft);
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>(() => {
    const map: Record<string, Draft> = {};
    for (const supplier of initialSuppliers) {
      map[supplier.id] = {
        name: supplier.name,
        primaryEmail: supplier.primaryEmail,
        ccEmails: supplier.ccEmails.join(", "),
        timezone: supplier.timezone ?? "",
        paymentTerms: supplier.paymentTerms ?? "",
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
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(createDraft)),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to create supplier.");
      }

      setCreateDraft(emptyDraft);
      setMessage(payload.message ?? "Supplier created.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create supplier.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(id: string) {
    setMessage("");
    setError("");
    setBusyId(id);

    try {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(editDrafts[id])),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update supplier.");
      }

      setMessage(payload.message ?? "Supplier updated.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update supplier.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setMessage("");
    setError("");
    setBusyId(id);

    try {
      const response = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to delete supplier.");
      }

      setMessage(payload.message ?? "Supplier deleted.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to delete supplier.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="grid gap-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4 md:grid-cols-2">
        <input
          value={createDraft.name}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, name: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="Supplier name"
          required
        />
        <input
          type="email"
          value={createDraft.primaryEmail}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, primaryEmail: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="Primary email"
          required
        />
        <input
          value={createDraft.ccEmails}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, ccEmails: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="CC emails (comma-separated)"
        />
        <input
          value={createDraft.timezone}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, timezone: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
          placeholder="Timezone (e.g. Asia/Kolkata)"
        />
        <input
          value={createDraft.paymentTerms}
          onChange={(event) => setCreateDraft((prev) => ({ ...prev, paymentTerms: event.target.value }))}
          className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm md:col-span-2"
          placeholder="Payment terms (e.g. Net 30)"
        />
        <button
          type="submit"
          disabled={busyId === "create"}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white md:w-fit"
        >
          {busyId === "create" ? "Creating..." : "Add Supplier"}
        </button>
      </form>

      {message ? <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">{message}</p> : null}
      {error ? <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900">{error}</p> : null}

      <div className="space-y-3">
        {initialSuppliers.map((supplier) => (
          <article key={supplier.id} className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={editDrafts[supplier.id]?.name ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [supplier.id]: { ...prev[supplier.id], name: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
              />
              <input
                type="email"
                value={editDrafts[supplier.id]?.primaryEmail ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [supplier.id]: { ...prev[supplier.id], primaryEmail: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
              />
              <input
                value={editDrafts[supplier.id]?.ccEmails ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [supplier.id]: { ...prev[supplier.id], ccEmails: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
                placeholder="CC emails"
              />
              <input
                value={editDrafts[supplier.id]?.timezone ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [supplier.id]: { ...prev[supplier.id], timezone: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm"
                placeholder="Timezone"
              />
              <input
                value={editDrafts[supplier.id]?.paymentTerms ?? ""}
                onChange={(event) =>
                  setEditDrafts((prev) => ({
                    ...prev,
                    [supplier.id]: { ...prev[supplier.id], paymentTerms: event.target.value },
                  }))
                }
                className="rounded-lg border border-[color:var(--card-border)] bg-white px-3 py-2 text-sm md:col-span-2"
                placeholder="Payment terms"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleUpdate(supplier.id)}
                disabled={busyId === supplier.id}
                className="rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => handleDelete(supplier.id)}
                disabled={busyId === supplier.id}
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
