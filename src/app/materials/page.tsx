import { db } from "@/lib/db";

import { MaterialsManager } from "./materials-manager";

export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  const materials = await db.material.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Materials</h1>
        <p className="text-[color:var(--muted)]">Manage sample raw materials available for PO line items and scheduling decisions.</p>
      </div>
      <MaterialsManager initialMaterials={materials} />
    </section>
  );
}
