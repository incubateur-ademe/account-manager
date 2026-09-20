-- Un constat de compte se deduplique sur l'identifiant du fournisseur, et non plus sur
-- le nom d'usage.
--
-- Un nom d'usage se renomme, et surtout il se recycle : GitHub rend un login abandonne
-- a quelqu'un d'autre. `dedupKey` etant unique sur toute la table, fermes compris, le
-- nouveau porteur d'un nom levait la cle de l'ancien : il heritait de son episode, et du
-- verrou qu'un operateur avait pose en le cloturant a la main, si bien que son ecart ne
-- remontait jamais.
--
-- Une seule ligne par compte et par famille est reprise, celle qui vaut encore : la
-- vivante s'il y en a une, sinon la plus recemment ouverte. Les autres sont des episodes
-- clos sous un ancien nom, et leur cle reste telle quelle plutot que d'entrer en
-- collision avec celle qu'on vient d'ecrire. Plus rien ne les produit, donc plus rien ne
-- les rouvre, et le journal d'audit garde leur histoire.
UPDATE "Finding" f
SET "dedupKey" = r."cle"
FROM (
  SELECT DISTINCT ON (g."kind", g."externalIdentityId")
    g."id" AS "id",
    g."kind"::text || ':' || e."provider" || ':' || e."externalId" AS "cle"
  FROM "Finding" g
  JOIN "ExternalIdentity" e ON e."id" = g."externalIdentityId"
  WHERE g."kind" IN ('ORPHAN', 'UNREGISTERED')
  ORDER BY
    g."kind",
    g."externalIdentityId",
    (g."closedAt" IS NULL) DESC,
    g."openedAt" DESC,
    g."id"
) r
WHERE f."id" = r."id"
  AND f."dedupKey" <> r."cle"
  AND NOT EXISTS (SELECT 1 FROM "Finding" x WHERE x."dedupKey" = r."cle");
