-- Preserve existing types while allowing administrators to enter new merch types.
ALTER TABLE "merch_products"
    ALTER COLUMN "category" TYPE TEXT USING "category"::text;

DROP TYPE "MerchCategory";
