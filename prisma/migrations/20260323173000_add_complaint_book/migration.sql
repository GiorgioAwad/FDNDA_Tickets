CREATE TYPE "ComplaintBookEntryType" AS ENUM ('RECLAMO', 'QUEJA');
CREATE TYPE "ComplaintBookSubjectType" AS ENUM ('PRODUCTO', 'SERVICIO');
CREATE TYPE "ComplaintBookStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'RESPONDED', 'CLOSED');

CREATE TABLE "complaint_book_entries" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ComplaintBookEntryType" NOT NULL,
    "subjectType" "ComplaintBookSubjectType" NOT NULL,
    "consumerIsMinor" BOOLEAN NOT NULL DEFAULT false,
    "parentName" TEXT,
    "customerName" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT NOT NULL,
    "orderId" TEXT,
    "eventName" TEXT,
    "subjectDescription" TEXT NOT NULL,
    "amountClaimed" DECIMAL(10,2),
    "detail" TEXT NOT NULL,
    "requestDetail" TEXT NOT NULL,
    "status" "ComplaintBookStatus" NOT NULL DEFAULT 'RECEIVED',
    "responseDetail" TEXT,
    "respondedAt" TIMESTAMP(3),
    "emailAcknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_book_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "complaint_book_entries_ticketNumber_key" ON "complaint_book_entries"("ticketNumber");
CREATE INDEX "complaint_book_entries_createdAt_idx" ON "complaint_book_entries"("createdAt");
CREATE INDEX "complaint_book_entries_status_idx" ON "complaint_book_entries"("status");

ALTER TABLE "complaint_book_entries"
ADD CONSTRAINT "complaint_book_entries_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
