# Éditer une fiche créée manuellement, identifiant compris (#1)

> Plan d'implémentation de l'issue #1. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

**La fabrication de l'identifiant.** `identifiantDepuis()` dérive un username du nom saisi
(`src/app/comptes-isoles/creer.ts:14`), et la fiche naît avec `attachment: "LOCAL"`,
`source: "LOCAL"`, sans échéance (`src/app/comptes-isoles/creer.ts:92`). Le compte qui l'a fait
découvrir passe en `DECLARED` (`creer.ts:105`) et les constats `UNREGISTERED` ouverts sur lui sont
refermés (`creer.ts:110`). Rien, nulle part, ne remet ensuite cet identifiant en cause.

**Aucun écran d'édition.** La fiche d'une personne est en lecture seule
(`src/app/personnes/[username]/page.tsx:255`), ses deux seuls gestes sont « Détacher » un compte
(`src/app/personnes/[username]/Detacher.tsx:9`) et « Préparer un départ »
(`page.tsx:361`). Aucune action serveur ne modifie un champ de `Person`.

**Ce que la collecte réécrit.** `upsert()` du périmètre écrase `betaUuid`, `fullname`,
`githubLogin`, `primaryEmail`, `communicationEmail`, `missionEnd`, `attachment`, `startups`,
`source` à chaque passage (`src/lib/sync/perimetre.ts:52`), et sa clé de recherche est le
`username` (`perimetre.ts:67`). Une fiche fabriquée n'y figure pas tant que son identifiant ne
correspond à personne : elle n'est donc jamais réécrite, et la collecte ne la fait pas non plus
disparaître tant qu'un de ses comptes est observé (`perimetre.ts:264`). Deux exceptions à retenir :
un identifiant qui finit par correspondre à un membre de l'espace-membre fait adopter la fiche par
la collecte, et les personnes déclarées dans `scope.local` de la politique sont reconstruites à
chaque passage avec `fullname` égal au username et des adresses nulles (`perimetre.ts:191`).

**Ce à quoi servent les champs éditables.** Le rapprochement automatique lit `githubLogin`,
`primaryEmail` et `communicationEmail` (`src/core/rapprochement.ts:123`), mais il ne repasse jamais
sur une identité déjà rattachée : seules celles en `matchMethod: "NONE"` sont réexaminées
(`src/lib/sync/rapprochement.ts:24`). Corriger une adresse rebranche donc les comptes encore
isolés et ceux à venir, pas ceux déjà rattachés à tort.

**Ce qui porte le username en dur ailleurs.**

- Clés de constat ancrées sur la personne : `SCOPE_EXIT:<username>` (`src/core/constat.ts:41`),
  `INACTIVE_STARTUP:<username>` (`constat.ts:82`),
  `OVERDUE_MANUAL_ACTION:<systeme>:<username>` (`constat.ts:199`). Celles ancrées sur le compte ne
  le portent pas : `ORPHAN:<provider>:<handle>` (`constat.ts:227`) et
  `UNREGISTERED:<provider>:<handle>` (`constat.ts:239`).
- Étapes de plan figées à la création : libellé, `params`, `idempotencyKey` et bloc `manual`
  contiennent le username (`src/connectors/github.ts:232`), gelés par
  `enregistrerPlan()` (`src/lib/depart.ts:172`).
- Journal : une cible `personne` porte le username en `targetId`
  (`src/app/departs/actions.ts:40`, `creer.ts:87`), une cible `identite` porte
  `provider:handle` (`src/app/comptes-isoles/actions.ts:119`,
  `src/app/personnes/[username]/actions.ts:51`). Le filtre « personne » du journal repose sur cette
  convention de suffixe (`src/app/journal/criteres.ts:66`).

**Les cascades, qui sont le piège principal.** Supprimer une `Person` supprime ses constats
(`prisma/schema.prisma:441`), ses dossiers de départ (`schema.prisma:308`) et ses références
(`schema.prisma:237`), détache ses comptes (`schema.prisma:177`) et laisse les plans du dossier
supprimé avec un `departureCaseId` nul (`schema.prisma:348`), donc vivants mais introuvables. Un
`delete` naïf perd exactement les trois choses que la Definition of Done interdit de perdre.

