-- Renommage et non recreation. Sur un renommage de modele, `prisma migrate dev`
-- rend une suppression suivie d'une creation, ce qui effacerait les dossiers, les
-- plans qui les referencent et les etapes deja pointees. Un ALTER ... RENAME est
-- atomique, ne reecrit aucune ligne et conserve les cles etrangeres.
ALTER TYPE "DepartureState" RENAME TO "CaseState";

ALTER TABLE "DepartureCase" RENAME TO "AccessCase";

ALTER TABLE "Plan" RENAME COLUMN "departureCaseId" TO "accessCaseId";

-- Postgres laisse aux objets dependants le nom qu'ils avaient : la cle primaire,
-- les index et les contraintes de cle etrangere continuent de porter l'ancien
-- modele. Sans ces renommages la base resterait fonctionnelle, mais le prochain
-- `prisma migrate` verrait une derive et proposerait de tout recreer.
ALTER TABLE "AccessCase" RENAME CONSTRAINT "DepartureCase_pkey" TO "AccessCase_pkey";

ALTER TABLE "AccessCase" RENAME CONSTRAINT "DepartureCase_personId_fkey" TO "AccessCase_personId_fkey";

ALTER TABLE "Plan" RENAME CONSTRAINT "Plan_departureCaseId_fkey" TO "Plan_accessCaseId_fkey";

ALTER INDEX "DepartureCase_personId_idx" RENAME TO "AccessCase_personId_idx";

ALTER INDEX "DepartureCase_state_idx" RENAME TO "AccessCase_state_idx";

ALTER INDEX "Plan_departureCaseId_idx" RENAME TO "Plan_accessCaseId_idx";
