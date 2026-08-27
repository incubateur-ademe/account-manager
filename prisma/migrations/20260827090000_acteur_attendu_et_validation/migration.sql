-- Migration additive : sept colonnes nullables ou a defaut, aucune reprise de
-- donnees. Les etapes deja ecrites deviennent « a faire par l'operateur, sans
-- controle », ce qui est exactement ce qu'elles ont toujours ete.
--
-- Deux types crees ici, jamais deux valeurs ajoutees a un type existant : une valeur
-- ajoutee par ALTER TYPE ADD VALUE ne s'utilise pas dans la transaction qui l'ajoute,
-- alors qu'un type cree dans la meme transaction s'utilise librement, defaut de
-- colonne compris.

-- Qui agit, et qui controle. DELEGATE est pose des maintenant alors qu'aucun chemin
-- de code ne l'atteint : une valeur inerte coute zero, une valeur ajoutee apres coup
-- coute un incident.
CREATE TYPE "StepActor" AS ENUM ('OPERATOR', 'SUBJECT', 'DELEGATE');

-- Dimension orthogonale a StepState, qui dit ce qui a ete declare la ou celle-ci dit
-- ou en est le controle de cette declaration. StepState ne gagne donc aucune valeur :
-- un AWAITING_VALIDATION obligerait a decliner chaque declaration validable en deux
-- valeurs, et l'enum dirait deux choses a la fois.
CREATE TYPE "StepValidation" AS ENUM ('NONE', 'AWAITING', 'ACCEPTED', 'REFUSED');

-- Aucune contrainte CHECK sur la combinaison (validationBy, expectedActor), et c'est
-- une decision. La combinaison est ecrite par le code au moment de figer les etapes,
-- a partir d'une fonction pure qui refuse net : aucune course ne peut en produire une
-- invalide, ce qui la distingue des deux index uniques partiels de ce schema, ou
-- l'invariant n'etait pas tenu par le code seul. Une CHECK qui reference une valeur
-- d'enum se desynchronise en outre en silence apres un ALTER TYPE RENAME VALUE,
-- PostgreSQL en stockant l'OID et Prisma etant aveugle aux CHECK.
--
-- declaredBy porte le nom du declarant et pas son role : « personne ne valide sa
-- propre declaration » se compare sur le username, sans quoi la regle serait
-- declarative et fausse.
ALTER TABLE "PlanStep" ADD COLUMN     "expectedActor" "StepActor" NOT NULL DEFAULT 'OPERATOR',
ADD COLUMN     "validationBy" "StepActor",
ADD COLUMN     "validation" "StepValidation" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "declaredBy" TEXT,
ADD COLUMN     "validatedBy" TEXT,
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validationNote" TEXT;

-- Sert la file « ce qui attend quelqu'un », que #13 et #14 liront par dossier et par
-- personne.
-- CreateIndex
CREATE INDEX "PlanStep_validation_idx" ON "PlanStep"("validation");
