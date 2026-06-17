-- CreateEnum
CREATE TYPE "EventTicketLayout" AS ENUM ('LIST', 'PLANS');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "ticketLayout" "EventTicketLayout" NOT NULL DEFAULT 'LIST';

-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "benefits" JSONB,
ADD COLUMN     "highlightLabel" TEXT,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyClassLimit" INTEGER,
ADD COLUMN     "originalPrice" DECIMAL(10,2);
