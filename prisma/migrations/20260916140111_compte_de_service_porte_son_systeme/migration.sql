-- Le systeme d'un compte machine devient une colonne, et non plus une deduction.
--
-- Les lignes anterieures venaient d'un fichier de politique qui ne le disait pas.
-- Deux reprises, dans cet ordre : l'identite rattachee quand elle est seule a decider,
-- puis le prefixe de la cle, que toutes les cles ecrites a la main portent deja. Ce que
-- ni l'une ni l'autre ne rattrape arrete la migration plutot que de recevoir une valeur
-- inventee : un compte range sous un systeme au hasard serait pire qu'un refus, la fiche
-- du systeme l'affirmant ensuite sans reserve.

ALTER TABLE "ServiceAccount" ADD COLUMN "provider" TEXT;

-- Seulement quand toutes les identites rattachees s'accordent. Rien n'interdisait jusqu'ici
-- de rattacher a un meme compte machine des comptes releves sur deux systemes : en choisir
-- un des deux le rangerait sous l'un en taisant l'autre, et le garde plus bas ne verrait
-- rien puisque la colonne serait remplie.
UPDATE "ServiceAccount" s
SET "provider" = (
  SELECT min(e."provider") FROM "ExternalIdentity" e
  WHERE e."serviceAccountId" = s."id"
  HAVING count(DISTINCT e."provider") = 1
)
WHERE s."provider" IS NULL;

-- Le prefixe ne parle que pour les comptes qu'aucune identite ne reclame. Sur un compte
-- aux identites discordantes, il trancherait le desaccord par le nom, ce qui est
-- exactement l'invention que la reprise precedente vient de refuser.
UPDATE "ServiceAccount" s
SET "provider" = split_part(s."key", '-', 1)
WHERE s."provider" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "ExternalIdentity" e WHERE e."serviceAccountId" = s."id")
  AND split_part(s."key", '-', 1) IN ('github', 'notion', 'scalingo');

DO $$
DECLARE restantes TEXT;
BEGIN
  SELECT string_agg("key", ', ' ORDER BY "key") INTO restantes
  FROM "ServiceAccount" WHERE "provider" IS NULL;

  IF restantes IS NOT NULL THEN
    RAISE EXCEPTION 'Systeme indeterminable pour : %. Ces comptes n''ont pas de cle prefixee par un systeme connu, ou portent des comptes releves sur plusieurs systemes a la fois. Tranchez a la main, en separant le compte machine s''il en sert deux, puis relancez la migration.', restantes;
  END IF;
END $$;

ALTER TABLE "ServiceAccount" ALTER COLUMN "provider" SET NOT NULL;

CREATE INDEX "ServiceAccount_provider_idx" ON "ServiceAccount"("provider");
