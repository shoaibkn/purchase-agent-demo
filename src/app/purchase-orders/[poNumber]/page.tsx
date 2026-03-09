import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import { db } from "@/lib/db";

import { ReceiveGoodsForm } from "./receive-goods-form";

export const dynamic = "force-dynamic";

type PurchaseOrderLineView = {
  id: string;
  orderedQty: { toString(): string };
  openQty: { toString(): string };
  requestedDate: Date | null;
  latestEdd: Date | null;
  lineStatus: string;
  material: { name: string; sku: string };
  deliveryCommitments: Array<{ promisedDate: Date; promisedQty: { toString(): string }; source: string }>;
};

type EmailMessageView = {
  id: string;
  direction: string;
  subject: string;
  fromEmail: string;
  body: string;
  createdAt: Date;
};

type AgentRunView = {
  id: string;
  trigger: string;
  model: string;
  decision: string;
  status: string;
  createdAt: Date;
};

type ReminderTaskView = {
  id: string;
  type: string;
  status: string;
  runAt: Date;
  attempts: number;
  poLine: { id: string; material: { name: string } } | null;
};

type GoodsReceiptView = {
  id: string;
  reference: string | null;
  receivedAt: Date;
  lines: Array<{ id: string }>;
};

function badgeClass(status: string) {
  if (status === "CONFIRMED" || status === "ACKNOWLEDGED" || status === "SUCCESS") {
    return "bg-emerald-100 text-emerald-900";
  }

  if (status === "RESCHEDULED" || status === "OVERDUE" || status === "ACK_PENDING") {
    return "bg-amber-100 text-amber-900";
  }

  if (status === "FAILED") {
    return "bg-rose-100 text-rose-900";
  }

  return "bg-slate-200 text-slate-800";
}

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ poNumber: string }>;
}) {
  const { poNumber } = await params;
  const purchaseOrder = await db.purchaseOrder.findUnique({
    where: { poNumber },
    include: {
      supplier: true,
      lines: {
        include: {
          material: true,
          deliveryCommitments: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      emailThreads: {
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
      agentRuns: {
        orderBy: { createdAt: "desc" },
      },
      reminderTasks: {
        include: {
          poLine: {
            include: {
              material: true,
            },
          },
        },
        orderBy: { runAt: "desc" },
      },
      goodsReceipts: {
        include: {
          lines: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!purchaseOrder) {
    notFound();
  }

  const messages: EmailMessageView[] = purchaseOrder.emailThreads.flatMap((thread: { messages: EmailMessageView[] }) => thread.messages);
  const receivableLines = (purchaseOrder.lines as PurchaseOrderLineView[])
    .filter((line) => Number(line.openQty.toString()) > 0)
    .map((line) => ({
      id: line.id,
      materialName: line.material.name,
      openQty: Number(line.openQty.toString()),
    }));

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <Link href="/purchase-orders" className="text-sm text-[color:var(--accent)] underline-offset-4 hover:underline">
          Back to purchase orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{purchaseOrder.poNumber}</h1>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(purchaseOrder.status)}`}>{purchaseOrder.status}</span>
        </div>
        <p className="text-sm text-[color:var(--muted)]">
          Supplier: {purchaseOrder.supplier.name} ({purchaseOrder.supplier.primaryEmail}) - Created {format(purchaseOrder.createdAt, "yyyy-MM-dd HH:mm")}
        </p>
        {purchaseOrder.notes ? <p className="text-sm text-[color:var(--muted)]">Notes: {purchaseOrder.notes}</p> : null}
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Line Items and EDD</h2>
        <div className="overflow-hidden rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--card-border)] text-xs uppercase tracking-[0.1em] text-[color:var(--muted)]">
              <tr>
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3">Ordered</th>
                <th className="px-4 py-3">Open</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Latest EDD</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Commitments</th>
              </tr>
            </thead>
            <tbody>
              {(purchaseOrder.lines as PurchaseOrderLineView[]).map((line) => (
                <tr key={line.id} className="border-b border-[color:var(--card-border)] align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{line.material.name}</p>
                    <p className="text-xs text-[color:var(--muted)]">{line.material.sku}</p>
                  </td>
                  <td className="px-4 py-3">{line.orderedQty.toString()}</td>
                  <td className="px-4 py-3">{line.openQty.toString()}</td>
                  <td className="px-4 py-3">{line.requestedDate ? format(line.requestedDate, "yyyy-MM-dd") : "-"}</td>
                  <td className="px-4 py-3">{line.latestEdd ? format(line.latestEdd, "yyyy-MM-dd") : "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(line.lineStatus)}`}>{line.lineStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[color:var(--muted)]">
                    {line.deliveryCommitments.length === 0
                      ? "No commitments yet"
                      : line.deliveryCommitments
                          .slice(0, 3)
                          .map(
                            (item: { promisedDate: Date; promisedQty: { toString(): string }; source: string }) =>
                              `${format(item.promisedDate, "yyyy-MM-dd")}: ${item.promisedQty.toString()} (${item.source})`,
                          )
                          .join(" | ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
          <h2 className="text-xl font-semibold">Receive Goods</h2>
          <p className="text-sm text-[color:var(--muted)]">Post partial or full receipts against open PO lines.</p>
          <ReceiveGoodsForm poNumber={purchaseOrder.poNumber} lines={receivableLines} />
        </div>

        <div className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
          <h2 className="text-xl font-semibold">Recent Goods Receipts</h2>
          <div className="space-y-2 text-sm">
            {purchaseOrder.goodsReceipts.length === 0 ? (
              <p className="text-[color:var(--muted)]">No goods receipts yet.</p>
            ) : (
              (purchaseOrder.goodsReceipts as GoodsReceiptView[]).slice(0, 6).map((receipt) => (
                <div key={receipt.id} className="rounded-xl border border-[color:var(--card-border)] p-3">
                  <p className="font-medium">{receipt.reference ?? receipt.id.slice(0, 12)}</p>
                  <p className="text-xs text-[color:var(--muted)]">{format(receipt.receivedAt, "yyyy-MM-dd HH:mm")}</p>
                  <p className="text-xs text-[color:var(--muted)]">Lines: {receipt.lines.length}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
          <h2 className="text-xl font-semibold">Communication Timeline</h2>
          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]">No thread activity yet.</p>
            ) : (
              messages.map((message: EmailMessageView) => (
                <article key={message.id} className="rounded-xl border border-[color:var(--card-border)] p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
                    {message.direction} - {format(message.createdAt, "yyyy-MM-dd HH:mm")}
                  </p>
                  <p className="mt-1 text-sm font-medium">{message.subject}</p>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">From: {message.fromEmail}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
            <h2 className="text-xl font-semibold">Agent Runs</h2>
            <div className="space-y-2">
              {purchaseOrder.agentRuns.length === 0 ? (
                <p className="text-sm text-[color:var(--muted)]">No agent runs yet.</p>
              ) : (
                (purchaseOrder.agentRuns as AgentRunView[]).map((run) => (
                  <div key={run.id} className="rounded-xl border border-[color:var(--card-border)] p-3 text-sm">
                    <p className="font-medium">{run.trigger}</p>
                    <p className="text-xs text-[color:var(--muted)]">Model: {run.model}</p>
                    <p className="text-xs text-[color:var(--muted)]">{format(run.createdAt, "yyyy-MM-dd HH:mm")}</p>
                    <p className="mt-1">{run.decision}</p>
                    <p className="mt-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(run.status)}`}>{run.status}</span>
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
            <h2 className="text-xl font-semibold">Reminder Tasks</h2>
            <div className="space-y-2">
              {purchaseOrder.reminderTasks.length === 0 ? (
                <p className="text-sm text-[color:var(--muted)]">No reminder tasks scheduled.</p>
              ) : (
                (purchaseOrder.reminderTasks as ReminderTaskView[]).slice(0, 12).map((task) => (
                  <div key={task.id} className="rounded-xl border border-[color:var(--card-border)] p-3 text-sm">
                    <p className="font-medium">{task.type}</p>
                    <p className="text-xs text-[color:var(--muted)]">Run at: {format(task.runAt, "yyyy-MM-dd HH:mm")}</p>
                    <p className="text-xs text-[color:var(--muted)]">Attempts: {task.attempts}</p>
                    <p className="text-xs text-[color:var(--muted)]">
                      Line: {task.poLine ? `${task.poLine.material.name} (${task.poLine.id.slice(0, 8)})` : "PO-level"}
                    </p>
                    <p className="mt-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(task.status)}`}>{task.status}</span>
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
