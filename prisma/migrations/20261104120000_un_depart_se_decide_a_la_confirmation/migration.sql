-- Confirmer le plan d'un depart decide ce depart, et le passe a CONFIRMED dans la meme
-- ecriture. Avant cette regle, aucun code ne posait cet etat : les departs dont le plan
-- a deja ete confirme sont restes en WATCH ou CANDIDATE, et les listes les annoncent
-- encore a instruire. Un plan confirme ne se remplace pas, sa date suffit a les retrouver.
UPDATE "AccessCase" AS dossier
SET "state" = 'CONFIRMED'
WHERE dossier."kind" = 'OFFBOARDING'
  AND dossier."state" IN ('WATCH', 'CANDIDATE')
  AND EXISTS (
    SELECT 1
    FROM "Plan" AS plan
    WHERE plan."accessCaseId" = dossier."id"
      AND plan."confirmedAt" IS NOT NULL
  );
