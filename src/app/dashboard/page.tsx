import Link from "next/link";
import { endOfDay, format, startOfDay } from "date-fns";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PendingAckOrder = {
  id: string;
  poNumber: string;
  createdAt: Date;
  supplier: { name: string };
};

type OverdueLine = {
  id: string;
  openQty: { toString(): string };
  latestEdd: Date | null;
  material: { name: string };
  purchaseOrder: { poNumber: string };
};

type ScheduledLine = { latestEdd: Date | null; lineStatus: string };

type PendingReminder = {
  id: string;
  type: string;
  status: string;
  runAt: Date;
  purchaseOrder: { poNumber: string };
  poLine: { material: { name: string } } | null;
};

function decimalToNumber(value: { toString(): string }) {
  return Number(value.toString());
}

function formatMetric(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function metricCard(title: string, value: string, hint: string) {
  return (
    <article className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--muted)]">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-[color:var(--muted)]">{hint}</p>
    </article>
  );
}

export default async function DashboardPage() {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const ackSlaCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    openPoCount,
    pendingAckCount,
    ackSlaBreachesCount,
    dueTodayLines,
    overdueLines,
    partialDeliveryCount,
    linesWithSchedule,
    closedPoCount,
    pendingAckOrders,
    overdueLineQueue,
    pendingReminders,
  ] = await Promise.all([
    db.purchaseOrder.count({
      where: {
        status: {
          notIn: ["CLOSED", "CANCELLED"],
        },
      },
    }),
    db.purchaseOrder.count({
      where: {
        status: {
          in: ["SENT", "ACK_PENDING"],
        },
      },
    }),
    db.purchaseOrder.count({
      where: {
        status: {
          in: ["SENT", "ACK_PENDING"],
        },
        createdAt: {
          lte: ackSlaCutoff,
        },
      },
    }),
    db.purchaseOrderLine.count({
      where: {
        openQty: { gt: 0 },
        latestEdd: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    }),
    db.purchaseOrderLine.findMany({
      where: {
        openQty: { gt: 0 },
        latestEdd: {
          lt: dayStart,
        },
      },
      include: {
        material: true,
        purchaseOrder: true,
      },
      orderBy: { latestEdd: "asc" },
      take: 10,
    }),
    db.purchaseOrderLine.count({
      where: {
        lineStatus: "PARTIALLY_RECEIVED",
      },
    }),
    db.purchaseOrderLine.findMany({
      where: {
        latestEdd: { not: null },
      },
      select: {
        latestEdd: true,
        lineStatus: true,
      },
    }),
    db.purchaseOrder.count({
      where: {
        status: "CLOSED",
      },
    }),
    db.purchaseOrder.findMany({
      where: {
        status: {
          in: ["SENT", "ACK_PENDING"],
        },
      },
      include: {
        supplier: true,
      },
      orderBy: { createdAt: "asc" },
      take: 8,
    }),
    db.purchaseOrderLine.findMany({
      where: {
        openQty: { gt: 0 },
        latestEdd: {
          lt: dayStart,
        },
      },
      include: {
        material: true,
        purchaseOrder: true,
      },
      orderBy: { latestEdd: "asc" },
      take: 8,
    }),
    db.reminderTask.findMany({
      where: {
        status: {
          in: ["PENDING", "RUNNING"],
        },
      },
      include: {
        purchaseOrder: true,
        poLine: {
          include: {
            material: true,
          },
        },
      },
      orderBy: { runAt: "asc" },
      take: 10,
    }),
  ]);

  const delayedOpenQty = (overdueLines as OverdueLine[]).reduce((sum: number, line: OverdueLine) => sum + decimalToNumber(line.openQty), 0);

  const onTimeDenominator = (linesWithSchedule as ScheduledLine[]).filter((line: ScheduledLine) => line.lineStatus === "RECEIVED").length;
  const onTimeNumerator = (linesWithSchedule as ScheduledLine[]).filter(
    (line: ScheduledLine) => line.lineStatus === "RECEIVED" && line.latestEdd && line.latestEdd >= now,
  ).length;
  const onTimeDeliveryPct = onTimeDenominator === 0 ? 0 : (onTimeNumerator / onTimeDenominator) * 100;

  const avgAckHours = (pendingAckOrders as PendingAckOrder[]).length
    ? (pendingAckOrders as PendingAckOrder[]).reduce(
        (sum: number, po: PendingAckOrder) => sum + (now.getTime() - po.createdAt.getTime()) / (1000 * 60 * 60),
        0,
      ) / (pendingAckOrders as PendingAckOrder[]).length
    : 0;

  const requestedVsApproved = await db.purchaseOrderLine.findMany({
    where: {
      requestedDate: { not: null },
      approvedDate: { not: null },
    },
    select: {
      requestedDate: true,
      approvedDate: true,
    },
  });

  const avgVarianceDays = requestedVsApproved.length
    ? requestedVsApproved.reduce((sum: number, line: { requestedDate: Date | null; approvedDate: Date | null }) => {
        if (!line.requestedDate || !line.approvedDate) {
          return sum;
        }
        return sum + (line.approvedDate.getTime() - line.requestedDate.getTime()) / (1000 * 60 * 60 * 24);
      }, 0) / requestedVsApproved.length
    : 0;

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-[color:var(--muted)]">Live procurement KPIs across purchase orders, acknowledgments, EDD risk, and reminder operations.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCard("Open POs", formatMetric(openPoCount), "All active orders")}
        {metricCard("Pending Acknowledgment", formatMetric(pendingAckCount), "Awaiting supplier response")}
        {metricCard("ACK SLA Breaches", formatMetric(ackSlaBreachesCount), "Older than 24h without ack")}
        {metricCard("Due Today Lines", formatMetric(dueTodayLines), "Open qty with EDD today")}
        {metricCard("Overdue Lines", formatMetric(overdueLines.length), "Past EDD with open qty")}
        {metricCard("Delayed Open Qty", formatMetric(delayedOpenQty, 2), "Quantity still pending")}
        {metricCard("On-time Delivery %", `${formatMetric(onTimeDeliveryPct, 1)}%`, "Based on received lines")}
        {metricCard("Avg ACK Queue Age", `${formatMetric(avgAckHours, 1)}h`, "Current pending acknowledgment orders")}
        {metricCard("Avg EDD Variance", `${formatMetric(avgVarianceDays, 1)} days`, "Approved minus requested")}
        {metricCard("Partial Deliveries", formatMetric(partialDeliveryCount), "Lines partially received")}
        {metricCard("Closed POs", formatMetric(closedPoCount), "Lifecycle completed")}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pending ACK Queue</h2>
            <Link href="/purchase-orders" className="text-xs text-[color:var(--accent)] underline-offset-4 hover:underline">
              View all
            </Link>
          </div>
          <div className="space-y-2 text-sm">
            {pendingAckOrders.length === 0 ? (
              <p className="text-[color:var(--muted)]">No orders waiting for acknowledgment.</p>
            ) : (
              (pendingAckOrders as PendingAckOrder[]).map((po: PendingAckOrder) => (
                <div key={po.id} className="rounded-lg border border-[color:var(--card-border)] p-3">
                  <p className="font-medium">
                    <Link href={`/purchase-orders/${po.poNumber}`}>{po.poNumber}</Link>
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">{po.supplier.name}</p>
                  <p className="text-xs text-[color:var(--muted)]">Created: {format(po.createdAt, "yyyy-MM-dd HH:mm")}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
          <h2 className="mb-3 text-lg font-semibold">Overdue Line Queue</h2>
          <div className="space-y-2 text-sm">
            {overdueLineQueue.length === 0 ? (
              <p className="text-[color:var(--muted)]">No overdue lines.</p>
            ) : (
              (overdueLineQueue as OverdueLine[]).map((line: OverdueLine) => (
                <div key={line.id} className="rounded-lg border border-[color:var(--card-border)] p-3">
                  <p className="font-medium">{line.material.name}</p>
                  <p className="text-xs text-[color:var(--muted)]">PO: {line.purchaseOrder.poNumber}</p>
                  <p className="text-xs text-[color:var(--muted)]">Open Qty: {line.openQty.toString()}</p>
                  <p className="text-xs text-[color:var(--muted)]">EDD: {line.latestEdd ? format(line.latestEdd, "yyyy-MM-dd") : "-"}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-4">
          <h2 className="mb-3 text-lg font-semibold">Reminder Tasks</h2>
          <div className="space-y-2 text-sm">
            {pendingReminders.length === 0 ? (
              <p className="text-[color:var(--muted)]">No pending reminders.</p>
            ) : (
              (pendingReminders as PendingReminder[]).map((task: PendingReminder) => (
                <div key={task.id} className="rounded-lg border border-[color:var(--card-border)] p-3">
                  <p className="font-medium">{task.type}</p>
                  <p className="text-xs text-[color:var(--muted)]">PO: {task.purchaseOrder.poNumber}</p>
                  <p className="text-xs text-[color:var(--muted)]">Run at: {format(task.runAt, "yyyy-MM-dd HH:mm")}</p>
                  <p className="text-xs text-[color:var(--muted)]">Status: {task.status}</p>
                  <p className="text-xs text-[color:var(--muted)]">
                    {task.poLine ? `Line: ${task.poLine.material.name}` : "PO-level task"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
