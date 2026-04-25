-- CreateEnum
CREATE TYPE "InvoiceTaxType" AS ENUM ('none', 'gst', 'igst');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "tax_rate_pct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_type" "InvoiceTaxType" NOT NULL DEFAULT 'none';
