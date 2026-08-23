# Traiter en une fois les membres d'une startup qui s'arrête (#29)

> Plan d'implémentation de l'issue #29. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment. Il suppose livrée la page d'une startup, ouverte par #6, dont il occupe une section.

## Ce qui existe aujourd'hui

**Les deux gestes du ticket existent, à l'unité, sur la fiche d'une personne.**

« Déclarer hors incubateur » est un bouton de soumission portant `name="sens" value="EXCLUDE"` dans le
formulaire du composant `Appartenance`, qui appelle `forcerAppartenance`
(`src/app/personnes/[username]/actions.ts:301`). Elle exige une raison d'au moins trois caractères,
journalise `personne.appartenance.forcee` avec `targetId` valant le username, puis fait un `upsert` sur
`ScopeOverride`, unique par personne. Sa docstring est normative et ce plan s'y plie : elle dit
l'appartenance, elle n'ordonne rien, et surtout elle ne ferme aucun constat, faute de quoi « une sortie
forcée deviendrait le moyen le plus rapide de faire disparaître un écart gênant ».

« Ouvrir un dossier de départ » est `ouvrirDepart` (`src/app/departs/actions.ts:19`), qui journalise
`depart.ouverture`, appelle `ouvrirDossierDeDepart`, calcule le plan et le fige, puis **redirige**. Le
`redirect` est volontairement placé hors du passage tracé, avec un commentaire qui explique pourquoi.

**Le geste de clôture d'un constat existe aussi, et il est le seul chemin légitime.** `cloreConstat`
(`src/app/constats/actions.ts:13`) prend une `dedupKey` et une raison d'au moins trois caractères, refuse
un constat déjà clos, journalise `finding.close` et écrit `closedAt`, `closeReason` et `closedBy`.

**Un constat clos à la main ne se rouvre pas tant que la situation dure.** `verrousDeCloture`
(`src/core/constat.ts:152`) garde clos ce que la collecte reconstate, et ne réarme que ce qui a cessé.
C'est ce qui rend une clôture groupée tenable : elle ne sera pas défaite à la première nuit.

**Ce qui manque, et qui est le sujet du ticket.**

- Le dépôt ne contient **aucune action multiple** : pas un seul `formData.getAll` dans `src`. Ce lot
  écrit le premier, et fixe donc un précédent.
- `actionTracee` (`src/lib/actions.ts:30`) n'expose pas de `correlationId`, alors que `AuditInput` le
  porte déjà (`src/core/audit.ts:9`) et que le journal sait déjà filtrer par exécution
  (`src/app/journal/criteres.ts:131`). Rien ne relie donc quinze traces d'un même geste.
- `INACTIVE_STARTUP` **ignore totalement** `ScopeOverride` : le `select` de la collecte
  (`src/lib/sync/executer.ts:159`) ne le lit pas et `PersonneConstatable` (`src/core/constat.ts:28`) ne
  le porte pas. Exclure quinze personnes ne vide pas la file, et la collecte de la nuit les reconstate.

**Les pièges déjà repérables :**

- `ouvrirDepart` se termine par `redirect`, qui lève une exception `NEXT_REDIRECT`. Une boucle qui
  l'appellerait s'arrêterait au premier tour. Le lot doit donc rappeler les trois primitives de
  `src/lib/depart.ts` sous son propre `actionTracee`.
- `ouvrirDossierDeDepart` (`src/lib/depart.ts:119`) garantit l'unicité par un `findFirst` applicatif, pas
  par une contrainte de base : `DepartureCase` ne porte aucun `@@unique` sur `personId`. Deux lots
  concurrents peuvent créer deux dossiers vivants pour la même personne.
- `forcerAppartenance` fait un `upsert` qui ne refuse jamais. Passée en lot, elle écrase la raison,
  l'auteur et la date d'une surcharge existante, y compris une `INCLUDE` posée la veille par quelqu'un
  d'autre pour une bonne raison.
- Une personne `DECLARED` ou `BOTH` (équipe transverse) ne lève jamais `INACTIVE_STARTUP`
  (`src/core/constat.ts:73`), et l'exclure fabrique la contradiction que la fiche signale déjà sous
  « Deux autorités se contredisent » (`src/app/personnes/[username]/motifs.ts:212`).
- `actionTracee` écrit une trace `SUCCESS` **avant** l'écriture et une trace `FAILURE` en cas
  d'exception. Une personne dont l'écriture échoue laisse donc deux événements. Le récapitulatif à
  l'écran doit compter des personnes, jamais des événements.

## Décisions de conception

