-- Renommage et non recreation. `prisma migrate dev` rend un changement de valeur
-- d'enum par une suppression suivie d'une recreation du type, ce qui perdrait la
-- colonne : sur une base de developpement on s'en apercoit, en production on
-- s'apercoit qu'il est trop tard. Un ALTER TYPE ... RENAME VALUE est atomique et
-- ne reecrit aucune ligne, les fiches qui portaient 'LOCAL' portent 'NONE' sans
-- qu'une seule mise a jour ne passe sur la table.
ALTER TYPE "Attachment" RENAME VALUE 'LOCAL' TO 'NONE';

-- En l'absence d'observation, la voie constatee est « aucune », et non « par
-- startup » : le defaut affirmait un rattachement que rien n'avait constate.
ALTER TABLE "Person" ALTER COLUMN "attachment" SET DEFAULT 'NONE';

-- CreateEnum
CREATE TYPE "ScopeDecision" AS ENUM ('INCLUDE', 'EXCLUDE');

-- CreateTable
CREATE TABLE "ScopeOverride" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "decision" "ScopeDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScopeOverride_personId_key" ON "ScopeOverride"("personId");

-- AddForeignKey
ALTER TABLE "ScopeOverride" ADD CONSTRAINT "ScopeOverride_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
