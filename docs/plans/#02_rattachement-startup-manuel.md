# Rattacher une personne à une startup à la main, avec une échéance obligatoire (#2)

> Plan d'implémentation de l'issue #2. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### Le rattachement aux startups est une colonne réécrite chaque nuit

`Person.startups` est un `String[]` (`prisma/schema.prisma:106`), rempli exclusivement par la
collecte. L'`upsert` de `src/lib/sync/perimetre.ts:52-81` construit un objet `data` qui pose
`startups`, `missionEnd` et `attachment` sans condition, puis l'applique tel quel en `update`
(`src/lib/sync/perimetre.ts:73`). Rien n'est fusionné avec ce qui était là.

Le cas nommé par le ticket se vérifie ligne à ligne : une personne déclarée dans `scope.local` est
poussée dans les résolues avec `startups: []` et `attachment: "LOCAL"`
(`src/lib/sync/perimetre.ts:195-207`). Une valeur écrite à la main dans cette colonne disparaît donc
à la première collecte complète, sans erreur ni trace.

### L'échéance vient d'une seule source, et n'est jamais stockée comme un calcul

`Person.missionEnd` est écrit par la collecte à partir des missions de l'espace-membre
(`src/core/membre.ts:100-132`). Le statut se calcule à la lecture, jamais en base
(`src/core/statut.ts:32-75`), ce qui est exactement le point d'accroche dont ce chantier a besoin :
une échéance effective se calcule au même endroit, sans nouvelle colonne.

Les lieux qui lisent `missionEnd` pour en tirer une décision ou un affichage :

- `src/app/page.tsx:23-24` puis `41-47`, compteurs du tableau de bord
- `src/app/personnes/page.tsx:70-88`, colonne Échéance et statut de la liste
- `src/app/personnes/[username]/page.tsx:150-240`, fiche et explication du statut
- `src/app/constats/page.tsx:35`, affichage sur la file des constats
- `src/app/departs/actions.ts:28`, `41`, `44`, date effective du dossier de départ
- `src/core/constat.ts:67`, garde-fou du constat de startups terminées

### Le constat `INACTIVE_STARTUP` ne regarde que les rattachements collectés

`startupsToutesTerminees` (`src/core/constat.ts:52-86`) porte trois portes successives :

1. `src/core/constat.ts:60` : rien pour qui n'est pas `attachment === "STARTUPS"`, et rien pour une
   liste de startups vide. Une personne `LOCAL` ou une fiche créée à la main ne peut donc jamais
   lever ce constat aujourd'hui.
2. `src/core/constat.ts:67` : rien sur une mission déjà terminée, où l'échéance dit la même chose et
   la dit mieux.
3. `src/core/constat.ts:75` : rien tant qu'une phase est inconnue, on ne conclut que sur du constaté.

La clé de déduplication est `INACTIVE_STARTUP:${username}` (`src/core/constat.ts:82`) : elle ne
mentionne aucune startup, donc élargir l'ensemble regardé ne casse aucune clé existante et ne demande
aucune reprise de données.

### Les gestes humains ont déjà leur chemin obligé

`actionTracee` (`src/lib/actions.ts:30-56`) vérifie la session, écrit la trace nominative, puis écrit
en base, et repose une trace en échec si l'écriture casse. Le journal reste sans attente avec capture
d'erreur (`src/lib/audit.ts:16-38`). Deux gestes symétriques existent déjà comme modèle :
`rattacherIdentite` (`src/app/comptes-isoles/actions.ts:116-195`) et `detacherIdentite`
(`src/app/personnes/[username]/actions.ts:48-89`).

La confirmation en deux temps existe elle aussi, et c'est exactement la mécanique que réclame
l'avertissement de prolongation : le serveur refuse et renvoie un message contenant « Confirmez pour
continuer » (`src/app/comptes-isoles/actions.ts:110-114`), le client fait alors apparaître une case à
cocher (`src/app/comptes-isoles/Rattacher.tsx:24-48`).

### Ce qui manque

Aucun objet ne porte une décision de rattachement. Aucun écran ne parle de startup autrement qu'en
lecture. Le journal ne connaît ni verbe ni type de cible pour ce geste
(`src/app/journal/libelles.ts:9-38`).

### Les pièges déjà repérables

