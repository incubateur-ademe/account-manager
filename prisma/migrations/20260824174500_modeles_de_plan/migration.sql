-- Migration additive : aucune donnee existante n'est touchee, aucune reprise n'est
-- necessaire. Le type est cree dans la meme transaction que les tables qui s'en
-- servent, ce que PostgreSQL admet : la restriction ne porte que sur les valeurs
-- ajoutees a un type deja existant.

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- AlterTable
ALTER TABLE "PlanStep" ADD COLUMN     "reponse" TEXT,
ADD COLUMN     "template" JSONB;

-- CreateTable
CREATE TABLE "PlanTemplate" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "startupsMayExtend" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTemplateStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "runbook" TEXT,
    "deeplink" TEXT,
    "doneWhen" TEXT NOT NULL,
    "input" JSONB,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplate_ownerKey_kind_key" ON "PlanTemplate"("ownerKey", "kind");

-- CreateIndex
CREATE INDEX "PlanTemplateStep_templateId_position_idx" ON "PlanTemplateStep"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplateStep_templateId_key_key" ON "PlanTemplateStep"("templateId", "key");

-- AddForeignKey
ALTER TABLE "PlanTemplateStep" ADD CONSTRAINT "PlanTemplateStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
