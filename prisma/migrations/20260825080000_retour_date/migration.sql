-- Aucun retro-remplissage, et c'est delibere : personne n'est repute revenu avant que
-- l'outil ne sache le constater. Une date deduite d'un depart clos serait fausse par
-- construction, puisqu'une mission qui s'acheve ne fait pas sortir du referentiel :
-- la colonne se remplit au premier passage qui revoit une fiche disparue, jamais avant.
ALTER TABLE "Person" ADD COLUMN "returnedAt" TIMESTAMP(3);