`src/lib/sync/perimetre.ts:264-278` : une fiche `source: "LOCAL"` échappe au `vanishedAt` seulement
si une de ses identités est encore observée. Une fiche créée à la main, rattachée à une startup, dont
le compte disparaît, sortirait donc du référentiel alors qu'un opérateur vient de déclarer qu'elle
est là jusqu'à telle date.

`src/core/constat.ts:67` compare deux `Date` brutes : `missionEnd` arrive à minuit UTC, `today` porte
l'heure courante. Le dernier jour travaillé, la comparaison est déjà vraie et le constat est étouffé
un jour trop tôt. `statutDe` ne souffre pas de ce défaut, il tronque au jour UTC
(`src/core/statut.ts:19-24`).

Le filtre « historique de cette personne » du journal reconnaît une cible qui se termine par
`:username` (`src/app/journal/criteres.ts:65-74`). L'ordre des deux membres dans le `targetId` d'un
rattachement n'est donc pas cosmétique.

Enfin, les tests tournent en `environment: "node"` sans base ni mock Prisma
(`vitest.config.ts:11-15`, aucun `vi.mock` dans le dépôt) : tout ce qui doit être couvert par un test
doit vivre dans une fonction pure de `src/core`.

## Décisions de conception

**Un objet en base, pas une entrée de plus dans `Person.startups`.** C'est le cœur du ticket et ce
n'est pas une préférence de modélisation : la colonne est réécrite sans condition
(`src/lib/sync/perimetre.ts:53-65`). Un rattachement écrit là ne survivrait pas à la nuit.

**L'échéance effective se calcule, elle ne se stocke pas.** La plus lointaine entre `missionEnd` et
les `until` des rattachements en cours. Aucune écriture dans `Person.missionEnd`, qui reste ce que
l'amont dit. C'est la règle déjà tenue par `docs/architecture.md` §4.1 : le statut est calculé,
jamais stocké.

**Un rattachement expire par comparaison de dates, pas par une écriture.** Aucune tâche ne vient
poser un drapeau à minuit. « En cours » vaut `endedAt === null` et `until >= aujourd'hui`, au jour
UTC tronqué. Une expiration qui dépendrait de la collecte deviendrait fausse la nuit où elle ne
tourne pas, et c'est précisément la panne la plus discrète du système.

**Le retrait ferme, il ne supprime pas.** `endedAt` et `endedBy`, comme `vanishedAt` et `closedAt`
ailleurs. Une ligne effacée rendrait illisible un constat levé la veille.

**`INACTIVE_STARTUP` s'ouvre à qui n'a d'autre titre que ses startups.** La porte de
`src/core/constat.ts:60` passe de « `attachment === "STARTUPS"` » à « `attachment` n'est ni
`DECLARED` ni `BOTH` », l'ensemble regardé devenant l'union des startups collectées et des
rattachements manuels en cours. Une personne transverse garde son titre d'appartenance, qui ne
dépend d'aucune startup : lui lever le constat serait un contresens. Pour une personne `LOCAL` sans
rattachement manuel, l'ensemble reste vide et rien ne change : l'élargissement ne touche en pratique
que celles qui portent un rattachement posé à la main.

**Le garde-fou de mission terminée se lit sur l'échéance effective**, et la comparaison passe au jour
UTC tronqué. Conséquence assumée : le constat se lève désormais aussi le dernier jour travaillé, là
où il était étouffé un jour trop tôt. Le garde-fou de phase inconnue est inchangé, et il vaut pour
une startup rattachée à la main comme pour une autre : une phase qu'on ne connaît pas interdit de
conclure.

**Prolonger est permis, et c'est le geste qu'on veut voir passer.** Deux dispositifs, et ils ne se
remplacent pas. L'écran avertit dès la saisie, dès que la date dépasse le `missionEnd` connu. Le
serveur refuse tant que la confirmation n'est pas jointe, sur le modèle de
`src/app/comptes-isoles/actions.ts:110-114`. Le premier est du confort, le second est la garantie :
un formulaire se poste sans passer par l'écran.

**La cible doit être une startup connue en base.** Un `ghid` libre produirait une phase inconnue, donc
un constat qui ne se lèvera jamais, sans que rien ne le dise. Une startup portant un `vanishedAt`
reste sélectionnable, avec une mention : son sort relève de l'issue #6.

