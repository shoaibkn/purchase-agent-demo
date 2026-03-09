import { db } from "@/lib/db";

import { SuppliersManager } from "./suppliers-manager";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const suppliers = await db.supplier.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Suppliers</h1>
        <p className="text-[color:var(--muted)]">Manage supplier contacts used by automated purchase-order communication workflows.</p>
      </div>
      <SuppliersManager initialSuppliers={suppliers} />
    </section>
  );
}
