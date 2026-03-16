-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "vendor_equipment_id" UUID;

-- CreateIndex
CREATE INDEX "booking_requests_vendor_equipment_id_idx" ON "booking_requests"("vendor_equipment_id");

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_vendor_equipment_id_fkey" FOREIGN KEY ("vendor_equipment_id") REFERENCES "vendor_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
