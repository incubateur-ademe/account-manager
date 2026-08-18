# Modèles de plan assemblables, incubateur et startups (#9)

> Plan d'implémentation de l'issue #9. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

**Un plan naît uniquement des connecteurs.** `calculerPlanDeDepart` (`src/lib/depart.ts:62-109`)
boucle sur `CONNECTEURS`, ne retient que les systèmes où la personne a un compte qu'une étape a le
droit de viser (`systemesDeLaPersonne`, `src/lib/depart.ts:29-41`), appelle `connecteur.plan()` et
concatène. Rien, nulle part, ne permet
de déclarer une action que ne calcule aucun connecteur. C'est exactement le trou du ticket.

**Le gel existe déjà et il est bien fait.** `enregistrerPlan` (`src/lib/depart.ts:150-191`) recopie
chaque champ de la `PlannedStep` dans `PlanStep`, y compris la marche à suivre dans la colonne
`manual` (`prisma/schema.prisma:391`), dont le commentaire dit mot pour mot ce que le ticket
redemande : un runbook reformulé ne doit pas changer ce qui a été approuvé. **Une étape de modèle
n'a donc aucun mécanisme de gel à inventer, elle réutilise celui-là.**

**L'écran du dossier sait déjà rendre une tâche purement humaine.** `src/app/departs/[id]/page.tsx`
lit `etape.manual` (`:205`), affiche le runbook (`:224-226`), le lien direct (`:227-233`), le
critère de complétion (`:234-238`) et le formulaire de pointage. Le connecteur `github` produit
d'ailleurs déjà une étape `tier: "manual"` sans aucun appel d'API
(`src/connectors/github.ts:223-249`). **L'affichage d'une étape de modèle demande donc un
regroupement par origine, pas un nouveau rendu.**

**La forme d'une tâche déclarée est déjà typée.** `ManualTask` (`src/core/connector.ts:176-182`)
porte `title`, `runbook`, `deeplink?` et `doneWhen`, ce dernier avec le commentaire « sans ça,
"fait" ne veut rien dire ». Le ticket demande un texte, un critère de complétion et un lien
éventuel : c'est cette structure, plus la saisie attendue.

**Ce qui manque, en une phrase par point.** Aucune table de modèle. Aucune notion d'appartenance
d'une étape à l'incubateur ou à une startup. Aucun écran d'édition. Aucune page de startup
(`src/app` n'a pas de répertoire `startups`, c'est l'issue #6). `Person.startups` est un
`String[]` de ghid sans clé étrangère (`prisma/schema.prisma:106`), et `Startup.ghid` est unique
(`prisma/schema.prisma:247`) : le rattachement se lit donc par ghid, jamais par identifiant
interne.

**Ce dont ce ticket dépend et qui n'est pas là.** L'issue #8 n'est pas livrée : `PlanKind` ne
connaît pas `ONBOARDING` (`prisma/schema.prisma:315-319`) et `github.plan` retourne une liste vide
pour tout ce qui n'est pas un retrait (`src/connectors/github.ts:224-226`). Ce plan est donc écrit
pour livrer sur le départ seul, avec la couture vers l'arrivée posée mais pas empruntée.

**Trois traits du socle, à connaître avant d'écrire une ligne.**

1. `PlanStep.idempotencyKey` est unique globalement (`prisma/schema.prisma:399`), et le socle
   garantit désormais qu'un second plan ne s'y cogne pas : `enregistrerPlan` tire un `planId` avec
   `randomUUID()` et suffixe chaque clé par ce `planId`, non par l'identifiant du dossier
   (`src/lib/depart.ts:161` et `:182`). Une étape de modèle n'a donc qu'à produire une clé stable
   pour un même modèle, le suffixe étant ajouté au gel et jamais par elle.
2. `empreinteDuPlan` (`src/core/plan.ts:12-31`) hache `systemKey`, `capability`, `action`,
   `idempotencyKey` et `params`, **et volontairement ni le libellé ni l'ordre**. Ajouter ou retirer
   une étape de modèle déplacera l'empreinte, renommer une étape ne la déplacera pas.
3. L'écran trie les étapes par `systemKey` puis `label` (`src/app/departs/[id]/page.tsx:68`).
   L'ordre déclaré d'un modèle ne survivra pas à ce tri tant qu'on ne le change pas.

**Aucun test du dépôt ne touche Prisma** (vérifié : aucun fichier `src/**/*.test.ts` n'importe
`prisma`). Tout est testé sur des fonctions pures de `src/core`. Ce plan s'y conforme.

## Décisions de conception

**Une étape de modèle est une `PlannedStep` comme les autres.** C'est la décision structurante.
L'alternative, une table d'instances séparée, dupliquerait la machine à états
(`src/core/depart.ts:80-88`), le pointage, le gel et l'empreinte. Conséquence assumée : une étape
de modèle porte des champs faits pour un connecteur, qu'on remplit de façon documentée.
`systemKey` vaut la constante réservée `"modele"`, `tier` vaut toujours `"manual"`, `capability`
vaut `"revoke"` au départ et `"grant"` à l'arrivée (elle dit quel moment l'étape sert, pas ce qu'un
connecteur ferait), `expectedState` vaut `{}`.

