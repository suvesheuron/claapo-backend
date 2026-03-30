-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "twitter_url" TEXT,
ADD COLUMN     "youtube_url" TEXT;

-- AlterTable
ALTER TABLE "individual_profiles" ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "twitter_url" TEXT,
ADD COLUMN     "youtube_url" TEXT;

-- AlterTable
ALTER TABLE "vendor_profiles" ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "twitter_url" TEXT,
ADD COLUMN     "youtube_url" TEXT;
