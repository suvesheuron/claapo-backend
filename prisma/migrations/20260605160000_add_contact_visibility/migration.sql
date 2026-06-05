-- Per-user public visibility toggles for email and phone on the public profile.
ALTER TABLE "users" ADD COLUMN     "is_email_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_phone_public" BOOLEAN NOT NULL DEFAULT true;
