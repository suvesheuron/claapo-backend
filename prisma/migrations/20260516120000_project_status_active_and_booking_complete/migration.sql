-- Project default flips draft → active. The "Activate Project" UI step is
-- being removed; new projects are immediately Ongoing.
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'active';

-- Sweep existing drafts to active so they show up in Ongoing lists. This is
-- safe: drafts in the current data model represent projects waiting on the
-- removed Activate button, not unsaved work.
UPDATE "projects" SET "status" = 'active' WHERE "status" = 'draft';

-- Per-target completion timestamp on bookings. Crew/vendor side "Mark as
-- Complete" sets this; it does not change BookingStatus (so legacy filters
-- like (status in 'accepted','locked') continue to work).
ALTER TABLE "booking_requests" ADD COLUMN "completed_by_target_at" TIMESTAMP(3);
