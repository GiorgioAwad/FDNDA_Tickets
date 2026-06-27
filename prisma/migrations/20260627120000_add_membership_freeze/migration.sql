-- CreateTable
CREATE TABLE "membership_freezes" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_freezes_ticketId_key" ON "membership_freezes"("ticketId");

-- CreateIndex
CREATE INDEX "membership_freezes_startDate_endDate_idx" ON "membership_freezes"("startDate", "endDate");

-- AddForeignKey
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
