# Dossier et plan génériques : l'arrivée et le départ par le même mécanisme (#8)

> Plan d'implémentation de l'issue #8. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### La moitié départ, complète et en service

Le chemin d'un départ est entier et cohérent. `BoutonDepart`
(`src/app/personnes/[username]/page.tsx:355-362`) appelle `ouvrirDepart`
(`src/app/departs/actions.ts:17`), qui ouvre un dossier (`src/lib/depart.ts:118-143`), calcule un plan
(`src/lib/depart.ts:62-109`), le fige (`src/lib/depart.ts:150-191`) et redirige vers
`/departs/[id]`. La confirmation, le pointage, le recalcul et la clôture vivent dans
`src/app/departs/[id]/actions.ts`, les machines à états sont pures dans `src/core/depart.ts`
(`peutConfirmer:28`, `peutPointer:57`, `etatApresPointage:80`, `dossierSoldable:95`,
`peutRecalculer:153`, `etatDUnPlanRemplace:171`), l'empreinte et la péremption dans `src/core/plan.ts`
(`empreinteDuPlan:12`, `peremptionDuPlan:48`).

### Ce qui manque pour l'arrivée

- `PlanKind` vaut `OFFBOARDING | DRIFT_FIX | MANUAL_OP` (`prisma/schema.prisma:315-319`). Pas
  d'`ONBOARDING`.
- Le seul émetteur d'`Intent` du dépôt écrit `kind: "revoke"` en dur (`src/lib/depart.ts:91`). Le type
  prévoit pourtant `grant` depuis le début (`src/core/connector.ts:170-174`).
- `github` ne déclare que `list` et `revoke` (`src/connectors/github.ts:157-162`) et son `plan()` rend
  une liste vide pour tout ce qui n'est pas un retrait sur une personne
  (`src/connectors/github.ts:223-226`). La troisième origine d'étapes serait donc vide au premier jour.
- Aucune notion de modèle ni de profil. `configSchema` réserve `systems` et `permanentDerogations`
  sans les lire (`src/core/policy.ts:320-354`), rien d'autre.
- Il n'y a pas de page `/departs` : `revalidatePath("/departs")` (`src/app/departs/actions.ts:42`)
  rafraîchit une route qui n'existe pas, et la navigation n'a aucune entrée vers les dossiers
  (`src/ui/Navigation.tsx:7-16`).

### Six pièges vérifiés dans le code, dont les deux premiers déjà réglés

**1. L'invariant d'identité sûre, désormais tenu par le socle.** La règle vit en un seul endroit,
`METHODES_REVOCABLES` et `autoriseUneRevocation` (`src/core/rapprochement.ts:23-31`) ; la fonction
pure `systemesDuDepart` (`src/core/depart.ts:121-143`) répartit les comptes constatés en
`revocables`, `observes` et `nonConfirmes`, et `systemesDeLaPersonne` (`src/lib/depart.ts:29-41`) s'y
branche. `src/lib/sync/executer.ts:187` consomme la même fonction au lieu de l'allowlist qui y était
recopiée en dur. Ce lot ne doit pas rouvrir la porte : un rapprochement `HEURISTIC` écrit bien un
`personId` (`src/core/rapprochement.ts:183`, persisté en `src/lib/sync/rapprochement.ts:76-83`), et
c'est la méthode qui décide, jamais la seule présence d'un `personId`.

**2. La clé d'idempotence d'un second plan, désormais distincte.** `PlanStep.idempotencyKey` est
unique globalement (`prisma/schema.prisma:399`) et la clé était suffixée par l'identifiant du
dossier, ce qui aurait donné les mêmes clés à deux plans successifs d'un même dossier. `enregistrerPlan`
tire maintenant un `planId` avec `randomUUID()` et suffixe par lui (`src/lib/depart.ts:161` et
`:182`) ; `recalculerPlan` (`src/app/departs/[id]/actions.ts:244-288`) exerce déjà ce chemin. Reprendre
le suffixe au dossier dans l'assemblage générique casserait au premier recalcul.

**3. La vérification de ce qui est déclaré fait est à sens unique.**
`constatsDActionsDeclarees` (`src/core/constat.ts:186-207`) tient « le compte est toujours là après
relecture » pour un démenti. Appliquée telle quelle à une arrivée, elle ouvrirait un constat de
gravité haute sur chaque étape réussie, puisqu'un compte présent y est le résultat recherché. Et sa
source de données passe par `plan.departureCase.person` (`src/lib/sync/constats.ts:220-241` et `:256`).