**Reposer un rattachement sur la même startup remplace le précédent** dans le même geste tracé :
l'ancien est fermé, le nouveau créé, le `before` du journal portant l'ancienne date. Prolonger reste
ainsi un acte unique et lisible plutôt qu'un retrait suivi d'une pose que rien ne relie.

**Aucun recalcul de constat dans l'action, et c'est délibéré.** `rattacherIdentite` referme
immédiatement un `UNREGISTERED` (`src/app/comptes-isoles/actions.ts:163-193`) parce que ce constat ne
dépend que du geste. `INACTIVE_STARTUP` dépend des phases de toutes les startups et d'une date qui
passe toute seule : le recalculer dans l'action créerait une seconde vérité, et resterait de toute
façon incomplet le jour où un rattachement expire sans que personne n'ait cliqué. Il reste levé et
refermé par la collecte, et l'écran le dit.

**Une personne dont la fiche vit à la main ne disparaît pas tant qu'un rattachement court.**
L'exemption de `src/lib/sync/perimetre.ts:264-267` s'étend aux fiches `source: "LOCAL"` portant un
rattachement en cours. Restriction expresse à `LOCAL` : une personne venue de l'espace-membre qui en
sort doit continuer de lever `SCOPE_EXIT`, qui est le constat le plus important du système. La
protection est bornée d'elle-même, puisque le rattachement porte une date de fin obligatoire.

**Rien de ceci ne peut produire une révocation.** Un rattachement manuel ne touche à aucune
`ExternalIdentity` et ne change aucun `matchMethod` : la règle qui interdit à `HEURISTIC` et `NONE`
de produire une étape de révocation reste hors de portée de ce chantier. Le risque réel est
l'inverse et il faut le nommer : prolonger repousse le statut `A_TRAITER`, donc retarde une coupure.
C'est pour cela que le geste est nominatif, daté, borné, et annoncé à la saisie.

### Tension avec `docs/architecture.md`

Le ticket annonce l'amendement de **§3.4** (`docs/architecture.md:285-289`) : une fiche créée à la
main n'a pas d'échéance et c'est voulu. Elle en a une dès qu'elle porte un rattachement daté. Sans
rattachement, la règle actuelle tient mot pour mot.

Trois autres endroits dérivent, que le ticket ne cite pas et qu'il faut soumettre avec :

- **§3.2** (`docs/architecture.md:208`) énumère les objets constatés. Le nouvel objet relève du
  décidé, donc de **§3.3** (`docs/architecture.md:266`) au titre de ce qu'un opérateur attribue, et
  il rejoint le périmètre de sauvegarde critique que §3.4 délimite.
- **§4.1** (`docs/architecture.md:294`) dit que le statut se calcule « à partir de l'échéance ». Il
  faut lire désormais l'échéance effective.
- **§4.2** (`docs/architecture.md:342-348`) décrit `INACTIVE_STARTUP` et ses deux garde-fous. La
  phrase « toutes les startups d'une personne » couvre maintenant les rattachements manuels, et le
  garde-fou de mission terminée se lit sur l'échéance effective.

Conformément aux consignes du dépôt, aucune de ces modifications n'est appliquée sans validation
explicite.
L'étape 8 les propose, elle ne les écrit pas d'office.

## Modèle de données

Une migration, un modèle, une relation inverse. Aucune colonne ajoutée à `Person`, aucune valeur
ajoutée à l'enum `Attachment` : ce champ documente ce que l'espace-membre constate, on n'y mélange
pas du décidé.

```prisma
model StartupAssignment {
  id String @id @default(cuid())

  personId String
  // Identifiant et non clé étrangère, comme Person.startups : la startup peut
  // disparaître de l'incubateur sans que la décision cesse d'avoir été prise.
  startupGhid String

  // Dernier jour couvert, inclusif, au même titre qu'une fin de mission.
  until DateTime @db.Date

  reason String?

  createdBy String
  createdAt DateTime @default(now())

  endedAt DateTime?
  endedBy String?

  person Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@index([personId, endedAt])
  @@index([startupGhid, endedAt])
}
```

Sur `Person`, une seule ligne à ajouter au bloc des relations (`prisma/schema.prisma:112-115`) :

```prisma
  startupAssignments StartupAssignment[]
```

Obligatoire : `personId`, `startupGhid`, `until`, `createdBy`. Facultatif : `reason`. Ce qui le clôt :
`endedAt` avec `endedBy` pour un retrait, ou le simple passage de `until`, qui n'écrit rien.

