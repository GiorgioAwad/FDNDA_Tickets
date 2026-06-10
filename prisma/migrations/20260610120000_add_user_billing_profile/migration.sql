-- CreateTable
CREATE TABLE "user_billing_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL DEFAULT 'BOLETA',
    "buyerDocNumber" TEXT NOT NULL,
    "buyerName" TEXT,
    "buyerAddress" TEXT,
    "buyerEmail" TEXT,
    "buyerPhone" TEXT,
    "buyerUbigeo" TEXT,
    "buyerFirstName" TEXT,
    "buyerSecondName" TEXT,
    "buyerLastNamePaternal" TEXT,
    "buyerLastNameMaternal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_billing_profiles_userId_key" ON "user_billing_profiles"("userId");

-- AddForeignKey
ALTER TABLE "user_billing_profiles" ADD CONSTRAINT "user_billing_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