**Rien ne distingue un identifiant fabriqué d'un vrai.** `source: "LOCAL"` avec `betaUuid` nul
désigne aussi bien une fiche de `creer.ts` qu'une fiche hors incubateur créée depuis l'espace-membre
avec un vrai pivot (`src/app/comptes-isoles/actions.ts:132`, où `betaUuid` peut être nul si l'API ne
le rend pas) qu'une personne déclarée dans `scope.local` (`perimetre.ts:195`). L'heuristique
« LOCAL et sans uuid » ouvrirait donc le renommage sur des identifiants qu'aucun code n'a le droit
de toucher.

**Les tests ne touchent pas la base.** `vitest.config.ts` tourne en `environment: "node"`, et tous
les tests portent sur des fonctions pures (`src/core/*.test.ts`, `src/app/journal/criteres.test.ts`).
Aucun harnais Prisma n'existe, et ce plan n'en introduit pas.

## Décisions de conception

**Un drapeau explicite en base, pas une heuristique.** `Person.usernameFabricated` dit que cet
identifiant a été construit ici et n'engage personne d'autre. C'est la seule façon de tenir la règle
du ticket (« le renommage n'est ouvert que pour un identifiant fabriqué localement ») sans se
tromper sur les trois familles de fiches `LOCAL` listées plus haut.

**La collecte éteint le drapeau quand elle adopte la fiche.** Le jour où l'espace-membre connaît cet
identifiant, `upsert()` du périmètre écrit `usernameFabricated: false` en même temps que
`source: "BETA"`. Sans cette ligne, une fiche adoptée resterait renommable et l'outil offrirait de
renommer un vrai pivot, ce qu'aucun code n'a le droit de faire.

**Deux portées distinctes.** L'édition des champs est ouverte sur les fiches que la collecte ne
réécrit pas, c'est-à-dire `source = LOCAL` et username absent de `scope.local`. Le renommage, lui,
exige en plus `usernameFabricated`. Un identifiant réel reste immuable, y compris sur une fiche
locale hors incubateur.

**Champs modifiables : `fullname`, `githubLogin`, `primaryEmail`, `communicationEmail`.** L'échéance
n'est pas éditable ici, elle vient du rattachement daté de l'issue #2. `attachment`, `startups`,
`source`, `betaUuid` ne sont pas éditables : ce sont des constats, pas des saisies.

**Un geste, deux issues, jamais de glissement.** La correction de l'identifiant est un seul
formulaire. Identifiant libre : c'est un renommage, tracé. Identifiant déjà porté : l'action
n'écrit rien et renvoie un état qui décrit ce que la fusion déplacerait, en demandant une
confirmation explicite. Le motif existe déjà pour le second rattachement d'un compte
(`src/app/comptes-isoles/actions.ts:110`) et se reprend tel quel.

**La fusion déplace, puis supprime, dans cet ordre.** Comptes, constats, dossiers de départ,
références migrent vers la fiche cible avant que la fiche fabriquée ne disparaisse. L'ordre n'est
pas cosmétique, c'est ce qui neutralise les cascades. La suppression d'une fiche reste par ailleurs
hors périmètre en tant que geste autonome : la fusion en est la seule voie, et seulement pour une
fiche fabriquée.

**Les comptes gardent leur `matchMethod`.** Un compte rattaché par ressemblance à la fiche fabriquée
arrive sur la cible toujours en `HEURISTIC`, donc toujours incapable de produire une révocation, et
toujours dans la file de rattachement. La fusion affirme que ces deux fiches sont la même personne,
elle n'affirme pas que chaque compte est bien à elle. Promouvoir en `DECLARED` au passage
contournerait l'invariant sans que personne ne le voie. La règle n'est plus à redire ici : le socle
la porte en un seul endroit, `autoriseUneRevocation` (`src/core/rapprochement.ts:29`), que le calcul
du plan de départ consulte au lieu de recopier la liste des méthodes.

**Un dossier de départ ouvert des deux côtés bloque la fusion.** Un seul dossier vivant par personne
est une règle du socle (`src/lib/depart.ts:118`) : en faire migrer un second produirait deux plans
concurrents et deux façons de croire l'affaire réglée. Le message dit lequel fermer d'abord. Si un
seul côté en a un, il migre.

**Constats : la clé suit la personne quand elle est libre, sinon le constat migré se ferme.**
`ORPHAN` et `UNREGISTERED` sont déjà ancrés sur le compte et migrent sans retouche. Les clés ancrées
sur la personne sont réécrites vers l'identifiant cible **seulement si la clé cible n'existe pas**,
ouverte ou fermée : `dedupKey` est unique sur toute la table (`prisma/schema.prisma:428`) et la
réconciliation fait un `upsert` dessus (`src/lib/sync/constats.ts:159`). En cas de collision, le
constat migré est fermé avec pour raison la fusion, sans `closedBy` : la situation n'a pas été
jugée, et la collecte doit pouvoir reprendre la main (même choix que le détachement,
`src/app/personnes/[username]/actions.ts:74`).

**Les plans figés ne sont pas réécrits.** Une étape confirmée doit rester lisible telle quelle dans
deux ans (`docs/architecture.md:256`). Un plan calculé avant le renommage continue de nommer
l'ancien identifiant, c'est le journal qui fait le lien, pas une réécriture rétroactive.

**L'histoire s'ancre sur le compte.** Chaque compte déplacé reçoit son propre événement, cible
`identite`, `targetId` `provider:handle` comme les événements existants, avec `externalId` dans la
charge utile : le `handle` peut changer chez le fournisseur, l'`externalId` non, et sans lui la
chaîne se casserait au premier renommage côté GitHub. La fiche, elle, reçoit un événement de
renommage ou de fusion portant l'avant et l'après. Le filtre « personne » du journal résout d'abord
la chaîne des identifiants portés par cette fiche, puis filtre sur l'ensemble.

**Tension assumée avec `docs/architecture.md`.** La section 2.1 (`docs/architecture.md:107`) dit que
le pivot est en lecture seule et qu'aucun code ne le met à jour. Ce plan introduit une écriture sur
`Person.username`, strictement bornée aux identifiants fabriqués ici, qui ne servent de pivot à
personne d'autre. Le ticket demande explicitement de préciser cette règle dans le document
(dernière case de sa Definition of Done). La rédaction sera proposée à l'utilisateur et n'est pas
appliquée sans son accord : le document ne se modifie pas unilatéralement.

## Modèle de données

Une seule migration, une seule colonne.

```prisma
model Person {
  /// Vrai quand l'identifiant a ete construit ici faute de fiche beta.gouv. Seul cas
  /// ou il se renomme : un vrai pivot ne se met a jour nulle part. La collecte
  /// l'eteint le jour ou elle adopte la fiche.
  usernameFabricated Boolean @default(false)
}
```

`pnpm db:migrate --name identifiant_fabrique` produit :

```sql
ALTER TABLE "Person" ADD COLUMN "usernameFabricated" BOOLEAN NOT NULL DEFAULT false;
```

**Reprise des fiches existantes.** Aucune requête SQL ne sait distinguer une fiche de `creer.ts`
d'une personne déclarée dans `scope.local`, la politique n'étant pas en base. Le backfill est donc
écrit à la main dans le fichier de migration, avec la liste des déclarés recopiée depuis
`config/config.yaml` au moment de la livraison, et présente même si elle est vide, pour figer
l'intention :

```sql
UPDATE "Person"
SET "usernameFabricated" = true
WHERE "source" = 'LOCAL'
  AND "betaUuid" IS NULL
  AND "attachment" = 'LOCAL'
  AND "username" NOT IN ('prenom.nom');
```

Sans ce backfill, les fiches fautives déjà en base ne seraient pas renommables, c'est-à-dire
précisément celles pour lesquelles le ticket existe.

**Rappel de discipline.** Toute modification du schéma exige `pnpm db:generate` puis un redémarrage
de `pnpm dev` : la migration seule laisse un client généré et un client mis en cache sur
`globalThis` qui servent des métadonnées périmées, et le symptôme est un
`Unknown argument 'usernameFabricated'` au runtime alors que le typecheck passe.

## Découpage en étapes

### 1. Le drapeau, et son extinction par la collecte

Poser la colonne, la renseigner à la création, l'éteindre à l'adoption. Livrable seul : rien ne
change de comportement, mais la base sait enfin de quoi elle parle.

- `prisma/schema.prisma` : champ `usernameFabricated`.
- `prisma/migrations/<horodatage>_identifiant_fabrique/migration.sql` : colonne et backfill.
- `src/app/comptes-isoles/creer.ts` : `usernameFabricated: true` dans le `create`.
- `src/lib/sync/perimetre.ts` : `usernameFabricated: false` dans l'objet `data` de `upsert()`.

Vérification : créer une fiche depuis un compte isolé, constater le drapeau à vrai ; renommer la
ligne en base vers un username réel de l'incubateur, lancer `pnpm sync`, constater le drapeau à faux
et `source` à `BETA`.

### 2. Le noyau pur

Toute la décision vit dans un module sans Prisma, ce qui la rend testable en gros scénarios.

- `src/core/fiche-manuelle.ts` (nouveau) :
  - `normaliserIdentifiant(nom)`, déplacé depuis `creer.ts:14`, qui reste le seul endroit où un
    identifiant se fabrique ;
  - `ficheEditable(fiche, declaresLocaux)` et `renommable(fiche, declaresLocaux)` ;
  - `validerChamps(saisie)`, qui normalise le login GitHub avec `normaliserLogin`
    (`src/core/rapprochement.ts:69`) et refuse une adresse sans arobase ;
  - `planifierFusion(source, cible)` qui rend l'inventaire de ce qui bouge : comptes, constats
    migrés tels quels, clés de constat à réécrire, clés en collision donc à fermer, dossiers, et le
    cas échéant un `blocage` nommé.
- `src/app/comptes-isoles/creer.ts` : importe `normaliserIdentifiant`.

### 3. Édition des champs

- `src/app/personnes/[username]/edition.ts` (nouveau) : action `modifierFiche`, passage par
  `actionTracee` (`src/lib/actions.ts:30`) avec l'action `personne.edition`, `before` et `after`
  limités aux champs réellement changés.
- `src/app/personnes/[username]/FicheEditable.tsx` (nouveau) : formulaire DSFR, `useActionState`,
  même forme que `Rattacher.tsx`.
- `src/app/personnes/[username]/page.tsx` : rend le formulaire quand `ficheEditable` répond oui, et
  affiche sinon la raison courte (issue de la collecte, ou déclarée dans la politique).
- `src/app/journal/libelles.ts` : libellé de `personne.edition`.

Vérification : corriger un nom et une adresse, recharger, relire le journal.

### 4. Renommage vers un identifiant libre

- `src/app/personnes/[username]/edition.ts` : action `renommerFiche`, qui vérifie `renommable`,
  normalise, refuse une collision avec elle-même, puis trace `personne.renommage` avec
  `before: { username: ancien }` et `after: { username: nouveau }`, écrit, et émet un événement
  `identite.reattribution` par compte suivi.
- `src/app/personnes/[username]/Identifiant.tsx` (nouveau) : le formulaire à deux issues.
- Redirection vers la nouvelle URL **hors** du passage tracé, `redirect()` levant une exception que
  le journal consignerait en échec (motif déjà présent, `src/app/departs/actions.ts:55`).
- Revalidation : `/personnes`, `/personnes/<ancien>`, `/personnes/<nouveau>`, `/comptes-isoles`,
  `/constats`, `/`.

### 5. Fusion

- `src/app/personnes/[username]/edition.ts` : quand l'identifiant demandé est pris, `renommerFiche`
  n'écrit rien et rend l'inventaire de `planifierFusion` ; une seconde soumission portant
  `confirme=oui` exécute `fusionnerFiches`.
- L'écriture est enveloppée dans un `prisma.$transaction`, dans l'ordre comptes, constats, dossiers,
  références, suppression de la fiche source. Les références en collision sur
  `(personId, resourceId)` (`prisma/schema.prisma:240`) sont laissées à la cible et celle de la
  source est supprimée ; aucun code ne crée de `Reference` aujourd'hui, la branche existe pour ne
  pas laisser une cascade décider à notre place le jour où l'issue #16 la branchera.
- La trace précède : l'événement `personne.fusion` est écrit par `actionTracee` avant la
  transaction, avec l'inventaire complet en `after`, et les événements par compte sont émis avant
  leur écriture. Si la transaction échoue, `actionTracee` pose l'échec (`src/lib/actions.ts:51`).
- `src/app/journal/libelles.ts` : libellés de `personne.renommage`, `personne.fusion`,
  `identite.reattribution`.

### 6. Un journal lisible de bout en bout

- `src/app/journal/criteres.ts` : `identifiantsLies(evenements, username)`, pure, qui remonte et
  descend la chaîne des renommages et fusions, avec garde contre les cycles ;
  `versFiltre(criteres, alias)` filtre alors sur l'ensemble des identifiants au lieu d'un seul.
- `src/app/journal/page.tsx` : charge les événements `personne.renommage` et `personne.fusion` avant
  de construire le filtre.
- Le lien « Historique de cette personne » de la fiche (`page.tsx:346`) devient exact après un
  renommage sans changer d'URL.

### 7. Documentation

`/sync-docs` en fin de parcours : proposition de rédaction pour `docs/architecture.md` section 2.1
(immuabilité du pivot, et l'exception bornée de l'identifiant fabriqué) et section 3.4 (la fusion
comme geste rejouable depuis le journal), soumises avant écriture. `TODO.md` perd la ligne
« Pouvoir éditer une fiche créée manuellement ».

## Tests

Cinq scénarios, dans `src/core/fiche-manuelle.test.ts` et `src/app/journal/criteres.test.ts`. Aucun
n'a besoin de base : tout ce qui décide est pur, ce qui est le premier bénéfice de l'étape 2.

**1. « Ce qui se corrige, et ce qui ne se touche pas ».** Quatre fiches : fabriquée ici, adoptée
depuis par la collecte, déclarée dans `scope.local`, créée à la main pour une personne hors
incubateur avec un vrai pivot. Le scénario asserte pour chacune l'éditabilité des champs et
l'ouverture du renommage, et vérifie qu'une fiche adoptée n'est plus renommable même si son
`betaUuid` est nul.

**2. « L'identifiant fautif rejoint la vraie personne ».** Une fiche fabriquée porte deux comptes
(un `DECLARED`, un `HEURISTIC`), un constat `UNREGISTERED` ouvert, un constat `SCOPE_EXIT` ouvert et
un dossier de départ en cours ; la cible existe et n'a rien. Le plan de fusion déplace les deux
comptes en conservant leur méthode, migre le constat de compte sans retouche, réécrit la clé du
constat de personne vers l'identifiant cible, migre le dossier, et place la suppression en dernier.
Assertions sur chaque famille, plus l'ordre.

**3. « La fusion refuse ce qu'elle ne sait pas fusionner sans perte ».** Trois situations dans une
même histoire : un dossier de départ ouvert des deux côtés produit un blocage nommé et aucun
déplacement ; deux comptes du même fournisseur sur les deux fiches sont autorisés et signalés
comme tels ; un `SCOPE_EXIT` déjà présent côté cible, même fermé, empêche la réécriture de clé et
fait fermer le constat migré avec sa raison, sans `closedBy`.

**4. « Corriger le login rebranche le rapprochement, sans rien promouvoir ».** Un compte GitHub
resté isolé faute d'un login mal saisi : après `validerChamps` et correction, `rapprocher()`
(`src/core/rapprochement.ts:123`) le rend en `GITHUB_LOGIN`. Dans la même histoire, un compte déjà
rattaché en `HEURISTIC` et déplacé par une fusion reste en `HEURISTIC`, donc hors de toute
révocation, et reste dans la file de rattachement.

**5. « Le journal raconte l'histoire complète ».** Une fiche renommée deux fois puis fusionnée :
`identifiantsLies` rend les quatre identifiants, `versFiltre` construit un filtre qui les couvre
tous, et une chaîne circulaire fabriquée à la main ne fait pas boucler la fonction.

## Risques et pièges

**Le backfill oublié rend la fonctionnalité invisible.** Sans lui, aucune fiche existante n'est
renommable, et rien ne le dit : le bouton est simplement absent. C'est le premier point à vérifier
après la migration.

**Les cascades sont silencieuses.** Un `delete` sur `Person` avant les déplacements supprime les
constats et les dossiers sans erreur ni avertissement, et laisse des plans avec un
`departureCaseId` nul, vivants mais invisibles dans les écrans. Aucun test ne le rattraperait
puisque rien ne teste la base : c'est la revue de l'ordre des opérations dans la transaction qui
tient cet invariant.

**`dedupKey` est unique sur toute la table, constats fermés compris.** Réécrire une clé sans
vérifier les fermés fait échouer la fusion sur une contrainte, ou pire, fait échouer une collecte
ultérieure au moment précis où elle a quelque chose à signaler.

**Renommer vers un identifiant réel change qui commande la fiche.** À la collecte suivante, le
périmètre l'adopte et réécrit nom, login et adresses avec la version de l'espace-membre. C'est le
comportement voulu, mais il faut le dire dans l'écran : une correction de nom saisie juste avant
sera remplacée par la version amont, et c'est la bonne.

**Fusionner vers une fiche déclarée dans `scope.local`** donne une cible dont la collecte
reconstruit `fullname` à partir du username et remet les adresses à nul (`perimetre.ts:195`). La
politique fait autorité, donc c'est cohérent, mais l'opérateur qui vient de corriger un nom le
verra disparaître à la nuit suivante.

**Le rapprochement ne repasse pas sur une identité déjà rattachée**
(`src/lib/sync/rapprochement.ts:24`).
Corriger un login ou une adresse rebranche les comptes encore en `NONE` et ceux à venir, pas ceux
déjà rattachés à la mauvaise personne : ceux-là se détachent à la main. Le ticket dit vrai, mais
seulement pour les comptes que la collecte n'a pas encore attribués.

**L'ancrage du journal sur `provider:handle` est fragile par nature.** Un login GitHub renommé chez
le fournisseur casse la continuité de l'historique d'un compte. D'où l'`externalId` dans la charge
utile de chaque événement produit ici, seule donnée stable côté fournisseur.

**Deux opérateurs en même temps.** Deux renommages concurrents vers le même identifiant se
départagent par la contrainte d'unicité : le second reçoit un `P2002` de Prisma qu'il faut traduire
en phrase, sans quoi l'écran affichera une erreur technique là où la bonne réponse est « cet
identifiant vient d'être pris, la fusion est peut-être ce que vous voulez ».

**Rien ici n'écrit sur un système cible**, donc `ACTIONS_ENABLED` n'entre pas en jeu et aucun
`dryRun` n'est à câbler. Le corollaire est qu'il ne faut pas profiter de ce chemin pour y glisser
un geste qui toucherait un fournisseur : il contournerait le drapeau.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, pour les deux nouveaux composants clients.

Parcours manuel de bout en bout, qui est aussi la Definition of Done du ticket :

1. Créer une fiche depuis un compte isolé avec un nom mal orthographié, constater l'identifiant
   fautif.
2. Corriger nom, login GitHub et adresses ; vérifier le journal, entrée `personne.edition` avec
   avant et après.
3. Renommer vers un identifiant libre ; vérifier la redirection, la disparition de l'ancienne URL,
   l'entrée `personne.renommage`, et un événement par compte suivi.
4. Créer en base la fiche cible sous cet identifiant, ou la faire venir par `pnpm sync`, puis
   renommer une seconde fiche fabriquée vers cet identifiant : l'outil propose la fusion, décrit ce
   qui bouge, et n'écrit rien tant que la confirmation n'est pas donnée.
5. Confirmer, puis vérifier : aucun compte perdu, les constats ouverts sont sur la cible, le dossier
   en cours est sur la cible, la fiche fabriquée n'existe plus.
6. Ouvrir `/journal?personne=<identifiant-cible>` et retrouver les événements antérieurs au
   renommage et à la fusion.

Deux contrôles en base après le parcours, qu'aucun test ne couvre :

```sql
SELECT count(*) FROM "ExternalIdentity" WHERE "personId" IS NULL AND "matchMethod" = 'DECLARED';
SELECT count(*) FROM "Plan" WHERE "departureCaseId" IS NULL;
```

Les deux doivent valoir ce qu'ils valaient avant la fusion. Un compte `DECLARED` sans personne, ou
un plan sans dossier, signent une cascade qui a agi à notre place.

Enfin, `pnpm db:generate` et un redémarrage de `pnpm dev` après la migration, sans quoi le runtime
refusera le champ pendant que le typecheck le validera.
