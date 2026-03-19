-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "forwarded_from_id" UUID,
ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vendor_equipment" ADD COLUMN     "image_url" TEXT;
