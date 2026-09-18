# ADR-0002 : trois rangements pour ce qu'un connecteur stocke

## Statut

Accepted

Date : 2026-09-17

## Contexte

Le connecteur Scalingo doit relever le projet porté par chaque application, pour qu'un écran
montre les accès dans les deux sens : une personne vers ses applications regroupées par
projet, et une application ou un projet vers les personnes qui y accèdent.

La solution évidente était d'ajouter une colonne à `Resource`, qui ne porte aujourd'hui que
`provider`, `externalId`, `label` et `url` (`prisma/schema.prisma:276-288`). Elle a été
refusée, et la règle posée à cette occasion vaut bien au-delà de Scalingo : **on autorise une
dépendance du socle dans un connecteur, jamais l'inverse.** Une colonne du socle qui ne sert
qu'un connecteur inverse cette dépendance.

La question posée n'est donc pas « où mettre le projet Scalingo », c'est « où un connecteur
range ce qu'il sait ». Elle se reposera pour GitHub puis pour Notion, et il vaut mieux y
répondre une fois.

### Ce que le code dit déjà, et qui déplace la question

**Le regroupement n'est pas une bizarrerie Scalingo : GitHub l'encode déjà, à la main, dans
une chaîne.** `assemblerOrganisation` pose l'organisation comme ressource
(`src/connectors/github.ts:378`), puis chaque équipe sous la clé `` `${org}#${equipe.id}` ``
(`:401`), avec un commentaire qui explique que le dièse écarte la collision avec la clé de
l'organisation (`:396-400`). La contenance est donc déjà là, faute d'endroit où la mettre, et
personne ne relit jamais cette chaîne : le dépôt ne contient aucun découpage sur ce
séparateur.

**Un contenant peut porter ses propres accès.** L'organisation GitHub est visée par un accès
« membre de l'organisation » (`src/connectors/github.ts:392`) en même temps qu'elle contient
des équipes. Un projet Scalingo, lui, n'en porte aucun : le fournisseur laisse la gestion des
utilisateurs au niveau de l'application, et un projet n'a pas de membres.

**Le socle connaît déjà un connecteur.** `src/core/rapprochement.ts:147` branche sur
`identite.provider === "github"` pour choisir une stratégie, et le résultat est la valeur
d'énumération `GITHUB_LOGIN`, gravée dans `prisma/schema.prisma:234`. L'invariant que cette
décision protège est donc déjà entamé ailleurs. C'est du rapprochement d'identité et non du
stockage, et cette décision ne le traite pas ; elle n'ajoute simplement aucune fuite de plus.

### Contraintes

- `docs/architecture.md` fait référence : le socle porte le constaté, et rien de spécifique à
  un connecteur n'entre dans les écrans génériques (§5.3).
- Un regroupement doit être **requêtable**, puisque l'écran le demande dans les deux sens.
  L'afficher ne suffit pas.
- Un mainteneur à temps partiel : pas d'abstraction générale construite sur un seul exemple,
  mais pas non plus de bricolage qu'il faudra défaire au deuxième connecteur.
- `ExternalIdentity.details` existe déjà et règle le cas voisin : ce qu'un connecteur sait
  d'un compte et qu'aucune ressource ni aucun accès ne dit, sous forme de couples libellé et
  valeur déjà rédigés pour un humain, rendus tels quels et jamais interprétés.

## Décision

Trois rangements, avec leur critère de tri. Deux questions posées dans cet ordre : est-ce
partagé par plusieurs systèmes, et est-ce requêtable ?

**1. Requêtable et partagé par plusieurs systèmes : une notion du socle.** La contenance des
ressources en est le premier cas, portée par une auto-relation `Resource.parentId` nullable,
sur un seul niveau, en `onDelete: SetNull`. `ConnectorContract` ne change pas : la contenance
est une forme de ce qui est constaté, pas quelque chose qu'un connecteur déclare. Seul
`ObservedResource` gagne un `parentExternalId` facultatif.

**2. Lisible et non requêtable : le patron de `ExternalIdentity.details`.** Une donnée déjà
rédigée pour être lue, rendue telle quelle, jamais interprétée, sous un schéma Zod déclaré au
contrat comme l'est `configSchema`. **Ce rangement est écrit ici et n'est pas construit** :
aucun connecteur n'en a l'usage aujourd'hui, et le mécanisme vaut mieux d'être bâti avec un
vrai cas sous les yeux.

**3. Propre à un seul système et requêtable : une table à lui, dans son propre schéma.** Ce
rangement est vérifié disponible et **délibérément vide**. Rien n'y va aujourd'hui.

### Ce que la contenance n'est pas

Elle n'ouvre ni ne coupe aucun droit. Elle n'entre dans aucun plan, aucune empreinte, aucune
étape. Scalingo ne sait retirer quelqu'un que d'une application, et un écran qui laisserait
croire à une révocation « sur un projet » promettrait un geste que le fournisseur ne sait pas
faire.

Elle ne pèse plus sur le relevé du garde-fou de chute, dont les contenants sortent. Elle
continue en revanche de peser sur un cas qui lui préexiste, l'équipe GitHub sans membre, et
c'est assumé : la spécification des projets n'est pas arrêtée du côté de Scalingo, et le
comptage complet se reprendra quand elle le sera. Voir les conséquences négatives.

### Justification

