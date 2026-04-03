-- Individual: genres (multi), address, vimeo; migrate legacy genre
ALTER TABLE "individual_profiles" ADD COLUMN "genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "individual_profiles" SET "genres" = ARRAY["genre"] WHERE "genre" IS NOT NULL AND BTRIM("genre") <> '';
ALTER TABLE "individual_profiles" DROP COLUMN "genre";
ALTER TABLE "individual_profiles" ADD COLUMN "address" TEXT;
ALTER TABLE "individual_profiles" ADD COLUMN "vimeo_url" TEXT;

-- Company: skills, vimeo, imdb (5th social), bank details for invoices
ALTER TABLE "company_profiles" ADD COLUMN "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "company_profiles" ADD COLUMN "imdb_url" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "vimeo_url" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "bank_account_name" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "bank_account_number" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "ifsc_code" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "bank_name" TEXT;

-- Vendor: PAN, bank, vimeo, imdb
ALTER TABLE "vendor_profiles" ADD COLUMN "pan_number" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN "imdb_url" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN "vimeo_url" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN "bank_account_name" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN "bank_account_number" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN "ifsc_code" TEXT;
ALTER TABLE "vendor_profiles" ADD COLUMN "bank_name" TEXT;
