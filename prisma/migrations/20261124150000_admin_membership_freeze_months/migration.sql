ALTER TABLE "membership_freezes"
ADD COLUMN "additionalMonths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "adminHistory" JSONB;
