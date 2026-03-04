-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_user_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "main_user_id" UUID;

-- CreateTable
CREATE TABLE "sub_user_project_assignments" (
    "id" UUID NOT NULL,
    "account_user_id" UUID NOT NULL,
    "sub_user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_user_project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sub_user_project_assignments_account_user_id_sub_user_id_idx" ON "sub_user_project_assignments"("account_user_id", "sub_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sub_user_project_assignments_sub_user_id_project_id_key" ON "sub_user_project_assignments"("sub_user_id", "project_id");

-- CreateIndex
CREATE INDEX "booking_requests_requester_user_id_status_idx" ON "booking_requests"("requester_user_id", "status");

-- CreateIndex
CREATE INDEX "users_main_user_id_idx" ON "users"("main_user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_main_user_id_fkey" FOREIGN KEY ("main_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_user_project_assignments" ADD CONSTRAINT "sub_user_project_assignments_account_user_id_fkey" FOREIGN KEY ("account_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_user_project_assignments" ADD CONSTRAINT "sub_user_project_assignments_sub_user_id_fkey" FOREIGN KEY ("sub_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_user_project_assignments" ADD CONSTRAINT "sub_user_project_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
