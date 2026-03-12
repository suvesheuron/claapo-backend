-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'cancel_requested';

-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "cancel_request_reason" TEXT,
ADD COLUMN     "cancel_requested_at" TIMESTAMP(3);
