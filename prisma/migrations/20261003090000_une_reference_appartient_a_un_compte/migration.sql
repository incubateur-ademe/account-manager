-- Une reference pointe vers le compte qui possede l'objet, et non vers une fiche : un
-- objet survit a son compte. Aucun code n'a jamais cree de ligne dans cette table ; la
-- garde refuse quand meme d'effacer un proprietaire qu'une reprise a la main y aurait pose.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Reference") THEN
    RAISE EXCEPTION 'Reference porte des lignes rattachees a une fiche. Cette migration retire personId et perdrait leur proprietaire. Videz la table ou reprenez-la a la main, puis relancez.';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "Reference" DROP CONSTRAINT "Reference_personId_fkey";

-- DropIndex
DROP INDEX "Reference_personId_resourceId_key";

-- DropIndex
DROP INDEX "Reference_provider_idx";

-- AlterTable
ALTER TABLE "Reference" DROP COLUMN "personId",
ADD COLUMN     "externalIdentityId" TEXT,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vanishedAt" TIMESTAMP(3),
ALTER COLUMN "onOffboard" SET DEFAULT 'KEEP';

-- CreateIndex
CREATE INDEX "Reference_provider_vanishedAt_idx" ON "Reference"("provider", "vanishedAt");

-- CreateIndex
CREATE INDEX "Reference_externalIdentityId_idx" ON "Reference"("externalIdentityId");

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_externalIdentityId_fkey" FOREIGN KEY ("externalIdentityId") REFERENCES "ExternalIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une ressource a au plus une reference vivante par compte : un changement de compte ou
-- de destin date la ligne et en ouvre une neuve. Prisma ne declare pas un index partiel
-- et le laisse en place, comme AccessCase_un_seul_vivant_par_sens. Une reference sans
-- compte y echappe, deux nuls etant distincts : la collecte refuse un couple en double.
CREATE UNIQUE INDEX "Reference_vivante_par_compte_key"
  ON "Reference"("resourceId", "externalIdentityId")
  WHERE "vanishedAt" IS NULL;
