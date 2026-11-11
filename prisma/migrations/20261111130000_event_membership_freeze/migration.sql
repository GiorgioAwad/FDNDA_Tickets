-- Event-specific, multi-month closures extend and block member access without
-- consuming or replacing the member's one voluntary freeze.
ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "membershipFreezeStart" DATE,
ADD COLUMN IF NOT EXISTS "membershipFreezeEnd" DATE,
ADD COLUMN IF NOT EXISTS "membershipFreezeExtensionMonths" INTEGER NOT NULL DEFAULT 0;
