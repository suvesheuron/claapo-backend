/*
  Warnings:

  - You are about to drop the column `daily_rate_max` on the `individual_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `daily_rate_min` on the `individual_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `budget_max` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `budget_min` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `daily_rate_max` on the `vendor_equipment` table. All the data in the column will be lost.
  - You are about to drop the column `daily_rate_min` on the `vendor_equipment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "individual_profiles" DROP COLUMN "daily_rate_max",
DROP COLUMN "daily_rate_min",
ADD COLUMN     "daily_budget" INTEGER;

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "budget_max",
DROP COLUMN "budget_min",
ADD COLUMN     "budget" INTEGER;

-- AlterTable
ALTER TABLE "vendor_equipment" DROP COLUMN "daily_rate_max",
DROP COLUMN "daily_rate_min",
ADD COLUMN     "daily_budget" INTEGER;
