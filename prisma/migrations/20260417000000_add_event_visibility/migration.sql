-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "events"
ADD COLUMN "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN "accessToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_accessToken_key" ON "events"("accessToken");

-- CreateIndex
CREATE INDEX "events_visibility_isPublished_endDate_idx" ON "events"("visibility", "isPublished", "endDate");
