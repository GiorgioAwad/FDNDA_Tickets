ALTER TABLE "ticket_types"
ADD COLUMN "servilexEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "servilexIndicator" TEXT DEFAULT 'AC',
ADD COLUMN "servilexServiceCode" TEXT,
ADD COLUMN "servilexDisciplineCode" TEXT,
ADD COLUMN "servilexScheduleCode" TEXT,
ADD COLUMN "servilexPoolCode" TEXT;

ALTER TABLE "orders"
ADD COLUMN "buyerEmail" TEXT,
ADD COLUMN "buyerPhone" TEXT,
ADD COLUMN "buyerUbigeo" TEXT,
ADD COLUMN "buyerFirstName" TEXT,
ADD COLUMN "buyerSecondName" TEXT,
ADD COLUMN "buyerLastNamePaternal" TEXT,
ADD COLUMN "buyerLastNameMaternal" TEXT;

ALTER TABLE "invoices"
ADD COLUMN "buyerEmail" TEXT,
ADD COLUMN "buyerPhone" TEXT,
ADD COLUMN "buyerUbigeo" TEXT,
ADD COLUMN "buyerFirstName" TEXT,
ADD COLUMN "buyerSecondName" TEXT,
ADD COLUMN "buyerLastNamePaternal" TEXT,
ADD COLUMN "buyerLastNameMaternal" TEXT,
ADD COLUMN "traceId" TEXT,
ADD COLUMN "requestPayload" TEXT,
ADD COLUMN "requestSignature" TEXT,
ADD COLUMN "httpStatus" INTEGER,
ADD COLUMN "reciboHash" TEXT,
ADD COLUMN "sentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "invoices_traceId_key" ON "invoices"("traceId");
