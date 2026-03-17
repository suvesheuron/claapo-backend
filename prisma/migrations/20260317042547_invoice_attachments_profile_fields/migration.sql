-- AlterTable
ALTER TABLE "individual_profiles" ADD COLUMN     "bank_account_name" TEXT,
ADD COLUMN     "bank_account_number" TEXT,
ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "ifsc_code" TEXT,
ADD COLUMN     "pan_number" TEXT;

-- AlterTable
ALTER TABLE "vendor_profiles" ADD COLUMN     "address" TEXT;

-- CreateTable
CREATE TABLE "invoice_attachments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_attachments_invoice_id_idx" ON "invoice_attachments"("invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
