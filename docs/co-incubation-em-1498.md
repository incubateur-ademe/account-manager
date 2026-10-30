# Co-incubation espace-membre : ce qui a été fait, ce qui reste à surveiller

> **État.** L'essentiel est fait. La collecte n'interroge plus le miroir public et
> demande son périmètre aux routes de l'espace-membre scopées par incubateur, qui
> résolvent l'appartenance côté serveur. Le jour où la co-incubation arrivera, ces
> routes répondront correctement sans que rien ne change ici. Reste une échéance
> qui ne dépend pas de nous : la disparition des anciennes routes.

## Le problème que cela réglait

L'espace-membre laisse une startup relever de plusieurs incubateurs. Le champ
`incubator_id` d'une startup ne désigne alors plus que l'incubateur *principal*,
et la vérité vit dans une table de liaison.

Or la collecte comparait ce champ à l'identifiant de l'ADEME pour décider qu'une
personne relevait du périmètre. Une startup de l'ADEME co-incubée où l'ADEME
n'aurait pas été principale serait donc sortie du périmètre sans bruit, et la
collecte suivante aurait daté la disparition de personnes toujours en poste,
jusqu'à leur couper leurs accès. Le miroir public avait le même angle mort en
amont : il ne liste une startup que sous son incubateur principal.

Rien de tout cela ne se voyait : la reprise de données de l'espace-membre garde
l'ADEME principale sur les produits existants, le défaut n'aurait mordu que sur
les co-incubations futures.

## Ce qui a été fait

La collecte du périmètre demande désormais, sur l'API v1 décrite au §7 de
`docs/architecture.md` :

- `GET /api/v1/incubators/{ghid}/startups` pour les produits et leurs
  phases, qui venaient du miroir public ;
- `GET /api/v1/incubators/{ghid}/members` pour le périmètre entier, page après
  page, avec la voie de rattachement (`startups`, `teams`, `both`) déjà tranchée
  par l'espace-membre ;
- `GET /api/v1/members/{username}` pour les seules personnes rattachées
  par une équipe : la liste scopée ne leur associe aucune mission, et leur
  échéance beta.gouv est justement ce qui fait foi pour elles.

`src/lib/beta-gouv.ts` a disparu, et avec lui la découverte par intersection de
missions. Une personne déclarée transverse dans la politique que l'espace-membre
ne rattache pas reste dans le périmètre : la déclaration locale fait autorité sur
l'appartenance, sa fiche sur la date.

Le périmètre arrivant en une seule lecture, `syncPerimetre` refuse de dater des
disparitions dès qu'il perd plus d'un cinquième de son effectif d'un coup, et se
déclare partiel : une réponse tronquée mais valide ne se distingue d'un départ
collectif que par son ampleur.

## Ce qui reste à surveiller

**Le login a quitté les anciennes routes.** Depuis sa 1.0.0,
`@incubateur-ademe/next-auth-espace-membre-provider` résout `username -> email` par
`/api/v1/members/{username}`, en `Bearer`, avec la même `ESPACE_MEMBRE_API_KEY` que la
collecte. Plus rien dans ce dépôt n'appelle `/api/protected`.

**Les startups d'une mission hors périmètre.** Les missions rendues par la route
scopée peuvent porter des produits d'un autre incubateur (mission à plusieurs
produits). `rattachementDe` ne retient que les `ghid` du périmètre ; ce filtre
n'est pas une précaution superflue.

**Le paramètre `status`.** La route des membres accepte `?status=active`, que la
collecte ne passe pas et ne doit pas passer : son défaut renvoie aussi les
missions terminées. Masquer les partants reviendrait à ne jamais leur couper
leurs accès, alors que c'est précisément le moment qui compte.

**L'invariant de disparition.** Une collecte qui n'est pas `OK` ne date aucune
disparition, et le plancher ci-dessus s'y ajoute. Les deux se perdraient
facilement dans un futur remaniement.
