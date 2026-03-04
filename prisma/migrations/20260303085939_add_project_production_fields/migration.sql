-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "delivery_date" TIMESTAMP(3),
ADD COLUMN     "production_house_name" TEXT,
ADD COLUMN     "shoot_locations" TEXT[] DEFAULT ARRAY[]::TEXT[];
