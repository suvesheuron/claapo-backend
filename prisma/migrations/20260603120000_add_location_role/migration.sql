-- Adds the `location` user role (shooting-location providers: bungalows/villas/
-- apartments, studio set-ups, location managers), its location_profiles table,
-- the location_properties catalog (+ date-range availability), and the
-- location_property_id link on booking_requests. Mirrors the cast role and the
-- vendor-equipment listing system. Purely additive — no existing rows touched.

-- 1. Extend UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'location';

-- 2. Booking link to a specific listed property (mirror vendor_equipment_id)
ALTER TABLE "booking_requests" ADD COLUMN     "location_property_id" UUID;

-- 3. location_profiles
CREATE TABLE "location_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "property_name" TEXT NOT NULL,
    "location_type" TEXT NOT NULL,
    "sub_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "about_us" TEXT,
    "address" TEXT,
    "address_lat" DOUBLE PRECISION,
    "address_lng" DOUBLE PRECISION,
    "location_city" TEXT,
    "location_state" TEXT,
    "logo_key" TEXT,
    "cover_key" TEXT,
    "detail_pdf_key" TEXT,
    "detail_pdf_name" TEXT,
    "website" TEXT,
    "imdb_url" TEXT,
    "instagram_url" TEXT,
    "linkedin_url" TEXT,
    "twitter_url" TEXT,
    "youtube_url" TEXT,
    "vimeo_url" TEXT,
    "pan_number" TEXT,
    "billing_name" TEXT,
    "gst_number" TEXT,
    "sac_code" TEXT,
    "upi_id" TEXT,
    "bank_account_name" TEXT,
    "bank_account_number" TEXT,
    "ifsc_code" TEXT,
    "bank_name" TEXT,
    "is_gst_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_profiles_pkey" PRIMARY KEY ("id")
);

-- 4. location_properties
CREATE TABLE "location_properties" (
    "id" UUID NOT NULL,
    "location_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sub_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT,
    "address" TEXT,
    "address_lat" DOUBLE PRECISION,
    "address_lng" DOUBLE PRECISION,
    "daily_budget" INTEGER,
    "photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pdf_key" TEXT,
    "pdf_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_properties_pkey" PRIMARY KEY ("id")
);

-- 5. location_property_availability
CREATE TABLE "location_property_availability" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "location_city" TEXT NOT NULL,
    "available_from" TIMESTAMP(3) NOT NULL,
    "available_to" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_property_availability_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "location_profiles_user_id_key" ON "location_profiles"("user_id");
CREATE UNIQUE INDEX "location_profiles_gst_number_key" ON "location_profiles"("gst_number");
CREATE INDEX "location_properties_location_user_id_idx" ON "location_properties"("location_user_id");
CREATE INDEX "location_property_availability_property_id_available_from_a_idx" ON "location_property_availability"("property_id", "available_from", "available_to");
CREATE INDEX "location_property_availability_location_city_available_from_idx" ON "location_property_availability"("location_city", "available_from", "available_to");
CREATE INDEX "booking_requests_location_property_id_idx" ON "booking_requests"("location_property_id");

-- Foreign keys
ALTER TABLE "location_profiles" ADD CONSTRAINT "location_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "location_properties" ADD CONSTRAINT "location_properties_location_user_id_fkey" FOREIGN KEY ("location_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "location_property_availability" ADD CONSTRAINT "location_property_availability_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "location_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_location_property_id_fkey" FOREIGN KEY ("location_property_id") REFERENCES "location_properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
