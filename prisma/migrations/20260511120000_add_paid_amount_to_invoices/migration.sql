-- AlterTable
ALTER TABLE "invoices"
ADD COLUMN "paid_amount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing fully-paid invoices have paid_amount = total_amount.
UPDATE "invoices"
SET "paid_amount" = "total_amount"
WHERE "status" = 'paid';
