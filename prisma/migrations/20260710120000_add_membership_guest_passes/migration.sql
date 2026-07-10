-- CreateTable
CREATE TABLE "membership_guest_passes" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_guest_passes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_guest_passes_number_check" CHECK ("number" BETWEEN 1 AND 3)
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_guest_passes_ticketId_number_key"
ON "membership_guest_passes"("ticketId", "number");

-- CreateIndex
CREATE INDEX "membership_guest_passes_eventId_date_idx"
ON "membership_guest_passes"("eventId", "date");

-- CreateIndex
CREATE INDEX "membership_guest_passes_staffId_idx"
ON "membership_guest_passes"("staffId");

-- CreateIndex
CREATE INDEX "membership_guest_passes_registeredAt_idx"
ON "membership_guest_passes"("registeredAt");

-- AddForeignKey
ALTER TABLE "membership_guest_passes"
ADD CONSTRAINT "membership_guest_passes_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_guest_passes"
ADD CONSTRAINT "membership_guest_passes_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_guest_passes"
ADD CONSTRAINT "membership_guest_passes_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
