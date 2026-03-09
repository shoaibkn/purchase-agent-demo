import Link from "next/link";
import type { Route } from "next";
import { format } from "date-fns";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PurchaseOrderRow = {
  id: string;
  poNumber: string;
  status: string;
  createdAt: Date;
  supplier: {
    name: string;
  };
  lines: Array<{ id: string }>;
  emailThreads: Array<{
    messages: Array<{ id: string }>;
  }>;
};

function statusClass(status: string) {
  if (status === "ACKNOWLEDGED" || status === "RECEIVED" || status === "CLOSED") {
    return "bg-emerald-100 text-emerald-900";
  }

  if (status === "ACK_PENDING" || status === "PARTIALLY_RECEIVED") {
    return "bg-amber-100 text-amber-900";
  }

  return "bg-slate-200 text-slate-800";
}

export default async function PurchaseOrdersPage() {
  const purchaseOrders: PurchaseOrderRow[] = await db.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: true,
      lines: {
        include: {
          material: true,
        },
      },
      emailThreads: {
        include: {
          messages: true,
        },
      },
    },
    take: 100,
  });

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Purchase Orders</h1>
        <p className="text-[color:var(--muted)]">Track order status, line-level delivery commitments, and supplier communication threads.</p>
        <div>
          <Link
            href="/purchase-orders/new"
            className="inline-flex rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white"
          >
            Create Purchase Order
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[color:var(--card-border)] text-xs uppercase tracking-[0.1em] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">PO</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Lines</th>
              <th className="px-4 py-3">Messages</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => {
              const messageCount = po.emailThreads.reduce((sum, thread) => sum + thread.messages.length, 0);
              const detailHref = `/purchase-orders/${po.poNumber}` as Route;
              return (
                <tr key={po.id} className="border-b border-[color:var(--card-border)] last:border-b-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={detailHref} className="text-[color:var(--accent)] underline-offset-4 hover:underline">
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{po.supplier.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(po.status)}`}>{po.status}</span>
                  </td>
                  <td className="px-4 py-3">{po.lines.length}</td>
                  <td className="px-4 py-3">{messageCount}</td>
                  <td className="px-4 py-3 text-[color:var(--muted)]">{format(po.createdAt, "yyyy-MM-dd HH:mm")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {purchaseOrders.length === 0 ? (
          <div className="p-6 text-sm text-[color:var(--muted)]">No purchase orders found. Create one through `POST /api/purchase-orders` to start the workflow.</div>
        ) : null}
      </div>
    </section>
  );
}
