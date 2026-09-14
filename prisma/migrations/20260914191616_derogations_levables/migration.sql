-- AlterTable
ALTER TABLE "Derogation" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedBy" TEXT;