**Ce qui distingue une étape de modèle est une colonne, pas une convention de nommage.**
`PlanStep.template` est un `Json?` gelé, sur le modèle exact de `manual` : `{ owner, stepKey,
saisie? }`. Nul signifie « vient d'un connecteur ». Ce choix, plutôt que deux colonnes ou un enum,
suit le précédent du dépôt et **porte gratuitement le futur `capacitor`** : l'ajouter reviendra à
poser une clé de plus dans ce JSON et dans la table de modèle, sans refaire le modèle, ce que le
ticket exige explicitement.

**Aucune étape de modèle ne peut jamais exécuter quoi que ce soit.** `etapesDepuisModeles` émet
toujours `tier: "manual"` et ne consulte aucun connecteur : il n'y a donc pas de `execute` à
appeler, et le pointage reste ce qu'il est déjà, une déclaration humaine
(`src/core/depart.ts:57-65`). L'invariant `ACTIONS_ENABLED=false` n'est pas affaibli, il est hors
d'atteinte. Le jour où un `capacitor` arrivera, c'est lui qui devra passer par `RunContext.dryRun`,
et ce sera son ticket. Corollaire non négociable : une étape de modèle ne touche aucune identité,
elle ne peut donc pas contourner la règle qui interdit à une identité `HEURISTIC` ou `NONE` de
produire une révocation. Cette règle est portée par `autoriseUneRevocation`
(`src/core/rapprochement.ts:29-31`), que `systemesDuDepart` consulte pour le calcul du plan : il
n'y a rien à en recopier ici.

**Un modèle est identifié par le couple (propriétaire, moment).** Le propriétaire est une chaîne :
le ghid de la startup, ou la valeur réservée `*incubateur`. **Pas de colonne nullable pour
l'incubateur** : dans PostgreSQL deux `NULL` ne s'égalent pas, un `@@unique([startupGhid, kind])`
laisserait donc créer autant de modèles d'incubateur qu'on veut, et le doublon ne se verrait qu'à
l'assemblage. Le caractère `*` est impossible dans un ghid beta.gouv (minuscules, chiffres,
tirets), la collision est donc exclue par construction. Pas de clé étrangère vers `Startup` non
plus : `Person.startups` porte déjà des ghid sans clé étrangère, l'assemblage compare des ghid à
des ghid sans jointure.

