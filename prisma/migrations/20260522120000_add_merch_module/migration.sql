-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('TICKET', 'MERCH');

-- CreateEnum
CREATE TYPE "MerchCategory" AS ENUM ('POLERA', 'GORRA', 'PIN', 'OTROS');

-- CreateEnum
CREATE TYPE "MerchZone" AS ENUM ('LIMA', 'SUR', 'NORTE', 'ORIENTE', 'GENERICA');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PICKUP_EVENT', 'SHIPPING_HOME', 'PICKUP_OFFICE');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'READY', 'SHIPPED', 'DELIVERED', 'PICKED_UP', 'CANCELLED');

-- AlterTable: order_items polymorphic
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_ticketTypeId_fkey";
ALTER TABLE "order_items" ALTER COLUMN "ticketTypeId" DROP NOT NULL;
ALTER TABLE "order_items" ADD COLUMN "merchVariantId" TEXT;
ALTER TABLE "order_items" ADD COLUMN "merchSnapshot" JSONB;

-- AlterTable: orders + delivery
ALTER TABLE "orders" ADD COLUMN "orderType" "OrderType" NOT NULL DEFAULT 'TICKET';
ALTER TABLE "orders" ADD COLUMN "deliveryMethod" "DeliveryMethod";
ALTER TABLE "orders" ADD COLUMN "pickupEventId" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingAddress" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingDistrito" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingUbigeo" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingReference" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingPhone" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippingCost" DECIMAL(10,2);
ALTER TABLE "orders" ADD COLUMN "fulfillmentStatus" "FulfillmentStatus";
ALTER TABLE "orders" ADD COLUMN "fulfilledAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "trackingCode" TEXT;

-- CreateTable: merch_products
CREATE TABLE "merch_products" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "MerchCategory" NOT NULL,
    "zone" "MerchZone" NOT NULL DEFAULT 'GENERICA',
    "etapa" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PEN',
    "imageUrl" TEXT,
    "imageUrls" JSONB,
    "hasSizes" BOOLEAN NOT NULL DEFAULT false,
    "availableSizes" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "servilexServiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merch_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable: merch_variants
CREATE TABLE "merch_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merch_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merch_products_slug_key" ON "merch_products"("slug");
CREATE INDEX "merch_products_category_zone_isActive_idx" ON "merch_products"("category", "zone", "isActive");
CREATE INDEX "merch_products_isActive_sortOrder_idx" ON "merch_products"("isActive", "sortOrder");
CREATE UNIQUE INDEX "merch_variants_sku_key" ON "merch_variants"("sku");
CREATE UNIQUE INDEX "merch_variants_productId_size_key" ON "merch_variants"("productId", "size");
CREATE INDEX "merch_variants_productId_isActive_idx" ON "merch_variants"("productId", "isActive");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_merchVariantId_fkey"
    FOREIGN KEY ("merchVariantId") REFERENCES "merch_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merch_products" ADD CONSTRAINT "merch_products_servilexServiceId_fkey"
    FOREIGN KEY ("servilexServiceId") REFERENCES "servilex_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merch_variants" ADD CONSTRAINT "merch_variants_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "merch_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint: OrderItem must reference exactly one of ticketType or merchVariant
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_exactly_one_kind"
    CHECK (
        (("ticketTypeId" IS NOT NULL)::int + ("merchVariantId" IS NOT NULL)::int) = 1
    );
