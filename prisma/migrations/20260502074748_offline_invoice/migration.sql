-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "offline_billing_name" VARCHAR(512),
ADD COLUMN "recorded_offline_by_company" BOOLEAN NOT NULL DEFAULT false;