Commande : `pnpm db:migrate` avec le nom `rattachement_manuel_a_une_startup`, dans la lignée des
migrations existantes (`prisma/migrations/20260818161504_marche_a_suivre_figee`).

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`.** Les deux caches se
cumulent : `prisma migrate dev` ne régénère pas toujours le client de `src/generated/prisma`, et
celui-ci est mis en cache sur `globalThis` pour survivre au rechargement à chaud. Symptôme si on
saute l'une des deux étapes : `Unknown argument 'startupAssignments'` au runtime pendant que le
typecheck passe.

Aucune reprise de données : la table naît vide, et les clés de déduplication des constats existants
ne changent pas.

## Découpage en étapes

### 1. Le modèle et la migration

Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_rattachement_manuel_a_une_startup/migration.sql`.

Livrable : la table existe, le client est régénéré, `pnpm typecheck` passe.
Vérifiable : `pnpm db:studio` montre la table vide et ses index.

### 2. Le cœur du calcul

Fichiers : `src/core/rattachement-startup.ts` (nouveau), `src/core/statut.ts`.

Nommé `rattachement-startup` et non `rattachement` pour ne pas se confondre à la lecture avec
`src/core/rapprochement.ts`, qui traite un tout autre sujet.

`src/core/statut.ts` expose `jourUTC(date): number`, extrait de `daysBetween`
(`src/core/statut.ts:19-24`), pour que les comparaisons de dates du nouveau module tronquent au jour
comme le fait déjà le statut.

```ts
export interface RattachementManuel {
  startupGhid: string;
  until: Date;
  endedAt: Date | null;
}

export function enCours(rattachement: RattachementManuel, aujourdHui: Date): boolean;
export function startupsEffectives(
  collectees: readonly string[],
  manuels: readonly RattachementManuel[],
  aujourdHui: Date,
): string[];
export function echeanceEffective(
  missionEnd: Date | null,
  manuels: readonly RattachementManuel[],
  aujourdHui: Date,
): Date | null;
export function prolongeLaMission(missionEnd: Date | null, until: Date): boolean;
```

`startupsEffectives` rend une union dédupliquée et triée, pour que deux appels successifs donnent la
même liste et que l'affichage ne bouge pas d'une collecte à l'autre.

Livrable : quatre fonctions pures et leurs tests (scénarios 1 et 2 ci-dessous).
Vérifiable : `pnpm test`.

### 3. Le constat

Fichiers : `src/core/constat.ts`, `src/lib/sync/executer.ts`.

`PersonneConstatable` gagne `rattachementsManuels: readonly RattachementManuel[]`. Le champ
`startups` garde son sens de départ, celui des startups collectées : c'est `constat.ts` qui fait
l'union, pas l'appelant. Faire calculer l'appelant reviendrait à mettre la décision dans un mapper.

`startupsToutesTerminees` devient :

```ts
if (personne.attachment === "DECLARED" || personne.attachment === "BOTH") {
  return null;
}

const effectives = startupsEffectives(personne.startups, personne.rattachementsManuels, today);
if (effectives.length === 0) {
  return null;
}

const echeance = echeanceEffective(personne.missionEnd, personne.rattachementsManuels, today);
if (echeance !== null && jourUTC(echeance) < jourUTC(today)) {
  return null;
}
```

Le `detail` liste les startups effectives et mentionne, le cas échéant, que certaines viennent d'un
rattachement manuel : sur la file des constats, savoir d'où vient le rattachement change le geste à
poser.

`src/lib/sync/executer.ts:156-165` ajoute au `select` :

```ts
startupAssignments: {
  where: { endedAt: null },
  select: { startupGhid: true, until: true, endedAt: true },
},
```

et mappe vers `rattachementsManuels`. Le reste de la collecte n'est pas touché : la clause `endedAt`
est un filtre de lecture, aucune écriture n'est ajoutée au chemin de collecte, et le contrat de
`CollectResult` reste hors sujet ici.

Livrable : le constat voit les rattachements manuels.
Vérifiable : scénarios 3 et 4 ci-dessous.

### 4. L'échéance effective sur les écrans de lecture

Fichiers : `src/app/page.tsx`, `src/app/personnes/page.tsx`,
`src/app/personnes/[username]/page.tsx`, `src/app/constats/page.tsx`, `src/app/departs/actions.ts`.

