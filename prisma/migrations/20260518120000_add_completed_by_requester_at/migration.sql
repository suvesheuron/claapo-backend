-- Requester-side "Mark as Complete" timestamp on bookings, mirroring
-- completed_by_target_at. Set when the production company that initiated
-- the booking closes out a specific engagement (today used by the
-- company→company hiring flow, so the hiring company can wrap one booking
-- without marking the whole project complete). Does not change
-- BookingStatus, so legacy filters keep working.
ALTER TABLE "booking_requests" ADD COLUMN "completed_by_requester_at" TIMESTAMP(3);
