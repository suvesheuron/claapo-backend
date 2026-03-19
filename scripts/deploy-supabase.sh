#!/usr/bin/env bash
# Run from crewcall-backend root. Requires DATABASE_URL and SUPABASE_* in .env.
set -e
echo "Installing dependencies..."
npm ci
echo "Generating Prisma client..."
npx prisma generate
echo "Running migrations on Supabase..."
npx prisma migrate deploy
echo "Seeding database..."
npm run seed
echo "Building backend..."
npm run build
echo "Done. Start with: node dist/main"
