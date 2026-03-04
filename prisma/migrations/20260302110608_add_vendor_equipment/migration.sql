-- CreateTable
CREATE TABLE "vendor_equipment" (
    "id" UUID NOT NULL,
    "vendor_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "daily_rate_min" INTEGER,
    "daily_rate_max" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_equipment_vendor_user_id_idx" ON "vendor_equipment"("vendor_user_id");

-- AddForeignKey
ALTER TABLE "vendor_equipment" ADD CONSTRAINT "vendor_equipment_vendor_user_id_fkey" FOREIGN KEY ("vendor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
