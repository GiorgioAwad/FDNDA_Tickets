-- CreateTable
CREATE TABLE "membership_monthly_schedules" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "monthIndex" INTEGER NOT NULL,
    "selection" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_monthly_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_monthly_schedules_ticketId_idx" ON "membership_monthly_schedules"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_monthly_schedules_ticketId_monthIndex_key" ON "membership_monthly_schedules"("ticketId", "monthIndex");

-- AddForeignKey
ALTER TABLE "membership_monthly_schedules" ADD CONSTRAINT "membership_monthly_schedules_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
