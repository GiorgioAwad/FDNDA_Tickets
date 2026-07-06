-- CreateEnum
CREATE TYPE "PoolReservationStatus" AS ENUM ('RESERVED', 'USED', 'CANCELLED');

-- CreateTable
CREATE TABLE "pool_visit_reservations" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "sourceTicketTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" TEXT NOT NULL,
    "status" "PoolReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pool_visit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pool_visit_reservations_ticketId_date_sourceTicketTypeId_key" ON "pool_visit_reservations"("ticketId", "date", "sourceTicketTypeId");

-- CreateIndex
CREATE INDEX "pool_visit_reservations_ticketId_status_idx" ON "pool_visit_reservations"("ticketId", "status");

-- CreateIndex
CREATE INDEX "pool_visit_reservations_sourceTicketTypeId_date_idx" ON "pool_visit_reservations"("sourceTicketTypeId", "date");

-- AddForeignKey
ALTER TABLE "pool_visit_reservations" ADD CONSTRAINT "pool_visit_reservations_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_visit_reservations" ADD CONSTRAINT "pool_visit_reservations_sourceTicketTypeId_fkey" FOREIGN KEY ("sourceTicketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
