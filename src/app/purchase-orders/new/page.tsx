import Link from "next/link";

import { db } from "@/lib/db";

import { CreatePoForm } from "./create-po-form";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const [suppliers, materials] = await Promise.all([
    db.supplier.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
    db.material.findMany({
      select: {
        id: true,
        sku: true,
        name: true,
        uom: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href="/purchase-orders" className="text-sm text-[color:var(--accent)] underline-offset-4 hover:underline">
          Back to purchase orders
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Create Purchase Order</h1>
        <p className="text-[color:var(--muted)]">
          Creating a PO will automatically trigger agent communication with the supplier and line-level EDD processing.
        </p>
      </div>

      <div className="rounded-2xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5">
        <CreatePoForm suppliers={suppliers} materials={materials} />
      </div>
    </section>
  );
}
