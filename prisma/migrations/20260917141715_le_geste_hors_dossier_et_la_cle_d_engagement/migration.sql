-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "intent" JSONB,
ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "PlanStep" ADD COLUMN     "engagementKey" TEXT;

-- CreateIndex
CREATE INDEX "Plan_subjectId_idx" ON "Plan"("subjectId");

-- CreateIndex
CREATE INDEX "PlanStep_engagementKey_idx" ON "PlanStep"("engagementKey");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
