-- AlterTable: Add ON DELETE CASCADE to order_items.ticketTypeId foreign key
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_ticketTypeId_fkey";

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
