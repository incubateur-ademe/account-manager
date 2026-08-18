# Dire à quel titre une personne appartient au périmètre (#3)

> Plan d'implémentation de l'issue #3. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

### Deux axes, une valeur homonyme

`Person` porte deux colonnes qui répondent à deux questions différentes
(`prisma/schema.prisma:104-105`) :

- `source` (`PersonSource`) dit d'où vient la fiche : `BETA`, `LOCAL`, `SERVICE`.
- `attachment` (`Attachment`) dit à quel titre la personne est dans le périmètre : `STARTUPS`,
  `DECLARED`, `BOTH`, `LOCAL` (`prisma/schema.prisma:82-87`).

`LOCAL` existe donc des deux côtés avec deux sens qui n'ont rien à voir. Le ticket le montre par
l'exemple, et le code le confirme : `src/app/comptes-isoles/creer.ts:96` écrit
`attachment: "LOCAL"` pour une fiche saisie à la main, `src/app/comptes-isoles/actions.ts:143`
fait de même pour une fiche recopiée depuis l'espace-membre hors incubateur, et
`src/lib/sync/perimetre.ts:203` l'écrit pour une personne déclarée dans `scope.local`. Trois
situations, une seule valeur, et l'écran qui l'affiche
(`src/app/personnes/[username]/page.tsx:59-62`) n'en décrit qu'une : « Suivie localement, avec une
échéance saisie à la main dans la politique », ce qui ne vaut que pour la troisième.

`attachment` est par ailleurs le seul des deux à être écrit par la collecte : `upsert()`
(`src/lib/sync/perimetre.ts:52-81`) le réécrit à chaque passage depuis ce que l'espace-membre
constate, via la table de correspondance de `src/core/membre.ts:79-83`.

### Le libellé est une table de correspondance, pas un calcul

Deux tables, dupliquées, toutes deux typées `Record<string, ...>` :
`src/app/personnes/[username]/page.tsx:44-63` et `src/app/personnes/page.tsx:39-44`. Le typage par
`string` est le piège central du ticket : une valeur ajoutée à l'enum Prisma ne casse aucun
typecheck, elle tombe simplement dans le repli `?? personne.attachment`
(`src/app/personnes/[username]/page.tsx:297`, `src/app/personnes/page.tsx:155`) et l'écran affiche
la valeur brute de l'enum. Le libellé peut aussi contredire les données sans que rien ne le
signale : `src/app/personnes/[username]/page.tsx:370-376` affiche « Par startup » puis, juste en
dessous, une alerte disant qu'aucune startup n'est rattachée.

### Les trois redéclarations manuelles du type `Attachment`

Recensées, comme le demande la Definition of Ready :

1. `src/core/perimetre.ts:1` : `export type Attachment = "STARTUPS" | "DECLARED" | "BOTH" | "LOCAL";`
2. `src/core/constat.ts:22` : la même union, réécrite à la main dans `PersonneConstatable`.
3. `src/lib/sync/perimetre.ts:43` : la même union, réécrite à la main dans `PersonneResolue`.

Aucune des trois ne dérive de l'enum Prisma. Ajouter une valeur au schéma laisse les trois
mentir en silence, et les deux tables de libellés en `Record<string, ...>` avalent le reste. Le
précédent existe pourtant dans le dépôt : `src/core/audit.ts:1` et `src/lib/sync/perimetre.ts:9`
importent déjà `ActorKind` et `PersonSource` depuis `@/generated/prisma/enums`.

### Ce qui dépend d'`attachment` en dehors de l'affichage

Un seul endroit décide quelque chose : `src/core/constat.ts:60`, où `INACTIVE_STARTUP` ne se lève
que si `attachment === "STARTUPS"`. Le reste (`SCOPE_EXIT` dans `src/core/constat.ts:34-45`,
`ORPHAN` dans `src/core/constat.ts:224-233`) est piloté par `vanishedAt`, jamais par
l'appartenance. Autrement dit, aujourd'hui l'appartenance est un axe d'affichage plus un garde-fou
de constat, et rien d'autre.

