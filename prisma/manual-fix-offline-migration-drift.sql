-- STEP 1 — Run BEFORE `npm run prisma:migrate` while Prisma reports drift / missing migration file.
-- Easiest: `npm run prisma:fix-offline-drift` (uses DATABASE_URL from .env)
-- Or paste this block into Neon SQL Editor.

BEGIN;

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260502120000_offline_project_invoices';

DROP TABLE IF EXISTS "offline_project_invoices";

COMMIT;

-- STEP 2 — Then: npm run prisma:migrate
-- Expect Prisma to apply: 20260502074748_offline_invoice
