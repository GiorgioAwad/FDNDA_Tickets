ALTER TABLE "orders"
ADD COLUMN "providerOrderNumber" TEXT,
ADD COLUMN "providerTransactionId" TEXT,
ADD COLUMN "paymentSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "paymentLastSyncAt" TIMESTAMP(3),
ADD COLUMN "paymentNeedsReview" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "orders_providerOrderNumber_idx" ON "orders"("providerOrderNumber");
CREATE INDEX "orders_providerTransactionId_idx" ON "orders"("providerTransactionId");
CREATE INDEX "orders_status_provider_paymentNeedsReview_paymentLastSyncAt_idx"
ON "orders"("status", "provider", "paymentNeedsReview", "paymentLastSyncAt");