**Le moment a son propre enum, `TemplateKind { ONBOARDING, OFFBOARDING }`.** Réutiliser `PlanKind`
couplerait ce ticket à la migration de l'issue #8 et obligerait à répondre à « que vaut un modèle
pour `DRIFT_FIX` », qui n'a pas de réponse. Une fonction pure `modeleDuPlan(kind: PlanKind):
TemplateKind | null` fait la conversion et rend `null` pour `DRIFT_FIX` et `MANUAL_OP` : c'est le
seul point que l'issue #8 aura à brancher.

**L'autorisation donnée aux startups est un booléen par moment, porté par le modèle de
l'incubateur, et il vaut `false` par défaut.** Défaut fermé, comme `ACTIONS_ENABLED` : un plan
assemblé ne doit jamais gagner une étape que personne, côté incubateur, n'a admise. Le refus se
joue à deux endroits, et c'est délibéré : l'action d'édition refuse avec une phrase qui dit
pourquoi, et l'assemblage écarte les étapes de startup qui existeraient malgré l'interdiction.
**Refermer l'autorisation ne supprime rien**, cela neutralise : supprimer le travail d'une startup
sur un basculement de case serait indéfendable, et rouvrir doit tout rendre. L'écran de
l'incubateur affiche donc le compte des étapes actuellement neutralisées, sinon la neutralisation
serait silencieuse. **Absence de modèle d'incubateur pour un moment vaut absence d'autorisation** :
aucune étape de startup n'est assemblée.

**La déduplication se fait sur une clé dérivée du titre.** La clé d'une étape est le titre
slugifié (minuscules, accents dépliés, tirets), calculée à l'écriture et stockée, unique par
modèle. Deux startups qui déclarent « Présenter l'équipe » produisent donc la même clé et une seule
étape survit. L'ordre d'assemblage est l'incubateur d'abord dans l'ordre déclaré, puis les startups
**triées par ghid**, chacune dans son ordre déclaré : il faut un ordre déterministe, sans quoi
l'empreinte du plan changerait d'un calcul à l'autre. Le premier arrivé gagne, l'incubateur prime
donc toujours. **Rien n'est écarté en silence** : `assembler` rend aussi la liste des étapes
écartées avec leur origine et leur raison, et les écrans l'affichent.

**Qui édite le modèle d'une startup : un opérateur, aujourd'hui.** Un lead n'est pas dans
`OPERATORS` et `requireOperateur` revérifie l'allowlist à chaque passage
(`src/lib/session.ts:23-36`). Ouvrir cet accès est un modèle d'autorisation par objet, c'est-à-dire
l'issue #13, pas celle-ci. Le jour où il arrivera, il se posera sur les mêmes actions sans toucher
au modèle de données.

**Tension assumée avec le ticket sur l'emplacement de l'édition.** Le ticket dit « celui d'une
startup s'édite depuis sa page », et cette page est l'issue #6, non livrée. Ce plan livre
`/modeles/startup/[ghid]`, une page par propriétaire, et l'issue #6 y renverra depuis la page de la
startup au lieu de réimplémenter le formulaire. L'intention est respectée, la dépendance n'est pas
créée.

**Une saisie attendue se déclare et se gèle ici, elle ne se collecte pas ici.** La forme est
arrêtée (voir le modèle de données), elle est figée dans `PlanStep.template.saisie`, et l'écran du
dossier affiche ce que l'étape attend. **Enregistrer la réponse relève de l'issue #10**, qui
retravaille le pointage et la validation par étape : livrer un champ dont personne ne lit la valeur
serait pire que de ne rien livrer. Ce plan fixe donc la forme pour que #10 n'en invente pas une
seconde, et nomme la colonne qu'elle aura à ajouter, `PlanStep.answer Json?`. La Definition of
Ready du ticket ne demande que la forme, elle est tenue.

**Une startup rattachée après l'instanciation ne change aucun plan figé.** C'est l'invariant du
produit et le mécanisme existe déjà : les étapes de modèle entrant dans le calcul, une nouvelle
startup déplace l'empreinte recalculée, `peremptionDuPlan` rend `obsolete: true`
(`src/core/plan.ts:48-57`) et `peutConfirmer` refuse le brouillon avec la bonne phrase
(`src/core/depart.ts:28-50`). Le brouillon n'est pas pour autant sans issue : `peutRecalculer`
(`src/core/depart.ts:153-164`) autorise à le refaire, et celui qu'il remplace passe à `STALE` par
`etatDUnPlanRemplace`. Sur un plan déjà confirmé, rien ne bouge et le dossier affiche un
encart nominatif disant quelles étapes de modèle n'y sont pas. **Renommer une étape ne rend pas un
brouillon obsolète**, puisque l'empreinte ignore les libellés : c'est cohérent avec la doctrine
existante, un plan qui ne diffère que par sa présentation est le même plan.

**Une étape de modèle ne se supprime pas en douceur.** Retirer une étape d'un modèle est une
suppression franche, dont la trace d'audit porte l'étape entière dans `before`. Une colonne
`retireeLe` obligerait tous les lecteurs à la filtrer, pour un objet qui n'a pas d'historique
propre : le journal est cet historique.

## Modèle de données

Trois changements dans `prisma/schema.prisma`, un seul enum, deux tables, une colonne.

```prisma
enum TemplateKind {
  ONBOARDING
  OFFBOARDING
}

