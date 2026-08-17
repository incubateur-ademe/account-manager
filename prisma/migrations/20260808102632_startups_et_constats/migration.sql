-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FindingKind" ADD VALUE 'SCOPE_EXIT';
ALTER TYPE "FindingKind" ADD VALUE 'INACTIVE_STARTUP';

-- CreateTable
CREATE TABLE "Startup" (
    "id" TEXT NOT NULL,
    "ghid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "incubatorGhid" TEXT NOT NULL,
    "currentPhase" TEXT,
    "phaseStart" DATE,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vanishedAt" TIMESTAMP(3),

    CONSTRAINT "Startup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Startup_ghid_key" ON "Startup"("ghid");

-- CreateIndex
CREATE INDEX "Startup_incubatorGhid_idx" ON "Startup"("incubatorGhid");

-- CreateIndex
CREATE INDEX "Startup_currentPhase_idx" ON "Startup"("currentPhase");
