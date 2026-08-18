# Index des startups et page d'une startup (#6)

> Plan d'implémentation de l'issue #6. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

**Aucun écran ne parle d'une startup.** La navigation ne propose que huit entrées, aucune n'est
`/startups` (`src/ui/Navigation.tsx:7`). Le mot « startup » n'apparaît dans l'interface qu'en colonne
de la liste des personnes, sous la forme brute des ghids joints par des virgules
(`src/app/personnes/page.tsx:156`), et en section de la fiche d'une personne.

**Le modèle est déjà là, complet.** `Startup` porte `ghid` (unique), `name`, `incubatorGhid`,
`currentPhase`, `phaseStart`, plus `firstSeenAt`, `lastSeenAt` et `vanishedAt`
(`prisma/schema.prisma`, modèle `Startup`). Il est alimenté par `syncStartups`
(`src/lib/sync/constats.ts:52`), qui fait un `upsert` par startup rendue par l'espace-membre, puis
date les disparitions seulement si la collecte du périmètre est `OK` et si la chute n'est pas
excessive (`src/lib/sync/constats.ts:74` à `92`).

**Le rattachement est porté par `Person.startups`, un `String[]`.** Il est réécrit intégralement à
chaque collecte (`src/lib/sync/perimetre.ts:61`). Deux conséquences déjà visibles dans le code :

- une personne rattachée par équipe repart systématiquement avec `startups: []`
  (`src/core/membre.ts:131`), donc elle n'apparaîtra jamais dans les membres d'une startup ;
- une personne déclarée dans `scope.local` se voit imposer `startups: []` à chaque passage
  (`src/lib/sync/perimetre.ts:204`). **Écrire un rattachement dans cette colonne est un geste qui ne
  survit pas à la nuit.** C'est exactement le constat qui fonde l'issue #2.

**La fiche personne fait déjà la moitié du travail, dans le mauvais sens.** Elle recharge les
startups par leurs ghids, les joint à la main, calcule `terminale` et `connue`, et trie
(`src/app/personnes/[username]/page.tsx:206` à `234`). Elle porte aussi, en dur et en local :

- le tableau `LIBELLE_PHASE` des neuf phases beta.gouv (`src/app/personnes/[username]/page.tsx:79`) ;
- la table `SEVERITE_STATUT` (`src/app/personnes/[username]/page.tsx:31`), **déjà dupliquée** à
  l'identique dans `src/app/personnes/page.tsx:29` ;
- `SEVERITE_CONSTAT` et `LIBELLE_SEVERITE` (`src/app/personnes/[username]/page.tsx:41`), également
  présentes dans `src/app/constats/page.tsx:18` ;
- l'alerte de péremption de la collecte (`src/app/personnes/[username]/page.tsx:273`), bâtie sur
  `fraicheurDe` (`src/core/collecte.ts:34`) et sur la dernière passe du fournisseur de périmètre,
  nommé par la constante locale `FOURNISSEUR_PERIMETRE` (`src/app/personnes/[username]/page.tsx:96`).

Ouvrir une page startup sans rien toucher créerait donc une troisième copie de tout cela. C'est
précisément ce que la Definition of Ready du ticket demande d'éviter.

**Le geste de rattachement manuel à une startup n'existe pas.** Ce qui existe, c'est le rattachement
d'un **compte** à une **personne** (`src/app/comptes-isoles/actions.ts:26`) et son inverse
(`src/app/personnes/[username]/actions.ts:17`). Les deux passent par `actionTracee`
(`src/lib/actions.ts:30`), qui journalise avant d'écrire, puis revalide une liste de chemins figée
dans l'appel (`src/app/comptes-isoles/actions.ts:125`). L'objet daté du ticket #2 n'est pas au
schéma : `pnpm db:studio` ne montre aucune table de rattachement.

**Un précédent utile pour l'étape finale** : `BoutonDepart` importe une action serveur définie dans
une autre route (`src/app/personnes/[username]/BoutonDepart.tsx:7` importe
`@/app/departs/actions`). Emprunter le geste de #2 depuis `/startups` est donc un chemin déjà balisé,
et non une entorse.

**Les pièges déjà repérés dans le code existant :**

- `syncStartups` est enveloppé dans un `try/catch` qui ne dégrade pas le `SyncRun` de l'espace-membre
  (`src/lib/sync/executer.ts:66` à `91`). Le référentiel des startups peut donc être gelé pendant que
  l'indicateur de fraîcheur du périmètre affiche un vert franc.
