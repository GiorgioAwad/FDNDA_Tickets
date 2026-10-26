-- Delivery restrictions belong to the product, not to previous orders.
ALTER TABLE "merch_products"
ADD COLUMN "pickupOnly" BOOLEAN NOT NULL DEFAULT false;

-- The current active catalog is available only for pickup at its assigned venue.
UPDATE "merch_products"
SET "pickupOnly" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" = true;
