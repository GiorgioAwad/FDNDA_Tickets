-- CreateEnum
CREATE TYPE "TicketIssuanceOutcome" AS ENUM (
    'OK',
    'NO_ENTITLEMENT',
    'TICKET_NOT_ACTIVE',
    'TICKET_NOT_FOUND',
    'UNAUTHORIZED',
    'QR_GENERATION_ERROR',
    'INTERNAL_ERROR'
);

-- CreateTable
CREATE TABLE "ticket_issuance_logs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "userId" TEXT,
    "eventId" TEXT,
    "outcome" "TicketIssuanceOutcome" NOT NULL,
    "reason" TEXT,
    "qrDate" TEXT,
    "qrShift" TEXT,
    "requestedDate" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_issuance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_issuance_logs_ticketId_createdAt_idx" ON "ticket_issuance_logs"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_issuance_logs_outcome_createdAt_idx" ON "ticket_issuance_logs"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_issuance_logs_createdAt_idx" ON "ticket_issuance_logs"("createdAt");