**4. Une étape de plan n'a pas de rang.** L'écran trie par `systemKey` puis `label`
(`src/app/departs/[id]/page.tsx:68`). Sans conséquence pour un retrait, faux pour une arrivée, où
l'ordre est le mode d'emploi : on crée le compte avant de l'ajouter à un groupe.

**5. La dérive d'un plan confirmé ne se voit pas.** Le recalcul a lieu à l'affichage
(`src/app/departs/[id]/page.tsx:96`), mais la bannière n'est rendue que pour un brouillon (`:128`). Un
plan confirmé peut donc cesser de décrire la situation sans que l'écran le dise.

**6. Les tests n'ont pas de base.** `vitest.config.ts` fixe `environment: "node"` et rien n'ouvre de
connexion Prisma dans un test. Tout ce qui doit être couvert doit donc être pur.

## Décisions de conception

### D1. Un seul dossier, avec un sens, et non un second modèle

`DepartureCase` est généralisé, pas dupliqué. Un second modèle imposerait deux écrans, deux machines
à états et deux façons de croire qu'une affaire est réglée, pour un mainteneur à temps partiel.
`docs/architecture.md` (section 6) pose d'ailleurs que l'onboarding et l'offboarding sont symétriques
par construction : deux modèles seraient la trahison de cette phrase, pas son application.

Le point que le ticket signale à raison, `WATCH` et `CANDIDATE` n'ont aucun sens pour une arrivée, se
traite sans second modèle : les valeurs restent, et une fonction pure dit lesquelles sont admises
selon le sens. Une arrivée est une décision, jamais une veille ni un soupçon ; elle naît donc en
`CONFIRMED` et ne connaît que `CONFIRMED`, `CANCELLED`, `DONE`. `WATCH` reste réservé à ce qu'une
collecte lèvera un jour toute seule, comme le dit déjà `src/lib/depart.ts:134-136`.

### D2. Le modèle est renommé, la table aussi

Un dossier d'arrivée stocké dans une table nommée `DepartureCase` est un mensonge de schéma, et ce
dépôt refuse ce genre de mensonge (voir le commentaire sur la fausse organisation dans
`src/connectors/github.ts:17-21`). Le modèle devient `AccessCase`, avec `kind: CaseKind` valant
`ONBOARDING` ou `OFFBOARDING`, ce qui aligne exactement le vocabulaire du dossier sur celui de
`PlanKind`. L'enum `DepartureState` devient `CaseState`, valeurs inchangées.

Le champ de relation s'appelle `accessCase` et non `case` : `case` est un mot réservé de JavaScript,
et une déstructuration finirait par ne pas compiler pour une raison que personne ne cherche au bon
endroit. L'alternative française `Dossier` a été écartée pour rester dans le registre des autres
modèles (`Person`, `Plan`, `PlanStep`, `Finding`), le français restant la règle pour le code métier,
les commentaires et l'interface.

### D3. Les modèles vivent dans la politique YAML, pas en base

Un modèle dit ce qu'implique une arrivée : il change quelques fois par an, ne nomme personne, et doit
se relire dans un diff. C'est la définition même du déclaré au sens de `docs/architecture.md` section
1.4. Il va donc dans `config/config.yaml`, à côté de `systems` et de `permanentDerogations`, validé
par le schéma Zod de `src/core/policy.ts` et vérifiable par `pnpm policy:check` sans base ni secret.

Le mettre en base coûterait un écran de saisie, un versionnement à inventer, un journal d'audit sur
la modification d'un modèle, et une revue impossible. Rien de tout cela n'est demandé.

Un modèle porte une portée (`incubateur` ou `startup`, avec le `ghid` visé) et un sens
(`ARRIVEE` ou `DEPART`), parce qu'une startup a aussi des gestes de départ qui ne concernent qu'elle.

### D4. Trois origines, un ordre, un dédoublonnage

L'assemblage est déterministe et se lit dans cet ordre :

1. le modèle de l'incubateur, dans l'ordre de ses étapes,
2. les modèles des startups de la personne, startups triées par `ghid`, étapes dans leur ordre,
3. les étapes rendues par les connecteurs, connecteurs dans l'ordre de `CONNECTEURS`
   (`src/connectors/index.ts:10`), étapes dans l'ordre rendu.

Le rang est figé dans la ligne, comme le reste. Le dédoublonnage se fait sur `idempotencyKey` :
la première occurrence gagne et garde sa place, les suivantes sont écartées sans bruit. Deux lignes
pour un même geste, c'est une ligne qu'on pointe et une qui pourrit.

