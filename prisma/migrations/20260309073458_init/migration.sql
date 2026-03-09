-- CreateEnum
CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM ('CREATED', 'SENT', 'ACK_PENDING', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderLineStatus" AS ENUM ('PENDING_CONFIRMATION', 'DATE_NEGOTIATION', 'CONFIRMED', 'OVERDUE', 'RESCHEDULED', 'PARTIALLY_RECEIVED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "public"."MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "public"."AgentRunTrigger" AS ENUM ('PO_CREATED', 'SUPPLIER_REPLY_RECEIVED', 'ACK_REMINDER_DUE', 'EDD_OVERDUE', 'GOODS_RECEIPT_CREATED');

-- CreateEnum
CREATE TYPE "public"."AgentRunStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ReminderTaskType" AS ENUM ('ACK_REMINDER', 'EDD_OVERDUE_FOLLOWUP');

-- CreateEnum
CREATE TYPE "public"."ReminderTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryEmail" TEXT NOT NULL,
    "ccEmails" TEXT[],
    "timezone" TEXT,
    "paymentTerms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Material" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "uom" TEXT NOT NULL,
    "defaultLeadTimeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "status" "public"."PurchaseOrderStatus" NOT NULL DEFAULT 'CREATED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderedQty" DECIMAL(14,3) NOT NULL,
    "openQty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,3),
    "requestedDate" TIMESTAMP(3),
    "approvedDate" TIMESTAMP(3),
    "latestEdd" TIMESTAMP(3),
    "lineStatus" "public"."PurchaseOrderLineStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryCommitment" (
    "id" TEXT NOT NULL,
    "promisedDate" TIMESTAMP(3) NOT NULL,
    "promisedQty" DECIMAL(14,3) NOT NULL,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "poLineId" TEXT NOT NULL,

    CONSTRAINT "DeliveryCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoodsReceipt" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseOrderId" TEXT NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receivedQty" DECIMAL(14,3) NOT NULL,
    "acceptedQty" DECIMAL(14,3) NOT NULL,
    "rejectedQty" DECIMAL(14,3) NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailThread" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailMessage" (
    "id" TEXT NOT NULL,
    "direction" "public"."MessageDirection" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmails" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "intent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentRun" (
    "id" TEXT NOT NULL,
    "trigger" "public"."AgentRunTrigger" NOT NULL,
    "model" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "status" "public"."AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseOrderId" TEXT NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReminderTask" (
    "id" TEXT NOT NULL,
    "type" "public"."ReminderTaskType" NOT NULL,
    "status" "public"."ReminderTaskStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "poLineId" TEXT,

    CONSTRAINT "ReminderTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AppSetting" (
    "id" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
    "supplierMode" TEXT NOT NULL DEFAULT 'rule_based',
    "ackReminderHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_primaryEmail_key" ON "public"."Supplier"("primaryEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Material_sku_key" ON "public"."Material"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "public"."PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "ReminderTask_status_runAt_idx" ON "public"."ReminderTask"("status", "runAt");

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "public"."Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryCommitment" ADD CONSTRAINT "DeliveryCommitment_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailThread" ADD CONSTRAINT "EmailThread_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailThread" ADD CONSTRAINT "EmailThread_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgentRun" ADD CONSTRAINT "AgentRun_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderTask" ADD CONSTRAINT "ReminderTask_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderTask" ADD CONSTRAINT "ReminderTask_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
