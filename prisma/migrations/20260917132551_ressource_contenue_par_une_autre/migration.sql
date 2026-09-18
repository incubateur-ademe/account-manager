-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Resource_parentId_idx" ON "Resource"("parentId");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
