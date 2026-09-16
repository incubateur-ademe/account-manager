-- CreateTable
CREATE TABLE "ConfigOverride" (
    "path" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigOverride_pkey" PRIMARY KEY ("path")
);