Chacun ajoute la même clause `startupAssignments` à son `select`, puis passe par
`echeanceEffective` avant `statutDePersonne`, et par `startupsEffectives` là où il affiche des
startups (`src/app/personnes/page.tsx:156`, `src/app/personnes/[username]/page.tsx:206-234`).

`src/app/departs/actions.ts:44` ouvre le dossier sur l'échéance effective : la date de départ de
quelqu'un dont l'accès est prolongé est la date prolongée, sans quoi le dossier contredirait la
fiche.

Sur la fiche, la ligne Échéance affiche l'échéance effective et, quand elle diffère de `missionEnd`,
dit d'où vient l'écart. Une date affichée sans son motif serait une troisième vérité.

Livrable : plus aucun écran n'affiche un statut calculé sur la seule `missionEnd`.
Vérifiable : à la main, sur une fiche portant un rattachement au-delà de son échéance.

### 5. Les deux gestes tracés

Fichier : `src/app/personnes/[username]/actions.ts`.

`rattacherAStartup` : lecture et validations, puis `actionTracee`. Validations, dans cet ordre, avec
un message par cas et aucun message générique :

1. la personne existe en base ;
2. le `ghid` correspond à une ligne de `Startup` ;
3. `until` se lit comme une date, construite en ``new Date(`${iso}T00:00:00Z`)`` comme partout
   ailleurs (`src/lib/sync/perimetre.ts:48-50`) ;
4. `until` n'est pas déjà passée, au jour UTC tronqué : un rattachement expiré à la pose n'a aucun
   effet et donnerait l'illusion d'un geste ;
5. si `prolongeLaMission(missionEnd, until)` et que `confirme !== "oui"`, refus portant « Confirmez
   pour continuer », qui est la convention que le client sait lire
   (`src/app/comptes-isoles/Rattacher.tsx:25`).

