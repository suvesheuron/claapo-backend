ALTER TABLE "invoices"
ADD COLUMN "serial_number" INTEGER;

ALTER TABLE "invoices"
DROP CONSTRAINT IF EXISTS "invoices_invoice_number_key";

CREATE UNIQUE INDEX "invoices_issuer_user_id_invoice_number_key"
ON "invoices"("issuer_user_id", "invoice_number");

CREATE UNIQUE INDEX "invoices_issuer_user_id_serial_number_key"
ON "invoices"("issuer_user_id", "serial_number");
