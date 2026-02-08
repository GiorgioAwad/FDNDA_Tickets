CREATE INDEX IF NOT EXISTS "events_isPublished_endDate_idx"
ON "events"("isPublished", "endDate");

CREATE INDEX IF NOT EXISTS "ticket_day_entitlements_ticketId_status_idx"
ON "ticket_day_entitlements"("ticketId", "status");

CREATE INDEX IF NOT EXISTS "orders_userId_status_idx"
ON "orders"("userId", "status");

CREATE INDEX IF NOT EXISTS "scans_ticketId_result_idx"
ON "scans"("ticketId", "result");
