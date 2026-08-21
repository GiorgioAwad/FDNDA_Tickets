-- CreateEnum
CREATE TYPE "MembershipChangeKind" AS ENUM ('SCHEDULE', 'TRANSFER');

-- CreateTable
CREATE TABLE "membership_admin_changes" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "MembershipChangeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_admin_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_admin_changes_ticketId_createdAt_idx"
ON "membership_admin_changes"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "membership_admin_changes"
ADD CONSTRAINT "membership_admin_changes_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_admin_changes"
ADD CONSTRAINT "membership_admin_changes_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
