DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum enum
        JOIN pg_type type ON enum.enumtypid = type.oid
        WHERE type.typname = 'InvoiceStatus' AND enum.enumlabel = 'PROCESSING'
    ) THEN
        ALTER TYPE "InvoiceStatus" ADD VALUE 'PROCESSING';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum enum
        JOIN pg_type type ON enum.enumtypid = type.oid
        WHERE type.typname = 'InvoiceStatus' AND enum.enumlabel = 'FAILED_RETRYABLE'
    ) THEN
        ALTER TYPE "InvoiceStatus" ADD VALUE 'FAILED_RETRYABLE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum enum
        JOIN pg_type type ON enum.enumtypid = type.oid
        WHERE type.typname = 'InvoiceStatus' AND enum.enumlabel = 'FAILED_REQUIRES_REVIEW'
    ) THEN
        ALTER TYPE "InvoiceStatus" ADD VALUE 'FAILED_REQUIRES_REVIEW';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "uploaded_assets" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uploaded_assets_key_key" ON "uploaded_assets"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "uploaded_assets_url_key" ON "uploaded_assets"("url");
CREATE INDEX IF NOT EXISTS "uploaded_assets_createdById_idx" ON "uploaded_assets"("createdById");
CREATE INDEX IF NOT EXISTS "uploaded_assets_provider_idx" ON "uploaded_assets"("provider");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uploaded_assets_createdById_fkey'
    ) THEN
        ALTER TABLE "uploaded_assets"
        ADD CONSTRAINT "uploaded_assets_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
END $$;