L'ordre stocké est celui de la lecture, à ne pas confondre avec l'ordre de réversibilité décroissante
que `docs/architecture.md` section 5.6 impose à l'exécution : le jour où une exécution automatique
existera, elle triera à son démarrage, elle ne réécrira pas le plan.

### D5. Un modèle modifié après coup ne réécrit rien, mais rend le brouillon inconfirmable

Les étapes sont figées à la création, décision déjà actée par le ticket. Conséquence exacte, et c'est
la réponse attendue par la Definition of Ready : modifier un modèle ne touche à aucun plan existant.
Mais l'empreinte se recalcule à l'affichage et au démarrage de l'exécution, et elle change. Un
brouillon devient donc obsolète et refuse d'être confirmé, avec la raison qui existe déjà
(`src/core/depart.ts:42-48`) ; il se recalcule par le chemin qui existe désormais, `peutRecalculer`
(`src/core/depart.ts:153`) et l'action `recalculerPlan`. Un plan confirmé, lui, garde ses étapes et
affiche la dérive, ce qui suppose de corriger le piège 5.

### D6. Le contrat de connecteur ne bouge pas pour planifier, il gagne un mot pour exécuter

Le ticket a raison sur la planification : le sens du plan choisit le `kind` de l'`Intent`, et
`Connector.plan` répond déjà selon le tier résolu. Rien à changer.

En revanche `PrecheckResult` et `StepOutcome` ne connaissent que `ALREADY_ABSENT`
(`src/core/connector.ts:200-208`), qui est le cas nominal d'un retrait déjà fait par quelqu'un
d'autre. Le cas nominal symétrique d'une arrivée, l'accès déjà ouvert, n'a pas de mot. On ajoute donc
`ALREADY_PRESENT` aux deux types et à `StepState`. C'est une extension, pas une rupture : aucun
connecteur n'implémente `precheck` ni `execute` aujourd'hui. Le renommage de la paire en un terme
neutre a été écarté, il faudrait migrer les lignes existantes pour gagner un mot moins clair.

### D7. La présence n'est établie que par un rattachement sûr, dans les deux sens

Seules les méthodes `DECLARED`, `GITHUB_LOGIN` et `EMAIL_EXACT` prouvent qu'un compte appartient à
quelqu'un. La règle est déjà écrite et ne se réécrit pas : `autoriseUneRevocation`
(`src/core/rapprochement.ts:29`). Règle unique appliquée aux deux sens, mais dont les conséquences ne
sont pas symétriques, et c'est voulu :

- pour un départ, une identité douteuse ne produit aucune étape ; le système concerné est affiché à
  part, avec un lien vers les comptes isolés pour trancher, ce qui est en service
  (`src/app/departs/[id]/page.tsx:162-182`) ;
- pour une arrivée, une identité douteuse ne supprime pas l'étape d'octroi. Écarter un octroi sur la
  foi d'une ressemblance priverait quelqu'un d'un accès sans que rien ne le signale, alors qu'un
  octroi de trop se solde en un clic sur « déjà présent ».

Dans les deux cas le doute est affiché au même endroit et avec la même phrase.

### D8. Le journal garde ses anciens verbes

Les nouveaux gestes s'écrivent `dossier.ouverture`, `dossier.confirmation`, `dossier.pointage`,
`dossier.recalcul`, `dossier.cloture`. Les quatre libellés `depart.*` de
`src/app/journal/libelles.ts:18-21` restent en place : le journal est en écriture seule à rétention
indéfinie, et une ligne d'il y a six mois doit rester lisible. Le sens du dossier voyage dans la
charge utile de la trace. À relever au passage : `depart.recalcul` est déjà tracé
(`src/app/departs/[id]/actions.ts:271`) sans libellé correspondant, ce lot est l'occasion de combler
ce trou.

### D9. Une arrivée se prépare depuis une fiche existante

Le pivot d'identité reste le `username` beta.gouv. On prépare donc l'arrivée de quelqu'un que le
périmètre connaît déjà, c'est-à-dire dont la collecte de l'espace-membre a créé la fiche. Préparer
l'arrivée d'une personne sans fiche est hors de ce lot : il faudrait inventer une identité avant
qu'une source ne la donne.

### Tensions avec `docs/architecture.md`

Le document fait référence et ne se modifie pas sans validation explicite. Trois points à lui
soumettre, ce que demande d'ailleurs la Definition of Done du ticket :

1. **Section 3.3** nomme `DepartureCase` dans la liste du décidé. La D2 le renomme. C'est le ticket
   qui demande de trancher ce sort, donc le document suit le code une fois la décision validée.
