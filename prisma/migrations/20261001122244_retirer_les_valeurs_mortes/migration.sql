-- Retire quatre types de constat que rien ne produit, et l'état de plan `CONFIRMABLE`,
-- qu'aucun code n'écrit. Postgres ne sait pas retirer une valeur d'un type énuméré : le
-- type se recrée sous son nom, et chaque colonne se convertit par son texte. Une ligne qui
-- porterait encore une valeur retirée fait échouer la conversion, donc toute la migration,
-- plutôt que de se perdre.
--
-- Dans une transaction, que Prisma ne pose pas d'elle-même : un échec au second type
-- laisserait sinon le premier converti, et une base à moitié migrée.

BEGIN;

ALTER TYPE "FindingKind" RENAME TO "FindingKind_ancien";
CREATE TYPE "FindingKind" AS ENUM ('SCOPE_EXIT', 'SCOPE_ENTRY', 'INACTIVE_STARTUP', 'ORPHAN', 'UNREGISTERED', 'EXPIRED_GRANT', 'OVERDUE_MANUAL_ACTION');
ALTER TABLE "Finding" ALTER COLUMN "kind" TYPE "FindingKind" USING ("kind"::text::"FindingKind");
DROP TYPE "FindingKind_ancien";

-- Le défaut de la colonne et l'index partiel qui tient un seul plan courant par dossier
-- portent l'ancien type : ils se retirent le temps de la conversion, et l'index se recrée
-- à l'identique.
ALTER TYPE "PlanState" RENAME TO "PlanState_ancien";
CREATE TYPE "PlanState" AS ENUM ('DRAFT', 'EXECUTING', 'EXECUTED', 'PARTIALLY_EXECUTED', 'CANCELLED', 'EXPIRED', 'STALE');
DROP INDEX "Plan_un_seul_courant_par_dossier";
ALTER TABLE "Plan" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "Plan" ALTER COLUMN "state" TYPE "PlanState" USING ("state"::text::"PlanState");
ALTER TABLE "Plan" ALTER COLUMN "state" SET DEFAULT 'DRAFT';
CREATE UNIQUE INDEX "Plan_un_seul_courant_par_dossier" ON "Plan" ("accessCaseId")
  WHERE "accessCaseId" IS NOT NULL AND "state" NOT IN ('CANCELLED', 'EXPIRED', 'STALE');
DROP TYPE "PlanState_ancien";

COMMIT;
