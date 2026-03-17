-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "shoot_dates" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[],
ADD COLUMN     "shoot_locations" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "shoot_dates" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[];
