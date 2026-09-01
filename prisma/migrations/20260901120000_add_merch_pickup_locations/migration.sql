-- Puntos de recojo configurables para pedidos de merch.
CREATE TABLE "merch_pickup_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" TEXT,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merch_pickup_locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders"
ADD COLUMN "pickupLocationId" TEXT,
ADD COLUMN "pickupLocationSnapshot" JSONB;

CREATE INDEX "merch_pickup_locations_isActive_sortOrder_idx"
ON "merch_pickup_locations"("isActive", "sortOrder");

CREATE INDEX "orders_pickupLocationId_idx" ON "orders"("pickupLocationId");

ALTER TABLE "orders"
ADD CONSTRAINT "orders_pickupLocationId_fkey"
FOREIGN KEY ("pickupLocationId") REFERENCES "merch_pickup_locations"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Mantiene disponible la sede que estaba fija antes de esta migracion.
INSERT INTO "merch_pickup_locations"
    ("id", "name", "address", "district", "instructions", "isActive", "sortOrder", "updatedAt")
VALUES
    ('merch-pickup-campo-de-marte', 'Campo de Marte', 'Sede Campo de Marte', 'Jesus Maria', 'Presenta tu numero de orden y DNI al momento del recojo.', true, 0, CURRENT_TIMESTAMP);
