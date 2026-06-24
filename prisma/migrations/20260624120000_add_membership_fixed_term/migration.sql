-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "membershipDurationMonths" INTEGER;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "membershipStartDate" DATE;
