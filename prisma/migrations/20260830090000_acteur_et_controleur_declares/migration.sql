-- Migration additive : deux colonnes, l'une a defaut et l'autre nullable, aucune
-- reprise de donnees. Les etapes de modele deja ecrites deviennent « a faire par
-- l'operateur, sans controle », ce qu'elles ont toujours ete.
--
-- Aucun type n'est cree ici : "StepActor" existe depuis 20260827090000, ou il est ne
-- avec les colonnes de PlanStep. Rien n'etant ajoute a ce type, son emploi comme
-- defaut de colonne ne rencontre pas la restriction qui pese sur ALTER TYPE ADD VALUE.
--
-- validationBy reste nullable et sans defaut, contrairement a expectedActor : nul y
-- signifie « se croit sur parole », et un defaut a 'OPERATOR' mettrait d'un coup toutes
-- les etapes deja declarees en attente d'un second regard, ce qui suspendrait tout
-- dossier assemble depuis un modele existant. Un defaut qui vaut reprise de donnees
-- n'est pas un defaut.
--
-- Aucune contrainte CHECK sur la paire (expectedActor, validationBy), pour les deux
-- raisons deja retenues sur PlanStep : la combinaison se refuse a l'ecriture depuis une
-- fonction pure, et une CHECK qui reference une valeur d'enum se desynchronise en
-- silence apres un ALTER TYPE RENAME VALUE, PostgreSQL en stockant l'OID et Prisma
-- etant aveugle aux CHECK.

-- AlterTable
ALTER TABLE "PlanTemplateStep" ADD COLUMN     "expectedActor" "StepActor" NOT NULL DEFAULT 'OPERATOR',
ADD COLUMN     "validationBy" "StepActor";
