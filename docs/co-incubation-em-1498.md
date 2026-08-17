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

La collecte du périmètre demande désormais :

- `GET /api/protected/incubators/{ghid}/startups` pour les produits et leurs
  phases, qui venaient du miroir public ;
- `GET /api/protected/incubators/{ghid}/members` pour le périmètre entier, en un
  appel, avec la voie de rattachement (`startups`, `teams`, `both`) déjà tranchée
  par l'espace-membre ;
- `GET /api/protected/members/{username}` pour les seules personnes rattachées
  par une équipe : la liste scopée ne leur associe aucune mission, et leur
  échéance beta.gouv est justement ce qui fait foi pour elles.

`src/lib/beta-gouv.ts` a disparu, et avec lui la découverte par intersection de
missions. Une personne déclarée transverse dans la politique que l'espace-membre
ne rattache pas reste dans le périmètre : la déclaration locale fait autorité sur
l'appartenance, sa fiche sur la date.

Le périmètre arrivant en un seul appel, `syncPerimetre` refuse de dater des
disparitions dès qu'il perd plus d'un cinquième de son effectif d'un coup, et se
déclare partiel : une réponse tronquée mais valide ne se distingue d'un départ
collectif que par son ampleur.

## Ce qui reste à surveiller

**La disparition des anciennes routes, pour le login.** Le login résout
`username -> email` via `@incubateur-ademe/next-auth-espace-membre-provider`, qui
a `/api/protected` et `/member/{username}` en dur dans son client. Cette URL ne
se configure pas depuis `src/lib/auth.ts`. Les anciennes routes sont aujourd'hui
servies à l'identique sous un route group `(deprecated)/`, avec un en-tête
`Deprecation: true`. Le jour où l'espace-membre les retirera, plus personne ne
pourra se connecter. Il faut donc suivre les versions de ce paquet et passer à
une version qui vise `/members/{username}` **avant** ce retrait. La collecte,
elle, n'appelle plus aucune route dépréciée.

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
