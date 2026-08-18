# Brancher les dérogations (#15)

> Plan d'implémentation de l'issue #15. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

**Le modèle existe en base et personne ne le lit.** `Derogation` (`prisma/schema.prisma:448-461`)
porte `targetType`, `targetId`, `reason`, `createdBy`, `createdAt`, `expiresAt`, plus deux index,
`(targetType, targetId)` et `expiresAt`. La table est créée depuis la migration initiale
(`prisma/migrations/20260808000000_init/migration.sql:261-270`, index aux lignes 399 et 402). Aucun
fichier de `src/` n'appelle `prisma.derogation` : le client généré l'expose, rien ne s'en sert.

**La dérogation permanente est déclarée et pas lue non plus.** `derogationSchema`
(`src/core/policy.ts:97-126`) exige `targetType`, `targetId`, `reason` et `owner`.
`permanentDerogations` (`src/core/policy.ts:338-354`) s'annonce en toutes lettres comme réservé,
« aucun code ne le lit encore ». Une entrée complète figure dans le modèle
(`config/config.exemple.yaml:60-67`) et `pnpm policy:check` en imprime le décompte
(`src/cli/verifier-politique.ts:26`). Tout est prêt sauf le branchement.

**Le point d'insertion dans la réconciliation est unique, et le voici.** `syncConstats`
(`src/lib/sync/constats.ts:100-210`) est le seul endroit où un constat naît, se rouvre ou se ferme.
Sa mécanique tient en cinq temps : la liste du jour est assemblée à partir des trois sources pures
(`:109-113`), indexée par `dedupKey` (`:114`) ; les constats ouverts sont relus (`:116-120`) ; les
constats clos à la main sont départagés par `verrousDeCloture` (`:125-141`) ; ce qui manque est
ouvert ou rouvert par `upsert` avec une trace `finding.open` (`:144-191`) ; ce qui n'est plus dans la
liste du jour est fermé avec la raison unique « ne se vérifie plus à la collecte » (`:193-207`). Une
dérogation qui retire un constat de la liste du jour hérite donc gratuitement de la fermeture des
constats déjà ouverts. C'est le point d'insertion, et il n'y en a pas d'autre.

**Chaque constat porte déjà une clé qui nomme sa cible, mais pas la bonne.** Les cinq clés sont
`SCOPE_EXIT:<username>` (`src/core/constat.ts:41`), `INACTIVE_STARTUP:<username>` (`:82`),
`ORPHAN:<provider>:<handle>` (`:227`), `UNREGISTERED:<provider>:<handle>` (`:239`) et
`OVERDUE_MANUAL_ACTION:<systemKey>:<username>` (`:199`). Les deux clés de compte sont bâties sur le
`handle`, qui change au renommage : `IdentiteConstatable` (`src/core/constat.ts:142-153`) ne porte
pas l'`externalId`, alors que la base, elle, est unique sur `(provider, externalId)`
(`prisma/schema.prisma:183`). Une dérogation posée sur un `handle` mourrait au premier renommage,
sans rien dire.

**Le calcul d'un plan est une fonction du constaté, et il tourne quatre fois.**
`calculerPlanDeDepart` (`src/lib/depart.ts:62-109`) lit les systèmes où la personne a une identité
vivante via `systemesDeLaPersonne` (`:29-41`), qui délègue la répartition à `systemesDuDepart`
(`src/core/depart.ts:121-143`) et rend `revocables`, `observes` et `nonConfirmes` ; seuls les
`revocables` appellent un connecteur. Il demande ensuite à chaque connecteur concerné son intention
de retrait, et rend les étapes avec leur empreinte. Il est appelé à l'ouverture du dossier
(`src/app/departs/actions.ts:49-50`), à l'affichage (`src/app/departs/[id]/page.tsx:96`), à la
confirmation (`src/app/departs/[id]/actions.ts:59-63`) et au recalcul
(`src/app/departs/[id]/actions.ts:257-261`). Le gel, lui, est ailleurs : `enregistrerPlan`
(`src/lib/depart.ts:150-191`) recopie la photo de chaque étape en base.

**Un plan confirmé est déjà protégé, sans rien ajouter.** L'empreinte
(`src/core/plan.ts:12-31`) est comparée au recalcul par `peremptionDuPlan` (`:48-57`), et
`peutConfirmer` (`src/core/depart.ts:28-50`) refuse tout ce qui n'est pas un brouillon frais et
concordant. Les étapes d'un plan confirmé sont figées en base et jamais recalculées : la décision
actée du ticket, « la dérogation joue au calcul », est donc déjà tenue par la construction. Il n'y a
rien à écrire pour cela, seulement à ne rien casser.

