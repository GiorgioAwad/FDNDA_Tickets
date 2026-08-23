ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'DISCARDED';

ALTER TABLE "invoices"
ADD COLUMN "discardedAt" TIMESTAMP(3),
ADD COLUMN "discardedReason" TEXT,
ADD COLUMN "discardedByUserId" TEXT;