- Une phase inconnue interdit de conclure quoi que ce soit, c'est un garde-fou explicite du moteur de
  constats (`src/core/constat.ts:74`), et `INACTIVE_STARTUP` ne se lève pas sur une mission déjà
  terminée (`src/core/constat.ts:67`).
- La liste des phases terminales est de la configuration, pas du code
  (`src/core/policy.ts:249`, défaut `abandon`, `abandon-investigation`, `transfere`, `alumni`).
- Tous les tests du dépôt sont des tests de fonctions pures dans `src/core` (et un dans
  `src/app/journal`). Il n'y a **aucun harnais de test contre une base**. Ce que ce plan propose de
  tester doit donc être calculable sans Prisma.

## Décisions de conception

**Routes.** `/startups` pour l'index, `/startups/[ghid]` pour le détail. Le ghid est le pivot public
de la startup, il est unique en base et déjà présent dans `Person.startups` : aucune raison
d'introduire un identifiant technique dans l'URL. Les deux pages sont
`export const dynamic = "force-dynamic"`, comme toutes les pages qui lisent la base.

**Les quatre vues de l'index, et ce qu'elles tranchent.** Paramètre `vue` en query string, formulaire
en GET comme `src/app/personnes/Filtres.tsx` :

| Vue | Contenu | Défaut |
|---|---|---|
| `actives` | `vanishedAt` nul et phase non terminale, phase inconnue comprise | oui |
| `terminales` | `vanishedAt` nul et phase terminale | |
| `sorties` | `vanishedAt` non nul, quelle que soit la dernière phase connue | |
| `tout` | tout | |

Une phase inconnue reste dans `actives`. C'est la règle du moteur de constats
(`src/core/constat.ts:74`) : on ne conclut pas sur une supposition, et ranger une startup dans les
terminées faute d'information reviendrait à conclure.

**Le sort des startups qui portent un `vanishedAt`** (point ouvert de la Definition of Ready). Elles
ne sont ni masquées, ni confondues avec les terminées. Trois raisons :

1. `vanishedAt` ne dit pas qu'une startup est finie, il dit qu'elle n'est plus rendue par la liste de
   l'incubateur. Une co-incubation retirée, un ghid renommé et une startup abandonnée produisent le
   même symptôme.
2. Sa dernière phase connue reste affichée mais n'est plus un fait présent : la page le dit en
   toutes lettres et affiche `lastSeenAt`.
3. Une startup sortie de l'incubateur **qui a encore des membres** est exactement l'endroit où des
   accès survivent sans que rien d'autre ne le signale. Elle mérite donc son propre compteur, à côté
   de celui que le ticket réclame pour les phases terminales.

Elles sont donc écartées de la vue par défaut, rassemblées dans la vue `sorties`, et comptées.

**Trois compteurs en tête d'index**, en tuiles horizontales comme le tableau de bord
(`src/app/page.tsx:122`) : startups actives, startups en phase terminale **qui ont encore des
membres**, startups sorties de l'incubateur **qui ont encore des membres**. Le compteur du ticket est
le deuxième, et il ne compte que du peuplé : une startup terminée sans personne dessus est un fait
d'archive, pas un travail à faire, et la gonfler dans le compteur c'est le rendre ignorable.

**Un membre sorti du référentiel compte quand même comme membre.** `Person.vanishedAt` non nul
signifie que plus aucune source ne la réclame, ce qui est le pire cas, pas une raison de la faire
disparaître de l'écran. La ligne porte alors son statut `SORTI`, calculé par
`statutDePersonne` (`src/core/statut.ts:66`) comme partout ailleurs.

**Une seule liste de membres, pas deux tableaux.** Le ticket exige qu'un membre rattaché à la main se
distingue visuellement d'un membre collecté. Deux tableaux séparés le feraient, mais rendraient
invisible le cas qui compte : une personne **à la fois** collectée sur cette startup et porteuse d'un
rattachement manuel vers la même. Une colonne « Rattachement » avec trois valeurs (`Collecté`,
`Manuel jusqu'au ...`, `Les deux`) le dit mieux, et le troisième cas porte une mention explicite
disant que le rattachement manuel n'ajoute rien tant que la collecte le porte déjà.

