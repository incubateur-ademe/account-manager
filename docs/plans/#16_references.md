# Brancher les références : inventaire des actifs possédés (#16)

> Plan d'implémentation de l'issue #16. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

**`Reference` existe en base et personne ne la touche.** Le modèle est à `prisma/schema.prisma:229-242`,
l'enum `OnOffboard` juste au-dessus (`prisma/schema.prisma:223-227`). Une recherche sur le dépôt entier
ne rend que trois occurrences hors code généré : la déclaration Prisma, la ligne `TODO.md:27`, et la
phrase de `docs/architecture.md:244`. **Aucun fichier de `src/` ne lit ni n'écrit cette table.** Le plan
de l'issue #1 en a d'ailleurs pris acte : sa fusion de fiches prévoit une branche pour les références
« pour ne pas laisser une cascade décider à notre place le jour où l'issue #16 la branchera »
(`docs/plans/#01_edition-fiche-manuelle.md:243-246`).

**Le modèle actuel ne peut pas porter ce que le ticket demande.** Trois manques, tous structurants.

1. `personId String` est obligatoire (`prisma/schema.prisma:232`). Un objet dont le propriétaire est
   un compte qu'aucune fiche ne réclame n'a donc pas de place, alors que c'est exactement le cas
   que la Definition of Ready demande de traiter.
2. Aucun horodatage. `Person`, `ExternalIdentity`, `AccessGrant` et `Startup` portent tous
   `firstSeenAt`, `lastSeenAt`, `vanishedAt` ; `Reference` n'a rien. Un objet collecté qui cesse
   d'exister n'aurait aucun moyen de le dire, et l'invariant « un run non `ok` ne fait rien
   disparaître » n'aurait même pas de colonne où s'appliquer.
3. Le lien vers le propriétaire passe par la personne et non par le compte, alors que **la collecte
   ne lit jamais une personne, elle lit un compte** : GitHub rend un login, Notion rend un identifiant
   d'utilisateur. Le rapprochement vers une fiche est un second temps, qui a son propre code
   (`src/lib/sync/rapprochement.ts`).

**Le contrat de collecte ne sait pas parler d'objets possédés.** `CollectPayload`
(`src/core/connector.ts:151-156`) porte `identities`, `resources` et `grants`, et rien d'autre.
`ObservedResource` (`src/core/connector.ts:132-136`) sait déjà dire le titre et l'URL d'un objet, ce qui
règle gratuitement une des Definition of Done : les métadonnées vivent sur `Resource`
(`prisma/schema.prisma:189-201`), et un objet partagé avec N personnes n'y duplique rien.
**La brique manquante n'est donc pas la ressource, c'est le lien de propriété.**

**Le socle de collecte a déjà tout le squelette.** `enregistrerRessources`
(`src/lib/sync/collecte.ts:82-104`) rend une table externalId vers identifiant interne, exactement ce
dont l'écriture des références aura besoin. `enregistrerAcces` (`src/lib/sync/collecte.ts:133-205`)
montre le traitement d'une contradiction de connecteur : un accès sur une ressource absente de la
collecte pousse une erreur unitaire et fait passer le run en `PARTIAL`
(`src/lib/sync/collecte.ts:162-169`, `293-295`). Le datage des disparitions est enfermé dans un
`if (status === "OK")` (`src/lib/sync/collecte.ts:300-326`), lui-même gardé par `chuteExcessive`
(`src/core/collecte.ts:10-15`). **Ce plan n'invente aucune de ces disciplines, il les étend.**

**Le plan de départ ne regarde que les systèmes où la personne a un compte vivant et sûrement
rattaché.** `systemesDeLaPersonne` (`src/lib/depart.ts:29-41`) filtre sur `vanishedAt: null` et passe
le résultat à `systemesDuDepart` (`src/core/depart.ts:121-143`), qui répartit les systèmes entre
`revocables`, `observes` et `nonConfirmes` ; `calculerPlanDeDepart` (`src/lib/depart.ts:62-109`)
ignore tout connecteur absent des `revocables`. C'est correct pour une révocation, et **faux pour une
référence** : une page créée par quelqu'un survit à la suppression de son compte. Les étapes de
référence ne peuvent donc pas naître dans cette boucle.

**L'étape manuelle existe déjà de bout en bout.** `ManualTask` (`src/core/connector.ts:176-182`) porte
`title`, `runbook`, `deeplink?` et `doneWhen`. `enregistrerPlan` (`src/lib/depart.ts:150-191`) la fige
dans `PlanStep.manual` (`prisma/schema.prisma:387-391`), l'écran la rend
(`src/app/departs/[id]/page.tsx:204-253`), et `github.plan` en produit une sans le moindre appel d'API
(`src/connectors/github.ts:223-249`). **Une étape de référence n'a donc aucun rendu à inventer.**

**Le pointage ne sait pas exiger une saisie.** `pointerEtape` (`src/app/departs/[id]/actions.ts:101-183`)
lit un champ `note` libre, l'exige au-delà de trois caractères pour `SKIPPED` et `FAILED`
(`:141-148`), et le range dans `PlanStep.lastError` (`:166`). Il n'y a ni champ typé, ni validation
d'un repreneur, ni vocabulaire pour dire qu'une étape attend autre chose qu'une case.

**Trois pièges déjà en place.**

