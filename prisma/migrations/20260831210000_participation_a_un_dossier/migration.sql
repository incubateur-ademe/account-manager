-- Le droit d'une personne a voir un dossier et a y pointer les etapes qui la nomment,
-- sans etre operateur. Migration additive, table neuve et vide, aucune reprise de
-- donnees. Rien ne change de comportement : la base sait exprimer le droit, personne
-- ne le lit encore.
--
-- Cascade sur les deux cles etrangeres, et il faut la declarer : la cascade du dossier
-- n'est pas uniforme, Plan.accessCaseId etant en SET NULL. Poser SET NULL ici par
-- symetrie produirait des droits orphelins pointant vers rien.
--
-- L'index sur channelEmail n'est pas decoratif, la connexion resout une adresse par
-- lui. Il n'est pas unique a dessein : une meme personne porte legitimement le meme
-- canal sur deux dossiers, et le refus de pluralite entre personnes distinctes vit
-- dans le code, aucun index ne sachant l'exprimer sans interdire le cas legitime.

-- CreateTable
CREATE TABLE "CaseParticipation" (
    "id" TEXT NOT NULL,
    "accessCaseId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "channelEmail" TEXT,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,

    CONSTRAINT "CaseParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseParticipation_personId_revokedAt_idx" ON "CaseParticipation"("personId", "revokedAt");

-- CreateIndex
CREATE INDEX "CaseParticipation_expiresAt_idx" ON "CaseParticipation"("expiresAt");

-- CreateIndex
CREATE INDEX "CaseParticipation_channelEmail_idx" ON "CaseParticipation"("channelEmail");

-- CreateIndex
CREATE UNIQUE INDEX "CaseParticipation_accessCaseId_personId_key" ON "CaseParticipation"("accessCaseId", "personId");

-- AddForeignKey
ALTER TABLE "CaseParticipation" ADD CONSTRAINT "CaseParticipation_accessCaseId_fkey" FOREIGN KEY ("accessCaseId") REFERENCES "AccessCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParticipation" ADD CONSTRAINT "CaseParticipation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma ne sait pas exprimer un index partiel, d'ou l'ecriture a la main ; il n'y voit
-- pas de derive et le laisse en place. La clause WHERE ne sert pas a autoriser plusieurs
-- lignes nulles, PostgreSQL les autorise deja sous un index unique ordinaire : elle
-- borne l'unicite aux fiches que la voie par adresse ouvre reellement. L'etendre aux
-- fiches collectees casserait la collecte de nuit le jour ou deux membres partagent une
-- boite d'equipe, sans qu'aucune saisie soit en cause et sans que personne ne puisse
-- corriger, ces fiches n'etant pas editables.
CREATE UNIQUE INDEX "Person_communicationEmail_unique"
  ON "Person" ("communicationEmail")
  WHERE "communicationEmail" IS NOT NULL AND "source" = 'LOCAL';
