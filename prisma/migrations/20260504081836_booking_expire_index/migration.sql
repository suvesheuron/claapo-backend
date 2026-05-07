-- CreateIndex
CREATE INDEX "booking_requests_status_expires_at_idx" ON "booking_requests"("status", "expires_at");
