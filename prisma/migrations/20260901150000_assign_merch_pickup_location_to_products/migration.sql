-- Assign every merch product to the pickup location where it must be collected.
ALTER TABLE "merch_products"
ADD COLUMN "pickupLocationId" TEXT;

-- Restore the legacy location if an administrator removed it before this deploy.
INSERT INTO "merch_pickup_locations"
    ("id", "name", "address", "district", "instructions", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('merch-pickup-campo-de-marte', 'Campo de Marte', 'Sede Campo de Marte', 'Jesus Maria', 'Presenta tu numero de orden y DNI al momento del recojo.', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Existing products keep the legacy pickup behavior after this becomes required.
UPDATE "merch_products"
SET "pickupLocationId" = 'merch-pickup-campo-de-marte'
WHERE "pickupLocationId" IS NULL;

ALTER TABLE "merch_products"
ALTER COLUMN "pickupLocationId" SET NOT NULL;

CREATE INDEX "merch_products_pickupLocationId_idx"
ON "merch_products"("pickupLocationId");

ALTER TABLE "merch_products"
ADD CONSTRAINT "merch_products_pickupLocationId_fkey"
FOREIGN KEY ("pickupLocationId") REFERENCES "merch_pickup_locations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