**Trois gestes distincts, jamais un geste qui en fait deux.** Déclarer hors incubateur, ouvrir les
dossiers de départ, clore les constats. Chacun a son bouton, sa raison saisie une fois, sa confirmation
et son récapitulatif. Le ticket dit déjà que les deux premiers ne se remplacent pas. Le troisième est
ajouté parce que sans lui la file `/constats` reste pleine après le traitement, et l'opérateur croit
avoir fini. Mais il reste **séparé** : une clôture qui suivrait automatiquement une exclusion
reproduirait exactement ce que la docstring de `forcerAppartenance` interdit. On veut que fermer un écart
soit un acte que quelqu'un a posé et signé, pas la retombée d'un autre.

**Une action serveur par geste, qui boucle côté serveur.** Pas N appels depuis le client : il ne sait
pas sérialiser quinze aller-retours sans perdre l'ordre, la raison commune et la moitié des erreurs, et
chaque appel repaierait la barrière de session et une revalidation complète.

**Un `actionTracee` par personne, jamais un pour N.** C'est le seul chemin qui tient l'invariant du
dépôt, une trace nominative écrite avant l'action. Un événement qui dirait « quinze personnes sorties »
ne se réexamine pas. La boucle vit **à l'intérieur** de l'action de lot, autour de `actionTracee`, et
jamais l'inverse.

**`ActionTracee` gagne un `correlationId` optionnel**, recopié dans la trace. L'action de lot tire un
`randomUUID()` et le passe à chacun de ses appels. Le journal devient alors capable de rendre le lot
entier par son filtre d'exécution existant, sans nouvelle colonne ni nouvel écran. C'est le seul
changement de socle du ticket, il est additif et ne touche aucun appelant existant.

**La raison commune est recopiée dans le `after` de chaque événement**, avec le ghid de la startup et
l'identifiant de lot. Chaque événement se lit alors seul, sans avoir à remonter au lot, ce que le ticket
exige explicitement.

**Le `targetId` reste le username.** Le filtre du journal par personne cherche l'égalité ou le suffixe
`:<username>` (`src/app/journal/criteres.ts:143`) : un `targetId` de la forme `startup:<ghid>` ferait
disparaître l'événement de l'histoire de la personne, qui est justement là qu'on le cherchera.

**Les erreurs sont isolées par personne.** Un `try/catch` autour de chaque `actionTracee`, et surtout pas
une transaction unique sur les N personnes : une personne supprimée en base entre l'affichage et la
soumission ne doit pas annuler les quatorze autres.

**Le résultat est structuré, et la modale ne se ferme pas toute seule.** Les actions du dépôt rendent
`null` en cas de succès et `useFermetureApresSucces` (`src/ui/modale.ts:13`) ferme alors la modale. Une
action de lot ne peut pas suivre ce contrat : elle rendrait un succès en cachant ses échecs. Elle rend
donc `{ traites, dejaOuverts, echecs }` et laisse l'opérateur fermer après lecture.

**Pas de `redirect` après un lot de départs.** `redirect` ne sait viser qu'un dossier, et en choisir un
arbitrairement ferait perdre les quatorze autres. Le récapitulatif liste les liens vers les dossiers
créés.

**Rien ne se décide tout seul.** Une phase terminale ne sort personne : c'est ce qui sépare le constat de
la décision. La sélection par défaut ne coche que les personnes qui portent un `INACTIVE_STARTUP` ouvert
et aucune surcharge d'appartenance. Restent décochées, mais visibles et cochables à la main, avec leur
motif affiché : les transverses, celles qui ont déjà un dossier vivant, celles qui portent déjà une
surcharge, et celles qui appartiennent encore à une autre startup vivante ou de phase inconnue.

**Une phase inconnue ailleurs interdit de conclure ici.** Si un membre est aussi rattaché à une startup
dont la phase n'est pas connue, il n'est pas proposé par défaut. C'est le garde-fou du moteur de constats
rejoué à l'écran, et l'oublier reviendrait à sortir quelqu'un sur une supposition.

**Le troisième choix est offert au même prix que la sortie.** Le ticket le demande en toutes lettres :
une startup terminale ne veut pas dire que la personne est partie, elle travaille peut-être ailleurs. La
liste porte donc par ligne un accès au rattachement vers une autre startup, celui de l'issue #2, à côté
des cases à cocher. Une liste qui ne proposerait que sortir ou faire partir serait une sortie automatique
déguisée avec une case à cocher.

**La sélection passe par des cases à cocher natives de même `name`**, lues par `formData.getAll`, plus un
champ `raison` unique et un champ caché portant le ghid. C'est la forme HTML native, elle survit sans
JavaScript, et le dépôt n'a aucun précédent qui la contredise.