### Ce qui manque

- Aucun moyen de dire « cette personne est des nôtres » quand aucune startup ni aucune équipe ne
  le porte : coach, personne rattachée à l'incubateur sans produit précis, prestataire suivi à la
  main.
- Aucun moyen de sortir quelqu'un du périmètre depuis l'outil. Le seul geste de sortie est le
  retrait de `scope.transverse` dans le YAML (`src/core/policy.ts:182-189`), qui suppose d'avoir
  la main sur le fichier de politique.
- Le défaut de la colonne, `@default(STARTUPS)` (`prisma/schema.prisma:105`), affirme un
  rattachement par startup pour toute fiche créée sans le préciser. Aujourd'hui les trois sites
  d'écriture le passent explicitement, donc personne ne s'en aperçoit.

## Décisions de conception

**D1. `Attachment` reste ce que l'espace-membre constate, et `LOCAL` y est renommé `NONE`.**
Le ticket interdit d'ajouter une valeur, il n'interdit pas d'en renommer une. La collision de
noms entre les deux axes est le premier symptôme cité par le ticket, et la laisser en place
condamne le prochain lecteur à se demander, devant `attachment: "LOCAL"`, de quel axe on parle.
Après renommage, l'enum se lit d'un trait : l'espace-membre rattache par startup (`STARTUPS`), par
équipe (`DECLARED`), par les deux (`BOTH`), ou pas du tout (`NONE`). Aucune valeur ajoutée, le
champ ne documente toujours qu'un fait constaté. Le défaut de colonne passe à `NONE` : en
l'absence d'observation, la voie constatée est « aucune », et non « par startup ».
*Si cette décision est refusée*, tout le reste du plan tient sans elle : il suffit de garder
`LOCAL` et de le documenter comme « aucune voie constatée ». Seules l'étape 2 et une ligne de la
§2.3 changent.

**D2. L'appartenance est calculée, jamais stockée.** Un nouveau module `src/core/appartenance.ts`
porte une fonction pure `appartenanceDe()` qui rend un motif, un libellé et les faits qui le
justifient. C'est le pendant de `src/core/statut.ts`, calculé et jamais persisté
(`docs/architecture.md` §4.1). Rien ne s'ajoute à `Person`.

**D3. Toutes les tables de libellés deviennent exhaustives.** `Record<Attachment, ...>` et
`Record<MotifAppartenance, ...>` au lieu de `Record<string, ...>`. Sous `@tsconfig/strictest`,
une clé d'union littérale n'est pas une signature d'index : l'accès rend la valeur sans
`undefined`, les replis `?? personne.attachment` disparaissent, et l'ajout d'une valeur d'enum
casse le typecheck au lieu de passer au travers. C'est la réponse structurelle à la Definition of
Ready.

**D4. Ordre de lecture des sources, écrit noir sur blanc.**

