-- Un constat de compte se deduplique sur l'identifiant du fournisseur, et non plus sur
-- le nom d'usage.
--
-- Un nom d'usage se renomme, et surtout il se recycle : GitHub rend un login abandonne
-- a quelqu'un d'autre. `dedupKey` etant unique sur toute la table, fermes compris, le
-- nouveau porteur d'un nom levait la cle de l'ancien, heritait de son episode et du
-- verrou qu'un operateur avait pose en le cloturant a la main, si bien que son ecart ne
-- remontait jamais.
--
-- Chaque compte garde une ligne sous la cle canonique, celle qui vaut encore : la
-- vivante s'il y en a une, sinon la plus recemment ouverte. Ses episodes anterieurs,
-- clos sous d'autres noms, prennent la meme cle suivie de leur identifiant. Rien ne les
-- produit plus, donc rien ne les rouvre, et ils cessent d'occuper une cle que la
-- collecte convoite.
--
-- En deux temps, et c'est la contrainte d'unicite qui l'impose. Rien n'interdit qu'un
-- nom d'usage vaille l'identifiant d'un autre compte du meme systeme, auquel cas la
-- cle canonique a poser est occupee par la ligne de cet autre compte. Toutes sont donc
-- garees d'abord sous une cle qui n'appartient a personne, puis posees.
DO $$
BEGIN
  UPDATE "Finding"
  SET "dedupKey" = 'reprise:' || "id"
  WHERE "kind" IN ('ORPHAN', 'UNREGISTERED') AND "externalIdentityId" IS NOT NULL;

  UPDATE "Finding" f
  SET "dedupKey" = r."cle"
  FROM (
    SELECT
      g."id" AS "id",
      g."kind"::text || ':' || e."provider" || ':' || e."externalId"
        || CASE
             WHEN row_number() OVER (
               PARTITION BY g."kind", g."externalIdentityId"
               ORDER BY (g."closedAt" IS NULL) DESC, g."openedAt" DESC, g."id"
             ) = 1 THEN ''
             ELSE '#' || g."id"
           END AS "cle"
    FROM "Finding" g
    JOIN "ExternalIdentity" e ON e."id" = g."externalIdentityId"
    WHERE g."kind" IN ('ORPHAN', 'UNREGISTERED')
  ) r
  WHERE f."id" = r."id";
END $$;
