CREATE TABLE "ticket_qr_tokens" (
    "tokenHash" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_qr_tokens_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX "ticket_qr_tokens_ticketId_idx" ON "ticket_qr_tokens"("ticketId");

ALTER TABLE "ticket_qr_tokens" ADD CONSTRAINT "ticket_qr_tokens_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
