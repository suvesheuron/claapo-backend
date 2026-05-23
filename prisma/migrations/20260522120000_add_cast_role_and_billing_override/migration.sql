-- Adds the `cast` user role (actors/models), the cast_profiles table, and the
-- billed_to_company_user_id override on projects used by the Casting Director
-- flow to route actor invoices to a third-party company (the project's payer).

-- 1. Extend UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'cast';

-- 2. Project-level billing override
ALTER TABLE "projects" ADD COLUMN "billed_to_company_user_id" UUID;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_billed_to_company_user_id_fkey"
  FOREIGN KEY ("billed_to_company_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "projects_billed_to_company_user_id_idx" ON "projects"("billed_to_company_user_id");

-- 3. cast_profiles table
CREATE TABLE "cast_profiles" (
  "id"                  UUID NOT NULL,
  "user_id"             UUID NOT NULL,
  "display_name"        TEXT NOT NULL,
  "role_type"           TEXT NOT NULL,
  "age"                 INTEGER,
  "gender"              TEXT,

  "height_cm"           INTEGER,
  "body_type"           TEXT,
  "skin_tone"           TEXT,
  "eye_color"           TEXT,
  "look_type"           TEXT,
  "hair_type"           TEXT,
  "languages"           TEXT[] DEFAULT ARRAY[]::TEXT[],

  "about_me"            TEXT,
  "bio"                 TEXT,
  "extra_skills"        TEXT[] DEFAULT ARRAY[]::TEXT[],
  "daily_budget"        INTEGER,

  "address"             TEXT,
  "location_city"       TEXT,
  "location_state"      TEXT,

  "avatar_key"          TEXT,
  "cover_key"           TEXT,
  "showreel_key"        TEXT,

  "website"             TEXT,
  "imdb_url"            TEXT,
  "instagram_url"       TEXT,
  "youtube_url"         TEXT,
  "vimeo_url"           TEXT,

  "pan_number"          TEXT,
  "billing_name"        TEXT,
  "gst_number"          TEXT,
  "sac_code"            TEXT,
  "upi_id"              TEXT,
  "bank_account_name"   TEXT,
  "bank_account_number" TEXT,
  "ifsc_code"           TEXT,
  "bank_name"           TEXT,

  "is_available"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cast_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cast_profiles_user_id_key" ON "cast_profiles"("user_id");

ALTER TABLE "cast_profiles"
  ADD CONSTRAINT "cast_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