- La contenance qualifie pour le premier rangement sans qu'on ait à forcer : **deux
  connecteurs sur trois l'encodaient déjà à la main.** Elle n'est donc pas une colonne pour
  un seul connecteur, ce qui était la condition posée.
- Une table de regroupement séparée se briserait sur le seul cas de généralisation qui existe
  vraiment dans le dépôt. L'organisation GitHub est simultanément un regroupement et une
  ressource porteuse d'accès : elle devrait exister en deux lignes, deux libellés, deux cycles
  de vie, sans clé étrangère entre elles, et aucune règle ne dirait laquelle un écran montre.
- Le troisième rangement est laissé vide exprès. Sans lui écrit, la prochaine personne qui
  rencontrera le cas le résoudra en ajoutant une colonne au socle, c'est-à-dire précisément ce
  que cette décision refuse.

## Options envisagées

### L'héritage de table

Écartée parce qu'elle n'existe pas. `model Derive extends Base` échoue au parse, et il n'y a
aucune construction d'extension de modèle dans le langage de schéma Prisma, à aucune version.
Cette réfutation est écrite ici pour qu'on ne la redécouvre pas.

### Une colonne `Json` portant l'axe de regroupement

Écartée sur preuve, et c'est la réfutation qui compte le plus. Le client généré ne laisse
aucun doute : `ResourceScalarFieldEnum` n'énumère que `id`, `provider`, `externalId`, `label`
et `url`, donc un `groupBy` ne prend rien d'autre, et le tri sur une colonne `Json` est un
ordre global sur le document `jsonb`. Prisma ne sait faire qu'un filtre sur un chemin.

D'où la règle qui rend le tri des trois rangements opérant : **ce qui doit se grouper, se
trier, se compter ou se dédoublonner ne peut pas vivre dans du JSON.**

### Un schéma PostgreSQL séparé par connecteur

Écartée pour ce cas, retenue comme troisième rangement. Elle fonctionne vraiment : `schemas =
[...]` sans drapeau de préversion, une relation inter-schémas valide, et le découpage en
plusieurs fichiers de schéma valide aussi.

Mais c'est le mauvais outil ici. Une table `scalingo.contenance(resourceId, projetId)` reste
une clé étrangère vers `Resource` : la même colonne déplacée hors de vue, privée de son
unicité, de son `SetNull` et de son passage unique d'écriture. Et il faudrait ouvrir au
connecteur une voie d'écriture en base, ce qui inverse exactement la dépendance que cette
décision protège.

### Sortir la région Scalingo du libellé vers le deuxième rangement

Écartée, et c'est pour cette raison que le deuxième rangement n'est pas construit. Le libellé
d'une ressource Scalingo vaut `` `${application.name}, ${region}` ``, et les écrans génériques
ne lisent que `label` : deux applications homonymes de régions différentes deviendraient
indistinguables sur l'écran qui sert justement à décider d'une coupure. La région reste dans
le libellé délibérément.

## Conséquences

### Positives

- GitHub cesse de dépendre de la lecture d'une chaîne pour savoir ce qui contient quoi. La clé
  `` `${org}#${equipe.id}` `` ne change pas pour autant : la changer créerait une ligne neuve
  sans supprimer l'ancienne, et daterait tous les accès de l'équipe comme disparus.
- Les deux sens de l'écran sont des requêtes, pas un chargement complet suivi d'un
  regroupement en mémoire.
- Deux réfutations sont écrites plutôt que redécouvertes dans six mois.

### Négatives

- **Le garde-fou de chute reste inexact sur une équipe sans membre.** La référence compte les
  ressources qui portent au moins un accès vivant, le relevé compte les ressources émises, et
  seuls les contenants sortent du second. Une équipe GitHub vide continue donc de gonfler un
  seul des deux plateaux et peut masquer une chute réelle. C'est une dette consentie, et non
  un oubli : elle préexiste à cette décision, et le comptage complet attend que la
  spécification des projets soit arrêtée chez Scalingo.
- **Un seul axe, un seul niveau.** Une application Scalingo appartient à un projet et vit dans
  une région : le modèle tient le premier, la région reste dans le libellé. Un système qui
  aurait deux regroupements orthogonaux devra en choisir un, et la profondeur, représentable en
  base mais refusée à la collecte, demandera un vrai détecteur de cycles le jour où les équipes
  imbriquées de GitHub compteront.
- **Un contenant ne disparaît jamais.** `Resource` n'a pas de `vanishedAt` et ses lignes ne
  s'effacent pas, donc un projet supprimé chez le fournisseur garde la sienne. Sans enfant
  portant un accès vivant il sort des écrans, mais il reste en base, et qui compterait les
  projets sans ce filtre compterait des morts.
- **Deux exemples, pas trois.** Notion rend `resources: []` : son espace n'est pas un
  regroupement mais le périmètre entier du connecteur. La généralité repose sur GitHub et
  Scalingo.
- Le deuxième rangement est une règle sans implémentation. Quelqu'un la lira et croira la
  colonne posée.

## Liens

- `docs/architecture.md` §3.2, le constaté, où `Resource` gagne sa contenance
- `docs/architecture.md` §5.3, les fonctionnalités propres à un connecteur
- `docs/architecture.md` §5.6, les invariants de collecte, qui gagnent la vérification de
  contenance
- `docs/plans/#99_administrer-les-droits-scalingo.md`, le plan qui met cette décision en œuvre
- ADR-0003, le geste hors dossier, décidé en même temps et sur le même connecteur
