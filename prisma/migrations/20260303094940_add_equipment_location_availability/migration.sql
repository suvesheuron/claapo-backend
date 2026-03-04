-- AlterTable
ALTER TABLE "vendor_equipment" ADD COLUMN     "current_city" TEXT;

-- CreateTable
CREATE TABLE "vendor_equipment_availability" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "location_city" TEXT NOT NULL,
    "available_from" TIMESTAMP(3) NOT NULL,
    "available_to" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_equipment_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_equipment_availability_equipment_id_available_from_a_idx" ON "vendor_equipment_availability"("equipment_id", "available_from", "available_to");

-- CreateIndex
CREATE INDEX "vendor_equipment_availability_location_city_available_from__idx" ON "vendor_equipment_availability"("location_city", "available_from", "available_to");

-- AddForeignKey
ALTER TABLE "vendor_equipment_availability" ADD CONSTRAINT "vendor_equipment_availability_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "vendor_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