2. **Section 6** parle de « profil », un ensemble d'accès associé à un rôle. Le ticket parle de modèle
   d'incubateur et de modèles de startups : ce n'est pas le même découpage. Proposition à valider, le
   modèle est le porteur générique et le profil par rôle reste à ouvrir plus tard, sans quoi il
   faudrait décider dès maintenant d'un référentiel de rôles que personne n'a demandé.
3. **Section 5.6** ne mentionne que « déjà absent ». Elle gagne son symétrique.

## Modèle de données

Une seule migration, écrite à la main. Le nom proposé : `dossier_generique`.

### Ce que le schéma devient

```prisma
enum CaseKind {
  ONBOARDING
  OFFBOARDING
}

enum CaseState {
  WATCH
  CANDIDATE
  CONFIRMED
  CANCELLED
  DONE
}

model AccessCase {
  id String @id @default(cuid())

  personId        String
  kind            CaseKind
  state           CaseState @default(WATCH)
  firstSignalAt   DateTime  @default(now())
  effectiveDate   DateTime? @db.Date
  cancelledReason String?

  person Person @relation(fields: [personId], references: [id], onDelete: Cascade)
  plans  Plan[]

  @@index([personId])
  @@index([state])
  @@index([kind, state])
}
```

`PlanKind` gagne `ONBOARDING`. `StepState` gagne `ALREADY_PRESENT`. `Plan.departureCaseId` devient
`Plan.accessCaseId`, `Plan.departureCase` devient `Plan.accessCase`, `Person.departureCases` devient
`Person.accessCases`.

`PlanStep` gagne quatre colonnes, toutes figées à la création au même titre que `manual` :

```prisma
  ordre   Int    @default(0)
  origine String @default("connecteur")
  saisie  Json?
  reponse String?
```

`origine` retient d'où vient la ligne : `connecteur`, `modele:incubateur`, ou
`modele:startup:<ghid>`. Elle sert à grouper l'affichage et surtout à ce qu'un plan explique
lui-même sa composition dans deux ans. `saisie` porte la déclaration figée de ce qui est demandé
(libellé, obligatoire ou non), `reponse` ce que l'opérateur a saisi au pointage.

Une étape de modèle qui ne vise aucun système porte `systemKey = "modele"`. La valeur ne correspond à
aucune clé de connecteur, ce qui la met hors de portée de toute vérification par relecture, et c'est
correct : personne ne relira jamais une charte signée.

### SQL de la migration

```sql
CREATE TYPE "CaseKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');
ALTER TYPE "DepartureState" RENAME TO "CaseState";
ALTER TYPE "PlanKind" ADD VALUE 'ONBOARDING';
ALTER TYPE "StepState" ADD VALUE 'ALREADY_PRESENT';

ALTER TABLE "DepartureCase" RENAME TO "AccessCase";
ALTER TABLE "AccessCase" ADD COLUMN "kind" "CaseKind" NOT NULL DEFAULT 'OFFBOARDING';
ALTER TABLE "AccessCase" ALTER COLUMN "kind" DROP DEFAULT;

ALTER TABLE "Plan" RENAME COLUMN "departureCaseId" TO "accessCaseId";

ALTER TABLE "PlanStep" ADD COLUMN "ordre" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlanStep" ADD COLUMN "origine" TEXT NOT NULL DEFAULT 'connecteur';
ALTER TABLE "PlanStep" ADD COLUMN "saisie" JSONB;
ALTER TABLE "PlanStep" ADD COLUMN "reponse" TEXT;
```

Les index et contraintes renommés par Postgres avec leur table gardent leur ancien nom : les aligner
(`ALTER INDEX "DepartureCase_pkey" RENAME TO "AccessCase_pkey"`, idem pour les index de `personId`,
de `state` et pour la clé étrangère de `Plan`) évite une dérive que `prisma migrate` signalera à la
prochaine occasion.

Le défaut `OFFBOARDING` sur `kind` existe le temps de remplir les lignes déjà là, puis disparaît :
tous les dossiers existants sont des départs, et laisser un défaut ferait naître en départ un dossier
dont le code aurait oublié de dire le sens.

### Comment on l'applique

1. Modifier `prisma/schema.prisma`.
2. `pnpm db:migrate --create-only`. **Obligatoire** : sur un renommage, Prisma propose un `DROP TABLE`
   suivi d'un `CREATE TABLE`, ce qui efface les dossiers, les plans et les étapes déjà pointées.
3. Remplacer le contenu du fichier généré par le SQL ci-dessus.
4. `pnpm db:migrate` pour l'appliquer, puis **`pnpm db:generate` et redémarrage de `pnpm dev`**. Les
   deux caches se cumulent, comme le rappelle `CLAUDE.md` : sans cela le typecheck passe pendant que
   le runtime répond `Value 'ONBOARDING' not found in enum 'PlanKind'`.
