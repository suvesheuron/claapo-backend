/*
  Warnings:

  - Made the column `project_id` on table `conversations` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "conversations_participant_a_participant_b_idx";

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "project_id" SET NOT NULL;
