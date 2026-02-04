-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "scans_eventId_date_idx" ON "scans"("eventId", "date");

-- CreateIndex
CREATE INDEX "scans_ticketId_idx" ON "scans"("ticketId");

-- CreateIndex
CREATE INDEX "scans_staffId_idx" ON "scans"("staffId");

-- CreateIndex
CREATE INDEX "scans_scannedAt_idx" ON "scans"("scannedAt");

-- CreateIndex
CREATE INDEX "ticket_types_eventId_idx" ON "ticket_types"("eventId");

-- CreateIndex
CREATE INDEX "ticket_types_isActive_idx" ON "ticket_types"("isActive");

-- CreateIndex
CREATE INDEX "tickets_eventId_idx" ON "tickets"("eventId");

-- CreateIndex
CREATE INDEX "tickets_userId_idx" ON "tickets"("userId");

-- CreateIndex
CREATE INDEX "tickets_orderId_idx" ON "tickets"("orderId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");