5. Relancer `pnpm db:migrate` : il doit annoncer qu'il n'y a plus rien à faire. Toute dérive
   résiduelle se voit là et pas ailleurs.

Si Postgres refuse un `ALTER TYPE ... ADD VALUE` dans la transaction de la migration, sortir les deux
ajouts de valeurs dans une migration antérieure et vide par ailleurs. Aucun ordre du fichier
n'utilise ces nouvelles valeurs, le cas ne devrait donc pas se présenter.

## Découpage en étapes

### Étape 1. Tenir l'invariant d'identité sûre, dans les deux sens

**Livrée pour le départ**, avant ce lot et sans schéma ni renommage.

- `src/core/rapprochement.ts` porte `METHODES_REVOCABLES` et `autoriseUneRevocation(methode)`, la
  règle vit là et nulle part ailleurs.
- `src/core/depart.ts` porte la fonction pure `systemesDuDepart(comptes)`, qui rend `revocables`,
  `observes` et `nonConfirmes` ; `src/lib/depart.ts` l'appelle depuis `systemesDeLaPersonne` et
  `PlanCalcule` porte `nonConfirmes` (`:55`) là où cette étape prévoyait `douteux`. Le champ
  `sansConnecteur` porte désormais sur tous les systèmes observés, et non sur les seuls révocables.
- `src/lib/sync/executer.ts:187` consomme la fonction au lieu du tableau en dur.
- `src/app/departs/[id]/page.tsx:162-182` affiche la bannière des comptes non confirmés, avec son lien
  vers `/comptes-isoles`.

Reste au titre de cette étape : rien pour le départ. Pour l'arrivée, la moitié inverse de la D7, une
ressemblance n'écarte jamais un octroi, se tient dans l'assemblage de l'étape 4.

### Étape 2. Le schéma générique

`prisma/schema.prisma`, la migration décrite plus haut, puis la reprise mécanique des usages Prisma :
`src/lib/depart.ts` (`:122`, `:131`, `:151`, `:163`, `:166`), `src/app/departs/[id]/actions.ts`
(`:36-37`, `:54`, `:60-61`, `:80`, `:125`, `:158`, `:196`, `:227`, auxquels s'ajoutent `:251`, `:255`
et `:258-259` dans `recalculerPlan`), `src/app/departs/[id]/page.tsx:47`,
`src/lib/sync/constats.ts:228` et `:256`.

À ce stade le comportement ne change pas : tous les dossiers sont des départs.

### Étape 3. Les modèles dans la politique

- `src/core/policy.ts` : schéma Zod `modeleSchema`, ajouté à `configSchema` sous la clé `modeles`.
  Chaque champ porte son `.meta({ description, examples })`, c'est la convention du fichier et le seul
  endroit que le générateur de JSON Schema sait lire. Un `superRefine` exige le `ghid` quand la portée
  vaut `startup`, et refuse deux modèles de même clé.
- `config/config.exemple.yaml` : un exemple d'arrivée pour l'incubateur et un pour une startup.
- `pnpm policy:schema` régénère `config/config.schema.json` (`src/cli/schema-politique.ts:22-31`).

Forme visée :

```yaml
modeles:
  - cle: arrivee-incubateur
    libelle: Arrivée dans l'incubateur
    sens: ARRIVEE
    portee: incubateur
    etapes:
      - cle: charte
        titre: Faire signer la charte de l'incubateur
        runbook: Envoyer la charte, la faire signer, déposer le PDF dans le dossier partagé.
        doneWhen: Le PDF signé est dans le dossier partagé.
        risque: medium
        saisie:
          libelle: Lien du document signé
          obligatoire: true
  - cle: arrivee-ma-startup
    libelle: Arrivée sur ma-startup
    sens: ARRIVEE
    portee: startup
    startup: ma-startup
    etapes:
      - cle: canal
        titre: Ajouter la personne au canal de l'équipe
        runbook: Inviter depuis le canal, rôle membre.
        doneWhen: Elle apparaît dans la liste des membres du canal.
        risque: low
```

Vérifiable : `pnpm policy:check` accepte l'exemple et refuse un modèle de portée `startup` sans
`startup`.

### Étape 4. L'assemblage générique, pur

