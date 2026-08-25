ALTER TABLE "discount_codes"
ADD COLUMN "ticketTypeId" TEXT,
ADD COLUMN "validDate" DATE;

CREATE INDEX "discount_codes_ticketTypeId_validDate_idx"
ON "discount_codes"("ticketTypeId", "validDate");

ALTER TABLE "discount_codes"
ADD CONSTRAINT "discount_codes_ticketTypeId_fkey"
FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