**Un brouillon que la réalité a démenti a désormais une issue.** `peutRecalculer` et
`etatDUnPlanRemplace` (`src/core/depart.ts:153-173`) autorisent le remplacement d'un brouillon périmé
ou obsolète, jamais d'un plan engagé, et l'action serveur `recalculerPlan`
(`src/app/departs/[id]/actions.ts:244-288`), tracée sous `depart.recalcul`, écrit le nouveau plan
après avoir passé l'ancien en `EXPIRED` ou `STALE`. Le bouton correspondant, `BoutonRecalculer`
(`src/app/departs/[id]/Pointage.tsx:117-136`), s'affiche dans les deux alertes de péremption et
d'obsolescence. C'est ce qui rend supportable, pour ce lot, qu'une pose de dérogation démente les
brouillons en vol.

**La granularité réelle d'une étape est le couple (système, personne), pas le compte.** Le
connecteur `github` rend une étape par organisation (`src/connectors/github.ts:222-247`), avec
`params: { organisation, username }` et une clé d'idempotence `github:<org>:revoke:<username>`,
suffixée de l'identifiant du plan à l'écriture (`src/lib/depart.ts:182`), et non de celui du
dossier : cette clé est unique sur toute la table, donc deux plans successifs d'un même dossier ne
peuvent pas porter les mêmes. Rien dans une étape ne désigne le compte observé. Toute règle
d'exclusion doit donc s'exprimer à cette granularité, faute de quoi elle prétendrait épargner un
compte précis alors qu'elle épargnerait le système entier pour cette personne.

**L'écriture tracée existe en un seul exemplaire.** `actionTracee` (`src/lib/actions.ts:30-56`)
vérifie la session, journalise nominativement, puis écrit, et consigne un second événement en échec
si l'écriture casse. `cloreConstat` (`src/app/constats/actions.ts:36-48`) en est le modèle exact
pour une pose de dérogation. Le vocabulaire du journal se déclare dans
`src/app/journal/libelles.ts:9-38`, et le filtre par personne repose sur la convention « la cible
nomme la personne en fin d'identifiant » (`src/app/journal/criteres.ts:65-74`).

**Pièges vérifiés dans le code.**

- **L'invariant `HEURISTIC` est tenu par le socle, et il l'est en un seul endroit.** `rapprocher`
  rend toujours un `personId` avec la méthode `HEURISTIC` (`src/core/rapprochement.ts:180-185`) et
  `rapprocherIdentites` l'écrit tel quel (`src/lib/sync/rapprochement.ts:72-83`), mais la règle qui
  décide ce qu'un rattachement autorise vit désormais dans `METHODES_REVOCABLES` et
  `autoriseUneRevocation` (`src/core/rapprochement.ts:23-31`). Le calcul du plan la consomme via
  `systemesDuDepart` (`src/core/depart.ts:121-143`), la collecte via `rattachementSur`
  (`src/lib/sync/executer.ts:187`). Une personne dont le seul compte GitHub a été rattaché par
  ressemblance ne se voit donc plus proposer « retirer cette personne de l'organisation » : son
  système sort en `nonConfirmes` et le dossier le dit à l'écran. La file de rattachement manuel fait
  toujours son travail (`src/app/comptes-isoles/page.tsx:26-30`). Ce plan n'a plus rien à rétablir
  ici, seulement à ne pas contourner la fonction.
- **Le message d'obsolescence affirme une cause qu'il ne connaît pas.**
  `src/app/departs/[id]/page.tsx:128-143` dit « Une collecte est passée depuis son calcul » (`:136`),
  alors que l'écart d'empreinte pourra désormais venir d'une dérogation posée ou expirée. Le plan de
  l'issue #10 relève déjà la même phrase, pour une autre raison.
- **Un `externalId` peut contenir un deux-points.** Une invitation GitHub sans login est enregistrée
  sous `email:<adresse>` (`src/connectors/github.ts:123-126`). Toute lecture d'une cible
  `<provider>:<externalId>` doit donc découper au premier deux-points, jamais aux suivants.
- **L'identifiant interne d'une identité n'est pas reconstructible.** `docs/architecture.md` section
  3.4 pose que tout se rejoue depuis les connecteurs sauf le journal, les dérogations et l'état
  décidé. Un `cuid` d'`ExternalIdentity` change à la reconstruction : une dérogation qui le
  désignerait cesserait de couvrir quoi que ce soit, en silence.
- **Aucun test ne touche la base.** Les treize fichiers de test vivent dans `src/core` et
  `src/app/journal`, et sont purs. Tout ce qui doit être testé doit donc être exprimé en fonctions
  pures.
- **La navigation est une liste en dur** (`src/ui/Navigation.tsx:7-16`) : un écran de plus s'y
  déclare à la main.

## Décisions de conception