- `src/core/modele.ts` : `etapesDuModele(modele, sujet)` convertit une déclaration de politique en
  `PlannedStep[]`, avec `capability: "grant" | "revoke"` selon le sens, `tier: "manual"`, la clé
  d'idempotence `modele:<cle>:<cle-etape>:<username>`, et `manual` rempli à partir du titre, du
  runbook et du `doneWhen`.
- `src/core/plan.ts` : `assembler({ origines })` concatène dans l'ordre de la D4, dédoublonne sur
  `idempotencyKey`, numérote `ordre`, et rend les étapes avec leur `origine`.
- `src/core/dossier.ts` (renommé depuis `src/core/depart.ts`) : `etatsAdmis(kind)` et
  `peutOuvrir(kind, etat)`.

Aucune de ces fonctions ne touche à Prisma ni à l'environnement : c'est la condition pour que les
scénarios de test existent.

### Étape 5. L'adaptateur base

`src/lib/dossier.ts` remplace `src/lib/depart.ts` :

- `ouvrirDossier(personId, kind, effectiveDate)` : un seul dossier vivant par personne **et par
  sens**, l'état de naissance dépendant du sens (`CANDIDATE` pour un départ, `CONFIRMED` pour une
  arrivée).
- `calculerPlan(kind, personne)` : lit les identités sûres, lit `policy().modeles`, sélectionne les
  modèles par sens et par portée, interroge les connecteurs avec l'`Intent` du bon `kind`, et appelle
  `assembler`. Pour un retrait, on n'interroge que les connecteurs où la présence est établie
  (règle existante, `src/lib/depart.ts:85`) ; pour un octroi, on interroge tous ceux qui déclarent
  `grant`.
- `enregistrerPlan` : **conserver le suffixe de clé d'idempotence tiré du `planId`**, déjà en place
  (`src/lib/depart.ts:161` et `:182`), et ne pas revenir à l'identifiant du dossier. Le suffixe
  n'entre pas dans l'empreinte, qui se calcule sur les `PlannedStep` avant persistance
  (`src/lib/depart.ts:101`) : les empreintes des plans existants restent donc valides.
- `recalculerPlan` suit le dossier : l'action existante (`src/app/departs/[id]/actions.ts:244-288`)
  appelle `calculerPlanDeDepart` puis `enregistrerPlan`, et devient générique en même temps qu'eux.
- `RunContext.dryRun` continue de valoir `!env.ACTIONS_ENABLED` et ne se force jamais.

### Étape 6. `github` apprend à donner

`src/connectors/github.ts` déclare `grant: [{ requires: [], tier: "manual", runbook: RUNBOOK_INVITATION }]`
et son `plan()` traite `kind === "grant"` en produisant une invitation par organisation, avec son
lien direct et son critère de complétion. Sans cela, la troisième origine d'un plan d'arrivée est
vide et la fonctionnalité ne se démontre pas.

### Étape 7. Les écrans

- Renommer `src/app/departs` en `src/app/dossiers`, y compris les chemins passés à `revalider` :
  `src/app/departs/actions.ts:42` et son `redirect` (`:58`), puis
  `src/app/departs/[id]/actions.ts` (`:80`, `:158`, `:225`, `:276`). Retirer au passage la
  revalidation de `/departs`, qui vise une page inexistante.
- La fiche personne gagne « Préparer l'arrivée » à côté de « Préparer le départ », avec la phrase qui
  dit que rien n'est exécuté.
- L'écran de dossier prend le sens comme paramètre de langage : « ce qu'il faudra donner » contre
  « ce qu'il faudra retirer », étapes groupées par `origine` et triées par `ordre`.
- Pointage : `POINTAGES` (`src/app/departs/[id]/actions.ts:21-26`) gagne `deja-present`. Le libellé
  proposé dépend du sens du plan.
- Saisie : une étape dont `saisie.obligatoire` vaut vrai refuse d'être pointée « faite » sans valeur,
  sur le modèle du refus de note existant (`src/app/departs/[id]/actions.ts:141-148`). La valeur est
  écrite dans `reponse` et figure dans la charge utile de la trace.
- Bannière de dérive affichée aussi pour un plan confirmé (correctif du piège 5), mais sans
  `BoutonRecalculer` : `peutRecalculer` refuse à juste titre un plan déjà engagé, et proposer un bouton
  qui répond toujours non serait pire que pas de bouton du tout.
- `src/app/journal/libelles.ts` : ajouter les cinq verbes `dossier.*`, conserver les quatre `depart.*`
  et donner enfin son libellé à `depart.recalcul`.
- Toute écriture continue de passer par `actionTracee` (`src/lib/actions.ts:30`), jamais par un
  `prisma.*.update` direct : la trace nominative précède l'action.

### Étape 8. La vérification prend le sens en compte

