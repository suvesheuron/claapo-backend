-- Adds an optional Google Maps share link to company, vendor and location
-- profiles (paste-a-link approach, replaces manual lat/lng for the pin).
ALTER TABLE "company_profiles" ADD COLUMN     "map_link" TEXT;
ALTER TABLE "location_profiles" ADD COLUMN     "map_link" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN     "map_link" TEXT;
