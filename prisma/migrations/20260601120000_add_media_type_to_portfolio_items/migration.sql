-- Extend portfolio items so they can hold images, videos and documents
-- (Cast "Work Showcase"). The legacy image_key column keeps holding the
-- storage key; media_type disambiguates how to render it.
ALTER TABLE "portfolio_items" ADD COLUMN "media_type" TEXT NOT NULL DEFAULT 'image';
ALTER TABLE "portfolio_items" ADD COLUMN "file_name" TEXT;
ALTER TABLE "portfolio_items" ADD COLUMN "mime_type" TEXT;