1. **Une identité rapprochée par ressemblance porte quand même un `personId`.** `rapprocher` rend
   `{ personId: trouvee.id, serviceAccountId: null, methode: "HEURISTIC" }`
   (`src/core/rapprochement.ts:183`). Filtrer les références « de cette personne » sur le seul
   `personId` ferait donc entrer de la propriété devinée dans un plan de départ, sans que rien ne le
   signale. Le filtre doit lire `matchMethod`. Le socle porte maintenant cette règle en un seul
   point, `autoriseUneRevocation` (`src/core/rapprochement.ts:29-31`) sur `METHODES_REVOCABLES`
   (`:23-27`) : la lecture des références l'appelle plutôt que de recopier la liste des méthodes.
2. **`empreinteDuPlan` (`src/core/plan.ts:12-31`) hache `systemKey`, `capability`, `action`,
   `idempotencyKey` et `params`, ni le libellé ni l'ordre.** Changer le destin d'un objet déplacera
   l'empreinte et rendra un brouillon obsolète, ce qui est le comportement voulu ; renommer l'objet
   ne la déplacera pas, ce qui est voulu aussi.
3. **`PlanStep.idempotencyKey` est unique globalement** (`prisma/schema.prisma:399`) et
   `enregistrerPlan` la suffixe par l'identifiant du plan, tiré au moment de l'enregistrement
   (`src/lib/depart.ts:161` et `:182`). Deux plans successifs d'un même dossier ne se marchent donc
   plus dessus, mais l'unicité reste entière à l'intérieur d'un plan : chaque étape de référence doit
   produire une clé stable et distincte, sinon un dossier portant deux objets du même système lève
   une violation d'unicité au moment précis où on enregistre le plan.

