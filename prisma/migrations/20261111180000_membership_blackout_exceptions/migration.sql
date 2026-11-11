ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "membershipBlackoutExceptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Approved reopening for the existing Videna closure only. Keep the previous
-- expiry calculation and any other access exceptions already configured.
UPDATE "events"
SET "membershipBlackoutExceptions" = array_append("membershipBlackoutExceptions", '2027-01')
WHERE "id" = 'cmqtpjkzl003g01qex3xwhgfl'
  AND "servilexSucursalCode" = '03'
  AND "membershipFreezeStart" = DATE '2026-11-01'
  AND "membershipFreezeEnd" = DATE '2027-01-01'
  AND NOT ('2027-01' = ANY("membershipBlackoutExceptions"));
