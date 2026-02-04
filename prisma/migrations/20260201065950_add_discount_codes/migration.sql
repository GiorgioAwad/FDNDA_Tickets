-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "value" DECIMAL(10,2) NOT NULL,
    "eventId" TEXT,
    "minPurchase" DECIMAL(10,2),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerUser" INTEGER DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_usages" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountSaved" DECIMAL(10,2) NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_usages_discountCodeId_orderId_key" ON "discount_usages"("discountCodeId", "orderId");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
