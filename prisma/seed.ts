import { PrismaClient, PurchaseOrderStatus, PurchaseOrderLineStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.appSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      defaultModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      supplierMode: "rule_based",
      ackReminderHours: 24,
    },
  });

  const supplier = await prisma.supplier.upsert({
    where: { primaryEmail: "supplier@aciermetals.example" },
    update: {},
    create: {
      name: "Acier Metals Pvt Ltd",
      primaryEmail: "supplier@aciermetals.example",
      ccEmails: ["ops@aciermetals.example"],
      timezone: "Asia/Kolkata",
      paymentTerms: "Net 30",
    },
  });

  const steel = await prisma.material.upsert({
    where: { sku: "RM-STL-001" },
    update: {},
    create: {
      sku: "RM-STL-001",
      name: "Cold Rolled Steel Coil",
      uom: "kg",
      defaultLeadTimeDays: 10,
      description: "CRCA grade SPCC",
    },
  });

  const polymer = await prisma.material.upsert({
    where: { sku: "RM-POL-011" },
    update: {},
    create: {
      sku: "RM-POL-011",
      name: "Polypropylene Granules",
      uom: "kg",
      defaultLeadTimeDays: 7,
      description: "Injection molding grade",
    },
  });

  const po = await prisma.purchaseOrder.upsert({
    where: { poNumber: "PO-2026-0001" },
    update: {},
    create: {
      poNumber: "PO-2026-0001",
      supplierId: supplier.id,
      status: PurchaseOrderStatus.ACK_PENDING,
      notes: "Seeded PO for demo timeline",
    },
  });

  const lineOne = await prisma.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      materialId: steel.id,
      orderedQty: 1200,
      openQty: 1200,
      unitPrice: 98.5,
      lineStatus: PurchaseOrderLineStatus.PENDING_CONFIRMATION,
    },
  });

  const lineTwo = await prisma.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      materialId: polymer.id,
      orderedQty: 850,
      openQty: 850,
      unitPrice: 72.4,
      lineStatus: PurchaseOrderLineStatus.DATE_NEGOTIATION,
    },
  });

  await prisma.deliveryCommitment.createMany({
    data: [
      {
        poLineId: lineOne.id,
        promisedDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        promisedQty: 1200,
        source: "Supplier",
      },
      {
        poLineId: lineTwo.id,
        promisedDate: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
        promisedQty: 500,
        source: "Supplier",
      },
    ],
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
