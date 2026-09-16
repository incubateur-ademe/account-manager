-- Le systeme d'un compte machine devient une colonne, et non plus une deduction.
--
-- Les lignes anterieures venaient d'un fichier de politique qui ne le disait pas.
-- Deux reprises, dans cet ordre : l'identite rattachee quand il y en a une, puis le
-- prefixe de la cle, que toutes les cles ecrites a la main portent deja. Ce que ni
-- l'une ni l'autre ne rattrape arrete la migration plutot que de recevoir une valeur
-- inventee : un compte range sous un systeme au hasard serait pire qu'un refus, la
-- fiche du systeme l'affirmant ensuite sans reserve.

ALTER TABLE "ServiceAccount" ADD COLUMN "provider" TEXT;

UPDATE "ServiceAccount" s
SET "provider" = (
  SELECT e."provider" FROM "ExternalIdentity" e
  WHERE e."serviceAccountId" = s."id"
  ORDER BY e."provider"
  LIMIT 1
)
WHERE s."provider" IS NULL;

UPDATE "ServiceAccount" s
SET "provider" = split_part(s."key", '-', 1)
WHERE s."provider" IS NULL
  AND split_part(s."key", '-', 1) IN ('github', 'notion', 'scalingo');

DO $$
DECLARE restantes TEXT;
BEGIN
  SELECT string_agg("key", ', ' ORDER BY "key") INTO restantes
  FROM "ServiceAccount" WHERE "provider" IS NULL;

  IF restantes IS NOT NULL THEN
    RAISE EXCEPTION 'Systeme indeterminable pour : %. Posez la colonne provider a la main sur ces lignes, puis relancez la migration.', restantes;
  END IF;
END $$;

ALTER TABLE "ServiceAccount" ALTER COLUMN "provider" SET NOT NULL;

CREATE INDEX "ServiceAccount_provider_idx" ON "ServiceAccount"("provider");
