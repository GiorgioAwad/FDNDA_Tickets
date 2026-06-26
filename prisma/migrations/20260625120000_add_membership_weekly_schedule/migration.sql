-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "membershipScheduleKey" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "membershipSchedule" JSONB;
