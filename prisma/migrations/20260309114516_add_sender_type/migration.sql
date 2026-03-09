-- CreateEnum
CREATE TYPE "public"."SenderType" AS ENUM ('PURCHASER', 'AGENT', 'SUPPLIER');

-- AlterTable
ALTER TABLE "public"."EmailMessage" ADD COLUMN     "senderType" "public"."SenderType";
