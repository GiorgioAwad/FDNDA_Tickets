ALTER TABLE "ticket_types"
ADD COLUMN "servilexSucursalCode" TEXT,
ADD COLUMN "servilexExtraConfig" JSONB;

DROP INDEX IF EXISTS "invoices_orderId_key";

ALTER TABLE "invoices"
ADD COLUMN "servilexGroupKey" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "servilexIndicator" TEXT,
ADD COLUMN "servilexSucursalCode" TEXT,
ADD COLUMN "servilexGroupType" TEXT,
ADD COLUMN "servilexGroupLabel" TEXT,
ADD COLUMN "assignedTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "alumnoSnapshot" JSONB,
ADD COLUMN "servilexPayloadSnapshot" JSONB;

UPDATE "invoices" AS i
SET "assignedTotal" = o."totalAmount"
FROM "orders" AS o
WHERE o."id" = i."orderId"
  AND i."assignedTotal" = 0;

CREATE UNIQUE INDEX "invoices_orderId_servilexGroupKey_key"
ON "invoices"("orderId", "servilexGroupKey");

CREATE INDEX "invoices_orderId_idx"
ON "invoices"("orderId");