**D1. Une cible est un couple (type, identifiant), et deux types suffisent.** `identite` désigne
`<provider>:<externalId>`, `personne` désigne un `username`. La clé de comparaison est la
concaténation `<type>:<id>`, donc `identite:github:12345678` ou `personne:prenom.nom`. Le même
vocabulaire sert au YAML et à la base, à l'écran et au journal. Ferme le point de la DoR sur la
désignation de la cible.

**D2. La cible d'un compte se désigne par son `externalId`, jamais par son `handle` ni par son
identifiant interne.** Le `handle` change au renommage et la dérogation cesserait de couvrir sans
que rien ne le dise ; le `cuid` ne survit pas à une reconstruction de la base (section 3.4 de
l'architecture). `(provider, externalId)` est la seule clé stable et déjà unique en base
(`prisma/schema.prisma:183`). Conséquence assumée pour le YAML : l'identifiant ne se devine pas, il
se relève à la première collecte, exactement comme pour les identités d'un compte de service
(`src/core/policy.ts:78-85`).

**D3. Correspondance constat vers cible, et un constat non dérogeable.**

| Constat | Cible qui le couvre |
|---|---|
| `SCOPE_EXIT` | `personne:<username>` |
| `INACTIVE_STARTUP` | `personne:<username>` |
| `ORPHAN` | `identite:<provider>:<externalId>` |
| `UNREGISTERED` | `identite:<provider>:<externalId>` |
| `OVERDUE_MANUAL_ACTION` | aucune |

Un constat n'a qu'une cible, jamais deux : une dérogation sur une personne ne tait pas les constats
de ses comptes, et l'inverse non plus. `OVERDUE_MANUAL_ACTION` n'est pas dérogeable parce qu'il
n'accuse pas un accès mais une déclaration : quelqu'un a dit « fait » et la lecture suivante dit le
contraire. Le taire effacerait la seule contrepartie que l'outil oppose à une case cochée
(`src/core/constat.ts:177-185`). La clôture manuelle motivée reste disponible pour ce cas, elle
existe déjà.

**D4. Sur le plan, l'exclusion joue au couple (système, personne), et seulement si tout est
couvert.** Un système est écarté du calcul pour une personne quand toutes ses identités vivantes et
sûres sur ce système sont couvertes par une dérogation en cours. S'il en reste une non couverte, le
système reste au plan en entier : le connecteur ne sait pas produire une étape par compte
(`src/connectors/github.ts:222-247`), et prétendre épargner un compte en épargnant le système
reviendrait à laisser ouvert un accès que personne n'a admis. Une dérogation de type `personne`
n'écarte jamais aucune étape : elle tait un constat de périmètre, elle ne vide pas un offboarding.

**D5. L'invariant du rapprochement sûr est un acquis, et la lecture des dérogations part de lui.**
La règle vit dans `METHODES_REVOCABLES` et `autoriseUneRevocation` (`src/core/rapprochement.ts:23-31`)
et nulle part ailleurs ; ce lot ne la réécrit pas et ne la recopie pas. Conséquence directe pour les
dérogations : la couverture d'un système se juge sur les seules identités révocables de la personne,
donc sur celles que `systemesDuDepart` (`src/core/depart.ts:121-143`) place dans `revocables`. Une
identité rattachée par ressemblance ne compte ni comme couverte ni comme bloquante, puisqu'elle
n'aurait de toute façon produit aucune étape : la faire peser d'un côté ou de l'autre ferait mentir
le décompte. La conséquence concrète, une pose qui change les empreintes des brouillons en cours,
est traitée par le recalcul et non par une exception.

**D6. La dérogation joue au calcul, et le calcul le dit.** Rien n'est à ajouter pour protéger un plan
confirmé (voir plus haut), mais deux textes doivent changer de bouche : le message d'obsolescence
(`src/app/departs/[id]/page.tsx:128-143`) cesse d'affirmer qu'une collecte est passée, et le dossier
affiche ce qui a été écarté. Le bouton de recalcul déjà présent dans cette alerte reste la sortie
offerte à un brouillon démenti, quelle que soit la cause de l'écart.

**D7. Une exclusion silencieuse est pire que l'écart qu'elle admet.** Tout endroit qui tait quelque
chose le dit : le dossier de départ liste les systèmes écartés avec la raison, le responsable et
l'échéance ; l'écran des constats indique combien d'écarts sont couverts et par quoi ; la sortie de
`pnpm sync` compte les constats couverts au même titre que les ouverts et les fermés. Un offboarding
amputé sans mention aurait l'air complet, ce qui est exactement la panne que cet outil existe pour
éviter.

**D8. Temporaire en base, permanente en YAML, une seule lecture.** Une fonction unique rend les
dérogations en cours, en fusionnant les lignes de la base et les entrées de
`permanentDerogations`. La forme de cible est la même des deux côtés ; seules diffèrent l'échéance
(nulle pour une permanente) et la façon de la retirer. Une permanente ne se lève pas depuis
l'interface : l'écran affiche sa provenance et renvoie au fichier, parce que le déclaré vit en git et
se relit dans un diff (`docs/architecture.md` section 1.4). Ferme le point de la DoR sur
l'articulation des deux.

**D9. Le responsable est `createdBy` en base et `owner` en YAML, sans colonne supplémentaire.**
L'outil n'a qu'une classe d'acteur, l'équipe transverse, et aucune délégation dans cette version
(`docs/architecture.md` section 6). Ajouter un second nom produirait un champ que personne ne peut
faire agir, à côté d'un nom qui, lui, est vérifié par la session. Celui qui pose répond de ce qu'il
pose ; à la demande de qui il l'a posé se dit dans la raison, qui est obligatoire.

**D10. Lever n'est pas supprimer, ni avancer l'échéance.** La levée écrit `revokedAt` et
`revokedBy`. Supprimer la ligne contredirait l'immuabilité du décidé et la liste des trois familles
non reconstructibles (`docs/architecture.md` sections 3.3 et 3.4). Ramener `expiresAt` à maintenant
rendrait une dérogation levée indiscernable d'une dérogation périmée, alors que l'une est un geste
signé et l'autre un simple écoulement du temps.

**D11. L'échéance est obligatoire, inclusive, et plafonnée.** La saisie est un jour au format
`AAAA-MM-JJ`, stocké à la fin de ce jour dans le fuseau de Paris : le dernier jour couvert est
couvert en entier, comme une fin de mission est le dernier jour travaillé
(`docs/architecture.md` section 4.1), et l'écart réapparaît le lendemain. La conversion passe par le
fuseau de Paris, jamais par une troncature de chaîne, pour la raison déjà écrite dans
`src/core/membre.ts:46-52`. Le plafond est de 180 jours, constante du cœur au même titre que
`VALIDITE_JOURS` (`src/lib/depart.ts:16`) : une tolérance de trois ans est une tolérance permanente
qui n'a pas voulu dire son nom, et le YAML est là pour les vraies permanentes.

**D12. Le verrou de clôture manuelle se calcule sur les constats non filtrés.** `verrousDeCloture`
(`src/core/constat.ts:124-140`) reçoit la liste complète, dérogations comprises. Le verrou dit « la
situation que cet opérateur a jugée traitée dure encore » ; une dérogation ne fait pas cesser la
situation, elle fait cesser le signalement. Passer la liste filtrée réarmerait des constats clos à la
main pour une raison qui n'a rien à voir avec eux.

**D13. La pose ferme immédiatement le constat qu'elle couvre, sans poser `closedBy`.** Attendre la
nuit laisserait la ligne à l'écran, et l'opérateur croirait son geste sans effet. La fermeture porte
la raison « couvert par une dérogation », constante partagée avec la réconciliation, et laisse
`closedBy` nul : ce n'est pas le jugement d'un traitement, c'est une tolérance, et la distinction
compte pour le réarmement décrit en D12.

**D14. Rien à toucher côté environnement ni côté systèmes cibles.** Aucune variable nouvelle, donc
aucun ajout au schéma Zod de `src/lib/env.ts`. Une dérogation n'appelle aucun système :
`ACTIONS_ENABLED` reste hors sujet et `RunContext.dryRun` inchangé. Poser une dérogation retire une
action d'un plan, cela n'en ajoute jamais.

**D15. Tension avec `docs/architecture.md` : aucune, et deux ajouts à proposer.** Le document décrit
déjà le mécanisme (sections 1.4, 3.1, 3.3 et 3.4) et ce plan s'y conforme sans exception. Deux
choses n'y figurent pas et mériteront deux phrases : le vocabulaire des cibles (les deux types
autorisés, et le fait qu'une dérogation ne couvre jamais une révocation qu'elle n'a pas nommée), et
la levée avec sa trace. Le ticket n'exige aucune mise à jour documentaire dans sa DoD ; la
proposition sera soumise à l'utilisateur et n'est pas appliquée par ce lot, le document ne se
modifiant pas sans validation explicite.

## Modèle de données

**Une seule migration, additive, sans reprise de données.** Deux colonnes nullables sur un modèle qui
ne contient aucune ligne aujourd'hui.

```prisma
model Derogation {
  id String @id @default(cuid())

  targetType String
  targetId   String
  reason     String

  createdBy String
  createdAt DateTime @default(now())
  expiresAt DateTime

  /// Une dérogation levée n'est pas une dérogation supprimée : elle appartient au
  /// décidé, qui ne se reconstruit depuis aucune collecte. Et elle n'est pas non plus
  /// une dérogation dont on aurait avancé l'échéance, qui ne se distinguerait plus
  /// d'une tolérance simplement périmée.
  revokedAt DateTime?
  revokedBy String?

  @@index([targetType, targetId])
  @@index([expiresAt])
}
```

Aucun index supplémentaire : la lecture des dérogations en cours ramène quelques dizaines de lignes
au plus, et `expiresAt` est déjà indexé. `targetType` et `targetId` restent des chaînes libres en
base ; c'est le cœur qui fait respecter le vocabulaire, du même geste pour les deux sources.

Nom de migration proposé : `derogations_levables`, dans la lignée de
`20260818161504_marche_a_suivre_figee`.

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`.** Les deux caches se
cumulent : `prisma migrate dev` applique bien la migration en base sans toujours régénérer le client
de `src/generated/prisma`, et ce client est mis en cache sur `globalThis`, donc il survit à la
régénération et sert des métadonnées périmées. Le symptôme attendu ici est `Unknown argument
'revokedAt'` au premier appel, avec un typecheck qui passe.

**Côté politique, une seule modification de schéma, sans migration.** `targetType` passe de
`z.string().min(1)` à `z.enum(["identite", "personne"])` dans `derogationSchema`
(`src/core/policy.ts:99-105`), et l'exemple de `targetId` devient un identifiant relevé à la
collecte. L'entrée existante du modèle (`config/config.exemple.yaml:60-67`) reste valide, son
`targetType` valant déjà `identite` ; seul son `targetId` change de forme, avec le commentaire qui
dit qu'il se relève et ne se devine pas. Les deux JSON Schema se régénèrent par `pnpm policy:schema`
et ne s'écrivent jamais à la main (`src/cli/schema-politique.ts:8-16`).

## Découpage en étapes

**1. Le schéma et la politique.** Ajouter `revokedAt` et `revokedBy`, générer et appliquer la
migration, régénérer le client, redémarrer. Restreindre `targetType` dans le schéma Zod, mettre à
jour le modèle YAML et régénérer les JSON Schema. Vérifier par `pnpm policy:check` qu'un
`targetType` inconnu est refusé avec un message lisible.
Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_derogations_levables/migration.sql`,
`src/core/policy.ts`, `config/config.exemple.yaml`, `config/config.schema.json`.

**2. Le cœur des dérogations.** Nouveau module pur, sans dépendance à Prisma ni à la politique.

```ts
export type TypeDeCible = "identite" | "personne";

export interface Cible {
  type: TypeDeCible;
  id: string;
}

export interface Derogation {
  id: string | null;
  cible: Cible;
  raison: string;
  responsable: string;
  source: "base" | "politique";
  poseeLe: Date | null;
  expireLe: Date | null;
  leveeLe: Date | null;
}

export const DUREE_MAX_JOURS = 180;
export const RAISON_DE_FERMETURE = "couvert par une dérogation en cours";

export function cibleDIdentite(provider: string, externalId: string): Cible;
export function cibleDePersonne(username: string): Cible;
export function cleDeCible(cible: Cible): string;
export function lireCible(type: string, id: string): Cible | null;

export function enCours(
  derogations: readonly Derogation[],
  maintenant: Date,
): Map<string, Derogation>;

export function ecarterLesCouverts<T extends { cible: Cible | null }>(
  constats: readonly T[],
  couvertes: ReadonlyMap<string, Derogation>,
): { retenus: T[]; couverts: { constat: T; par: Derogation }[] };

export function systemesEcartes(
  identites: readonly { provider: string; externalId: string }[],
  couvertes: ReadonlyMap<string, Derogation>,
): Map<string, Derogation[]>;

export function poseAdmissible(
  saisie: { cible: Cible | null; raison: string; expireLe: Date | null },
  dejaCouverte: boolean,
  maintenant: Date,
): Verdict;
```

`enCours` écarte ce qui est levé et ce qui est expiré, une échéance nulle valant permanente.
`systemesEcartes` n'inscrit un système que si toutes les identités reçues sur ce système sont
couvertes (D4). `Verdict` est repris de `src/core/depart.ts:16-21` : ce type ne dit rien du départ,
et le dupliquer ferait deux vocabulaires du refus.
Fichiers : `src/core/derogation.ts`, `src/core/derogation.test.ts`.

**3. La cible portée par chaque constat.** `Constat` gagne `cible: Cible | null`,
`IdentiteConstatable` gagne `externalId`, et les cinq constructeurs posent leur cible selon la table
de D3. La collecte sélectionne l'`externalId` des identités et le passe au mapper
(`src/lib/sync/executer.ts:167-195`). Un helper exporté rend la cible d'un constat déjà persisté, à
partir de son `kind`, de son `person.username` et de son `externalIdentity`, pour que l'écran et le
calcul ne divergent jamais.
Fichiers : `src/core/constat.ts`, `src/core/constat.test.ts`, `src/lib/sync/executer.ts`.

**4. La lecture unifiée des deux sources.** Un module d'infrastructure rend
`derogationsEnCours(maintenant)` en fusionnant les lignes de la base (`revokedAt` nul) et les entrées
de `policy().permanentDerogations`, chacune convertie vers le type du cœur avec sa provenance. Une
entrée YAML dont le `targetType` ou la forme du `targetId` est illisible est écartée et signalée,
jamais tenue pour une couverture.
Fichiers : `src/lib/derogation.ts`.

**5. La réconciliation.** Dans `syncConstats`, lire les dérogations en cours, filtrer la liste du
jour par `ecarterLesCouverts`, indexer les retenus, passer la liste complète à `verrousDeCloture`
(D12), et fermer les constats disparus avec la bonne raison selon qu'ils étaient couverts ou qu'ils
ne se vérifient plus. `ConstatsResult` gagne `couverts`, que la ligne de journal de `pnpm sync`
imprime.
Fichiers : `src/lib/sync/constats.ts`, `src/lib/sync/executer.ts`.

**6. Le calcul du plan.** `systemesDeLaPersonne` (`src/lib/depart.ts:29-41`) sélectionne aussi
l'`externalId` des identités vivantes, pour que la couverture se juge sur la cible stable de D2. Le
filtre sur les méthodes sûres n'est pas à écrire : `systemesDuDepart` le fait déjà, et la couverture
se calcule sur ses `revocables` (D5). `calculerPlanDeDepart` demande les systèmes écartés au cœur,
saute les connecteurs concernés, et `PlanCalcule` gagne
`ecartees: readonly { systeme: string; par: Derogation }[]` à côté de `nonConfirmes`, qui existe
déjà. `sansConnecteur` porte déjà sur `observes`, donc sur les systèmes écartés comme sur les autres :
un compte toléré n'est pas un compte inconnu, et rien n'est à changer de ce côté.
Fichiers : `src/lib/depart.ts`.

**7. Poser et lever, tracé avant écriture.** Deux actions serveur passant par `actionTracee`, avec
les verbes `derogation.pose` et `derogation.levee`, `targetType: "derogation"` et `targetId` valant
la clé de cible, ce qui fait fonctionner sans rien ajouter le filtre par personne du journal
(`src/app/journal/criteres.ts:65-74`). La pose valide par `poseAdmissible`, écrit la ligne, puis
ferme le constat couvert s'il est ouvert (D13). La levée refuse une dérogation de la politique, une
dérogation déjà levée ou déjà expirée. Les deux libellés entrent au catalogue du journal, ainsi que
la cible `derogation`.
Fichiers : `src/app/derogations/actions.ts`, `src/app/journal/libelles.ts`.

**8. Les écrans.** Une page `/derogations` en deux tableaux : ce qui court, avec la cible rendue
lisible, la raison, le responsable, la provenance et l'échéance, plus le bouton de levée pour les
seules dérogations de base ; ce qui s'est éteint dans les trente derniers jours, levé ou expiré, qui
est la preuve visible du mécanisme anti-pourrissement. Entrée de navigation. Sur `/constats`, un
bouton « Tolérer » par ligne, à côté de la clôture, préremplissant la cible, et une mention du
nombre d'écarts couverts avec un lien. Sur le dossier de départ, une alerte listant les systèmes
écartés et pourquoi, sur le modèle de celle des systèmes sans connecteur
(`src/app/departs/[id]/page.tsx:184-191`) et de celle des comptes non confirmés (`:162-182`), et la
reformulation du message d'obsolescence (D6). Sur
la fiche d'une personne, un badge « toléré jusqu'au … » sur les comptes couverts, là où se décide une
coupure.
Fichiers : `src/app/derogations/page.tsx`, `src/app/derogations/PoseDerogation.tsx`,
`src/app/derogations/LeverDerogation.tsx`, `src/ui/Navigation.tsx`, `src/app/constats/page.tsx`,
`src/app/departs/[id]/page.tsx`, `src/app/personnes/[username]/page.tsx`.

## Tests

Tout ce qui décide vit dans `src/core` et se teste sans base, comme le reste du dépôt. Cinq
scénarios, chacun raconté en Given / When / Then et portant plusieurs assertions.

**1. Une tolérance tait un écart, et le rend le lendemain de son échéance.** Given un compte isolé
sur `github` et une personne sortie du référentiel, donc un `UNREGISTERED` et un `SCOPE_EXIT`. When
une dérogation couvre le compte jusqu'au 30 juin inclus, Then le constat de compte disparaît de la
liste retenue le 30 juin à 23 heures, le constat de personne y reste, et le couple retenu ou couvert
nomme la dérogation qui l'a tu. When on avance au 1er juillet, Then les deux constats sont de retour,
la couverture étant vide. When une dérogation permanente sans échéance couvre le même compte, Then il
reste tu quelle que soit la date. Emplacement : `src/core/derogation.test.ts`.

**2. Une dérogation levée cesse de couvrir, sans se confondre avec une dérogation périmée.** Given
une dérogation en cours et non échue. When elle est levée à une date antérieure à son échéance, Then
elle ne couvre plus rien, elle reste distincte d'une dérogation expirée dans ce qu'elle porte, et une
seconde dérogation posée sur la même cible reprend la couverture. Emplacement :
`src/core/derogation.test.ts`.

**3. Un système ne sort du plan que si tous ses comptes sont admis.** Given une personne avec deux
comptes vivants sur `github` et un sur `notion`. When une seule des deux identités GitHub est
couverte, Then `github` reste au plan et `notion` aussi. When la seconde est couverte à son tour,
Then `github` sort du plan en nommant les deux dérogations, et `notion` reste. When la couverture ne
vise qu'une personne et non un compte, Then aucun système ne sort. When une identité couverte a été
rattachée par ressemblance et n'est donc pas révocable, Then elle ne compte ni comme couverte ni
comme bloquante, parce qu'elle n'entre pas dans la liste des identités révocables. Emplacement :
`src/core/derogation.test.ts`.

**4. Chaque constat sait ce qui peut le taire, et un seul ne peut pas l'être.** Given les cinq
constats du produit, levés sur un jeu représentatif. Then `SCOPE_EXIT` et `INACTIVE_STARTUP` visent
la personne, `ORPHAN` et `UNREGISTERED` visent le compte par son `externalId` et non par son
`handle`, et `OVERDUE_MANUAL_ACTION` n'a aucune cible. Then une dérogation sur une personne ne tait
pas les constats de ses comptes, et l'inverse non plus. Then une dérogation quelconque ne tait jamais
la contradiction d'une action déclarée. Emplacement : `src/core/constat.test.ts`.

**5. Un plan confirmé ne bouge pas, un brouillon si.** Given un plan calculé sur deux systèmes, gelé
avec son empreinte. When une dérogation écarte l'un des deux et qu'on recalcule, Then l'empreinte
diffère, `peremptionDuPlan` déclare le plan obsolète et `peutConfirmer` refuse un brouillon dans cet
état. Then le même verdict tombe si la dérogation expire entre le calcul et la confirmation, dans
l'autre sens. Then un plan déjà confirmé reste refusé à la confirmation quoi qu'il arrive, et ses
étapes figées ne dépendent d'aucun recalcul. Then le brouillon démenti reste recalculable, ce que
`peutRecalculer` dit déjà et que le describe « recalcul d'un plan » de `src/core/depart.test.ts`
couvre : rien n'est à écrire pour cela, seulement à ne pas le casser. Emplacement :
`src/core/plan.test.ts` et `src/core/depart.test.ts`.

**6. Une pose inadmissible est refusée avant d'atteindre la base.** Then une raison vide, une
échéance passée, une échéance au-delà du plafond, une cible de forme inconnue et une cible déjà
couverte sont refusées, chacune avec sa propre raison. Then une pose au dernier jour admissible passe.
Emplacement : `src/core/derogation.test.ts`.

## Risques et pièges

**Le double cache Prisma.** Le typecheck passera pendant que le runtime refusera `revokedAt`.
`pnpm db:generate` puis redémarrage, sans exception.

**Le silence est le vrai danger de ce ticket.** Une étape retirée d'un offboarding sans mention
produit un dossier qui a l'air complet et des accès qui restent ouverts. C'est la raison d'être de
D7 : chaque endroit qui tait quelque chose doit le dire, et la vérification manuelle porte
là-dessus autant que sur le mécanisme lui-même.

**Une dérogation posée sur un compte rattaché par ressemblance.** Le socle garantit désormais
qu'aucune étape ne vise ce compte, par `autoriseUneRevocation` (`src/core/rapprochement.ts:23-31`) :
la dérogation n'a donc rien à y écarter, et l'écran de départ signale déjà ce compte parmi les
`nonConfirmes`. Le piège qui reste est de recopier la liste des méthodes ailleurs pour juger de la
couverture : elle ne se recopie pas, elle s'appelle.

**Les brouillons en vol.** Toute pose ou expiration change les empreintes et rend non confirmable
tout plan `DRAFT` existant, qui doit être recalculé. Le geste existe : `recalculerPlan`
(`src/app/departs/[id]/actions.ts:244-288`) et son bouton dans les deux alertes, si bien qu'un
brouillon démenti n'immobilise plus son dossier. Le parc en compte peu, et le message affiché est
aujourd'hui mensonger dans ce cas précis : sa reformulation fait partie du lot.

**Un compte supprimé puis recréé ne conserve pas sa tolérance.** Son `externalId` change, la
dérogation ne le suit pas, et l'écart réapparaît. C'est voulu, mais cela se découvre au mauvais
moment si personne ne l'a écrit : l'écran doit distinguer une cible jamais observée d'une cible
couverte, sans quoi une dérogation morte a l'air vivante.

**Une cible de politique qui ne correspond à rien.** Le YAML peut précéder la collecte, donc une
cible inconnue n'est pas une erreur bloquante ; elle ne doit pas non plus s'afficher comme si elle
couvrait quelque chose. Le décompte de `pnpm policy:check` reste le seul garde-fou côté fichier.

**Le découpage d'une cible.** `identite:github:email:quelquun@exemple.org` est une cible valide :
tout découpage doit s'arrêter au premier deux-points. Une comparaison de clés entières, sans
découpage, est préférable partout où c'est possible.

**Le journal précède l'écriture, y compris pour la levée.** Les deux gestes passent par
`actionTracee` (`src/lib/actions.ts:30-56`). Une levée écrite sans trace serait une tolérance dont
la fin n'aurait aucun auteur, ce qui vaut la tolérance elle-même.

**La fermeture automatique d'un constat couvert ne doit pas ressembler à une résolution.** Le
`finding.close` émis par la réconciliation porte aujourd'hui une raison unique
(`src/lib/sync/constats.ts:197`) ; sans la seconde raison, le journal dirait qu'un écart a cessé
d'être constaté alors qu'il a seulement cessé d'être signalé.

**Le réarmement des constats clos à la main.** Filtrer avant `verrousDeCloture` réarmerait des
constats qu'un opérateur a jugés traités, pour une raison étrangère à son jugement. C'est le genre de
régression qu'aucun écran ne montre.

**Les dérogations sont dans le périmètre de sauvegarde critique.** Aucune suppression physique,
jamais, y compris pour « faire le ménage » dans l'écran des dérogations éteintes.

**Une dérogation ne doit jamais pouvoir vider un plan de départ.** C'est l'usage détourné évident du
mécanisme, et la raison pour laquelle une cible `personne` n'a aucun effet sur le calcul. Toute
évolution future qui l'autoriserait doit repasser par une décision d'architecture.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build. Au-delà :

- La migration s'applique, `pnpm db:generate` et le redémarrage faits, la pose d'une dérogation
  fonctionne au premier essai plutôt que de rendre `Unknown argument 'revokedAt'`.
- `pnpm policy:check` accepte le modèle YAML mis à jour, refuse un `targetType` inconnu avec un
  message qui nomme le fichier et la clé, et compte toujours les dérogations permanentes.
- Cycle complet à la main, sur un constat de compte isolé : poser une dérogation depuis `/constats`,
  vérifier que la ligne disparaît immédiatement, que `/derogations` l'affiche avec sa raison, son
  responsable et son échéance, et que le journal montre la trace de pose avant la fermeture du
  constat, toutes deux nominatives.
- Relancer `pnpm sync` : la ligne de compte rendu affiche les constats couverts, le constat ne se
  rouvre pas, et le journal ne contient aucun `finding.open` pour lui.
- Lever la dérogation, relancer `pnpm sync` : le constat revient, la trace de levée précède
  l'écriture, et `/derogations` montre la dérogation dans le tableau des éteintes avec son auteur.
- Expiration : poser une dérogation dont le dernier jour couvert est la veille, relancer la collecte,
  vérifier que le constat est de retour. Une dérogation dont le dernier jour est aujourd'hui ne le
  fait pas revenir.
- Plan de départ : une personne dont tous les comptes d'un système sont couverts voit ce système
  absent des étapes et présent dans l'alerte, avec la raison et l'échéance. Un second compte non
  couvert sur ce système remet les étapes.
- Plan confirmé : confirmer un plan, poser ensuite une dérogation qui aurait écarté une de ses
  étapes, recharger le dossier. Les étapes affichées sont inchangées, et rien ne propose de
  reconfirmer.
- Non-régression de l'invariant de rapprochement : une personne dont le seul compte sur un système a
  été rattaché par ressemblance ne produit toujours aucune étape pour ce système, ce système figure
  toujours dans l'alerte des comptes non confirmés, et ce compte reste dans la file de rattachement
  manuel. Poser une dérogation sur lui ne change rien à ces trois points.
- Plan démenti : après une pose qui change l'empreinte, un brouillon devient non confirmable et le
  bouton de recalcul en produit un nouveau, l'ancien passant en `STALE` sans disparaître.
- `ACTIONS_ENABLED` reste à `false` du début à la fin, et aucun appel sortant n'a lieu : poser,
  lever et calculer ne touchent aucun système cible.
