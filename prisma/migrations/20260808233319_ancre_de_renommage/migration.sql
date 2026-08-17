-- AlterTable
ALTER TABLE "Person" ADD COLUMN "betaUuid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Person_betaUuid_key" ON "Person"("betaUuid");