- `src/core/constat.ts` : `ActionDeclaree` gagne `sens`, et `constatsDActionsDeclarees` contredit une
  déclaration quand le compte est **encore là** pour un départ, quand il est **toujours absent** pour
  une arrivée. Les étapes dont le `systemKey` ne correspond à aucun connecteur ne produisent rien.
- `src/lib/sync/constats.ts:219-274` : remonter le `kind` du plan et le passer.
- Le libellé du constat (`src/core/libelle-constat.ts`) dit la bonne moitié de l'histoire.

### Étape 9. La documentation

Soumettre à validation les trois modifications de `docs/architecture.md` listées plus haut. Ne rien
écrire dans ce fichier avant accord explicite.

## Tests

Cinq scénarios, tous purs, tous à plusieurs assertions, dans `src/core/`. Les fichiers existants
(`plan.test.ts`, `depart.test.ts` renommé en `dossier.test.ts`, `constat-verification.test.ts`)
accueillent les nouveaux scénarios plutôt que d'en ouvrir d'autres.

**S1. Une ressemblance ne coupe rien, et ne prive de rien non plus** (`src/core/plan.test.ts`). La
moitié départ est déjà couverte par le describe « ce qu'un plan de départ a le droit de viser »
(`src/core/depart.test.ts:94-143`), qui suit le fichier dans son renommage ; S1 y ajoute la moitié
arrivée et l'assemblage.
Given une personne avec trois comptes, l'un rattaché par login GitHub, l'un par adresse exacte, l'un
par ressemblance. When on assemble son départ, puis son arrivée. Then le plan de départ ne contient
aucune étape visant le système douteux, il le rend à part pour l'écran, les deux autres systèmes ont
bien leur étape, et le plan d'arrivée propose quand même l'octroi sur le système douteux.

**S2. Une arrivée assemble trois origines, dans l'ordre, et ne dit jamais deux fois la même chose**
(`src/core/plan.test.ts`). Given un modèle d'incubateur de deux étapes dont une avec saisie
obligatoire, deux modèles de startup dont l'un répète une étape de l'incubateur avec la même clé
d'idempotence, et un connecteur qui propose une invitation. When on assemble. Then l'ordre est
incubateur puis startups triées par `ghid` puis connecteurs, le doublon n'apparaît qu'une fois et à
sa première place, chaque étape porte son `origine` et un `ordre` strictement croissant, l'étape à
saisie porte sa déclaration figée, et l'empreinte ne dépend pas de l'ordre dans lequel les origines
ont été fournies.

**S3. Un modèle modifié ne réécrit pas le passé, il périme le brouillon**
(`src/core/plan.test.ts`). La machine du recalcul est déjà couverte par le describe « recalcul d'un
plan » (`src/core/depart.test.ts`) ; S3 porte sur l'assemblage et sur l'empreinte. Given un plan figé et son empreinte. When le modèle de l'incubateur gagne
une étape. Then les étapes figées sont identiques au caractère près, l'empreinte recalculée diffère,
`peutConfirmer` refuse en invoquant l'obsolescence et non la péremption, et le plan recalculé porte
la nouvelle étape à sa place dans l'ordre.

**S4. Une arrivée ne connaît ni veille ni soupçon, et se clôt comme un départ**
(`src/core/dossier.test.ts`). Given les deux sens. When on demande les états admis. Then une arrivée
refuse `WATCH` et `CANDIDATE` et accepte les trois autres, un départ les accepte tous. And le pointage
« déjà présent » vaut soldé au même titre que « déjà absent », une étape en échec laisse le plan en
`PARTIALLY_EXECUTED` et interdit la clôture, et un plan dont toutes les étapes sont soldées la permet.

**S5. Ce qui est déclaré fait se vérifie dans le sens du dossier**
(`src/core/constat-verification.test.ts`). Given une étape de départ et une étape d'arrivée, toutes
deux déclarées faites, et une relecture du système postérieure. When le compte est encore là. Then le
départ ouvre un constat de gravité haute et l'arrivée n'ouvre rien. And quand le compte est absent,
c'est l'inverse. And tant que le système n'a pas été relu depuis la déclaration, aucun des deux ne dit
quoi que ce soit. And une étape de modèle sans système connu ne produit jamais de constat.

## Risques et pièges

**La migration efface tout si elle est générée sans `--create-only`.** Prisma ne devine pas un
renommage. Le geste manquant se voit à la première ouverture d'un dossier existant, c'est-à-dire trop
tard.

