-- Un dossier ne porte qu'un plan qui compte. La reprise d'une ouverture interrompue
-- lit le nombre de plans du dossier avant d'en calculer un : deux ouvertures
-- simultanees comptent toutes les deux zero, et tout le calcul s'ecoule entre cette
-- lecture et l'ecriture. Sans garde en base elles ecrivent deux plans sur le meme
-- dossier, que rien ne departage : les ecrans prennent le plus recent, et deux
-- ecritures de la meme milliseconde s'egalisent sur un TIMESTAMP(3). La cloture
-- finirait par juger un brouillon que personne n'a vu, et l'annulation n'annulerait
-- que celui des deux qu'elle a lu.
--
-- Par exclusion et non par liste des etats courants : CANCELLED, EXPIRED et STALE sont
-- exactement les etats d'un plan qui a cesse de valoir, poses par l'annulation et par
-- le recalcul pour laisser la place a un successeur. Une valeur ajoutee un jour a
-- l'enum entre ainsi sous la garde par defaut, la ou une liste des etats courants l'en
-- laisserait sortir sans bruit. Les plans sans dossier restent libres.
--
-- Partiel, donc ecrit a la main : Prisma ne sait pas exprimer la clause WHERE, n'y voit
-- pas de derive et laisse l'index en place. Meme dispositif que
-- AccessCase_un_seul_vivant_par_sens.

-- Aucun chemin connu n'ecrit aujourd'hui deux plans courants sur un meme dossier :
-- plan.create n'existe qu'a un endroit et ses appelants sont gardes. La remise en etat
-- precede quand meme la creation de l'index, pour qu'un deploiement ne s'arrete jamais
-- sur un doublon que personne ne saurait defaire a la main. Elle garde celui que les
-- ecrans montraient deja, le plus recent, et passe les autres a STALE : c'est l'etat
-- d'un plan remplace, il garde ce qu'il proposait.
UPDATE "Plan" AS p
SET "state" = 'STALE'
WHERE p."accessCaseId" IS NOT NULL
  AND p."state" NOT IN ('CANCELLED', 'EXPIRED', 'STALE')
  AND p."id" <> (
    SELECT q."id"
    FROM "Plan" AS q
    WHERE q."accessCaseId" = p."accessCaseId"
      AND q."state" NOT IN ('CANCELLED', 'EXPIRED', 'STALE')
    ORDER BY q."createdAt" DESC, q."id" DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX "Plan_un_seul_courant_par_dossier"
  ON "Plan" ("accessCaseId")
  WHERE "accessCaseId" IS NOT NULL
    AND "state" NOT IN ('CANCELLED', 'EXPIRED', 'STALE');