Puis, dans le `ecrire` : fermeture d'un éventuel rattachement ouvert sur le même couple
(`endedAt`, `endedBy` à l'opérateur), et création du nouveau avec `createdBy` à l'opérateur.

```ts
action: "rattachement.pose",
targetType: "rattachement",
// L'ordre compte : le filtre « historique de cette personne » du journal reconnaît
// une cible qui se termine par le username (src/app/journal/criteres.ts:65-74).
targetId: `${ghid}:${username}`,
before: remplace ? { jusquAu: ancienne } : undefined,
after: { startup: ghid, jusquAu: iso, motif, prolongeLaMission: bool },
revalider: [`/personnes/${username}`, "/personnes", "/constats", "/"],
```

`retirerRattachement` : refuse un rattachement déjà clos, pose `endedAt` et `endedBy`, journalise
`rattachement.retrait` avec le même `targetType` et le même `targetId`, et un `before` portant la
date et l'auteur de la pose.

Livrable : les deux gestes écrivent leur trace avant l'écriture métier, par construction, puisqu'ils
passent par `actionTracee`.
Vérifiable : `/journal?personne=<username>` montre les deux lignes.

### 6. L'interface

Fichiers : `src/app/personnes/[username]/page.tsx`,
`src/app/personnes/[username]/RattacherStartup.tsx` (nouveau),
`src/app/personnes/[username]/RetirerRattachement.tsx` (nouveau), `src/app/journal/libelles.ts`.

Nommés `RattacherStartup` et `RetirerRattachement` pour ne pas se confondre avec `Detacher.tsx`, qui
traite des comptes externes.

La section Startups de la fiche gagne une colonne d'origine : collecté, ou manuel avec sa date de fin
et l'auteur de la pose. Un rattachement clos ou expiré reste visible, grisé, sous la liste : sans lui,
un constat levé la veille deviendrait inexplicable.

Le formulaire de pose propose les startups connues en base par un `datalist`, une date, un motif
facultatif. `missionEnd` étant déjà chargée par la page, l'avertissement de prolongation s'affiche
côté client dès la saisie, et la case de confirmation apparaît sur refus du serveur, exactement comme
`src/app/comptes-isoles/Rattacher.tsx:24-48`.

L'écran dit aussi, en une phrase, que le constat de startups terminées sera revu à la prochaine
collecte : sans cette phrase, l'absence d'effet immédiat passerait pour une panne.

`src/app/journal/libelles.ts` ajoute `rattachement.pose`, `rattachement.retrait` à `LIBELLE_ACTION`,
et `rattachement` à `LIBELLE_CIBLE`, sans quoi le journal afficherait la valeur brute au moment
précis où il sert de preuve.

Livrable : le geste complet est faisable depuis la fiche.
Vérifiable : à la main, aller-retour pose puis retrait.

### 7. Le garde-fou de disparition

Fichier : `src/lib/sync/perimetre.ts`.

La requête de `src/lib/sync/perimetre.ts:264-267` s'étend :

```ts
const adossees = await prisma.person.findMany({
  where: {
    source: "LOCAL",
    OR: [
      { identities: { some: { vanishedAt: null } } },
      { startupAssignments: { some: { endedAt: null, until: { gte: jourDeCollecte } } } },
    ],
  },
  select: { username: true },
});
```

`source: "LOCAL"` reste en tête et hors du `OR` : une personne venue de l'espace-membre qui en sort
doit continuer de lever `SCOPE_EXIT`.

Livrable : une fiche manuelle rattachée ne disparaît pas parce que son compte a disparu.
Vérifiable : scénario 5 ci-dessous, pour le versant collecte, et à la main pour le reste.

### 8. La documentation

Fichier : `docs/architecture.md`.

Les quatre modifications listées plus haut sont proposées à la validation, section par section, et
appliquées seulement après accord explicite. Le skill `/sync-docs` est le chemin normal pour cette
étape.

## Tests

Emplacement : `src/core/rattachement-startup.test.ts` (nouveau), `src/core/constat.test.ts`
(étendu), `src/lib/sync/perimetre.test.ts` (nouveau, sur la fonction extraite à l'étape 5 ci-dessous).

Personnages et produits inventés pour ces tests : `camille.exemple`, `dominique.exemple`,
`produit-alpha` vivante, `produit-omega` en phase terminale.

### Scénario 1 : un rattachement manuel traverse une collecte, puis expire

Le scénario nommé par la Definition of Done, joué de bout en bout sur les fonctions pures.

Given `camille.exemple`, collectée sur `produit-alpha`, mission jusqu'au 30 septembre.
When on lui pose un rattachement manuel sur `produit-omega` jusqu'au 30 novembre.
Then ses startups effectives contiennent les deux, et son échéance effective est le 30 novembre.
When une collecte repasse et réécrit ses champs collectés, `startups` étant recalculée depuis l'amont
et `missionEnd` remise au 30 septembre.
Then rien n'a bougé : le rattachement manuel n'appartient pas aux champs réécrits, l'union et
l'échéance effective sont identiques.
When on se place au 1er décembre.
Then `produit-omega` a quitté l'ensemble effectif, et l'échéance effective est retombée sur le 30
septembre.

Assertions : les deux ensembles, les trois échéances, et l'égalité stricte entre l'état d'avant et
d'après collecte.

### Scénario 2 : l'échéance effective ne raccourcit jamais rien, et se clôt de deux façons

Given une mission courant jusqu'au 31 décembre et un rattachement manuel jusqu'au 30 septembre.
Then l'échéance effective reste le 31 décembre : un rattachement court ne rogne pas une mission
longue.
Given une fiche sans aucune échéance, telle que `src/app/comptes-isoles/creer.ts` en crée.
When elle reçoit un rattachement jusqu'au 30 novembre.
Then elle a une échéance effective, ce que le ticket amende explicitement dans l'architecture.
When ce rattachement est retiré à la main, `endedAt` posée avant `until`.
Then l'échéance effective redevient nulle et l'ensemble effectif redevient vide, sans attendre la
date de fin.
Et un rattachement dont la date tombe aujourd'hui même est encore en cours : le dernier jour est
inclusif, comme une fin de mission.

### Scénario 3 : le constat de startups terminées voit les rattachements manuels

Given `dominique.exemple`, fiche créée à la main, `attachment: "LOCAL"`, aucune startup collectée.
When on la rattache à `produit-omega`, en phase terminale, mission en cours.
Then `INACTIVE_STARTUP` se lève sur elle, avec la clé `INACTIVE_STARTUP:dominique.exemple`.
When on lui ajoute un rattachement sur `produit-alpha`, vivante.
Then plus rien : une seule startup vivante dans l'union suffit à justifier ses accès.
When le rattachement vise une startup dont la phase est inconnue.
Then plus rien non plus : le garde-fou de phase inconnue vaut pour un rattachement manuel comme pour
un rattachement collecté.
When la même personne est transverse, `attachment: "DECLARED"`.
Then rien, même avec un rattachement manuel sur une startup terminale : son titre d'appartenance ne
dépend d'aucune startup.
When son rattachement est expiré.
Then rien : un rattachement expiré ne participe plus à l'ensemble regardé.

### Scénario 4 : le garde-fou de mission terminée se lit sur l'échéance effective

Given une personne dont la mission s'est terminée le mois dernier et dont toutes les startups
collectées sont terminales.
Then aucun constat : l'échéance dit la même chose et la dit mieux, comportement inchangé.
When on lui pose un rattachement manuel jusqu'au mois prochain, sur une startup terminale.
Then le constat se lève : elle est de nouveau réputée en poste, et plus rien de vivant ne le
justifie. C'est exactement la situation que le geste de prolongation doit rendre visible.
Et le jour où l'échéance effective tombe pile aujourd'hui, le constat se lève encore : la
comparaison tronque au jour, elle ne compare pas deux instants.

### Scénario 5 : la collecte ne connaît pas les rattachements manuels

Étape préalable : extraire de `src/lib/sync/perimetre.ts:52-81` la construction de l'objet `data`
dans une fonction pure `champsCollectes(personne, now)`, que `upsert` consomme. L'extraction ne
change aucun comportement et rend testable la seule chose qui compte ici.

Given une personne résolue par la collecte, y compris une personne de `scope.local` dont la collecte
rend `startups: []`.
Then les clés écrites sont exactement celles attendues, et aucune ne concerne un rattachement manuel.
Et `startups` vaut bien la valeur amont, `[]` comprise : le test grave le comportement que le ticket
décrit comme le piège de départ.

Ce scénario est le garde-fou de régression : le jour où quelqu'un ajoutera un champ à `Person`, il
dira si la collecte s'est mise à écraser une décision.

### Ce que ces tests ne couvrent pas, et qu'il faut trancher

La Definition of Done demande un test d'intégration. Le harnais actuel ne permet pas d'aller
jusqu'à Postgres : `vitest.config.ts:11-15` déclare `environment: "node"`, et aucun test du dépôt ne
mocke Prisma. Les cinq scénarios ci-dessus couvrent toute la logique de décision, mais pas la
persistance ni la clause `where` du garde-fou de l'étape 7.

Deux options, à arbitrer avant de commencer :

1. Accepter cette couverture, et vérifier la persistance à la main via la liste de l'étape
   Vérification. C'est le choix cohérent avec l'état du dépôt.
2. Monter un harnais de test adossé à une base, ce qui est une décision d'infrastructure à part
   entière, avec son coût sur la boucle de retour et sur l'intégration continue.

Ce plan retient l'option 1 par défaut et ne la maquille pas en couverture complète.

## Risques et pièges

**Les deux caches Prisma.** Sauter `pnpm db:generate` ou le redémarrage de `pnpm dev` produit un
`Unknown argument 'startupAssignments'` au runtime pendant que le typecheck passe. C'est la première
chose à revérifier devant une erreur incompréhensible sur ce chantier.

**Un site de lecture oublié.** `Person.startups` et `Person.missionEnd` restent lisibles partout et
rien ne signale un écran qui les affiche seuls. La liste exhaustive est donnée à l'étape 4 ; en
oublier un produit un écran qui contredit la fiche sans qu'aucun test ne bronche. Relecture par
`grep -rn "missionEnd" src/app` avant de clore.

**Le fuseau.** Un `until` construit par `new Date("2026-11-30")` et un `until` construit par
`new Date("2026-11-30T00:00:00Z")` ne sont pas la même chose selon l'environnement, et un
rattachement posé le soir depuis Paris décalerait d'un jour. Le dépôt a déjà sa convention
(`src/lib/sync/perimetre.ts:48-50`, `src/app/comptes-isoles/actions.ts:11-13`), la reprendre telle
quelle.

**La comparaison de dates.** Comparer deux `Date` brutes rejoue l'erreur de
`src/core/constat.ts:67`. Tout passage par `jourUTC` ou rien.

**La prolongation contournée.** L'avertissement client ne protège de rien : un formulaire se poste
sans passer par l'écran. Le refus serveur tant que la confirmation manque est le seul dispositif qui
tienne, et il doit être couvert.

**Le décalage entre le geste et le constat.** Poser un rattachement ne lève aucun constat sur le
champ, et le retirer n'en ferme aucun. C'est délibéré, mais un écran qui ne le dit pas fait
soupçonner une panne, et une file qui affiche un constat déjà résolu cesse d'être lue.

**Deux poses simultanées sur le même couple.** Prisma ne sait pas exprimer un index unique partiel,
donc deux lignes ouvertes restent possibles sur un double clic. Les conséquences sont bénignes,
l'union dédoublonne et l'échéance prend le maximum, mais l'affichage doit rester lisible et le retrait
doit fermer ce qu'il vise, pas « le » rattachement supposé unique.

**Une startup disparue de l'incubateur.** Un rattachement sur une startup portant un `vanishedAt`
reste posable et sa phase reste connue, donc le constat peut se lever. Le sort de ces startups relève
de l'issue #6 et ne se tranche pas ici, mais l'écran doit signaler le cas.

**L'ordre de validation et la session.** Les vérifications précèdent `actionTracee`, donc précèdent
`requireOperateur` (`src/lib/actions.ts:31`). C'est le motif déjà en place dans
`src/app/comptes-isoles/actions.ts`, à ne pas aggraver : aucune donnée sensible ne doit être lue ni
renvoyée avant le passage tracé.

**Le vrai danger métier.** Ce chantier donne le moyen de repousser une coupure. Il ne crée aucune
révocation nouvelle et ne touche à aucun `matchMethod`, mais il déplace une échéance. La trace
nominative, la date de fin obligatoire et l'avertissement à la saisie sont les trois contreparties :
en retirer une viderait le geste de sa garantie.

**`ACTIONS_ENABLED`.** Rien ici n'écrit sur un système cible, il n'y a donc pas de simulation à
prévoir. Ne pas en conclure qu'un raccourci hors `actionTracee` serait sans conséquence : c'est le
journal qui est en jeu, pas le mode d'exécution.

## Vérification

Au-delà de `pnpm verify` et de `/verif`, qui ajoute le build.

Sur la base de développement, dans cet ordre :

1. Poser un rattachement sur une personne collectée, avec une date en deçà de son échéance. Vérifier
   que la fiche l'affiche, que la startup apparaît dans ses startups, et que la liste des personnes
   la montre aussi.
2. Lancer `pnpm sync`. Vérifier que le rattachement est toujours là, que `Person.startups` a bien été
   réécrite par la collecte, et que les deux cohabitent.
3. Refaire le point 1 sur une personne déclarée dans `scope.local`, dont la collecte remet
   `startups: []`. C'est la case de la Definition of Done qui vaut pour toutes les autres.
4. Poser une date au-delà du `missionEnd` : l'avertissement paraît à la saisie, le serveur refuse
   sans la confirmation, et accepte avec.
5. Rejouer le point 4 en postant le formulaire sans la confirmation, hors de l'écran. Le serveur doit
   refuser.
6. Vérifier dans `/journal?personne=<username>` que la trace de pose précède l'écriture, porte
   l'opérateur, et que le filtre par personne retrouve bien les deux lignes, ce qui valide l'ordre
   choisi pour le `targetId`.
7. Rattacher quelqu'un à une startup en phase terminale, alors qu'il n'a rien d'autre de vivant.
   Lancer `pnpm sync`. Le constat `INACTIVE_STARTUP` doit être ouvert sur `/constats`.
8. Retirer le rattachement, relancer `pnpm sync`. Le constat doit s'être refermé de lui-même, avec la
   raison de réconciliation habituelle.
9. Avancer une date de fin dans le passé directement en base, relancer `pnpm sync` : le constat se
   referme de la même manière, sans qu'aucun geste humain n'ait eu lieu. C'est la preuve que
   l'expiration ne dépend d'aucune écriture.
10. Sur une fiche créée à la main, rattachée, faire disparaître son compte externe. Lancer
    `pnpm sync` et vérifier qu'elle ne prend pas de `vanishedAt` tant que le rattachement court, et
    qu'une personne issue de l'espace-membre sortie du référentiel, elle, lève toujours
    `SCOPE_EXIT`.

Le chantier est fini quand les dix points passent, que les cinq scénarios de test sont verts, et que
les quatre amendements de `docs/architecture.md` ont été soumis et tranchés.