**Aucun test du dépôt ne touche Prisma** (vérifié : aucun des douze fichiers `src/core/*.test.ts`
n'importe `prisma`, et il n'y a pas d'autre test ailleurs). Tout est testé sur des fonctions pures.
Ce plan s'y conforme, ce qui impose de sortir chaque décision du code Prisma.

### La lisibilité de la propriété, vérifiée sur l'API réelle

C'est la première Definition of Ready du ticket, et la réponse est un résultat, pas une formalité.

**Sur GitHub, la propriété d'un dépôt n'est pas lisible.** Vérifié en direct, sur l'organisation
réelle, sans credential applicatif :

- `GET /repos/incubateur-ademe/account-manager` : l'objet dépôt porte `owner`, et `owner.login` vaut
  `incubateur-ademe`, c'est-à-dire l'organisation elle-même. La liste complète des clés de la réponse
  ne contient **ni `creator`, ni `created_by`, ni aucun champ nommant une personne**.
- `GET /orgs/incubateur-ademe/repos` : mêmes champs, plus `archived`, `created_at` et
  `custom_properties`. Toujours aucun créateur.
- `GET /orgs/incubateur-ademe/audit-log` : **404**. Le journal d'audit d'organisation, seul endroit
  où GitHub conserve l'auteur d'un `repo.create`, est réservé à GitHub Enterprise Cloud, et
  `GET /orgs/incubateur-ademe` rend `plan.name = "free"`.
- `GET /orgs/incubateur-ademe/properties/schema` : rend une liste vide. Les propriétés personnalisées
  fonctionnent sur ce plan et pourraient porter un propriétaire déclaré, mais **aucune n'est
  définie** aujourd'hui.
- `GET /repos/{org}/{repo}/collaborators?affiliation=direct` : rend une liste vide sur le dépôt
  testé. Dans cette organisation l'accès passe par les équipes et l'appartenance, pas par des
  collaborateurs directs. Et de toute façon un droit `admin` est un accès, pas une possession :
  le confondre avec la propriété reviendrait exactement à l'erreur que ce ticket corrige.

**Conclusion, à inscrire dans le code et pas seulement ici : `github` ne déclare aucune capacité de
lecture de propriété, et l'écran des systèmes le dit.** L'exemple du ticket, « les dépôts d'une
organisation et leur créateur », n'est pas tenable sur ce fournisseur avec ce plan tarifaire. C'est
précisément le cas que la décision actée du ticket anticipe : vérifier avant de promettre quoi que ce
soit dans un écran.

**Les autres systèmes n'ont pas été sondés, et ce plan ne prétend pas le contraire.** Aucun n'est
implémenté et aucun credential n'est disponible ici. Ce qu'ils devront répondre :

- `notion` par SCIM (issue #4) : SCIM décrit des sièges, pas des pages. Il ne portera aucune
  référence, et il faudra le déclarer explicitement plutôt que de laisser un écran vide.
- `notion` par jeton de session : c'est là que se trouve l'auteur d'une page. La jonction avec les
  identités SCIM est à vérifier avant de promettre le rapprochement, pas après.
- `notion-trombi` : `docs/architecture.md:520-524` en fait le cas d'école de la référence, « où
  archiver ne veut pas dire supprimer ». Il est en tier `manual` et n'a pas de `list` : il ne
  collectera donc rien, et sa page se déclarera au fil de l'eau ou naîtra de l'onboarding.

**Ce ticket livre donc le mécanisme complet et sa vérité sur les systèmes, pas une source de
production.** C'est ce que demande la Definition of Done, qui ne mentionne aucun connecteur.

## Décisions de conception

**Une référence appartient à un compte, pas à une fiche.** `Reference.externalIdentityId` remplace
`Reference.personId`, et il est nullable. C'est la transposition exacte de ce que
`docs/architecture.md:226-228` dit de `ExternalIdentity.personId` : une identité non rattachée est la
définition même de l'écart, elle ne se jette ni ne se force. Un objet créé par un compte que personne
ne réclame est le même écart, vu depuis l'actif. La personne se lit par jointure, l'index
`ExternalIdentity.personId` (`prisma/schema.prisma:184`) existe déjà pour ça. Conséquence heureuse :
détacher un compte d'une fiche (`src/app/personnes/[username]/Detacher.tsx`) emporte ses objets avec
lui, ce qui est la bonne réponse, et la fusion de fiches de l'issue #1 n'a plus rien à déplacer.

**Un objet a un propriétaire et un seul : `resourceId` devient unique.** Plusieurs détenteurs d'un
même objet, c'est un accès partagé, et cela s'appelle déjà `AccessGrant`. Cette contrainte est ce qui
tient la Definition of Done sur les métadonnées : le titre vit sur `Resource`, la propriété vit sur
`Reference`, et rien ne se duplique. Le jour où un système rendra des copropriétaires, ce sera une
décision de modèle assumée, pas un contournement.

**Le destin par défaut devient `KEEP`, et non `ARCHIVE`.** Le défaut actuel
(`prisma/schema.prisma:235`) ferait naître une étape d'archivage sur tout objet dont personne n'a rien
dit. Le dépôt tranche déjà dans l'autre sens partout où c'est possible : `ACTIONS_ENABLED` vaut faux
par défaut, un run s'ouvre en échec. **Un défaut qui fabrique du travail sur un objet dont on ne sait
rien est un mauvais défaut**, et il contredirait la Definition of Done « un plan de départ ne propose
aucune suppression sur un objet possédé ». La table n'a jamais reçu la moindre ligne, le changement
ne coûte rien.

**Le destin est déduit ET déclaré, le déclaré primant, avec un verrou.** C'est la réponse à la
deuxième Definition of Ready. Le connecteur propose un destin au moment où il lit l'objet, parce que
lui seul sait ce qu'est cet objet : une page de trombinoscope s'archive, un dépôt d'équipe se
transfère. Un opérateur peut trancher autrement, et **sa décision pose `onOffboardDecidedBy`, après
quoi la collecte ne réécrit plus `onOffboard`**. Le motif est déjà écrit dans le schéma, sur
`Finding.closedBy` (`prisma/schema.prisma:434-439`) : une colonne qui sert de verrou, et le journal
qui porte le qui, le quand et le pourquoi. Sans ce verrou, chaque nuit déferait l'arbitrage humain de
la veille, exactement comme le rapprochement s'interdit de repasser sur ce qui est rattaché
(`src/lib/sync/rapprochement.ts:17-22`).

**Une propriété devinée ne fait agir sur rien.** Une référence dont le compte propriétaire est
rapproché en `HEURISTIC` ou `NONE` ne produit aucune étape, quel que soit son destin. La règle dure du
document ne parle que de révocation (`docs/architecture.md:233-234`), et une référence n'en est pas
une : **ce plan durcit donc l'invariant au lieu de l'assouplir**, et c'est délibéré. Le socle porte
désormais la règle en un seul endroit, `autoriseUneRevocation` (`src/core/rapprochement.ts:29-31`) :
la référence l'appelle au lieu de redire quelles méthodes autorisent un geste. Archiver la page de
quelqu'un d'autre au motif qu'un login ressemblait à un username est une bévue visible de tous et
pénible à défaire. Ces références alimentent la file de rattachement, comme les comptes isolés.

**Une référence ne produit jamais d'étape de coupure, et le type l'empêche.** Les étapes de
référence portent `capability: "reference"` et une `action` valant `archiver` ou `transferer`. Elles
ne peuvent pas être confondues avec une révocation par un lecteur ni par un `grep`, et aucun chemin
existant filtrant sur `revoke` ne les verra. `KEEP` ne produit rien du tout, comme le ticket
l'exige : on ne fabrique pas du travail pour dire qu'il n'y en a pas.

**`Capability` gagne la valeur `"reference"`, et c'est une modification du document de référence.**
Elle sert deux fois. Comme capacité déclarée, elle dit si un système sait lire la propriété, se
résout par `resolveCapability` (`src/core/connector.ts:84-117`) comme les quatre autres, et s'affiche
sur `/systemes` : `github` y apparaîtra en `indisponible`, ce qui est la seule façon honnête de ne
pas promettre un inventaire vide pour un inventaire sans objet. Comme capacité d'étape, elle marque
les étapes qui portent sur un objet possédé. **Tension explicite avec `docs/architecture.md:361`, qui
fige `type Capability = "list" | "grant" | "revoke" | "verify"` : ce point demande une validation
avant d'être écrit.** Voir la section dédiée plus bas.

**Les références se collectent dans `list`, et l'absence du champ n'est pas une liste vide.**
`CollectPayload` gagne `references?: readonly ObservedReference[]`. **`undefined` signifie « je n'ai
pas regardé », `[]` signifie « j'ai regardé, il n'y a rien ».** C'est la même distinction que le
statut `SKIPPED` défend au niveau du système (`prisma/schema.prisma:265-269`) : rien ne doit rendre
indiscernable un système sans écart d'un système que personne ne regarde. Traiter `undefined` comme
`[]` ferait disparaître tout l'inventaire d'un système le jour où son connecteur cesse de lire les
objets, silencieusement et en une seule collecte. Aucune `SyncRun` de capacité `reference` n'est
créée : c'est la même lecture, elle a déjà sa trace.

**Un connecteur qui déclare la capacité et ne rend pas le champ se contredit.** Le socle pousse une
erreur unitaire et le run passe en `PARTIAL`, exactement comme pour un accès sur une ressource
absente de la collecte (`src/lib/sync/collecte.ts:162-169`). Un run partiel ne date aucune
disparition, donc l'inventaire ne bouge pas.

**Le repreneur d'un transfert vit sur la référence, pas sur l'étape.** Deux raisons. La première est
l'objet du ticket : c'est un inventaire d'actifs, et un inventaire qui ne sait pas dire à qui un
objet est passé n'inventorie rien. La seconde est qu'aucune colonne n'est disponible sur `PlanStep` :
le plan de l'issue #8 y prévoit `saisie Json?` et `reponse String?`
(`docs/plans/#08_plan-generique.md:235-238`), celui de l'issue #9 y prévoit `answer Json?`
(`docs/plans/#09_modeles-de-plan.md:137`), les deux pour la même chose et sous deux noms. **Ce plan
n'ajoute pas un troisième nom et ne touche pas à `PlanStep`**, ce qui laisse ces deux tickets se
départager sans lui.

**Le repreneur déclaré ne réécrit pas le propriétaire constaté, il s'y ajoute.** La collecte est la
source, c'est une décision actée du ticket : le lendemain d'un transfert, Notion dira toujours que la
page a été créée par la même personne. Écraser le propriétaire serait affirmer contre l'observation.
Le plan de départ retient donc **l'union** de deux ensembles vrais : les objets dont le compte
propriétaire est celui de la personne qui part, et les objets dont on a déclaré cette personne
repreneuse. Aucun des deux n'est une supposition.

**Aucun nouveau constat.** Un objet dont le propriétaire est parti est déjà signalé du côté du
compte, par `ORPHAN` (`src/core/constat.ts:224-232`), qui porte la même situation et appelle la même
action. Ajouter un type de constat par actif noierait la file, et le ticket n'en demande pas. Le cas
est traité autrement : ces objets sont visibles et filtrables à l'inventaire, ils apparaissent sur la
fiche de la personne même sortie, et ils reviennent dans le plan dès qu'un dossier de départ est
ouvert pour elle.

**Le geste appartient à l'équipe transverse, comme tout le reste.** `requireOperateur`
(`src/lib/session.ts:23-36`) revérifie l'allowlist à chaque passage. Ouvrir la décision de destin à
un lead relève de l'issue #13 et se posera sur les mêmes actions sans toucher au modèle.

### Tensions avec `docs/architecture.md`

Le document fait référence et ne se modifie pas sans validation explicite. Trois points à soumettre.

1. **Section 5.1, le bloc `type Capability`.** Il énumère quatre valeurs. Ce plan en ajoute une
   cinquième, `"reference"`. C'est la seule tension frontale du lot : le document ne dit pas
   seulement autre chose, il fige une liste. À valider avant l'étape 1, faute de quoi il faut
   trouver un autre porteur pour la lisibilité de la propriété, et il n'y en a pas de bon.
2. **Section 3.2, le paragraphe `Reference`.** Il décrit la notion sans en fixer la forme, il n'y a
   donc pas de contradiction, mais il devient incomplet : il gagne le lien vers le compte plutôt que
   vers la fiche, les horodatages de constat, et le verrou de décision. Une phrase suffit.
3. **Section 3.4, reconstructibilité.** Aujourd'hui `Reference` est implicitement du constaté, donc
   entièrement rejouable. Après ce lot, deux de ses colonnes relèvent du décidé et se rejouent
   depuis le journal, comme tout ce qu'un opérateur attribue. Le paragraphe existant couvre déjà ce
   cas, il gagne juste la mention.

Rien à changer en 5.6 : l'invariant de collecte s'applique aux références sans être reformulé, et
c'est exactement l'intérêt de le porter dans le type de retour.

## Modèle de données

Une seule migration, nommée `references_collectees`.

### Ce que le schéma devient

`Reference` est réécrit :

```prisma
model Reference {
  id String @id @default(cuid())

  provider String
  /// Un objet a un proprietaire et un seul. Plusieurs detenteurs d'un meme objet,
  /// c'est un acces partage, et cela s'appelle AccessGrant.
  resourceId String @unique

  /// Le compte qui possede l'objet, tel que la collecte l'a lu. Nul quand le systeme
  /// rend un proprietaire qu'aucun compte connu ne porte : l'objet reste alors a
  /// l'inventaire sans que rien ne permette de dire a qui il revient.
  externalIdentityId String?

  onOffboard OnOffboard @default(KEEP)

  /// Tant qu'il est renseigne, la collecte ne reecrit plus onOffboard : un humain a
  /// tranche, et le recalculer chaque nuit deferait son arbitrage sans que personne
  /// ne s'en apercoive. Qui a decide quoi, et quand, vit dans le journal.
  onOffboardDecidedBy String?

  /// Ce qui a herite de l'objet, une fois le transfert declare. "person" ou
  /// "startup", et la cle correspondante : un username beta.gouv, ou un ghid.
  /// C'est une declaration datee, pas une observation : la collecte suivante
  /// continuera de rendre le createur, qui ne change pas cote systeme.
  heirKind String?
  heirKey  String?

  firstSeenAt DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  vanishedAt  DateTime?

  resource         Resource          @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  externalIdentity ExternalIdentity? @relation(fields: [externalIdentityId], references: [id], onDelete: SetNull)

  @@index([provider, vanishedAt])
  @@index([externalIdentityId])
  @@index([heirKind, heirKey])
}
```

Trois relations changent en conséquence :

- `Person.references Reference[]` (`prisma/schema.prisma:113`) **disparaît**. Les objets d'une
  personne se lisent par ses comptes.
- `Resource.references Reference[]` (`prisma/schema.prisma:198`) devient `reference Reference?`,
  puisque `resourceId` est unique.
- `ExternalIdentity` gagne `references Reference[]`.

Le `onDelete` n'est pas symétrique et ce n'est pas un oubli. `Cascade` depuis la ressource : sans
objet, la référence ne veut rien dire. `SetNull` depuis le compte : purger un compte ne doit jamais
emporter l'inventaire des actifs, sinon supprimer une ligne fait disparaître une page.

### La migration

`pnpm db:migrate --create-only`, puis relire le SQL avant de l'appliquer. Il doit contenir un
`DROP COLUMN "personId"`, un `DROP CONSTRAINT` de l'unicité `(personId, resourceId)`, les ajouts de
colonnes, le `CREATE UNIQUE INDEX` sur `resourceId` et l'`ALTER COLUMN "onOffboard" SET DEFAULT
'KEEP'`. **Il ne doit contenir aucun `DROP TABLE`.** La table n'a jamais reçu de ligne, aucune
reprise de données n'est nécessaire, mais la relecture coûte une minute et un `DROP TABLE` généré à
tort sur une base de production coûterait beaucoup plus.

**Après la migration, `pnpm db:generate` puis redémarrage de `pnpm dev`, sans exception.** Les deux
caches se cumulent, comme le rappelle `CLAUDE.md`. Le symptôme attendu si on saute une étape est
`Unknown argument 'externalIdentityId'` pendant que `pnpm typecheck` passe, ou un
`Unknown argument 'references'` sur `Person`.

Aucune modification de `PlanStep`, aucune modification de `SyncRun`, aucune nouvelle valeur d'enum :
`OnOffboard` existe déjà avec ses trois valeurs, seul son défaut bouge.

## Découpage en étapes

### 1. Dire ce que chaque système sait lire de la propriété

Aucune écriture en base, aucun schéma. `Capability` (`src/core/connector.ts:5`) gagne `"reference"`.
`github` déclare qu'il ne sait pas lire la propriété : la capacité reste absente de son contrat, ce
qui la résout à `none` par `resolveCapability`, et un commentaire dit pourquoi en citant ce qui a été
vérifié sur l'API réelle. `/systemes` gagne une ligne dans `CAPACITES`
(`src/app/systemes/page.tsx:15-20`), libellée « Inventorier » avec pour explication « lire les objets
possédés et leur propriétaire ».

Vérifiable seul : `/systemes` affiche la nouvelle ligne, `github` y est en `indisponible`, et rien
d'autre n'a bougé sur la page.

Fichiers : `src/core/connector.ts`, `src/connectors/github.ts`, `src/app/systemes/page.tsx`.

### 2. Le schéma

Poser le modèle ci-dessus, migrer, régénérer, redémarrer.

Vérifiable seul : `pnpm db:studio` montre la table `Reference` avec ses nouvelles colonnes et sans
`personId`, `pnpm typecheck` passe, l'application démarre, une fiche personne et un dossier de départ
existants s'affichent à l'identique.

Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_references_collectees/migration.sql`.

### 3. Le cœur pur, avec ses tests

`src/core/reference.ts`, sans Prisma ni `fetch`, porte tout le raisonnement.

```ts
export type Destin = "ARCHIVE" | "TRANSFER" | "KEEP";
export type NatureDuRepreneur = "person" | "startup";

export interface Repreneur {
  kind: NatureDuRepreneur;
  key: string;
}

export interface ReferenceConstatee {
  provider: string;
  resourceExternalId: string;
  label: string;
  url: string | null;
  destinPropose: Destin;
  destinDecide: Destin | null;
  repreneurAttendu: NatureDuRepreneur | null;
  /** Comment le compte proprietaire a ete rattache. Null quand aucun ne le porte. */
  rattachement: MethodeRapprochement | null;
  proprietaireUsername: string | null;
  proprietaireSorti: boolean;
  repreneurDeclare: Repreneur | null;
}

export function destinEffectif(reference: ReferenceConstatee): Destin;
export function faitAgir(reference: ReferenceConstatee): boolean;
export function etapesDeReference(
  references: readonly ReferenceConstatee[],
  username: string,
): PlannedStep[];
export function verdictDeTransfert(
  attendu: NatureDuRepreneur | null,
  saisi: Repreneur | null,
  connus: ReadonlySet<string>,
): Verdict;
export function classerInventaire(
  references: readonly ReferenceConstatee[],
): { agissables: ReferenceConstatee[]; devinees: ReferenceConstatee[]; orphelines: ReferenceConstatee[] };
export function disparitionsDeReferences(params: {
  observees: readonly string[] | undefined;
  tenuesPourVivantes: number;
  status: "OK" | "PARTIAL" | "FAILED" | "SKIPPED";
  partMax: number;
}): { dater: boolean; raison?: string };
```

`Verdict` et `Refus` se reprennent de `src/core/depart.ts:16-21`, il n'y a pas de second vocabulaire
de refus à inventer. `disparitionsDeReferences` réutilise `chuteExcessive`
(`src/core/collecte.ts:10-15`) au lieu d'en écrire une variante.

Les étapes produites portent toutes `tier: "manual"`, `capability: "reference"`,
`riskLevel: "medium"`, `idempotencyKey: \`${provider}:reference:${resourceExternalId}\``, et un
`manual.doneWhen` qui dit ce qu'il faut constater. Le libellé d'une étape `ARCHIVE` **nomme
l'archivage et interdit la suppression en toutes lettres** : c'est le seul endroit où un opérateur
pressé lira la consigne.

Vérifiable seul : `pnpm test` passe sur les scénarios de la section Tests, rien d'autre du dépôt ne
change.

Fichiers : `src/core/reference.ts`, `src/core/reference.test.ts`.

### 4. La collecte des références

`src/core/connector.ts` gagne les types du contrat :

```ts
export type ProposedFate =
  | { fate: "archive" | "keep" }
  | { fate: "transfer"; heir: "person" | "startup" };

export interface ObservedReference {
  resourceExternalId: string;
  /** Le compte qui possede l'objet. Absent quand le systeme rend un proprietaire
   *  qu'aucun compte de la collecte ne porte. */
  ownerIdentityExternalId?: string;
  proposedFate: ProposedFate;
}
```

`CollectPayload` gagne `references?: readonly ObservedReference[]`. L'union discriminée est ce qui
rend impossible un transfert sans nature de repreneur : le compilateur refuse la forme incomplète, et
la question « personne ou startup » se règle à l'écriture du connecteur, pas dans un écran.

`src/lib/sync/collecte.ts` gagne `enregistrerReferences`, calquée sur `enregistrerAcces` :
résolution de la ressource dans la table rendue par `enregistrerRessources`, résolution du compte
propriétaire, erreur unitaire sur toute contradiction, et **écriture de `onOffboard` uniquement quand
`onOffboardDecidedBy` est nul**. Le datage des disparitions entre dans le bloc `if (status === "OK")`
existant (`src/lib/sync/collecte.ts:300-326`), gardé par `disparitionsDeReferences`.
`ResultatCollecte` gagne un compteur `references: { creees, revues, disparues }`, et `executerSync`
l'imprime (`src/lib/sync/executer.ts:132-136`).

Le contrat impose aussi son symétrique : un connecteur qui déclare la capacité `reference` à un tier
autre que `none` et ne rend pas le champ pousse une erreur unitaire.

Vérifiable seul : `pnpm sync` sur GitHub se comporte exactement comme avant, le run reste `OK`, la
ligne de compte rendu affiche zéro référence, et aucune ligne n'apparaît dans la table.

Fichiers : `src/core/connector.ts`, `src/lib/sync/collecte.ts`, `src/lib/sync/executer.ts`.

### 5. Les références dans le plan de départ

`src/lib/reference.ts` porte les lectures Prisma et rien d'autre : `referencesDePersonne(personId)`,
qui rend l'union des objets possédés par ses comptes et des objets dont elle est repreneuse déclarée,
et `referencesDeStartup(ghid)`, qui sert l'inventaire et attend l'issue #6 sans lui rien imposer.
Toutes deux traduisent les lignes Prisma en `ReferenceConstatee` et laissent `src/core/reference.ts`
décider.

`calculerPlanDeDepart` (`src/lib/depart.ts:62-109`) ajoute les étapes de référence **après** sa
boucle sur les connecteurs, et surtout **hors** des `revocables` que `systemesDeLaPersonne` en tire :
un objet survit au compte qui l'a créé. `PlanCalcule` gagne un champ `references` pour que l'écran
sache combien d'objets ont été écartés faute de rattachement sûr, plutôt que de les taire, sur le
modèle de `nonConfirmes` (`src/lib/depart.ts:50-55`), qui rend déjà ce service pour les comptes.

`src/app/departs/[id]/page.tsx` groupe les étapes en deux blocs, les accès puis les objets possédés,
sous un titre et une phrase disant qu'aucune de ces lignes n'est une coupure. Le tri actuel
(`:68`) reste, appliqué dans chaque bloc.

Vérifiable seul : insérer à la main dans `pnpm db:studio` une `Resource` et une `Reference` rattachée
à un compte réel d'une personne réelle, avec les trois destins tour à tour, puis ouvrir un dossier de
départ. `KEEP` ne produit rien, `ARCHIVE` et `TRANSFER` produisent une étape chacune, dans le bloc
des objets possédés, et aucune ne porte le mot « supprimer ».

Fichiers : `src/lib/reference.ts`, `src/lib/depart.ts`, `src/app/departs/[id]/page.tsx`.

### 6. Le transfert et son repreneur

`Pointage.tsx` affiche, sur une étape dont `capability` vaut `reference` et dont l'action est
`transferer`, un champ de saisie du repreneur alimenté par les personnes du périmètre ou par les
startups selon ce que l'étape a figé dans `params`.

`pointerEtape` (`src/app/departs/[id]/actions.ts:101-183`) appelle `verdictDeTransfert` avant toute
écriture et refuse un pointage « fait » sans repreneur valide, avec une phrase qui dit pourquoi.
L'écriture passe par `actionTracee`, donc **la trace précède l'action** : un événement
`reference.transfert`, cible `ressource`, identifiant `<provider>:<externalId>`, avec le repreneur et
le destin en `after`. Puis, dans le même `ecrire`, `heirKind` et `heirKey` sont posés sur la
référence et l'étape passe à `SUCCEEDED`.

`src/app/journal/libelles.ts:9-27` gagne `reference.destin` et `reference.transfert`, et
`LIBELLE_CIBLE` (`:29-38`) gagne `ressource`. Sans ça le journal affiche des clés brutes au moment
précis où il sert de preuve.

Vérifiable seul : pointer un transfert sans repreneur refuse et explique ; avec un repreneur, le
journal montre l'événement nominatif avant l'écriture, et la référence porte son repreneur dans
`pnpm db:studio`.

Fichiers : `src/app/departs/[id]/actions.ts`, `src/app/departs/[id]/Pointage.tsx`,
`src/app/journal/libelles.ts`.

### 7. L'inventaire et le destin déclaré

`/inventaire` liste toutes les références vivantes, groupées par ce que `classerInventaire` en dit :
celles qui feront agir, celles dont la propriété est devinée et qui attendent un rattachement, celles
dont le propriétaire est parti ou inconnu. Un filtre par système et par startup. **Quand aucun
système ne sait lire la propriété, la page le dit au lieu d'afficher une liste vide**, sur le modèle
de l'encart de `src/app/personnes/[username]/page.tsx:489-497`.

Chaque ligne porte un contrôle de destin, servi par une action `changerDestin` qui passe par
`actionTracee` sous le verbe `reference.destin`, écrit `onOffboard` et pose `onOffboardDecidedBy`.
L'écran avertit qu'un destin changé rend obsolète un plan de départ encore en brouillon, ce qui est
le comportement voulu de `empreinteDuPlan` et non un défaut.

La fiche personne gagne une section « Objets possédés », alimentée par `referencesDePersonne`, entre
« Comptes externes » et « Observation ». `src/ui/Navigation.tsx:7-16` gagne le lien.

Vérifiable seul : la page se charge avec la base vide et explique pourquoi elle est vide ; après
insertion manuelle d'une référence, elle apparaît dans le bon groupe, son destin se change, et le
journal porte l'événement.

Fichiers : `src/app/inventaire/page.tsx`, `src/app/inventaire/actions.ts`,
`src/app/inventaire/Destin.tsx`, `src/app/personnes/[username]/page.tsx`, `src/ui/Navigation.tsx`.

### 8. La documentation

Lancer `/sync-docs` et soumettre les trois points de la section « Tensions » ci-dessus. Le document
ne se modifie qu'après validation explicite. Mettre à jour `TODO.md:26-32`, qui traite les
dérogations et les références ensemble : seule la moitié « références » est faite, l'autre reste
l'issue #15.

Fichiers : `docs/architecture.md`, `TODO.md`.

## Tests

Tout est pur, dans `src/core/reference.test.ts`, en Given / When / Then, sans Prisma, conformément à
ce que fait déjà le dépôt.

**1. Les trois destins d'un objet possédé, au départ de son auteur.**
Étant donné une personne dont un compte sûr possède quatre objets : une page à archiver, un dépôt à
transférer à une startup, une note à garder, et une page dont le destin proposé est l'archivage mais
qu'un opérateur a décidé de garder. Quand on calcule les étapes de son départ. Alors il y a
exactement deux étapes, pas trois ni quatre : `KEEP` n'en produit aucune et le destin décidé écrase
le destin proposé. Aucune des deux ne porte `capability: "revoke"`. Les deux sont en `tier: "manual"`.
Le libellé de l'archivage parle d'archiver et jamais de supprimer. L'étape de transfert porte
`repreneurAttendu: "startup"`. Les deux clés d'idempotence diffèrent et ne dépendent que du système
et de l'identifiant de l'objet, donc deux calculs successifs rendent les mêmes.

**2. Une propriété devinée ne fait agir sur rien, une propriété sûre survit au compte.**
Étant donné quatre objets à archiver : un possédé par un compte rapproché en `DECLARED`, un par un
compte en `GITHUB_LOGIN`, un par un compte en `HEURISTIC`, un par un compte que personne ne réclame.
Quand on calcule les étapes. Alors seuls les deux premiers en produisent. Et quand le compte
propriétaire du premier a disparu du système alors que la personne est toujours là, son étape est
quand même produite, parce que l'objet, lui, n'a pas disparu avec le compte. `classerInventaire`
range les quatre dans les bons groupes, et le total est conservé : rien n'est perdu en route.

**3. Un transfert sans repreneur ne se pointe pas.**
Étant donné une étape de transfert attendant une startup. Quand on tente de la pointer sans
repreneur, alors le verdict refuse et sa raison nomme ce qui manque. Quand on la pointe avec une
personne, alors le verdict refuse aussi : ce n'est pas la bonne nature de repreneur. Quand on la
pointe avec une startup inconnue du référentiel, alors le verdict refuse. Quand on la pointe avec une
startup connue, alors le verdict accepte. Et quand on saisit un repreneur sur une étape d'archivage,
le verdict refuse : il n'y a rien à hériter.

**4. Une collecte tronquée ne fait disparaître aucun actif.**
Étant donné vingt objets tenus pour vivants sur un système. Quand la collecte rend `PARTIAL`, alors
aucune disparition n'est datée. Quand elle rend `OK` mais ne rapporte que trois objets, alors la
chute est jugée excessive, rien n'est daté, et la raison le dit en clair. Quand elle rend `OK` avec
dix-neuf objets, alors le vingtième est daté. Quand elle rend `OK` sans avoir regardé les objets du
tout, c'est-à-dire avec un champ absent et non une liste vide, alors rien n'est daté : ne pas avoir
regardé n'est pas avoir constaté une absence. Quand elle rend `OK` avec une liste vide sur une base
vide, alors rien n'est daté non plus et ce n'est pas une chute.

**5. Le repreneur déclaré ajoute sans écraser.**
Étant donné un objet possédé par le compte d'une première personne, déclaré transféré à une seconde.
Quand on calcule le départ de la première, alors l'objet y figure, parce que le système continue de
la nommer propriétaire. Quand on calcule le départ de la seconde, alors l'objet y figure aussi,
parce qu'on lui a déclaré cet héritage. Et l'inventaire nomme toujours le propriétaire constaté comme
propriétaire, le repreneur restant une déclaration à côté.

## Risques et pièges

**Traiter `references: undefined` comme une liste vide vide l'inventaire en une nuit.** C'est la
panne la plus discrète du lot : un connecteur qui cesse de lire les objets, ou un refactoring qui
oublie le champ, dateraient toutes les disparitions d'un coup sans qu'aucune erreur ne soit levée.
Le test 4 couvre précisément ce cas, et c'est le seul garde-fou.

**Une identité `HEURISTIC` porte un `personId`** (`src/core/rapprochement.ts:183`). Toute requête qui
lit « les références de cette personne » sur le seul `personId` fera entrer de la propriété devinée
dans un plan, sans erreur, sans avertissement, et l'étape aura l'air normale. Le socle le garantit
maintenant pour les accès, par `autoriseUneRevocation` (`src/core/rapprochement.ts:29-31`) que
`systemesDuDepart` consulte, mais aucune lecture neuve n'en hérite toute seule : celle des références
doit passer par `referencesDePersonne`, qui appelle la même fonction, et ce point mérite un
commentaire à l'endroit du filtre.

**Ajouter une valeur à `Capability` ne casse rien et ne se voit pas.** `ConnectorContract.capabilities`
est un `Partial<Record<...>>` (`src/core/connector.ts:64`) et `CAPACITES`
(`src/app/systemes/page.tsx:15-20`) est une liste écrite à la main : oublier d'y ajouter la ligne
laisse la capacité se résoudre correctement tout en restant invisible. Le typecheck ne dira rien.

**Un destin changé rend obsolète un brouillon de plan.** `empreinteDuPlan` hache `capability`,
`action` et `params` : ajouter, retirer ou requalifier un objet déplace l'empreinte, et
`peutConfirmer` (`src/core/depart.ts:42-48`) refuse alors la confirmation. Ce refus n'enferme plus le
dossier : un brouillon obsolète se recalcule, par `peutRecalculer` (`src/core/depart.ts:153-164`) et
le bouton de l'écran de départ (`src/app/departs/[id]/Pointage.tsx:117-136`). Reste qu'un opérateur
qui range son inventaire pendant qu'un plan attend sa signature ne comprendra pas tout seul pourquoi
le bouton refuse. L'écran d'inventaire doit le dire au moment du geste.

**Le transfert déclaré ne change rien côté système.** La collecte suivante rendra le même créateur.
Si un jour on décide que le repreneur remplace le propriétaire, ce sera une affirmation contre
l'observation, et il faudra la traiter comme telle. En attendant, l'écran ne doit jamais laisser
croire que l'objet a changé de main dans le système : il a changé de main dans nos décisions.

**`resourceId` unique enferme le modèle sur un propriétaire.** C'est un choix, pas un oubli. Un
système rendant des copropriétaires demandera une décision de modèle, et le contourner par plusieurs
`Resource` pour un même objet casserait la Definition of Done sur les métadonnées.

**Les clés d'idempotence se collent bout à bout.** `enregistrerPlan` (`src/lib/depart.ts:182`)
suffixe par l'identifiant du plan, et la colonne est unique globalement
(`prisma/schema.prisma:399`). Un identifiant d'objet contenant un deux-points reste sans danger tant
que le préfixe `<provider>:reference:` est présent, mais deux objets d'un même système dont les
identifiants ne diffèrent que par un séparateur produiraient la même clé et feraient échouer
l'enregistrement du plan entier, pas seulement l'étape.

**La suppression de `Person.references` touche le plan de l'issue #1.** Sa fusion de fiches prévoit de
déplacer les références sur `(personId, resourceId)`
(`docs/plans/#01_edition-fiche-manuelle.md:243-246`). Après ce lot, les références suivent les
comptes : #1 a une chose de moins à déplacer, et son plan doit être corrigé plutôt que laissé à
diverger.

**Le nom de la colonne de saisie reste à trancher entre #8 et #9.** Ce plan n'y touche pas et n'en
dépend pas, mais celui des deux qui livrera devra vérifier qu'il ne réinvente pas le stockage du
repreneur, désormais porté par la référence.

**Les deux caches Prisma.** Rien de neuf, mais ce lot supprime une colonne obligatoire et une
relation : le symptôme d'un oubli n'est pas une erreur au démarrage, c'est un `Unknown argument`
au premier accès, en production, sur la page qu'on venait d'écrire.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build. Au-delà, six constats à faire soi-même.

1. **Une collecte réelle ne change pas de comportement.** `pnpm sync` termine en `OK` sur GitHub, le
   compte rendu affiche zéro référence, et la table reste vide. Un système qui ne lit pas la
   propriété ne doit rien coûter à l'existant.
2. **`/systemes` dit la vérité sur la propriété.** GitHub y apparaît en `indisponible` pour la
   capacité d'inventaire, et la raison est lisible sans ouvrir le code.
3. **Le parcours complet tourne sur une donnée posée à la main.** Créer dans `pnpm db:studio` une
   `Resource` et une `Reference` par destin, rattachées à un compte réel d'une personne réelle du
   périmètre, ouvrir son dossier de départ : deux étapes, dans leur bloc, aucune coupure, aucun mot
   de suppression.
4. **Le transfert refuse puis trace.** Pointer sans repreneur : refus explicite. Pointer avec un
   repreneur valide : l'événement `reference.transfert` est au journal avec le nom de l'opérateur,
   et il y est **avant** l'écriture, ce qui se vérifie en comparant les horodatages du journal et de
   la référence.
5. **Un objet dont le propriétaire est parti reste visible.** Marquer le compte propriétaire comme
   disparu, relancer l'affichage : l'objet est toujours à l'inventaire, dans le groupe des orphelins,
   et la fiche de la personne sortie le montre encore.
6. **Le document de référence est à jour**, avec la validation explicite des trois points de tension
   tracée dans la pull request. Sans elle, l'étape 1 ne doit pas être livrée : la cinquième valeur de
   `Capability` contredit un bloc du document.