**Les deux caches se cumulent après la migration.** `prisma migrate dev` ne régénère pas toujours le
client, et le client est mémorisé sur `globalThis` pour survivre au rechargement à chaud. Symptôme :
`Value 'ONBOARDING' not found in enum 'PlanKind'` alors que la base et le client sont à jour.
`pnpm db:generate` puis redémarrage.

**La vérification à sens unique est le piège le plus coûteux.** Il ne casse rien à l'écriture : il se
découvre une collecte plus tard, sous la forme de constats de gravité haute parfaitement faux sur
toutes les arrivées réussies. Et un rapport qui crie à tort finit par ne plus être lu du tout. Ne pas
livrer l'étape 7 sans l'étape 8.

**La clé d'idempotence unique interdirait un second plan dans un dossier.** Le correctif est déjà en
place, `enregistrerPlan` suffixe par un `planId` tiré à la création (`src/lib/depart.ts:161`). Le
défaire en revenant à l'identifiant du dossier ferait remonter une violation de contrainte au clic,
sous une forme qui ne dit rien de compréhensible.

**Écarter une étape d'octroi sur la foi d'une ressemblance** priverait quelqu'un d'un accès sans que
rien ne le signale nulle part, là où un octroi en trop se solde par un clic. Le sens de la règle
D7 n'est pas symétrique, et il est facile de la coder comme si elle l'était.

**`ACTIONS_ENABLED` reste faux par défaut.** L'étape 6 ouvre une capacité `grant`, ce qui rapproche
d'une écriture réelle. `RunContext.dryRun` continue de se déduire de l'environnement
(`src/lib/depart.ts:76`) et ne se force jamais à `false`.

**Un run non `ok` ne pose aucun `vanishedAt`.** Le calcul de plan lit `vanishedAt: null`
(`src/lib/depart.ts:31`) et fait donc confiance à cette garantie de la collecte. Rien dans ce lot ne
doit la relâcher : une collecte partielle qui daterait des disparitions ferait oublier un système
entier dans un plan de départ, silencieusement.

**Le journal est immuable.** Renommer les verbes passés rendrait illisibles des lignes qui servent de
preuve. Les anciens libellés restent.

**Un `ghid` de startup dans un modèle vieillit.** Une startup renommée ou disparue laisse un modèle
qui ne s'applique plus à personne. Ne pas faire tomber la politique pour autant : signaler, comme le
fait déjà `perimetre.missingDeclared` (`src/lib/sync/executer.ts:211-213`).

**Le renommage des routes touche des chaînes, pas des types.** Un `revalidatePath` oublié ne casse
aucun build : l'écran affiche simplement des données périmées après une action, ce qui ressemble à un
bug de logique métier et se cherche très longtemps au mauvais endroit.

## Vérification

**Automatique.** `pnpm verify` (Biome, typecheck, Vitest) puis le build Next, c'est-à-dire le skill
`/verif` au complet. `pnpm policy:check` sur l'exemple, et `pnpm policy:schema` qui ne doit produire
aucun diff parasite dans `config/config.schema.json`.

**Base.** Après la migration, `pnpm db:migrate` annonce qu'il n'y a rien à appliquer, et le compte de
lignes de `AccessCase`, `Plan` et `PlanStep` est celui d'avant.

**Non-régression du départ, exigée par la Definition of Done.** Sur une personne ayant un compte
GitHub rattaché sûrement, le plan calculé après refonte porte exactement les mêmes étapes qu'avant,
et surtout la même empreinte : elle se calcule sur les `PlannedStep` avant persistance, donc ni le
suffixe de clé d'idempotence, ni `ordre`, ni `origine` ne doivent la faire bouger. Un
changement d'empreinte ici est le signal qu'une régression s'est glissée dans l'assemblage.

**Arrivée de bout en bout, à la main.** Sur une fiche de test, avec un modèle d'incubateur et un
modèle de startup déclarés : ouvrir l'arrivée, vérifier l'ordre des étapes et leur regroupement par
origine, vérifier qu'une saisie obligatoire bloque le pointage, confirmer, pointer une étape en
« déjà présent », en échouer une autre, constater que le dossier refuse de se clore, la reprendre,
puis clore.

**Journal.** Chaque geste laisse une ligne nominative écrite avant l'écriture métier. Filtrer
`/journal` par personne doit raconter l'arrivée dans l'ordre, saisies comprises, et les lignes
`depart.*` d'avant doivent toujours s'afficher avec leur libellé.

**Le ticket, point par point.** Les six cases de la Definition of Done se relisent une par une, la
dernière (`docs/architecture.md` décrit le mécanisme générique) restant suspendue à la validation des
trois modifications proposées.