1. **Surcharge de sortie** posée par un opérateur : hors incubateur, quoi que dise le reste.
2. **Surcharge d'entrée** posée par un opérateur : dans l'incubateur.
3. **Rattachements en cours**, collectés ou manuels, sans préséance entre eux : startups portées
   par `Person.startups`, startups portées par un rattachement manuel en cours (issue #2),
   rattachement par équipe constaté par l'espace-membre (`DECLARED` ou `BOTH`).
4. Sinon : hors incubateur.

La liste transverse du YAML n'apparaît pas dans cet ordre, et c'est volontaire : la collecte la
matérialise déjà en `attachment = DECLARED` (`src/lib/sync/perimetre.ts:165-186`). Elle est donc
lue au rang 3, sous sa forme constatée, et il n'y a pas deux chemins à maintenir.

**D5. Une surcharge l'emporte sur la collecte, et n'efface jamais ce que la collecte dit.**
`appartenanceDe()` rend en plus le motif qu'auraient donné les seuls faits (`sansSurcharge`).
Quand les deux diffèrent, l'écran affiche les deux : « Hors incubateur, sortie forcée par
alex.martin le 3 mars 2026. L'espace-membre la rattache pourtant par startup. » Une surcharge qui
masquerait la réalité serait pire que pas de surcharge du tout : elle deviendrait un bandeau sur
les yeux que plus personne ne penserait à retirer. Quand les deux coïncident, la surcharge est
devenue superflue et l'écran propose de la retirer, sans jamais la retirer tout seul : une
décision nominative ne s'annule pas par une collecte anonyme.

**D6. Une surcharge dit l'appartenance, elle n'ordonne rien.** Elle ne pose aucun `vanishedAt`,
n'ouvre ni ne ferme aucun constat, ne rend aucune identité révocable ni non révocable, ne touche
aucun système cible. Sortir quelqu'un du périmètre, c'est dire « ce n'est pas des nôtres » ; ce
qui coupe des accès reste le dossier de départ, avec son plan, sa confirmation et son journal.
Corollaire opérationnel : une personne sortie par surcharge reste dans les listes et ses comptes
continuent d'être examinés par les constats. Sans cette règle, la surcharge de sortie deviendrait
le moyen le plus rapide de faire disparaître un écart gênant.

**D7. La surcharge est un objet décidé, hors de `Person`.** Nouveau modèle `ScopeOverride`, un par
personne au plus, avec sa décision, sa raison obligatoire, son auteur et sa date. Le mettre en
colonnes sur `Person` mélangerait du décidé dans une table de constaté, ce que le ticket refuse
explicitement pour `Attachment` et qui vaut tout autant pour le reste de la table. L'historique
n'est pas dupliqué en base : il vit dans le journal, conformément à `docs/architecture.md` §3.4,
et le geste de retrait supprime la ligne.

**D8. Pas d'échéance sur une surcharge.** Le cas type du ticket, quelqu'un rattaché à l'incubateur
sans être sur une startup précise, n'a pas de date de fin naturelle, et lui en inventer une
reviendrait à recréer le défaut de `scope.local.until`, une date que personne ne rafraîchit. Le
risque d'une surcharge qui vieillit est réel mais borné : elle ne prolonge aucun accès, puisque
l'échéance et le statut restent calculés depuis `missionEnd` (`src/core/statut.ts:32-58`).

**D9. Une phase terminale ne sort personne du périmètre.** La Definition of Done demande ce cas
limite. Réponse : quelqu'un dont toutes les startups sont terminées reste dans l'incubateur, et le
libellé cesse simplement d'affirmer sans nuance : « Par startup, toutes terminées ». Le fait
d'avoir à agir est déjà porté par `INACTIVE_STARTUP` (`src/core/constat.ts:52-86`), et le décider
une seconde fois dans la dérivation créerait deux vérités sur le même sujet. Pour qu'elles ne
puissent pas diverger, le prédicat de phase terminale est extrait dans `src/core/appartenance.ts`
et `src/core/constat.ts` l'importe, garde-fou de phase inconnue compris.

**D10. Un rattachement annoncé sans startup connue ne fait sortir personne.**
`attachment = STARTUPS` avec `startups` vide est déjà signalé à l'écran
(`src/app/personnes/[username]/page.tsx:370-376`). Basculer cette personne hors du périmètre
reviendrait à l'en sortir sur la foi d'une collecte peut-être tronquée, ce qui est exactement ce
que refuse la règle « un run non `ok` ne pose aucun `vanishedAt` » (`docs/architecture.md` §2.2).
La dérivation rend donc `dans: true` avec un drapeau `sansStartupConnue`, et le libellé porte la
nuance au lieu de la trancher.

### Tension avec `docs/architecture.md`

§2.3 (lignes 158-162) donne **une seule autorité** sur l'appartenance, la liste transverse du
YAML, et pose que l'en retirer est le geste qui sort quelqu'un du périmètre. La surcharge en crée
une seconde. Le ticket assume cette seconde autorité et demande deux choses : que ce soit
documenté, et que le geste de sortie existe des deux côtés. Ce plan les tient ainsi :

- côté YAML, le geste existe déjà et ne change pas : retirer de `scope.transverse` ;
- côté outil, la surcharge de sortie est le geste symétrique, tracé et réversible ;
- quand les deux se contredisent (surcharge de sortie sur quelqu'un que la politique déclare
  transverse), l'écran affiche la contradiction et nomme le geste manquant, plutôt que de laisser
  la collecte nocturne rétablir en silence un rattachement qu'un opérateur a explicitement retiré.

§2.3 ligne 156 énumère par ailleurs les valeurs de l'enum et devra suivre le renommage. §3.2 et
§3.3 gagnent `ScopeOverride` du côté décidé. **Ces modifications sont à valider explicitement
avant d'être écrites** (voir étape 6).

## Modèle de données

Deux changements, une seule migration : `prisma/migrations/<horodatage>_appartenance_forcee/`.

**1. Renommage de la valeur d'enum et du défaut de colonne.**

```prisma
enum Attachment {
  STARTUPS
  DECLARED
  BOTH
  NONE
}
```

```prisma
  attachment         Attachment   @default(NONE)
```

**2. La surcharge, côté décidé.**

```prisma
enum ScopeDecision {
  INCLUDE
  EXCLUDE
}

model ScopeOverride {
  id String @id @default(cuid())

  personId String        @unique
  decision ScopeDecision
  reason   String

  createdBy String
  createdAt DateTime @default(now())

  person Person @relation(fields: [personId], references: [id], onDelete: Cascade)
}
```

et sur `Person`, la relation inverse : `scopeOverride ScopeOverride?`.

`@unique` sur `personId` porte l'invariant « une surcharge en cours au plus » dans le schéma
plutôt que dans le code appelant. La raison est obligatoire, comme celle d'une clôture de constat
ou d'une dérogation : une décision d'appartenance sans motif est une décision qu'on ne saura pas
réexaminer.

**La migration se génère en deux temps, et le SQL du renommage s'écrit à la main.**

```
pnpm exec prisma migrate dev --create-only --name appartenance_forcee
```

Prisma rend un changement de valeur d'enum par une suppression suivie d'une recréation, ce qui
perdrait la colonne. Remplacer la partie enum du fichier généré par :

```sql
ALTER TYPE "Attachment" RENAME VALUE 'LOCAL' TO 'NONE';
ALTER TABLE "Person" ALTER COLUMN "attachment" SET DEFAULT 'NONE'::"Attachment";
```

Le renommage est atomique et ne réécrit aucune ligne : les fiches qui portaient `LOCAL` portent
`NONE` sans qu'une seule mise à jour ne passe sur la table. Garder le reste du fichier généré
(création de `ScopeDecision`, de `ScopeOverride`, index unique, clé étrangère), puis appliquer
avec `pnpm db:migrate`.

**Après cette migration : `pnpm db:generate`, puis redémarrer `pnpm dev`.** Les deux caches se
cumulent, comme le rappellent les consignes du dépôt. Le symptôme exact à attendre si l'un des deux est oublié
est `Value 'NONE' not found in enum 'Attachment'`, alors que la base et le schéma sont pourtant
justes.

## Découpage en étapes

### Étape 1. Une seule déclaration du type `Attachment`

Sans migration, sans changement de comportement. On supprime les trois redéclarations et on les
remplace par le type généré depuis le schéma.

- `src/core/appartenance.ts` (nouveau, réduit à ceci pour l'instant) :
  `export type { Attachment } from "@/generated/prisma/enums";`, en `import type` pour que rien du
  client généré ne soit chargé à l'exécution des tests.
- `src/core/perimetre.ts` : suppression de la ligne 1, le module ne garde que `declaresManquants`.
- `src/core/membre.ts` : import depuis `@/core/appartenance` au lieu de `./perimetre`.
- `src/core/constat.ts` : `PersonneConstatable.attachment` prend le type importé.
- `src/lib/sync/perimetre.ts` : `PersonneResolue.attachment` prend le type importé.

Vérifiable : `pnpm typecheck` passe, et
`grep -rn '"STARTUPS" | "DECLARED"' src --include='*.ts'` ne rend plus rien.

### Étape 2. La migration

- `prisma/schema.prisma` : renommage de la valeur, défaut de colonne, `ScopeDecision`,
  `ScopeOverride`, relation inverse sur `Person`.
- La migration, SQL du renommage écrit à la main comme ci-dessus.
- `pnpm db:generate`, redémarrage du serveur de développement.
- Les trois sites d'écriture passent de `"LOCAL"` à `"NONE"` : `src/lib/sync/perimetre.ts:203`,
  `src/app/comptes-isoles/creer.ts:96`, `src/app/comptes-isoles/actions.ts:143`.
- Les deux tables de libellés provisoirement rectifiées pour ne pas afficher une valeur brute
  entre l'étape 2 et l'étape 4 ; elles disparaissent à l'étape 4.

Vérifiable : `pnpm typecheck`, puis en base
`select unnest(enum_range(null::"Attachment"));` qui rend `STARTUPS, DECLARED, BOTH, NONE`, et
`select attachment, count(*) from "Person" group by 1;` qui ne perd aucune ligne.

### Étape 3. Le noyau de dérivation

`src/core/appartenance.ts`, pur, sans accès base ni Prisma runtime.

```ts
export interface Surcharge {
  sens: ScopeDecision;
  par: string;
  depuis: Date;
  raison: string;
}

export interface EtatAppartenance {
  attachment: Attachment;
  startupsCollectees: readonly string[];
  startupsManuelles: readonly string[];
  surcharge: Surcharge | null;
}

export type MotifAppartenance =
  | "INCLUSION_FORCEE"
  | "EXCLUSION_FORCEE"
  | "EQUIPE_ET_STARTUP"
  | "EQUIPE"
  | "STARTUP"
  | "STARTUP_MANUELLE"
  | "AUCUN";

export interface Appartenance {
  dans: boolean;
  motif: MotifAppartenance;
  startups: readonly string[];
  sansStartupConnue: boolean;
  toutesStartupsTerminees: boolean;
  surcharge: Surcharge | null;
  sansSurcharge: MotifAppartenance;
}

export function appartenanceDe(
  etat: EtatAppartenance,
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
): Appartenance;

export function toutesLesStartupsSontTerminees(
  startups: readonly string[],
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
): boolean;

export function surchargeSuperflue(appartenance: Appartenance): boolean;

export const LIBELLE_APPARTENANCE: Record<MotifAppartenance, { libelle: string; precision: string }>;

export function libelleAppartenance(
  appartenance: Appartenance,
): { libelle: string; precision: string };
```

`libelleAppartenance()` part de la table et y replie les nuances qui, seules, empêchent le libellé
de contredire les données : « aucune startup connue » quand `sansStartupConnue`, « toutes
terminées » quand `toutesStartupsTerminees`, et la mention de ce que dit la collecte quand
`sansSurcharge` diffère du motif retenu.

`src/core/constat.ts` remplace son test de phases terminales en ligne (lignes 71-77) par un appel
à `toutesLesStartupsSontTerminees`, garde-fou de phase inconnue compris. Le comportement ne change
pas ; c'est ce qui garantit que l'écran et le constat ne pourront jamais diverger.

Vérifiable : `src/core/appartenance.test.ts` (voir plus bas) et `src/core/constat.test.ts` qui
reste vert sans être modifié.

### Étape 4. Lecture en base et affichage

- `src/lib/appartenance.ts` (nouveau) : assemble un `EtatAppartenance` depuis une ligne Prisma,
  charge les phases des startups concernées, et rend l'`Appartenance`. C'est le seul endroit qui
  connaît la forme des lignes.
- `src/app/personnes/[username]/page.tsx` : suppression de la table `RATTACHEMENT` (lignes 44-63)
  et du repli ligne 297. Le champ devient « Appartenance », suivi de la précision calculée.
  L'alerte des lignes 370-376 est réécrite depuis `sansStartupConnue`, plutôt que depuis un test
  sur la valeur d'enum. Un encart apparaît quand une surcharge existe : son sens, son auteur, sa
  date, sa raison, ce que dit la collecte si elle dit autre chose, et le bouton de retrait.
- `src/app/personnes/page.tsx` : suppression de la table `RATTACHEMENT` (lignes 39-44), colonne
  « Rattachement » renommée « Appartenance ». La requête ligne 70 gagne `scopeOverride` et les
  rattachements manuels, et une lecture des startups pour les phases. Dix-neuf startups et quatre-
  vingt-quinze personnes : une requête de plus, pas de N+1.

Vérifiable : `pnpm build`, puis lecture des deux écrans avec un jeu comprenant une personne par
motif.

### Étape 5. Poser et retirer une surcharge

- `src/app/personnes/[username]/actions.ts` (existant, où vit déjà `detacherIdentite`) gagne
  `forcerAppartenance` et `libererAppartenance`. Les deux passent par `actionTracee`
  (`src/lib/actions.ts:30`), qui vérifie la session, journalise nominativement, puis écrit : la
  trace précède l'action, sans exception. Actions journalisées :
  `personne.appartenance.forcee` et `personne.appartenance.liberee`, `targetType: "personne"`,
  `targetId: username`, ce qui les fait remonter telles quelles dans l'historique d'une personne
  (`src/app/journal/criteres.ts:65-74`). `before` porte le motif courant, `after` porte le sens et
  la raison.
- Écriture : `prisma.scopeOverride.upsert()` sur `personId` pour la pose, `delete` pour le
  retrait. `revalider: ["/personnes", "/personnes/<username>", "/"]`.
- Refus explicites, rendus comme les autres actions du dépôt (`{ erreur: string } | null`) :
  personne inconnue, raison vide, sens non reconnu.
- `src/app/personnes/[username]/Appartenance.tsx` (nouveau, client) : formulaire de pose avec
  raison obligatoire, sur le modèle de `Detacher.tsx`, et bouton de retrait. Le libellé du bouton
  dit ce qu'il fait : « Forcer dans l'incubateur », « Sortir du périmètre », « Retirer la
  surcharge ».
- `src/app/journal/libelles.ts:9-27` : deux entrées, « Appartenance forcée » et « Surcharge
  d'appartenance retirée ».

Vérifiable : poser une surcharge, la voir sur la fiche avec l'auteur et la date, la retrouver dans
`/journal?personne=<username>`, la retirer, retrouver les deux événements.

### Étape 6. Documentation

À proposer et faire valider avant écriture, le document ne se modifie pas sans accord explicite :

- §2.3 : la valeur `NONE` remplace `LOCAL` dans l'énumération (ligne 156) ; un paragraphe pose que
  l'appartenance est **calculée** et non stockée, donne l'ordre de lecture de D4, et documente la
  seconde autorité avec son geste de sortie symétrique.
- §3.2 : `Attachment` décrit comme la voie constatée par l'espace-membre, « aucune » comprise.
- §3.3 : `ScopeOverride` rejoint la famille du décidé, avec la règle « elle dit l'appartenance,
  elle n'ordonne rien ».

## Tests

`src/core/appartenance.test.ts`, cinq scénarios, chacun avec plusieurs assertions. Noms de
personnes fictifs (`alex.martin`, `camille.roux`, `prestataire.exemple`). Aucun accès base : la
dérivation est pure, c'est tout l'intérêt de l'avoir sortie du rendu.

**1. L'ordre de lecture décide de l'appartenance.**
*Étant donné* cinq personnes : rattachée par startup, par équipe, par les deux, par un
rattachement manuel seul, et par rien du tout. *Quand* on dérive leur appartenance. *Alors*
`dans` vaut vrai pour les quatre premières et faux pour la dernière, les motifs sont
respectivement `STARTUP`, `EQUIPE`, `EQUIPE_ET_STARTUP`, `STARTUP_MANUELLE`, `AUCUN`, la liste
`startups` réunit collectées et manuelles sans doublon, et les libellés diffèrent deux à deux.

**2. Une surcharge d'entrée porte un nom et une date, et n'efface pas les faits.**
*Étant donné* une personne qu'aucune startup ni aucune équipe ne rattache. *Quand* un opérateur
la force dans le périmètre. *Alors* `dans` vaut vrai, le motif est `INCLUSION_FORCEE`, la
surcharge rendue porte l'auteur, la date et la raison, `sansSurcharge` vaut toujours `AUCUN`, et
le libellé dit que l'appartenance est forcée.

**3. Une surcharge de sortie l'emporte sur la collecte, et le dit.**
*Étant donné* une personne que l'espace-membre rattache par équipe et par startup. *Quand* un
opérateur la sort du périmètre. *Alors* `dans` vaut faux, le motif est `EXCLUSION_FORCEE`,
`sansSurcharge` vaut `EQUIPE_ET_STARTUP`, la liste des startups reste rendue telle quelle, et le
libellé mentionne à la fois la sortie forcée et ce que la collecte constate.

**4. Une startup terminale ne fait sortir personne, mais le libellé cesse d'affirmer.**
*Étant donné* une personne dont l'unique startup est en phase terminale, une deuxième dont une
startup sur deux est terminale, et une troisième dont la phase n'a pas été collectée. *Quand* on
dérive. *Alors* les trois restent dans le périmètre avec le motif `STARTUP`,
`toutesStartupsTerminees` ne vaut vrai que pour la première, la phase inconnue interdit de
conclure pour la troisième, et seul le libellé de la première porte la mention « toutes
terminées ».

**5. Une surcharge que la collecte a rattrapée se signale comme superflue.**
*Étant donné* une personne sortie du périmètre par surcharge, puis une collecte qui cesse de la
rattacher (`attachment` à `NONE`, plus aucune startup). *Quand* on dérive. *Alors* `dans` vaut
toujours faux, `sansSurcharge` vaut `AUCUN`, `surchargeSuperflue()` vaut vrai, et la surcharge
reste rendue avec son auteur : rien ne l'a retirée toute seule.

Un cas limite supplémentaire est couvert au passage dans le scénario 1 : `attachment` annonçant
`STARTUPS` sans qu'aucune startup ne soit connue rend `dans: true` et `sansStartupConnue: true`.

`src/core/constat.test.ts` sert de test de non-régression pour l'extraction du prédicat de phase
terminale : il doit rester vert sans être touché.

## Risques et pièges

**La migration générée détruit la colonne si on ne réécrit pas son SQL.** C'est le piège le plus
cher du lot : `prisma migrate dev` rend un changement de valeur d'enum par une suppression suivie
d'une recréation du type. Sur une base de développement on s'en aperçoit, en production on
s'aperçoit qu'il est trop tard. Le `--create-only` puis la réécriture en `ALTER TYPE ... RENAME
VALUE` ne sont pas un raffinement.

**Le renommage et le code partent ensemble.** Après migration, un binaire de la version
précédente écrivant `'LOCAL'` échoue. Un retour arrière du code seul casse la collecte au premier
`upsert` de personne hors incubateur.

**Le double cache Prisma.** `migrate dev` applique en base sans toujours régénérer le client, et
le client est mis en cache sur `globalThis` pour survivre au rechargement à chaud. `pnpm
db:generate` puis redémarrage, sinon `Value 'NONE' not found in enum 'Attachment'` sur une base
pourtant juste.

**La surcharge de sortie comme bandeau sur les yeux.** C'est le risque de conception principal, et
D6 est là pour lui. Toute évolution ultérieure qui filtrerait les listes ou les constats sur
l'appartenance dérivée réintroduirait le problème : quelqu'un de sorti du périmètre par un geste
humain cesserait d'être examiné, et ses comptes ouverts avec lui.

**Deux autorités qui se contredisent en silence.** Surcharge de sortie sur quelqu'un que
`scope.transverse` déclare : la collecte nocturne réécrit `attachment = DECLARED` à chaque
passage. Rien n'est cassé, mais si l'écran n'affiche pas la contradiction, un opérateur croira
avoir sorti quelqu'un que la politique continue de réclamer. D5 est ce qui rend la situation
visible ; la perdre en refactorant l'affichage la rendrait indétectable.

**La dépendance à l'issue #2.** Tant que le rattachement manuel à une startup n'existe pas,
`startupsManuelles` est toujours vide : la dérivation reste juste, mais la contrepartie promise
par le ticket, qu'une personne de `scope.local` puisse recevoir un rattachement comme n'importe
qui, n'est pas tenue. Le paramètre existe dès l'étape 3 pour que le branchement soit une ligne, et
le plan #02 reste le préalable fonctionnel.

**La colonne `Person.startups` est réécrite chaque nuit**, y compris remise à vide pour les
personnes de `scope.local` (`src/lib/sync/perimetre.ts:195-207`). Aucun rattachement manuel ne
doit jamais y être écrit, sous peine de disparaître à la première collecte. C'est le fondement de
l'issue #2, rappelé ici parce que c'est la tentation naturelle quand on branche la dérivation.

**`ACTIONS_ENABLED` n'entre pas en jeu**, et c'est le point à ne pas perdre : rien dans ce ticket
ne touche un système cible, donc rien n'a à consulter ce drapeau. Le jour où l'on serait tenté de
faire découler une coupure d'une surcharge de sortie, on serait dans un tout autre ticket, avec
plan, empreinte et confirmation.

**La révocabilité ne se dérive pas de l'appartenance.** L'invariant « une identité `HEURISTIC` ou
`NONE` ne peut jamais produire une révocation » est porté par le socle : `autoriseUneRevocation()`
(`src/core/rapprochement.ts:29`) en est la seule définition, et `systemesDuDepart()`
(`src/core/depart.ts:121`) s'en sert pour répartir les systèmes d'un départ entre `revocables`,
`observes` et `nonConfirmes` avant tout calcul d'étapes (`src/lib/depart.ts:29-41`). Ce ticket ne
crée aucune étape de plan et n'a rien à y ajouter : D6 pose déjà qu'une surcharge ne rend aucune
identité révocable ni non révocable. Faire dépendre cette répartition de l'appartenance dérivée
rouvrirait l'écart que ces deux symboles ferment.

## Vérification

Au-delà de `pnpm verify` et du `/verif` complet (lint, typecheck, tests, build) :

1. **Plus une seule redéclaration** :
   `grep -rn '"STARTUPS" | "DECLARED"' src --include='*.ts'` et
   `grep -rn 'Record<string, ' src/app/personnes` ne rendent rien.
2. **Plus une seule valeur brute affichable** : les deux écrans compilent sans repli
   `?? personne.attachment`. Ajouter mentalement une valeur à l'enum doit casser le typecheck, ce
   qui se vérifie en l'ajoutant réellement dans une branche jetable et en constatant l'erreur sur
   `LIBELLE_APPARTENANCE`.
3. **La base a bien renommé, pas recréé** : `select unnest(enum_range(null::"Attachment"));` rend
   les quatre valeurs attendues, et le compte de `Person` par `attachment` est identique avant et
   après migration.
4. **La surcharge se voit** : sur une fiche, poser une entrée forcée avec une raison, recharger,
   lire le sens, l'auteur, la date et la raison. Le libellé de la liste des personnes dit la même
   chose que celui de la fiche.
5. **La trace précède l'action** : dans `/journal?personne=<username>`, l'événement
   `personne.appartenance.forcee` porte le nom de l'opérateur, en `SUCCESS`, avec la raison dans
   `after`. Couper la base pendant l'écriture métier doit laisser une seconde ligne en `FAILURE`,
   comportement déjà porté par `actionTracee`.
6. **La collecte ne défait rien** : lancer `pnpm sync` après avoir posé une surcharge, vérifier
   qu'elle est toujours là, que `attachment` a bien été réécrit par la collecte, et que la fiche
   affiche les deux quand ils se contredisent.
7. **Le geste symétrique fonctionne** : retirer la surcharge, vérifier que l'appartenance
   redevient celle des faits et que le journal porte les deux événements.
8. **Rien n'a bougé du côté des constats** : le nombre de constats ouverts est identique avant et
   après la pose d'une surcharge de sortie, et `INACTIVE_STARTUP` se lève toujours dans les mêmes
   conditions qu'avant l'extraction du prédicat.
