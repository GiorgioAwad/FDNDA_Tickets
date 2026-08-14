-- CreateTable
CREATE TABLE "promo_popup_events" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "version" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT,
    "pathname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_popup_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_popup_events_promoId_version_sessionId_kind_key"
ON "promo_popup_events"("promoId", "version", "sessionId", "kind");

-- CreateIndex
CREATE INDEX "promo_popup_events_promoId_version_createdAt_idx"
ON "promo_popup_events"("promoId", "version", "createdAt");

-- AddForeignKey
ALTER TABLE "promo_popup_events"
ADD CONSTRAINT "promo_popup_events_promoId_fkey"
FOREIGN KEY ("promoId") REFERENCES "promo_popups"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
