-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "project_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "conversations_participant_a_participant_b_idx" ON "conversations"("participant_a", "participant_b");