### Tension avec `docs/architecture.md`

Aucune modification demandée. Le document décrit déjà le journal nominatif préalable (§ audit), la
distinction entre constat et décision, et le fait qu'une phase inconnue interdit de conclure. Ce plan
applique ces trois règles sans les amender. Le `correlationId` est un champ que le modèle d'audit porte
déjà.

Un point mérite d'être **signalé sans être tranché ici** : `INACTIVE_STARTUP` ignore `ScopeOverride`,
si bien qu'une personne déclarée hors incubateur continue d'être constatée chaque nuit. Faire lire la
surcharge par le moteur serait plus juste sur le fond, mais c'est une décision d'architecture qui déborde
ce ticket. Le geste de clôture groupée est le contournement assumé, et le verrou de clôture le rend
durable tant que la situation dure.

## Modèle de données

**Aucune migration Prisma.** `ScopeOverride`, `DepartureCase`, `Plan` et `Finding` existent et suffisent.

Un seul changement de socle, additif : `correlationId?: string` dans `ActionTracee`
(`src/lib/actions.ts:6`), recopié dans l'objet `trace` (ligne 33). Aucun appelant existant ne le passe,
aucun ne change de comportement.

## Découpage en étapes

### Étape 1. Le lot devient traçable comme un lot

Ajouter `correlationId?: string` à `ActionTracee` et le recopier dans la trace. Vérifiable : les
appelants existants compilent sans changement, et une trace posée sans corrélation reste identique à ce
qu'elle était.

### Étape 2. Le noyau de répartition et ses tests

Fichier modifié : `src/core/startups.ts`. Tout ce qui décide qui est proposé, qui est écarté et pourquoi
se calcule ici, hors de Prisma et hors de React.

```ts
export type RaisonEcarte =
  | "EQUIPE_TRANSVERSE"
  | "AUTRE_STARTUP_VIVANTE"
  | "PHASE_INCONNUE_AILLEURS"
  | "DOSSIER_DEJA_OUVERT"
  | "SURCHARGE_EXISTANTE"
  | "DEJA_SORTI";

export interface CandidatDeLot {
  username: string;
  fullname: string;
  statut: Statut;
  proposeParDefaut: boolean;
  ecarte: RaisonEcarte | null;
  autresStartupsVivantes: readonly string[];
  constatOuvert: string | null;
}

export function repartirLeLot(
  ghid: string,
  membres: readonly MembreDeLot[],
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
  aujourdHui: Date,
  seuils: StatutOptions,
): CandidatDeLot[];

export function resumeDuLot(resultats: readonly ResultatParPersonne[]): ResumeDeLot;
```

`LIBELLE_ECARTE` accompagne `RaisonEcarte`, sur le modèle des tables de libellés du dépôt, pour que
l'écran dise pourquoi une ligne n'est pas proposée plutôt que de la présenter sans explication.

### Étape 3. Les trois actions de lot

Fichier créé : `src/app/startups/[ghid]/actions.ts`.

```ts
export async function declarerHorsIncubateurEnLot(_etat, formData): Promise<EtatLot>;
export async function ouvrirDepartsEnLot(_etat, formData): Promise<EtatLot>;
export async function cloreConstatsEnLot(_etat, formData): Promise<EtatLot>;
```

Chacune lit `formData.getAll("username")`, un `raison` et un `startup` caché, tire un `correlationId`,
puis boucle. Dans la boucle, un `actionTracee` par personne, avec le même verbe que le geste unitaire
correspondant (`personne.appartenance.forcee`, `depart.ouverture`, `finding.close`), le username en
`targetId`, et `after` portant la raison, le ghid et l'identifiant de lot.

`ouvrirDepartsEnLot` rappelle `ouvrirDossierDeDepart`, `calculerPlanDeDepart` et `enregistrerPlan` dans
l'`ecrire`, exactement comme `ouvrirDepart`, mais sans `redirect` et en distinguant `deja: true`, qui
n'est ni un succès ni un échec.

`cloreConstatsEnLot` relit les `dedupKey` des `INACTIVE_STARTUP` ouverts des personnes visées depuis la
base, jamais depuis le formulaire, et tolère qu'un constat soit déjà clos sans faire échouer le lot.

Revalidation : `/startups`, `/startups/<ghid>`, `/personnes`, `/constats`, `/` et la fiche de chaque
personne traitée.

### Étape 4. L'écran

Fichiers créés : `src/app/startups/[ghid]/TraitementDuLot.tsx` (client) et sa section serveur.

