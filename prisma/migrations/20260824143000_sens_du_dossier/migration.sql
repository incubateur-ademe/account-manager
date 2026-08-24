-- Migration ecrite a la main. Une valeur ajoutee a un type enumere ne peut pas
-- etre utilisee dans la transaction qui l'ajoute : aucun ordre de ce fichier
-- n'ecrit 'ONBOARDING' ni 'ALREADY_PRESENT' dans une ligne. La restriction ne
-- vaut pas pour un type cree dans la meme transaction, d'ou le defaut
-- 'OFFBOARDING' plus bas.
CREATE TYPE "CaseKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- BEFORE et AFTER pour que l'ordre physique du type suive l'ordre du fichier
-- schema.prisma, sans quoi une introspection ulterieure signalerait une derive.
ALTER TYPE "PlanKind" ADD VALUE 'ONBOARDING' BEFORE 'OFFBOARDING';

ALTER TYPE "StepState" ADD VALUE 'ALREADY_PRESENT' AFTER 'ALREADY_ABSENT';

-- Le defaut qualifie les lignes deja la, toutes des departs, puis disparait :
-- le laisser ferait naitre en depart un dossier dont le code aurait oublie de
-- dire le sens.
ALTER TABLE "AccessCase" ADD COLUMN "kind" "CaseKind" NOT NULL DEFAULT 'OFFBOARDING';

ALTER TABLE "AccessCase" ALTER COLUMN "kind" DROP DEFAULT;

-- WATCH n'est pas un etat qu'une arrivee admet : la base cesse de savoir le poser.
ALTER TABLE "AccessCase" ALTER COLUMN "state" DROP DEFAULT;

ALTER TABLE "PlanStep" ADD COLUMN "ordre" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AccessCase_kind_state_idx" ON "AccessCase"("kind", "state");
