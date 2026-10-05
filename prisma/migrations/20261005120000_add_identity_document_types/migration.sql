ALTER TABLE "users" ADD COLUMN "identityDocType" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "user_billing_profiles" ADD COLUMN "buyerDocType" TEXT NOT NULL DEFAULT '1';

UPDATE "user_billing_profiles" SET "buyerDocType" = '6' WHERE "documentType" = 'FACTURA';
