CREATE TABLE "ticket_type_date_inventories" (
    "id" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_type_date_inventories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_type_date_inventories_ticketTypeId_date_key"
ON "ticket_type_date_inventories"("ticketTypeId", "date");

CREATE INDEX "ticket_type_date_inventories_ticketTypeId_date_idx"
ON "ticket_type_date_inventories"("ticketTypeId", "date");

ALTER TABLE "ticket_type_date_inventories"
ADD CONSTRAINT "ticket_type_date_inventories_ticketTypeId_fkey"
FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
