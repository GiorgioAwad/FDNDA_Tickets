-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BOLETA', 'FACTURA');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "buyerAddress" TEXT,
ADD COLUMN     "buyerDocNumber" TEXT,
ADD COLUMN     "buyerDocType" TEXT,
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "documentType" "DocumentType" NOT NULL DEFAULT 'BOLETA',
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "pdfUrl" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentToProvider" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "buyerAddress" TEXT,
ADD COLUMN     "buyerDocNumber" TEXT,
ADD COLUMN     "buyerDocType" TEXT,
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "documentType" TEXT;

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