model PlanTemplate {
  id String @id @default(cuid())

  /// ghid de la startup proprietaire, ou la valeur reservee "*incubateur". Pas de
  /// colonne nullable : dans PostgreSQL deux NULL ne s'egalent pas, et l'unicite
  /// laisserait alors creer plusieurs modeles d'incubateur pour un meme moment.
  ownerKey String
  kind     TemplateKind

  /// N'a de sens que sur le modele de l'incubateur. Ferme par defaut : un plan
  /// assemble ne gagne pas d'etape que personne n'a admise. Le refermer neutralise
  /// les etapes de startup, il ne les supprime pas.
  startupsMayExtend Boolean @default(false)

  steps PlanTemplateStep[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([ownerKey, kind])
}

model PlanTemplateStep {
  id String @id @default(cuid())

  templateId String
  /// Titre slugifie, calcule a l'ecriture. C'est la cle de deduplication entre
  /// modeles : deux startups qui declarent le meme geste n'en produisent qu'un.
  key      String
  position Int

  title    String
  runbook  String?
  deeplink String?
  /// Ce qu'il faut constater pour cocher. Obligatoire : sans lui, « fait » ne veut
  /// rien dire.
  doneWhen String

  /// Saisie attendue, validee par saisieAttendueSchema. Nulle quand l'etape ne
  /// demande qu'une case.
  input Json?

  riskLevel RiskLevel @default(LOW)

  template PlanTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([templateId, key])
  @@index([templateId, position])
}
```

Et sur `PlanStep`, à côté de `manual` (`prisma/schema.prisma:391`) :

```prisma
  /// L'origine declaree de l'etape, gelee comme le reste : quel modele l'a demandee,
  /// sous quelle cle, et quelle saisie elle attendait ce jour-la. Nulle pour une
  /// etape calculee par un connecteur.
  template Json?
```

Migration : `pnpm db:migrate --name modeles_de_plan`. Elle produit un `CREATE TYPE
"TemplateKind"`, deux `CREATE TABLE`, un `ALTER TABLE "PlanStep" ADD COLUMN "template" JSONB`.
Aucune donnée existante n'est touchée, aucune reprise n'est nécessaire.

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`, sans exception.** Deux
caches se cumulent, et ce ticket ajoute un enum, donc le symptôme attendu si on saute une étape est
`Value 'OFFBOARDING' not found in enum 'TemplateKind'` alors que la base et le client sont à jour,
ou `Unknown argument 'template'` pendant que le typecheck passe.

Forme de la saisie attendue, en Zod 4, dans `src/core/modele-plan.ts` :

```ts
export const saisieAttendueSchema = z.strictObject({
  type: z.enum(["texte", "url", "date", "courriel"]),
  libelle: z.string().min(1),
  obligatoire: z.boolean().default(true),
});

export type SaisieAttendue = z.infer<typeof saisieAttendueSchema>;
```

## Découpage en étapes

### 1. Le schéma et rien d'autre

Poser l'enum, les deux tables et la colonne `PlanStep.template`, migrer, régénérer, redémarrer.
Vérifiable : `pnpm db:studio` montre les deux tables vides, `pnpm typecheck` passe, l'application
démarre et le dossier de départ existant s'affiche à l'identique.

Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_modeles_de_plan/migration.sql`.

### 2. Le cœur pur, avec ses tests

`src/core/modele-plan.ts` porte tout le raisonnement, sans Prisma ni `fetch` :

- `CLE_INCUBATEUR = "*incubateur"` et `SYSTEME_MODELE = "modele"` ;
- `cleDEtape(titre: string): string`, la slugification ;
- `saisieAttendueSchema` et `SaisieAttendue` ;
- `modeleDuPlan(kind: PlanKind): TemplateKind | null`, la couture vers l'issue #8 ;
- `assembler(incubateur, parStartup)` qui rend `{ etapes, ecartees }`, où chaque écartée porte son
  origine et sa raison (`"non-autorise"` ou `"doublon"`) ;
- `etapesDepuisModeles(assemblage, moment)` qui produit des `PlannedStep` avec
  `systemKey: SYSTEME_MODELE`, `tier: "manual"`, `capability` selon le moment,
  `idempotencyKey: "modele:<owner>:<cle>"`, `params: { modele, etape }`, `manual` rempli depuis le
  titre, le runbook, le lien et le critère, et `template: { owner, stepKey, saisie? }` ;
- `ecartDeModele(figees, assemblees)` qui rend les clés présentes aujourd'hui et absentes du plan
  figé, et l'inverse.

`src/core/connector.ts` gagne un champ optionnel sur `PlannedStep` :

```ts
  /** Renseigne uniquement pour une etape issue d'un modele declare. Un connecteur ne le pose jamais. */
  template?: { owner: string; stepKey: string; saisie?: SaisieAttendue };
```

Vérifiable par `src/core/modele-plan.test.ts` seul, sans base.

### 3. L'édition des modèles, avec sa trace

Deux routes et leurs actions, toutes derrière `requireOperateur()` :

- `/modeles` : l'index, le modèle de l'incubateur pour chaque moment, la liste des modèles de
  startup avec leur nombre d'étapes, et le signalement des modèles dont le ghid ne correspond plus
  à aucune `Startup` ;
- `/modeles/incubateur` et `/modeles/startup/[ghid]` : la page d'un propriétaire, une section par
  moment, le formulaire d'ajout, l'édition et le retrait d'une étape, et sur l'incubateur
  seulement, la bascule d'autorisation avec le compte des étapes de startup neutralisées.

Toute écriture passe par `actionTracee` (`src/lib/actions.ts:30-57`), donc le journal précède
l'écriture. Nouveaux verbes à déclarer dans `src/app/journal/libelles.ts` : `modele.creation`,
`modele.autorisation`, `modele.etape.ajout`, `modele.etape.modification`, `modele.etape.retrait`,
plus la cible `modele`. `targetId` vaut `<owner>:<moment>`.

Le refus d'une étape de startup non autorisée est une phrase, pas un code : « Le modèle
d'arrivée de l'incubateur n'autorise pas les startups à le compléter. Ouvrez l'autorisation depuis
le modèle de l'incubateur, ou faites porter cette étape par ce modèle. »

Fichiers : `src/app/modeles/page.tsx`, `src/app/modeles/incubateur/page.tsx`,
`src/app/modeles/startup/[ghid]/page.tsx`, `src/app/modeles/actions.ts`,
`src/app/modeles/Editeur.tsx`, `src/lib/modele-plan.ts` (lecture et écriture Prisma),
`src/app/journal/libelles.ts`, `src/ui/Navigation.tsx`.

Vérifiable dans le navigateur : créer un modèle d'incubateur avec deux étapes, tenter d'ajouter une
étape à une startup et lire le refus, ouvrir l'autorisation, réussir, et voir cinq lignes dans le
journal.

### 4. Le branchement au calcul du plan

`src/lib/modele-plan.ts` charge le modèle de l'incubateur et ceux des startups de la personne, en
une requête `where: { ownerKey: { in: [CLE_INCUBATEUR, ...personne.startups] }, kind }`.
`calculerPlanDeDepart` (`src/lib/depart.ts:62`) appelle `assembler` puis `etapesDepuisModeles`, et
place ces étapes **avant** celles des connecteurs. `PlanCalcule` gagne `ecartees`, que l'écran
affichera. `enregistrerPlan` (`src/lib/depart.ts:150`) recopie `etape.template` comme il recopie
déjà `etape.manual` (`src/lib/depart.ts:183`).

Vérifiable de bout en bout : ouvrir un départ pour une personne rattachée à une startup qui a un
modèle, et voir les étapes déclarées dans le plan calculé.

Fichiers : `src/lib/depart.ts`, `src/lib/modele-plan.ts`.

### 5. L'affichage dans le dossier

`src/app/departs/[id]/page.tsx` regroupe les étapes par origine : « Ce que l'incubateur demande »,
« Ce que la startup <nom> demande », puis les systèmes. Le tri actuel `[{ systemKey }, { label }]`
(`:68`) devient un tri qui respecte l'ordre déclaré des modèles, la position étant reportée dans
`params` au moment du gel. La saisie attendue s'affiche en toutes lettres sous l'étape. Un encart
apparaît quand `ecartDeModele` rend quelque chose sur un plan déjà confirmé : « Le rattachement de
cette personne a changé depuis ce plan : N étapes déclarées n'y figurent pas. »

Fichiers : `src/app/departs/[id]/page.tsx`.

### 6. Vérification et documentation

Lancer `/verif`, qui va plus loin que `pnpm verify` puisqu'il fait le build. Proposer ensuite, via
`/sync-docs` et **avec validation explicite avant toute écriture**, l'ajout dans
`docs/architecture.md` d'un paragraphe en section 3.3 sur les modèles déclarés et le fait que le
gel des étapes vaut aussi pour elles.

## Tests

Emplacement : `src/core/modele-plan.test.ts`, sur les fonctions pures, comme tout le reste du
dépôt. Cinq scénarios, chacun une histoire, chacun plusieurs assertions.

**1. Sans aucune startup, une personne reçoit le modèle de l'incubateur et rien d'autre.**
Étant donné un modèle d'incubateur de trois étapes déclarées dans un ordre précis et deux modèles
de startup auxquels la personne n'est pas rattachée, quand on assemble pour une personne sans
startup, alors on obtient exactement les trois étapes dans l'ordre déclaré, aucune écartée, et les
`PlannedStep` produites portent `tier: "manual"`, `systemKey: "modele"`, un `manual.doneWhen`
non vide et un `template.owner` valant la clé de l'incubateur. Et quand il n'existe aucun modèle du
tout, l'assemblage rend une liste vide sans lever, parce qu'un dossier sans modèle doit rester
ouvrable.

**2. Rattachée à trois startups, elle voit les trois modèles assemblés, sans doublon d'étape.**
Étant donné un modèle d'incubateur qui déclare « Signer la charte », trois modèles de startup dont
deux déclarent « Présenter l'équipe » et l'un redéclare « Signer la charte », quand on assemble,
alors chaque geste n'apparaît qu'une fois, l'exemplaire conservé de « Signer la charte » est celui
de l'incubateur, l'ordre est incubateur puis startups par ghid croissant, et les deux étapes
écartées sont rendues avec la raison `"doublon"` et le ghid qui les portait. Assertion
supplémentaire : l'assemblage est stable, deux appels avec les startups fournies dans un ordre
différent donnent la même empreinte via `empreinteDuPlan`.

**3. Un modèle qui interdit les ajouts de startup les refuse effectivement, et le dit.**
Étant donné un modèle d'incubateur avec `startupsMayExtend: false` et deux startups qui portent
chacune une étape, quand on assemble, alors seules les étapes de l'incubateur sortent, et chaque
étape de startup est rendue comme écartée avec la raison `"non-autorise"` et son origine. Puis,
quand l'autorisation est rouverte sans qu'aucune étape ait été touchée, les mêmes étapes
réapparaissent à l'identique : neutraliser n'est pas supprimer. Enfin, en l'absence totale de
modèle d'incubateur pour ce moment, les étapes de startup sont écartées de la même façon, parce
qu'aucune autorisation n'existe.

**4. Une étape déclarée devient une étape de plan gelée, lisible et pointable.**
Étant donné un modèle portant une étape avec lien et saisie attendue, quand on produit les
`PlannedStep` pour un départ puis pour une arrivée, alors la `capability` suit le moment,
l'`idempotencyKey` est stable entre deux calculs et distincte entre deux propriétaires, la saisie
attendue est recopiée dans `template.saisie`, et le `manual` porte le titre, le lien et le critère.
Puis : l'empreinte du plan change quand une étape est ajoutée au modèle, et **ne change pas** quand
seul le titre d'une étape est réécrit, ce qui est la traduction exacte de la doctrine
d'`empreinteDuPlan`.

**5. Une startup rattachée après l'instanciation ne modifie pas le plan figé, mais le dossier le
dit.** Étant donné un plan figé sur deux étapes déclarées, quand la personne est rattachée à une
troisième startup qui porte une étape, alors les étapes figées sont inchangées, `ecartDeModele`
rend la clé manquante, l'empreinte recalculée diffère de l'empreinte figée, `peremptionDuPlan` rend
`obsolete: true` et `peutConfirmer` refuse le brouillon avec sa raison propre, distincte de celle
d'un plan périmé.

## Risques et pièges

**Le recalcul d'un plan, que ce ticket rend courant.** Un modèle modifié ou une startup rattachée
donnent envie de refaire le plan, et le socle le permet désormais sans casse : `enregistrerPlan`
suffixe les clés d'idempotence par un `planId` tiré à chaque plan (`src/lib/depart.ts:161`), et
`recalculerPlan` (`src/app/departs/[id]/actions.ts:244`) remplace un brouillon périmé ou obsolète
en s'appuyant sur `peutRecalculer` et `etatDUnPlanRemplace` (`src/core/depart.ts:153-173`). Ce qui
reste à surveiller tient à nous : la clé d'une étape de modèle doit être stable d'un calcul à
l'autre pour un même modèle, sinon chaque recalcul déplacerait l'empreinte sans qu'aucun geste
n'ait changé.

**La déduplication par titre slugifié peut fusionner deux gestes différents.** Deux startups qui
écrivent « Faire le point » pour deux choses distinctes n'en auront qu'une. C'est le prix d'une
déduplication automatique, et la parade est de ne jamais fusionner en silence : la liste des
écartées est rendue par `assembler` et affichée sur les écrans d'édition comme dans le dossier. Un
opérateur qui voit « écartée parce que déjà déclarée par l'incubateur » sait quoi faire, un
opérateur qui ne voit rien ne saura jamais que son étape a disparu.

**Refermer l'autorisation rétrécit les plans futurs sans rien effacer.** Personne ne relie
spontanément « j'ai décoché une case il y a trois semaines » à « ce plan d'arrivée est plus court
que prévu ». D'où l'affichage obligatoire du compte des étapes neutralisées sur la page de
l'incubateur, et la mention de l'origine sur la page de chaque startup concernée.

**Un ghid qui change rend un modèle orphelin, en silence.** Le modèle est rattaché par ghid sans
clé étrangère, donc un renommage amont fait cesser sa contribution sans erreur. L'index `/modeles`
doit signaler tout modèle dont le `ownerKey` ne correspond à aucune `Startup` connue : c'est le
seul endroit où cela se verra.

**L'oubli de `pnpm db:generate` et du redémarrage.** Ce ticket ajoute un enum, c'est le cas
exact où le typecheck passe pendant que le runtime refuse la valeur.

**Le tri d'affichage écrase l'ordre déclaré.** Tant que `src/app/departs/[id]/page.tsx:68` trie par
`systemKey` puis `label`, un modèle numéroté un, deux, trois s'affichera dans l'ordre
alphabétique de ses titres. C'est l'étape 5 du découpage, et l'oublier ferait passer une
fonctionnalité correcte pour cassée.

**Le risque de fond : croire qu'une étape de modèle exécute quelque chose.** Un plan qui mélange
« Retirer de l'organisation GitHub » et « Signer la charte » invite à penser que l'outil agit.
L'encart existant du dossier (`src/app/departs/[id]/page.tsx:121-126`) dit déjà que cocher
n'exécute rien : le vérifier après le regroupement par origine, et ne pas le reléguer sous les
étapes.

**Une régression discrète sur le départ existant.** Aucun modèle en base doit donner exactement le
plan d'aujourd'hui, à l'étape et à l'empreinte près. Un assemblage qui insérerait une étape vide,
ou qui changerait l'ordre des étapes de connecteur, déplacerait l'empreinte de tous les plans
brouillons existants et les rendrait inconfirmables du jour au lendemain, sans que personne
comprenne pourquoi.

## Vérification

`pnpm verify` d'abord, puis `/verif` pour le build, qui n'en fait pas partie.

Au-delà, la démonstration se fait en une seule traversée, sur une base de développement :

1. Créer le modèle de départ de l'incubateur avec deux étapes, dont une avec lien et critère.
   Vérifier dans `/journal` que la trace précède l'écriture et porte le nom de l'opérateur.
2. Tenter d'ajouter une étape au modèle de départ d'une startup. Lire le refus, qui doit nommer le
   modèle de l'incubateur et dire quoi faire.
3. Ouvrir l'autorisation, ajouter l'étape, la voir apparaître. Refermer, vérifier que l'étape est
   toujours là et annoncée comme neutralisée.
4. Rouvrir, puis ouvrir un départ pour une personne rattachée à trois startups dont deux portent
   un modèle avec une étape de même titre. Le dossier montre les étapes groupées par origine, une
   seule fois chacune, et l'écart est expliqué.
5. Réécrire le titre d'une étape du modèle. Le plan figé n'a pas bougé et reste confirmable.
6. Ajouter une étape au modèle. Le brouillon se déclare obsolète et refuse la confirmation, avec la
   phrase des collectes et non celle de la péremption. Le bouton de recalcul apparaît dans
   l'encart : le presser produit un plan qui porte la nouvelle étape, et l'ancien passe à `STALE`.
7. Confirmer un plan, puis rattacher la personne à une quatrième startup porteuse d'un modèle. Le
   plan confirmé est inchangé et le dossier affiche l'encart d'écart.
8. Vérifier dans `/journal` que les cinq verbes de modèle ont un libellé français, et non leur
   valeur brute.

C'est fini quand ces huit points passent, que les cinq scénarios de test sont verts, et que la
Definition of Done du ticket est cochée ligne à ligne : le refus effectif et dit, les trois modèles
assemblés sans doublon, l'absence d'effet sur les plans instanciés, la trace avant l'écriture, et
les tests d'assemblage à zéro, une et plusieurs startups.
