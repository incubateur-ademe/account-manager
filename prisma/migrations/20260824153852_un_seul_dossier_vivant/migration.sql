-- L'unicite d'un dossier vivant par personne et par sens etait tenue par le code
-- seul, qui lit avant de creer : deux ouvertures simultanees passaient toutes les
-- deux la lecture et creaient deux dossiers, sur lesquels `findFirst` rend ensuite
-- l'un ou l'autre sans regle.
--
-- Index partiel et non contrainte d'unicite : un dossier clos ou annule ne compte
-- pas, sans quoi une personne qui revient dans l'incubateur ne pourrait plus jamais
-- ouvrir de second dossier. Prisma ne sait pas exprimer un index partiel, d'ou
-- l'ecriture a la main ; il n'y voit pas de derive et le laisse en place.
CREATE UNIQUE INDEX "AccessCase_un_seul_vivant_par_sens"
  ON "AccessCase" ("personId", "kind")
  WHERE "state" IN ('WATCH', 'CANDIDATE', 'CONFIRMED');