**Un rattachement manuel échu ne fait plus un membre.** Il quitte la liste des membres et rejoint une
liste « rattachements manuels échus », lisible et datée. Le faire simplement disparaître ferait croire
que quelqu'un l'a retiré, alors que c'est le temps qui a passé.

**Le geste est emprunté, jamais réécrit.** La pose et le retrait d'un rattachement manuel appartiennent
à l'issue #2 et à son plan (`docs/plans/#02_rattachement-startup-manuel.md`). Cette page importe ces
actions serveur, elle n'en écrit pas de seconde version. Conséquence directe sur la Definition of Done
(« exactement le même effet et la même trace ») : il n'y a qu'un chemin d'écriture, donc la question
ne se pose pas. Ce plan porte deux exigences sur ce que #2 livre :

- la liste `revalider` de ces actions doit inclure `/startups` et `/startups/<ghid>`, faute de quoi la
  page resterait sur une version en cache après le geste ;
- la trace doit porter `targetId` sous la forme `<ghid>:<username>`, pour que le filtre du journal par
  personne continue de fonctionner : il cherche l'égalité ou le suffixe `:<username>`
  (`src/app/journal/criteres.ts:69`). Un filtre du journal **par startup** n'est pas ajouté ici, il
  demanderait un `startsWith` et un champ de formulaire de plus ; c'est un ajout ultérieur, pas une
  dépendance.

**Ce que la page ne fait pas.** Aucun départ groupé, décision actée du ticket. Aucune écriture dans
`Person.startups`, jamais, pour la raison rappelée plus haut. Aucun octroi d'accès. Les ressources
possédées par la startup et ses modèles de plan sont hors périmètre (issues #16 et #9) : la page
réserve leur emplacement par deux titres de section absents, pas par des blocs vides.

**Une seule vérité par notion, avant d'ouvrir un troisième écran.** Étape 1 du découpage, sans
changement de comportement :

- `LIBELLE_PHASE` part dans `src/core/libelle-startup.ts`, à côté de `src/core/libelle-constat.ts` qui
  suit exactement le même motif ;
- `SEVERITE_STATUT`, `SEVERITE_CONSTAT` et `LIBELLE_SEVERITE` partent dans `src/ui/severites.ts` : ce
  sont des correspondances d'affichage DSFR, elles n'ont rien à faire dans `src/core` ;
- l'alerte de péremption de la fiche personne devient `src/ui/Fraicheur.tsx`, avec la phrase variable
  en propriété. Le tableau de bord **garde la sienne** (`src/app/page.tsx:65`) : son texte parle de
  l'outil entier et de ses seuils, pas de ce que montre une fiche, les fusionner appauvrirait les
  deux ;
- `estPhaseTerminale` naît dans `src/core/startups.ts` et `src/core/constat.ts:71` s'en sert. Une
  ligne, aucun changement de comportement, et la définition de « phase terminale » cesse d'exister en
  deux endroits.

**Tension avec `docs/architecture.md`.** Aucune pour ce ticket. La page est en lecture, plus un geste
qui appartient à #2. C'est bien #2 qui amende le document (§3.4, sur l'échéance d'une fiche créée à la
main), pas celui-ci. `docs/architecture.md` §3.2 décrit `Startup` exactement tel qu'il est utilisé ici,
et la doctrine des sections 2.2 et 4.2 (une collecte qui s'arrête doit se voir, une phase inconnue
interdit de conclure) est appliquée telle quelle. Rien à modifier dans le document.

## Modèle de données

**Aucune migration Prisma.** Tout ce que ces deux écrans affichent existe déjà : `Startup`,
`Person.startups`, `ExternalIdentity`, `Finding`, `SyncRun`.

La table de rattachement manuel est livrée par l'issue #2, sa migration appartient à son plan. Ce plan
la consomme et ne la définit pas. Si #2 n'est pas encore fusionnée quand les étapes 1 à 5 sont prêtes,
elles sont livrables telles quelles : seule l'étape 6 est bloquée.

**Aucun index n'est ajouté.** La requête des membres d'une startup est un `has` sur un tableau scalaire
sans index GIN, donc un parcours séquentiel de la table `Person` : quatre-vingt-quinze lignes, ce qui
est le coût que le ticket qualifie de négligeable et qu'il demande de mesurer plutôt que d'anticiper.
`Startup` porte déjà `@@index([incubatorGhid])` et `@@index([currentPhase])`.

