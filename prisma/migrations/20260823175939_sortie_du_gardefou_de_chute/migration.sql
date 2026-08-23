-- CreateTable
CREATE TABLE "ScopeDropOverride" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "famille" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "consumedRunId" TEXT,

    CONSTRAINT "ScopeDropOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScopeDropOverride_provider_famille_consumedAt_idx" ON "ScopeDropOverride"("provider", "famille", "consumedAt");
