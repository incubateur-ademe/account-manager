-- CreateTable
CREATE TABLE "StartupAssignment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "startupGhid" TEXT NOT NULL,
    "until" DATE NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,

    CONSTRAINT "StartupAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StartupAssignment_personId_endedAt_idx" ON "StartupAssignment"("personId", "endedAt");

-- CreateIndex
CREATE INDEX "StartupAssignment_startupGhid_endedAt_idx" ON "StartupAssignment"("startupGhid", "endedAt");

-- AddForeignKey
ALTER TABLE "StartupAssignment" ADD CONSTRAINT "StartupAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