La section n'apparaît que sur une startup en phase terminale ou sortie de l'incubateur qui a encore des
membres. Elle porte un tableau avec case à cocher par ligne, le statut, le motif d'appartenance, la
surcharge en cours s'il y en a une, l'existence d'un dossier vivant, le constat ouvert, et l'accès au
rattachement vers une autre startup. Trois boutons ouvrent trois modales distinctes, chacune avec sa
raison et son récapitulatif à trois blocs.

Une seule modale par geste, jamais une par ligne : `createModal` enregistre un identifiant global par
module, et N modales de même identifiant cassent le retour de focus.

## Tests

Fichier : `src/core/startups.test.ts`, en complément des scénarios de #6.

**6. Le lot propose ceux pour qui la question se pose, et écarte les autres en le disant.** Given une
startup en phase `abandon` portant six membres : une personne dont c'est la seule startup et qui porte un
`INACTIVE_STARTUP` ouvert, une transverse rattachée par équipe, une qui appartient aussi à une startup en
`acceleration`, une qui appartient aussi à une startup de phase inconnue, une qui a déjà un dossier de
départ vivant, et une qui porte déjà une surcharge d'appartenance. Then une seule est proposée par
défaut, les cinq autres sont présentes avec leur raison, et aucune n'est absente de la liste.

**7. Le récapitulatif compte des personnes, pas des événements.** Given douze traitées, deux dont le
dossier était déjà ouvert et une en échec. Then le résumé rend douze, deux et une, l'échec nomme la
personne et sa raison, et le total des trois vaut le nombre de personnes soumises.

## Risques et pièges

**Une clôture qui suivrait l'exclusion viderait la file sans que personne ne l'ait décidé.** C'est le
risque central du ticket. La séparation des trois gestes est ce qui l'empêche, et elle n'est pas
négociable.

**Un `upsert` en lot écrase une décision antérieure.** Les personnes portant déjà une surcharge sont
écartées de la sélection par défaut et leur surcharge est affichée : reposer une décision doit rester un
choix, pas une conséquence de la case cochée par défaut.

**Deux lots concurrents peuvent créer deux dossiers vivants pour la même personne**, l'unicité étant
applicative. Le risque est faible à cette échelle et il préexiste au ticket ; le signaler ici évite de le
découvrir en production.

**Le récapitulatif ne doit jamais se réduire à une alerte d'erreur.** Une seule alerte laisserait croire
que tout a échoué là où quatorze personnes sur quinze ont été traitées.

**La liste des membres n'est pas « qui travaille sur cette startup ».** Une personne rattachée par équipe
n'est jamais dans `Person.startups`. La section le dit, et c'est aussi pourquoi les transverses ne sont
pas proposées par défaut.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build. Au delà, sur une base collectée :

1. Un lot de trois exclusions produit trois événements nominatifs au journal, portant le même
   identifiant de lot, chacun avec la raison commune et le ghid.
2. Le filtre du journal par personne fait bien apparaître l'événement de chacune des trois.
3. Un lot de départs sur une personne ayant déjà un dossier vivant la range dans « déjà ouvert » et ne
   crée pas de second dossier.
4. La modale reste ouverte sur un échec partiel et nomme la personne en échec.
5. Après une clôture groupée, `pnpm sync` ne rouvre pas les constats clos tant que la startup reste
   terminale.
6. Aucune écriture n'a touché `Person.startups`.

## Ce que l'implémentation a tranché autrement

**Pas de modale, un seul formulaire à trois boutons.** Le plan prévoyait trois modales. Elles auraient
multiplié les identifiants globaux de `createModal` sur un même écran, et surtout une modale se ferme :
or le récapitulatif à trois blocs est précisément ce qu'il faut pouvoir relire après coup. La sélection
et la raison se saisissent donc une fois dans un formulaire unique, et chaque bouton porte son
`formAction` vers son action serveur. Rien n'enchaîne les trois gestes, ce qui était l'exigence.

**La présélection ne dépend pas du constat ouvert.** Le plan cochait d'avance les personnes portant un
`INACTIVE_STARTUP`. Mais ce constat n'existe qu'après le passage de la collecte : l'écran n'aurait rien
eu à proposer le jour même où une phase bascule, c'est-à-dire le jour où il sert. Sont donc proposées
celles dont rien ne retient le traitement, et le constat ouvert s'affiche à côté comme confirmation.
Les gardes qui écartent rejouent le raisonnement du moteur sans le dupliquer : elles appellent
`estPhaseTerminale`, le prédicat que le moteur de constats emploie lui-même.

**Le noyau vit dans `src/core/startups.ts`** et non dans un module dédié : `repartirLeLot` a besoin des
mêmes types que l'assemblage des membres, et les séparer aurait obligé à exporter la moitié de l'un
vers l'autre.
