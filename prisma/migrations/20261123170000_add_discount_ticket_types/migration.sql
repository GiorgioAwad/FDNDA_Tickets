CREATE TABLE "discount_code_ticket_types" (
    "discountCodeId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    CONSTRAINT "discount_code_ticket_types_pkey" PRIMARY KEY ("discountCodeId", "ticketTypeId")
);

CREATE INDEX "discount_code_ticket_types_ticketTypeId_idx"
ON "discount_code_ticket_types"("ticketTypeId");

ALTER TABLE "discount_code_ticket_types"
ADD CONSTRAINT "discount_code_ticket_types_discountCodeId_fkey"
FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discount_code_ticket_types"
ADD CONSTRAINT "discount_code_ticket_types_ticketTypeId_fkey"
FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the scope of existing codes.
INSERT INTO "discount_code_ticket_types" ("discountCodeId", "ticketTypeId")
SELECT "id", "ticketTypeId" FROM "discount_codes" WHERE "ticketTypeId" IS NOT NULL;