Rappel qui vaut pour toute reprise de ce plan : **si le schéma bouge, `pnpm db:generate` puis
redémarrage de `pnpm dev`.** Deux caches se cumulent, `prisma migrate dev` ne régénère pas toujours le
client de `src/generated/prisma`, et le client survit au rechargement à chaud sur `globalThis`. Le
symptôme est un typecheck vert et un runtime qui refuse un champ.

## Découpage en étapes

### Étape 1. Sortir les vérités partagées, sans changer un pixel

Déplacements purs, aucun comportement modifié. La page startup ne doit pas être l'occasion d'écrire une
troisième fois la même table.

Fichiers créés : `src/core/libelle-startup.ts` (`LIBELLE_PHASE`), `src/ui/severites.ts`
(`SEVERITE_STATUT`, `SEVERITE_CONSTAT`, `LIBELLE_SEVERITE`), `src/ui/Fraicheur.tsx` (composant serveur,
l'alerte de la fiche personne avec sa phrase en propriété).

Fichiers modifiés : `src/app/personnes/[username]/page.tsx` (retrait des quatre tables locales et de
l'alerte inline), `src/app/personnes/page.tsx` (retrait de `SEVERITE`), `src/app/constats/page.tsx`
(retrait de `SEVERITE` et `LIBELLE_SEVERITE`).

Vérifiable : `pnpm verify` passe, et les trois pages rendent exactement comme avant. Un `git diff`
qui ne montre que des imports et des suppressions est le bon signe.

### Étape 2. Le noyau de calcul et ses tests

Tout ce qui décide se calcule ici, hors de Prisma et hors de React, parce que c'est la seule façon de
le tester dans ce dépôt.

Fichier créé : `src/core/startups.ts`. Fichier modifié : `src/core/constat.ts` (usage de
`estPhaseTerminale`).

Forme visée, à ajuster sur ce que #2 nomme réellement pour le rattachement manuel :

```ts
export type VueStartups = "actives" | "terminales" | "sorties" | "tout";

export interface StartupObservee {
  ghid: string;
  name: string;
  currentPhase: string | null;
  phaseStart: Date | null;
  lastSeenAt: Date;
  vanishedAt: Date | null;
}

export interface LigneStartup extends StartupObservee {
  membres: number;
  membresSortis: number;
  terminale: boolean;
  phaseConnue: boolean;
}

export function estPhaseTerminale(phase: string | null, terminales: ReadonlySet<string>): boolean;

export function assemblerIndex(
  startups: readonly StartupObservee[],
  personnes: readonly { startups: readonly string[]; vanishedAt: Date | null }[],
  terminales: ReadonlySet<string>,
): { lignes: LigneStartup[]; ghidsInconnus: { ghid: string; membres: number }[] };

export function filtrerStartups(
  lignes: readonly LigneStartup[],
  vue: VueStartups,
  recherche: string,
): LigneStartup[];

export function compteurs(lignes: readonly LigneStartup[]): {
  actives: number;
  terminalesPeuplees: number;
  sortiesPeuplees: number;
};

export function assemblerMembres(
  collectes: readonly MembreDeStartup[],
  manuels: readonly RattachementManuel[],
  maintenant: Date,
): { membres: MembreDeStartup[]; echus: RattachementManuel[] };
```

`ghidsInconnus` porte les ghids présents dans `Person.startups` mais absents de la table `Startup`.
Ils existent : la fiche personne les affiche déjà comme « non collectée »
(`src/app/personnes/[username]/page.tsx:391`). Sans cette sortie, ils seraient invisibles de l'index,
donc invisibles tout court.

Vérifiable : `src/core/startups.test.ts` passe (scénarios ci-dessous), et `pnpm test` reste vert sur
`src/core/constat.test.ts`, qui couvre le comportement dont `estPhaseTerminale` vient d'être extrait.

### Étape 3. L'index `/startups`

Fichiers créés : `src/app/startups/page.tsx`, `src/app/startups/Filtres.tsx` (formulaire GET, calqué
sur `src/app/personnes/Filtres.tsx`).

Fichier modifié : `src/ui/Navigation.tsx` (entrée « Startups » après « Personnes »).

Trois lectures parallèles : les startups (`prisma.startup.findMany`), les personnes réduites à
`{ startups, vanishedAt }`, et la dernière passe du fournisseur de périmètre pour l'alerte de
fraîcheur. Tout le reste est du calcul dans `src/core/startups.ts`.

La page rend : l'alerte de fraîcheur, les trois tuiles de compteur, le formulaire de vue et de
recherche, un tableau (Startup, Phase, Depuis, Membres, Dernière observation), et sous le tableau une
alerte d'information listant les ghids inconnus du référentiel s'il y en a.

Vérifiable : l'index s'ouvre sur une base vide sans erreur et le dit ; chaque vue affiche ce qu'elle
annonce ; la tuile des terminales peuplées mène bien à `?vue=terminales`.

### Étape 4. La page d'une startup, en lecture

Fichiers créés : `src/app/startups/[ghid]/page.tsx`, `src/app/startups/[ghid]/not-found.tsx`.

Sections, dans cet ordre :

1. Fil d'Ariane, nom, ghid, badge de phase, badge « sortie de l'incubateur » le cas échéant.
2. Alerte de fraîcheur (`src/ui/Fraicheur.tsx`), et mention « phase constatée le ... » tirée de
   `Startup.lastSeenAt`, qui est le seul recours contre le trou de l'étape startups décrit dans les
   risques.
3. Situation : phase, depuis quand (`phaseStart`), première et dernière observation, sortie du
   référentiel, lien vers la fiche espace-membre de la startup. **Le format exact de cette URL est à
   vérifier dans un navigateur avant de la livrer** ; en cas de doute, pas de lien plutôt qu'un lien
   mort, la fiche personne ayant déjà ce motif (`src/app/personnes/[username]/page.tsx:340`).
4. Membres : une seule liste, colonnes Personne, Statut, Échéance, Rattachement, Comptes. La colonne
   Comptes agrège les identités non disparues par fournisseur, et signale d'un badge celles dont
   `matchMethod` vaut `HEURISTIC` ou `NONE`, avec la même phrase que la fiche personne : un tel
   rattachement ne peut jamais produire de révocation. Sous le tableau, la liste des rattachements
   manuels échus s'il y en a.
5. Constats ouverts sur ses membres, avec lien vers `/constats`.

Le cas vide se dit en trois phrases distinctes, jamais en une seule : aucune personne rattachée, ou
aucune collecte n'a jamais eu lieu, ou la startup elle-même n'est plus observée depuis telle date.
Confondre les trois ferait passer une absence d'observation pour une absence de membre.

`generateMetadata` rend le nom de la startup, ou « Startup introuvable ». Un ghid inconnu appelle
`notFound()` et la page dédiée explique que ce ghid n'a jamais été collecté pour cet incubateur, sur
le modèle de `src/app/personnes/[username]/not-found.tsx`.

Vérifiable : une startup sans membre s'affiche et le dit ; une startup sortie affiche sa dernière
phase connue sans la présenter comme actuelle ; `/startups/ghid-qui-nexiste-pas` rend la page
introuvable et non une erreur 500.

### Étape 5. Recoudre la fiche personne

Fichier modifié : `src/app/personnes/[username]/page.tsx`. Le nom de chaque startup du tableau
« Startups » devient un lien vers `/startups/<ghid>`, sauf pour un ghid non collecté, qui reste du
texte. C'est le « par l'autre bout » du ticket, et cela ne coûte qu'un `Link`.

Vérifiable : depuis une fiche personne on atteint la startup, et depuis la startup on revient à la
fiche.

### Étape 6. Le geste de rattachement, emprunté à l'issue #2

Bloquée tant que #2 n'est pas fusionnée. Ne pas la contourner par une écriture locale.

Fichier créé : `src/app/startups/[ghid]/Rattachement.tsx`, composant client qui importe les actions
serveur de #2 et les pilote avec `useActionState`, exactement comme
`src/app/comptes-isoles/Rattacher.tsx` et `src/app/personnes/[username]/Detacher.tsx`. Un champ pour
le username, un champ pour la date de fin obligatoire, et le retrait sur chaque ligne de membre
manuel.

Fichier modifié : le module d'actions de #2, pour ajouter `/startups` et le chemin de la startup à sa
liste `revalider`.

L'avertissement de #2 sur une date posée au delà de `missionEnd` est rendu par l'action, pas par cet
écran : c'est elle qui détient la règle, et la dupliquer ici la ferait diverger.

Vérifiable : un rattachement posé depuis cette page et un rattachement posé depuis la fiche personne
produisent deux lignes de journal identiques au nom de l'opérateur près. Se le prouver en comparant
les deux `AuditEvent` dans `pnpm db:studio`.

## Tests

Fichier : `src/core/startups.test.ts`. Tout est calculable sans base, conformément à ce que fait déjà
le dépôt. Cinq scénarios, chacun avec plusieurs assertions.

**1. L'index sépare ce qui vit, ce qui est fini, et ce qui a quitté l'incubateur.** Given six startups :
deux en `construction`, une en `alumni`, une en `transfere`, une sans phase connue, une portant un
`vanishedAt` et une phase `acceleration`. When on assemble l'index avec la liste des phases terminales
de la politique. Then la vue par défaut en montre trois (les deux vivantes et celle dont la phase est
inconnue), la vue `terminales` en montre deux, la vue `sorties` en montre une, et la vue `tout` les six.
Assertion supplémentaire : la startup sans phase connue n'est **pas** marquée terminale, et son drapeau
`phaseConnue` est faux, pour que l'écran puisse le dire au lieu de trancher.

**2. Le compteur ne réclame l'attention que là où il reste des gens.** Given deux startups en phase
terminale, l'une avec deux personnes rattachées dont une sortie du référentiel, l'autre avec personne ;
et une startup sortie de l'incubateur avec une personne. Then `terminalesPeuplees` vaut un, pas deux ;
`sortiesPeuplees` vaut un ; et le décompte des membres de la première vaut deux, dont un sorti. Le point
de l'histoire est qu'une personne sortie du référentiel continue de compter : c'est sur elle que des
accès survivent.

**3. Les membres se lisent en une seule liste, sans doublon ni membre inventé.** Given une startup avec
deux membres collectés (`prenom.nom` et `autre.personne`), un rattachement manuel en cours sur
`prenom.nom` (donc déjà collectée) et un autre sur `tierce.personne` (inconnue de la collecte). Then la
liste rend trois membres et non quatre ; `prenom.nom` porte l'origine `les-deux` ; `tierce.personne`
porte l'origine `manuel` avec sa date de fin ; `autre.personne` porte `collecte` et aucun objet manuel.
Assertion supplémentaire : l'ordre est stable et ne dépend pas de l'ordre d'entrée des deux listes.

**4. Un rattachement manuel échu cesse de faire un membre, sans disparaître de l'écran.** Given une
startup dont le seul rattachement manuel s'est terminé la veille, et un autre qui court jusqu'au mois
prochain. When on assemble au jour dit. Then le premier n'est pas dans les membres mais figure dans les
échus avec sa date, le second est bien membre, et une date de fin tombant **le jour même** fait encore
un membre : la fin est inclusive, exactement comme la fin de mission dans `src/core/statut.ts:41`.

**5. Une startup jamais observée ne se dit pas vide, et un ghid orphelin ne disparaît pas.** Given un
référentiel de startups vide et deux personnes portant chacune le ghid `startup-fantome` dans
`Person.startups`. Then `assemblerIndex` ne rend aucune ligne mais signale `startup-fantome` dans
`ghidsInconnus` avec deux membres. Assertion supplémentaire : une startup présente au référentiel mais
sans aucun membre rend bien une ligne, à zéro membre, ce qui est un fait observé et non une absence
d'observation. Ce sont deux situations que l'écran doit formuler différemment, et le test fixe la
frontière.

## Risques et pièges

**Écrire dans `Person.startups` détruirait le travail à la première nuit.** La colonne est réécrite en
entier à chaque collecte (`src/lib/sync/perimetre.ts:61`) et forcée à vide pour les personnes de
`scope.local` (`src/lib/sync/perimetre.ts:204`). C'est silencieux : l'écran est juste jusqu'au
lendemain matin. Aucun code de ce ticket ne doit toucher cette colonne.

**Une personne rattachée par équipe n'apparaîtra jamais dans les membres d'une startup**, parce que
`rattachementDeclare` rend `startups: []` (`src/core/membre.ts:131`). Ce n'est pas un défaut à corriger
ici, mais la page doit éviter de laisser croire qu'elle liste « qui travaille sur cette startup ». Elle
liste qui l'espace-membre y rattache, plus qui a été rattaché à la main. Une phrase courte sous le
tableau suffit, et c'est précisément le manque que #2 comble.

**Le référentiel des startups peut être périmé pendant que l'alerte de fraîcheur affiche du vert.**
L'étape `syncStartups` est enveloppée dans un `try/catch` qui n'altère pas le `SyncRun` de
l'espace-membre (`src/lib/sync/executer.ts:66` à `91`), et un périmètre `PARTIAL` fait passer
`daterDisparitions` à faux (`src/lib/sync/executer.ts:73`) sans que rien ne le dise à l'écran. D'où
l'affichage systématique de `Startup.lastSeenAt` sur la page de détail : c'est le seul témoin par
startup, et il coûte une colonne déjà en base.

**Une phase terminale n'est pas une sortie, et l'inverse non plus.** Les confondre dans les vues ou dans
les compteurs ferait disparaître de l'écran l'un des deux cas. La table des vues ci-dessus est
normative.

**Un compte dont le rattachement est `HEURISTIC` ou `NONE` ne peut jamais produire une révocation.**
La colonne Comptes de la page startup est un nouvel endroit où l'oublier est possible : elle affiche
des comptes à côté de personnes, sur un écran d'où l'on part couper des accès. Le badge et la phrase de
la fiche personne (`src/app/personnes/[username]/page.tsx:530`) sont repris tels quels.

**Le geste emprunté à #2 doit revalider les chemins de cette page.** Sinon le rattachement réussit,
sa trace est écrite, et l'écran continue d'afficher l'état d'avant. L'opérateur en conclut que le geste
a échoué et le refait. Ajouter `/startups` et `/startups/<ghid>` à la liste `revalider` de l'action fait
partie de l'étape 6, pas d'un ajustement ultérieur.

**Une requête Prisma avec `in: []` ne rend rien, ce qui est bon, mais `notIn: []` n'exclut rien**, piège
déjà documenté dans le dépôt (`src/lib/sync/constats.ts:78`). Sur la page startup, la requête des
constats des membres doit être sautée quand la liste des membres est vide, plutôt que d'être émise avec
une liste vide.

**Ne pas oublier `export const dynamic = "force-dynamic"` sur les deux nouvelles pages.** Sans lui, le
build tente de préparer la route et touche la base, ce que `src/lib/db.ts:19` évite justement par une
connexion différée. Le symptôme apparaît au `pnpm build`, pas au `pnpm dev`, donc après `pnpm verify`
qui ne fait pas le build.

**Le ghid en URL est sensible à la casse.** Les ghids sont en kebab minuscule, la recherche est une
égalité stricte sur une colonne unique. Un lien mal formé rend la page introuvable, ce qui est le
comportement voulu, mais la page « introuvable » doit le dire assez clairement pour qu'on ne cherche pas
une panne de collecte.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next. Le build compte double ici : deux routes
nouvelles, et le piège de prérendu décrit ci-dessus ne se voit qu'à ce moment.

Au delà, sur une base réellement collectée (`pnpm sync` au moins une fois) :

1. L'index s'ouvre, les trois compteurs sont cohérents avec ce que montre chaque vue, et la tuile des
   terminales peuplées mène à la vue qui les liste.
2. Une startup sans membre s'affiche et le dit, sans erreur et sans tableau vide muet.
3. Une startup portant un `vanishedAt` affiche sa dernière phase connue **et** la date à laquelle elle
   a cessé d'être observée.
4. Un ghid inexistant rend la page introuvable, pas une erreur serveur.
5. En reculant à la main le `startedAt` du dernier `SyncRun` de `espace-membre` au delà de
   `collectStaleHours`, l'alerte de péremption apparaît sur l'index et sur la page de détail, comme sur
   la fiche personne.
6. Un membre rattaché à la main se distingue du premier coup d'oeil d'un membre collecté, et une
   personne portant les deux rattachements ne produit qu'une ligne.
7. Après un rattachement posé depuis la page startup, `pnpm sync` puis rechargement : le rattachement
   est toujours là, et `Person.startups` n'a pas bougé. C'est la preuve que rien n'a été écrit au mauvais
   endroit.
8. Les deux `AuditEvent` produits par un rattachement depuis la fiche personne et depuis la page
   startup sont identiques dans leur `action`, leur `targetType` et la forme de leur `targetId`.
9. Le journal filtré sur le username d'un membre fait bien apparaître le rattachement posé depuis cette
   page.

La Definition of Ready du ticket est close par ce document : le contenu de la page est arrêté et
confronté à ce que la fiche personne affiche déjà (étape 1), et le sort des startups portant un
`vanishedAt` est tranché (vue `sorties`, compteur dédié, dernière phase connue affichée comme telle).
