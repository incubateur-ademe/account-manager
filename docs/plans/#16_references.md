# Brancher les références : inventaire des actifs possédés (#16)

> Plan d'implémentation de l'issue #16, réécrit d'un bloc le 2 octobre 2026 puis révisé sur les
> arbitrages du mainteneur et sur le gel livré par la PR 147. Le ticket porte le quoi et le
> pourquoi, ce document le comment. Ancres sur `main` au commit `91c1413` : elles datent d'avant
> les PR 146 et 147, et se relisent avant d'écrire.

## Ce qui existe aujourd'hui

- `Reference` a un `personId` obligatoire, `ARCHIVE` par défaut et aucun horodatage
  (`prisma/schema.prisma:353-372`). Aucun code n'y crée de ligne. Seule la fusion de fiches s'en
  sert : elle la lit (`src/app/personnes/[username]/edition.ts:201`), la déplace et la supprime
  (`:572-580`).
- La capacité `reference` est livrée et personne ne la déclare. Son commentaire la réserve à ce
  qu'un connecteur sait faire (`src/core/connector.ts:7-12`).
- `CollectPayload` ignore les objets possédés (`src/core/connector.ts:259-264`), et GitHub ne lit
  aucun dépôt (`src/connectors/github.ts:284-335`).
- Depuis la PR 134, le pointage refuse une saisie obligatoire vide
  (`src/app/dossiers/[id]/actions.ts:468`) et la range dans `PlanStep.reponse`. Écarter une étape
  avec une raison existe aussi (`:343`, `:437`).
- Le transfert Scalingo est une étape `revoke` (`src/connectors/scalingo.ts:1672-1697`), et ce plan
  n'y touche pas. La capacité d'une étape entre dans l'empreinte des plans confirmés
  (`src/core/plan.ts:55-60`).
- La PR 147 fait garder à un plan confirmé, par identifiant, les comptes et les accès que son
  calcul a lus (`Plan.confirmedReads`). Au lancement, le calcul relit le présent plus cette liste
  (`vivantOuLu`, `src/lib/dossier.ts`).

## Décisions

Du 30 septembre, dans le ticket :

- **Le connecteur fixe le destin à chaque collecte.** Lui seul sait ce qu'est l'objet. Une exception
  s'écarte au pointage, avec une raison. Refusé : une colonne de décision.
- **Une référence pointe vers un compte, nullable.** La collecte lit des comptes, et un objet survit
  au sien. Un auteur parti range l'objet aux orphelins. Refusé : `personId`.
- **Une référence n'est jamais une révocation, et `KEEP` ne produit aucune étape.** Une page créée
  par quelqu'un n'est pas un accès. Refusé : toute étape de suppression ou de « rien à faire ».
- **La chute des références a sa famille, la quatrième, et son verrou.** La PR 46 a défait le
  couplage de deux verrous. Refusé : le verrou des ressources.
- **Le repreneur reste en texte libre, saisi au pointage.** La collecte suivante constate le vrai
  propriétaire. Une trace décidée vit sur l'étape, jamais dans le constaté (ADR 0003).
- **Notion passe par un second connecteur, « Notion API interne ».** SCIM ne liste pas les pages.
  Sans jeton, il se résout au tier `none`. Refusé : étendre le connecteur SCIM.

Du 2 octobre, par l'utilisateur :

- **`capability: "reference"` vaut aussi pour une étape.** Une telle étape n'est ni un octroi ni une
  coupure, et aucun chemin qui lit `revoke` ne doit la voir. Refusé : `revoke`.
- **Une référence GitHub est un dépôt d'une organisation suivie où un compte `User` est `admin` en
  collaborateur direct.** Le créateur ne compte pas. `KEEP` si le dépôt est archivé ou si une équipe
  y est admin par assignation directe, `TRANSFER` sinon. Refusé : `ARCHIVE`, geste public ; `read`,
  `write`, `maintain`, qui restent des accès. Relevé : 103 dépôts, 9 concernés sur 4 comptes,
  6 transferts et 3 gardés.

Du mainteneur du lot :

- Quatre PR, et ses autres décisions rangées dans chacune. Ni `onOffboardDecidedBy` ni colonnes de
  repreneur.
- L'ordre des étapes ne protège de rien, et aucune partie de ce plan n'en dépend.
- La lecture GitHub part avec le plan de départ, en B. A n'attend aucun jeton.
- Une référence ne change ni de compte ni de destin en place.
- Un champ `references` absent ou une liste tombée rend le passage PARTIAL, jamais FAILED.

| PR | Contenu | Definition of Done tenue | Bloquée par |
|---|---|---|---|
| A | lots 3 et 4 : schéma, fusion, contrat, socle de collecte, quatrième famille, prouvés par un connecteur double | métadonnées, invariant de collecte, fusion | la fusion des PR 146 et 147 |
| B | lot 5 et source GitHub : lecture des dépôts et plan de départ | aucune suppression, repreneur, trois destins | A |
| C | lot 6, écrans | | A |
| D | « Notion API interne » | | son jeton, ses questions ouvertes, B |

## Le modèle et la migration

```prisma
model Reference {
  id                 String     @id @default(cuid())
  provider           String
  resourceId         String
  externalIdentityId String?
  onOffboard         OnOffboard @default(KEEP)
  firstSeenAt        DateTime   @default(now())
  lastSeenAt         DateTime   @default(now())
  vanishedAt         DateTime?

  resource         Resource          @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  externalIdentity ExternalIdentity? @relation(fields: [externalIdentityId], references: [id], onDelete: SetNull)

  @@index([provider, vanishedAt])
  @@index([externalIdentityId])
}
```

- `provider` est la clé du connecteur qui relève l'objet. La datation filtre dessus, le filtre par
  relation des accès (`src/lib/sync/collecte.ts:470-479`) manquant une référence sans compte.
- Une référence ne change ni de compte ni de destin en place. Un changement date l'ancienne ligne
  (`vanishedAt`) et en ouvre une neuve. Une ressource a donc au plus une référence vivante par
  compte, et garde les autres en historique.
- Cette unicité porte sur `("resourceId", "externalIdentityId")` parmi les lignes vivantes. C'est un
  index unique partiel écrit à la main dans la migration. Le schéma ne le déclare pas, donc le
  client Prisma ne le connaît pas : l'écriture passe par `findFirst` puis `create` ou `update`,
  jamais par `upsert`.
- `SetNull` vers le compte, pour qu'un compte purgé n'efface pas l'objet.
- `Person.references` (`prisma/schema.prisma:148`) disparaît, `Resource.references` (`:327`) reste
  une liste, `ExternalIdentity` gagne `references Reference[]`.
- Aucune valeur d'enum ne disparaît. `PlanStep.capability` et `ScopeDropOverride.famille` sont des
  chaînes (`:683`, `:972`).

La migration `<horodatage>_une_reference_appartient_a_un_compte` sort de
`pnpm db:migrate --create-only` et se complète à la main avant toute application. Elle vient après
`20261001122244_retirer_les_valeurs_mortes`, de la PR 146. En tête, la garde, sur le modèle de
`prisma/migrations/20260916140111_compte_de_service_porte_son_systeme/migration.sql:33` :

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Reference") THEN
    RAISE EXCEPTION 'Reference porte des lignes rattachees a une fiche. Cette migration retire personId et perdrait leur proprietaire. Videz la table ou reprenez-la a la main, puis relancez.';
  END IF;
END $$;
```

Puis `DROP CONSTRAINT "Reference_personId_fkey"` et deux `DROP INDEX`, l'init ayant posé l'unicité
en index (`prisma/migrations/20260808000000_init/migration.sql:357`, `:360`). Puis
`DROP COLUMN "personId"`, les quatre colonnes, `SET DEFAULT 'KEEP'`, deux index et la clé
`ON DELETE SET NULL`. Enfin, ajouté à la main :

```sql
CREATE UNIQUE INDEX "Reference_vivante_par_compte_key"
  ON "Reference"("resourceId", "externalIdentityId")
  WHERE "vanishedAt" IS NULL;
```

Prisma laisse en place un index partiel écrit à la main, comme `AccessCase_un_seul_vivant_par_sens`
(`prisma/migrations/20260824153852_un_seul_dossier_vivant/migration.sql:8-12`). Une référence sans
compte échappe à l'index, Postgres tenant deux nuls pour distincts : c'est la collecte qui refuse un
couple déclaré deux fois. Ensuite `pnpm db:generate` et redémarrer `pnpm dev`, faute de quoi le
runtime refuse `externalIdentityId` pendant que le typecheck passe.

## PR A : schéma, fusion, contrat, socle de collecte

Le socle sait collecter des références avec leur destin, sous la quatrième famille. Aucun connecteur
ne déclare encore `reference`, et un connecteur double prouve le socle. A n'attend aucun jeton. A ne
vaut pas seule. Elle prépare B et C, et retire de la fusion un code que rien ne peut atteindre.

**Fusion.** Les références suivent leurs comptes, et la fusion n'en traite plus.

- `src/core/fiche-manuelle.ts` : retirer `:192-195`, `:249`, `:288-289`, `:335-336`, `:439-445`,
  `:486-487`, `:546-557`, et « les références » du commentaire `:267-270`.
- `src/app/personnes/[username]/edition.ts` : retirer `:54-55`, `:180`, `:201`, `:227`, `:275-276`,
  `:477-478`, `:572-580`, et le même mot du commentaire `:453-456`.
- `src/app/personnes/[username]/Identifiant.tsx:32-36` : la ligne disparaît.
- Tests : `src/core/fiche-manuelle.test.ts:33`, `:141`, `:170-171`, `:181`, le scénario `:254-273`,
  le commentaire `:173-175`, et `src/app/personnes/[username]/fusion.test.ts:209`.

**Contrat**, dans `src/core/connector.ts` :

```ts
export interface ObservedReference {
  resourceExternalId: string;
  ownerIdentityExternalId?: string;
  fate: "archive" | "transfer" | "keep";
}

interface CollectPayload {
  // ... (:259-264)
  /** Présent si et seulement si la capacité `reference` est praticable. Vide : regardé, rien. */
  references?: readonly ObservedReference[];
}
```

**Collecte**, dans `src/lib/sync/collecte.ts` :

1. **Contradiction**, après le retour sur échec (`:382-387`). La capacité `reference` se résout par
   `resolveCapability` sur `await connector.probe()`. Le champ absent alors qu'elle est praticable,
   ou rendu alors qu'elle ne l'est pas, ajoute une erreur unitaire de portée `references`. Le
   passage devient PARTIAL comme pour les autres erreurs unitaires (`:395-398`) : il écrit les
   comptes, les ressources et les accès lus, et ne date rien.
2. **Écriture**, `enregistrerReferences` après `:392`, sur un champ présent et attendu.
   - Une ressource absente de la table d'`enregistrerRessources`, ou un couple ressource et compte
     déclaré deux fois, est une erreur unitaire.
   - Le propriétaire se résout par `findUnique` sur `provider_externalId`, sans filtre de
     disparition. Introuvable, le compte reste nul et aucune erreur ne part, sans quoi chaque auteur
     inconnu rendrait la nuit PARTIAL.
   - Une ligne vivante du même couple et du même destin reçoit `lastSeenAt`. Un couple sans ligne
     vivante en ouvre une. Une ligne vivante du couple à un autre destin reste telle quelle, et le
     changement attend la datation.
3. **Datation**, dans le bloc OK (`:404`), si le champ est présent.
   - Plancher. Tenues : les références vivantes du système. Relues : celles dont le couple revient
     dans le champ, comme `ressourcesRelues` (`src/core/collecte.ts:88`). La datation des
     références ne dépend que de leur propre plancher, comme les identités sous une chute des
     ressources refusée (`src/lib/sync/collecte.ts:432`, `:442`), l'objet survivant à son compte.
   - Puis `reference.updateMany` sur `provider`, `vanishedAt: null` et `lastSeenAt < now`. Il date
     aussi la ligne d'un compte ou d'un destin qui a changé.
   - Puis les lignes neuves des destins changés s'ouvrent.
   - Un passage PARTIAL par erreur unitaire, constaté avant `:404`, ou un plancher des références
     refusé ne date rien et n'ouvre pas ces lignes. L'invariant
     du §5.6 le veut (`docs/architecture.md:1002-1005`), un run non `ok` ne faisant rien
     disparaître. Il tranche le seul cas où deux arbitrages se croisent : un changement de destin
     lu par un passage PARTIAL.
4. **Compte rendu.** `ResultatCollecte` (`:28-42`) gagne `references?`, absent avec le champ, et
   `src/lib/sync/executer.ts:143-147` ne l'imprime que s'il existe.

**Quatrième famille.**

```ts
// src/core/collecte.ts, à la place de :377 et :513
const FAMILLES = ["identites", "ressources", "perimetre", "references"] as const;
export type FamilleDeChute = (typeof FAMILLES)[number];
```

`AMPLEUR_EXIGEE` (`src/core/collecte.ts:532`) prend `false`, `INSTALLATION` (`:882`)
`parRefusIdentiques`, `QUOI` (`src/lib/sync/gardefou.ts:35`) « chute des objets possédés ».
`REDACTION` (`src/app/collectes/redaction.ts:132`) reprend constat et suite de `SYSTEME_CIBLE`
(`:47`), avec `quoi` « des objets possédés » et une conséquence propre, celle de `:51` parlant
d'accès : « Tant que cela dure, un objet possédé qui disparaît de ce système reste tenu pour
présent. » Les commentaires qui comptent les familles passent à quatre (`src/core/collecte.ts:368-376`,
`prisma/schema.prisma:970`, `src/app/collectes/redaction.test.ts:15`, `:176`, `:205`). Ceux qui
comptent les verrous d'un système cible passent à trois (`src/lib/sync/collecte.ts:422`,
`src/app/collectes/redaction.ts:44`).

**Tests.**

- Unitaire, `src/lib/sync/collecte.test.ts`, un scénario, connecteur double déclarant `reference`,
  le double de `@/lib/db` (`:72`) gagnant `reference`. Champ absent avec capacité en PARTIAL sans
  datation, champ rendu sans capacité en PARTIAL et non écrit, `[]` sur base vide sans datation,
  propriétaire inconnu en compte nul, chute refusée sous `references` puis levée une fois.
- Intégration, `src/lib/sync/collecte.integration.test.ts`, un scénario, pour ce que seul l'index
  partiel tient. Deux admins d'une ressource donnent deux lignes vivantes. Un destin changé reste tel
  quel sur un passage PARTIAL, puis date l'ancienne ligne et ouvre la neuve sur un passage OK. Un
  compte changé ouvre sa ligne et date l'ancienne au passage OK. La base refuse une seconde ligne
  vivante du même couple.
- Unitaire, `src/app/collectes/redaction.test.ts` : `references` rejoint les familles de système
  cible écrites en dur (`:49-50`, `:199`) et les boucles sur toutes les familles (`:53`, `:207`), et
  `src/core/collecte.test.ts:576`, où `references` rejoint la liste passée à `estFamilleDeChute`.

**Amendements.**

- §3.2 (`docs/architecture.md:471-473`), tombe sous le sens. Il décrit le modèle décidé le
  30 septembre, et s'écrit dans la PR sous « Les décisions qui méritent une relecture », avec la
  phrase avant et après : « **`Reference`** : un objet possédé, ni accès ni révocable. Elle pointe
  vers le compte qui le possède, nul quand aucun compte connu ne le porte, et non vers une fiche. Une
  ressource a au plus une référence vivante par compte, et un changement de compte ou de destin date
  la référence et en ouvre une neuve. `onOffboard` vaut `ARCHIVE`, `TRANSFER` ou `KEEP`, `KEEP` par
  défaut, et le connecteur le fixe à chaque collecte. Une page créée par quelqu'un n'est pas un
  accès ; les confondre fait proposer des suppressions absurdes. »
- §2.2 et §5.6 posent une règle. Ils se demandent à l'utilisateur à l'ouverture de A, sur ces
  formulations.
  - §2.2, après `:204-209` : « **Le plancher des objets possédés a sa famille et son verrou.** Il
    compare les références vivantes d'un système à celles que la lecture rend encore. Il ne date que
    les références, et seulement quand le connecteur a rendu le champ. »
  - §5.6, après `:1002-1005` : « Un champ `references` absent veut dire « pas regardé », une liste
    vide « regardé, rien ». Le champ absent alors que la capacité `reference` est praticable, ou
    rendu alors qu'elle ne l'est pas, est une erreur unitaire. Le passage devient `PARTIAL` et ne
    date rien. »
- `TODO.md:21-22` et `:24-32`, et `docs/plans/#01_edition-fiche-manuelle.md:244-248`, suivent. Ce
  plan remplace `docs/plans/#16_references.md`.

**Réserve dans le code, hors du #16** : le plancher des startups n'a pas de famille
(`src/lib/sync/constats.ts:101-104`).

## PR B : la lecture GitHub et le plan de départ

GitHub lit chaque nuit les dépôts de ses organisations. Le départ d'un admin direct propose de
transférer ses dépôts, en étape manuelle à repreneur obligatoire. Aucune étape ne propose de
supprimer. B vaut seule une fois A en production.

La lecture et le plan partent ensemble. Un plan confirmé avant le déploiement de B n'a lu aucune
référence, et sa liste `confirmedReads` n'en porte pas la clé : il n'en relit aucune au
lancement. La fenêtre des plans en vol se ferme, et aucune procédure n'est à prévoir pour eux.

**Lecture**, dans `lireOrganisation` (`src/connectors/github.ts:284-335`) :

- `/orgs/{org}/teams/{slug}/repos` dans la boucle des équipes (`:321-332`), sous son propre `try`.
  L'ensemble `adminParEquipe` ne retient que `role_name: "admin"`, lu sur les dépôts d'équipe, qui
  n'ont que l'assignation directe.
- `/orgs/{org}/repos` après la boucle des équipes, puis
  `/repos/{org}/{repo}/collaborators?affiliation=direct` par dépôt. La lecture s'arrête avant la
  boucle quand la liste des équipes tombe (`:316-318`). Coût mesuré : de 36 à 173 appels par nuit.
- Le champ `references` ne se rend que si toutes les listes sont lues, dans chaque organisation :
  dépôts, équipes, dépôts de chaque équipe. Une liste tombée laisse le champ absent avec son erreur
  unitaire, et le socle ajoute la sienne. Le passage est PARTIAL, écrit les comptes et les accès,
  ne date rien, et aucune référence GitHub ne s'écrit cette nuit-là.
- Des collaborateurs illisibles pour un dépôt font une erreur unitaire et écartent ce dépôt. Le champ
  porte les autres, et le passage PARTIAL ne date rien.

**Assemblage** :

- Ressource `${org}/${repo.id}`, libellé `Dépôt ${full_name}`, url `html_url`, contenue par
  l'organisation. Sans accès, elle ne pèse pas sur le plancher des ressources
  (`src/lib/sync/collecte.ts:277-283`).
- Référence : un collaborateur direct de type `User` et `admin`, propriétaire
  `String(collaborator.id)`, comme les membres (`:389`). Plusieurs admins directs donnent une
  référence par compte, chacune sous la même règle de destin.
- Un admin absent des membres est un collaborateur externe. Il devient un compte GitHub sans accès,
  faute de quoi son dépôt irait aux orphelins alors que son auteur est connu. Il compte dans
  `itemsSeen` (`:500`) et dans le plancher des identités (`src/lib/sync/collecte.ts:405-410`), et
  passe au rapprochement comme tout compte.
- Destin : `depot.archived || adminParEquipe.has(depot.id) ? "keep" : "transfer"`.
- Contrat : `reference: [{ requires: [CREDENTIAL], tier: "auto", runbook: RUNBOOK_LECTURE }]`
  (`:1262-1281`). `src/app/inventaire-des-systemes.test.ts:579-580` perd « Aucun connecteur ne la
  déclare aujourd'hui », que GitHub dément.

**Plan de départ.**

```ts
// src/core/connector.ts, bras person de SubjectRef (:311-344)
references?: readonly OwnedReference[];

export interface OwnedReference {
  resourceExternalId: string;
  resourceLabel: string;
  url?: string;
  fate: "archive" | "transfer";
}

// src/core/reference.ts, neuf et pur
export interface ReferenceLue {
  provider: string;
  resourceExternalId: string;
  resourceLabel: string;
  url: string | null;
  onOffboard: "ARCHIVE" | "TRANSFER" | "KEEP";
  matchMethod: string;
}
export function referencesAgissantes(
  lignes: readonly ReferenceLue[],
): ReadonlyMap<string, readonly OwnedReference[]>;
export function etapesDeReference(systemKey: string, username: string,
  references: readonly OwnedReference[], runbook: string): PlannedStep[];
```

- **Filtre**, en un point : destin autre que `KEEP`, rattachement accepté par
  `autoriseUneRevocation` (`src/core/rapprochement.ts:29`), rendu par système. Il ne juge pas la vie
  d'une référence. Il reçoit des lignes déjà gelées. Un connecteur ne reçoit ainsi ni ressemblance
  ni `KEEP`.
- **Lecture**, dans `src/lib/dossier.ts`, à côté de `systemesDeLaPersonne`, par la même règle que
  les comptes : les références vivantes, plus, pour un plan confirmé, celles que son calcul a lues.
  `LecturesDuPlan` gagne `references`, facultative : une liste confirmée qui n'en porte pas la clé
  n'en relit aucune. Une ligne ne se réutilise jamais (une par couple et par destin), si bien que
  l'identifiant désigne exactement ce qui a été lu. La vie du compte n'est pas filtrée, un objet
  survivant à son compte. C'est `SubjectRef` qui s'élargit (`docs/architecture.md:949`).
- **Interrogation** : `interroge` (`:185-194`) gagne un ensemble `possede`, les systèmes où le filtre
  laisse une référence, comme `engages`. La personne peut posséder sans compte vivant. La boucle
  transmet les références du système comme `acces` et `engagements` (`:321-331`).
- **Étape** : `capability: "reference"`, `tier: "manual"`, `action` `archiver` ou `transferer`,
  `riskLevel: "high"` comme le transfert Scalingo (`src/connectors/scalingo.ts:1686`), clé
  `${systemKey}:reference:${resourceExternalId}`, `params: { objet: resourceExternalId }`, sans
  `username`, la clé désignant l'objet. `label` et `manual.title` nomment le geste et l'objet, sur
  le modèle de `src/connectors/scalingo.ts:1684` et `:1690`. `expectedState` vaut
  `{ archive: true }` ou `{ transfere: true }`. `manual` porte le runbook du connecteur,
  `Resource.url` en `deeplink`, un `doneWhen` qui nomme le geste et interdit la suppression, et pour
  un transfert `saisie: { libelle: "Compte du repreneur", obligatoire: true }`, hors de l'empreinte
  (`docs/architecture.md:943-947`).
- **GitHub** : `plan` (`src/connectors/github.ts:1320`) ajoute ces étapes à celles de
  `planifierRetraitGithub`, sans ordre voulu. Le précheck rend `READY` hors octroi et hors retrait
  (`:1357-1360`, `:601`, `:732`), donc une étape de référence n'appelle aucune route.
- **Pas une coupure.** `src/lib/sync/constats.ts:479-484` gagne `capability: { not: "reference" }`.
  Sinon un transfert pointé avant la disparition du compte lève `OVERDUE_MANUAL_ACTION`
  (`src/core/constat.ts:505`). `voiesDuJour` (`src/app/dossiers/[id]/voie.ts:23-49`) saute
  `reference`, sans quoi `voieLisible` (`:81`) promettrait un geste automatique sans jeton.

**Tests.**

- Unitaire, `src/connectors/github.test.ts`, deux scénarios. Lecture : quatre dépôts (archivé, tenu
  par une équipe, sans équipe, admin non membre) donnent deux `keep`, deux `transfer` et une
  identité adoptée, un cinquième, non archivé et sans équipe admin, à deux admins directs donne deux
  références toutes deux `transfer`, et un `write` ne donne rien. Pannes : la liste des dépôts, celle des équipes, puis celle des dépôts d'une équipe tombent
  (champ absent, erreur unitaire), puis les collaborateurs d'un seul dépôt (erreur unitaire, les
  autres références restent).
- Unitaire, `src/core/reference.test.ts`, deux scénarios. Trois destins : `KEEP` ne produit rien,
  `archiver` nomme l'archivage sans dire « supprimer », `transferer` porte la saisie obligatoire,
  rien en `revoke` ni en `auto`, mêmes clés sur deux calculs. Filtre : `DECLARED` et
  `GITHUB_LOGIN` agissent, `HEURISTIC` et `NONE` non. Une ligne reçue agit sans que le filtre juge
  sa vie, compte disparu compris.
- Unitaire, `src/lib/dossier.test.ts:899`, étendu sur le précédent des engagements : le dossier
  remet à chaque système ses références et rien aux autres, et un système où la personne ne possède
  qu'une référence est quand même interrogé. Les doubles de `@/lib/db` qui calculent un départ
  gagnent `reference.findMany` (`src/lib/dossier.test.ts:130`,
  `src/app/dossiers/[id]/actions.test.ts:231`, `src/lib/arrivee.test.ts:66`).
- Unitaire : `voiesDuJour` ne rend rien pour une étape `reference`. Aucun test n'existe encore pour
  `voie.ts`.
- Unitaire, `src/lib/sync/constats.test.ts` : le double honore `capability: { not: "reference" }`
  comme il honore `engagementKey` (`:180-193`), et le scénario de `:957` gagne une étape de
  référence soldée, compte encore vu, qui ne lève rien.
- Intégration, `src/lib/gel-des-tolerances.integration.test.ts` : une référence disparue après la
  confirmation reste dans le plan recalculé, un changement de destin depuis laisse l'empreinte
  égale, et un plan confirmé sans la clé `references` n'en relit aucune.
- Contrat, `src/connectors/github.contrat.test.ts`, sur le modèle de
  `src/connectors/scalingo.contrat.test.ts` : le jeton de lecture lit les trois routes et rend
  `archived`, `type`, `role_name`. `GITHUB_TOKEN`, que seul `playwright.config.ts:128` vide
  aujourd'hui, rejoint `ADRESSES_MORTES` (`vitest.config.ts:37-54`) et
  `src/etages-de-test.test.ts:47`.

**Amendements.**

- §5.1 (`docs/architecture.md:861-864`), **accordé le 2 octobre** : « `reference` dit aussi la
  nature d'une étape. Une étape `capability: "reference"` porte un geste sur un objet possédé,
  archiver ou transférer, et n'est ni un octroi ni une coupure. » `src/core/connector.ts:7-11` suit.
- §3.4 (`:577-585`), tombe sous le sens : « **Un départ lit trois sources et non une.** Les
  connecteurs y reçoivent les accès que la collecte a constatés, les engagements ouverts, que le
  socle retrouve sur les étapes de plan qui les ont ouverts, et les objets possédés dont le destin
  appelle un geste. » La phrase du gel que la PR 147 ajoute au §3.4 nomme aussi les objets
  possédés.
- §5.4 (`:949-952`), tombe sous le sens : « Son bras `person` porte aussi, pour un départ, les
  objets que la personne possède sur ce système, quand leur destin n'est pas `KEEP` et que le
  rattachement de leur compte autorise un geste. »
- §5.8 (`:1070`), tombe sous le sens : « Il relève aussi, comme objets possédés, les dépôts où un
  compte de type `User` est admin en collaborateur direct. »

**Réserve dans le code, hors du #16** : le droit admin de l'équipe `all_repo_admin` sur les dépôts
n'est pas modélisé, une appartenance d'équipe s'écrivant `member` (`src/connectors/github.ts:432`).

**Ouvert.** Une tolérance qui couvre tout un système écarte aussi ses étapes de référence, avec sa
raison (`src/lib/dossier.ts:358-372`). C'est l'effet du code actuel. À confirmer par le mainteneur.

## PR C : les écrans

L'écran dit « objets possédés », jamais « inventaire », qui compte déjà les comptes
(`src/app/page.tsx:240`), ni « référence », qui nomme le chiffre du garde-fou
(`src/app/collectes/redaction.ts:119`). C se livre après A. Ses écrans restent vides tant que B ne
lit rien.

- **Classement**, `src/core/objets-possedes.ts`, pur, sur les références vivantes, première section
  qui s'applique. Orphelins : compte nul, compte rattaché à aucune fiche (un compte de service n'en a
  pas), fiche sortie (critère d'ORPHAN, `src/lib/sync/executer.ts:221`) ou compte disparu. Auteur à
  confirmer : ressemblance. Auteur présent : le reste. La lecture Prisma vit dans
  `src/lib/objets-possedes.ts`.
- **Page** `src/app/objets-possedes/page.tsx` : `h1` « Objets possédés », sans fil d'Ariane, trois
  sections `h2` dans cet ordre, une section vide absente. Colonnes : Objet (lien), Système, Compte,
  Au départ. Consultation seule. Sans système qui recense, une phrase et un lien vers `/systemes`.
- **Fiche** : `SectionObjetsPossedes.tsx` après `SectionComptesExternes`
  (`src/app/personnes/[username]/page.tsx:552`), nourrie par le `select` des identités
  (`:120-131`).
- **Destin** : une table exhaustive sur `OnOffboard` dans `src/ui/severites.ts`.
- **Navigation** : entre « Modèles » et « Systèmes » (`src/ui/Navigation.tsx:25-26`), commentaire
  `:14` à treize, `:33` et `:53` à douze, et `/objets-possedes` dans `src/ui/navigation.test.ts:34`.
- **Accueil** : une tuile « N objets possédés », « Dont M orphelins. », dans la section de
  `src/app/page.tsx:239-338`, nourrie par le `Promise.all` de `src/lib/inventaire.ts:73`.
- **Systèmes** : « Inventorier » devient « Recenser » (`src/app/systemes/page.tsx:34`), le test
  n'épinglant que le `quoi` (`src/app/inventaire-des-systemes.test.ts:586`).
- **Dossier** : C n'y touche pas. Les étapes de référence restent avec les autres étapes de leur
  système, sous « Sur les systèmes couverts » (`src/app/dossiers/[id]/page.tsx:131-133`).

**Tests.** Unitaire, `src/core/objets-possedes.test.ts` : un objet par cas, compte de service
compris, total conservé. La page entre dans `ECRANS` (`e2e/releve-visuel.spec.ts:40-68`), sans quoi
`src/app/ecrans-releves.test.ts:85-88` échoue. `e2e/semis-riche.ts` gagne des dépôts (`:58-64`) et
des références pour les trois sections et `03-personne-fiche`. Aucun plafond visuel ni de
`src/cli/seuils-ui.json` ne bouge.

## PR D : le connecteur « Notion API interne »

Les pages partagées avec une connexion interne, rattachées au compte SCIM de leur créateur. D se
planifiera sur les réponses ci-dessous. Ni contrat ni test ne s'écrivent avant.

**Ce qui la bloque.**

- Le jeton de la connexion interne, en lecture, que l'utilisateur crée. Seul un propriétaire du
  workspace peut en créer une.
- La jonction des identifiants. Un test sur ce jeton doit montrer que l'API publique désigne un
  utilisateur par l'identifiant de SCIM. Aucune des deux documentations ne l'affirme.

**Questions ouvertes.**

- La résolution du propriétaire sous la clé `notion`. Les comptes Notion vivent sous la clé du
  connecteur SCIM (`CONTRAT_NOTION`, `src/connectors/notion.ts`), et la collecte résout un compte à
  la clé du passage en cours (`src/lib/sync/collecte.ts:186-189`). Piste : `identitiesFrom: "notion"`
  au contrat.
- La règle de destin. Il n'y en a aucune, et sans elle tout vaut `keep`. Piste : `transfer` pour une
  page à la racine.
- La datation sur preuve. Search ne garantit pas l'exhaustivité, et dater sur absence ferait
  clignoter des pages. Piste : dater sur `in_trash: true`, ce que le socle de A ne sait pas faire.
- Le niveau d'information utilisateur de la connexion.

## Risques et pièges

**Empreinte des plans en vol.** Un plan confirmé avant le déploiement de B n'a lu aucune référence,
et n'en relit aucune. Après B, le gel par identifiant couvre la disparition et le changement de
compte ou de destin, qui date l'ancienne ligne au lieu de la réécrire. Un objet apparu après la
confirmation entre au calcul et rend le plan obsolète, comme un compte. Le gel ne couvre pas un
rattachement changé depuis la confirmation, pas plus que pour les comptes.

**Jeton de lecture GitHub.** Le relevé du 2 octobre a tourné avec un jeton OAuth `admin:org`, pas
avec le jeton fine-grained de l'application. Qu'il lise collaborateurs directs et dépôts d'équipe
n'est pas vérifié. Ouvert à une sélection de dépôts, il peut rendre une liste courte sans erreur.
S'il ne lit pas les collaborateurs, chaque dépôt fait une erreur unitaire, et GitHub passe PARTIAL
chaque nuit. Plus aucun compte ni accès ne s'y daterait. Le test de contrat de B le constate avant
le déploiement.

**Retrait d'organisation et admin direct.** L'ordre des étapes ne protège de rien. L'exécution trie
par réversibilité, puis risque, puis rang (`src/core/execution.ts:158-165`), et une étape manuelle
ne part jamais au lancement (`src/core/plan.ts:283-287`, `src/lib/execution.ts:508`). Le retrait
GitHub automatique (PR 145) part donc avant tout transfert. Le transfert d'un dépôt est un geste
d'un propriétaire de l'organisation, possible après le retrait de la personne qui part. Le plan ne
dépend pas de ce que le retrait emporte. S'il emporte l'admin direct, la référence se date après la
confirmation, et le gel garde l'étape.

**Volume Notion.** La connexion ne voit que ce qu'on lui partage, une source de données plafonne à
10 000 résultats, le débit à 180 requêtes par minute, 600 en Business et Enterprise. Des milliers
de pages imposeraient à `/objets-possedes` la pagination du journal
(`src/app/journal/page.tsx:217`).

**Ordre de livraison.** Les PR 146 et 147 fusionnent avant A. Parmi les fichiers que ce plan cite,
elles touchent `prisma/schema.prisma`, `docs/architecture.md`, `src/core/connector.ts`,
`src/core/constat.ts`, `src/core/fiche-manuelle.test.ts`, `src/connectors/github.ts`,
`src/connectors/scalingo.ts`, `src/connectors/notion.ts`, `src/lib/sync/constats.ts`,
`src/lib/dossier.ts`, `src/lib/dossier.test.ts`, `src/lib/gel-des-tolerances.integration.test.ts`,
`src/app/dossiers/[id]/actions.test.ts`, `src/app/dossiers/[id]/actions.ts`,
`src/app/personnes/[username]/page.tsx`, `docs/deploiement.md` et `e2e/semis-riche.ts`. Les ancres de ces fichiers se relisent après leur fusion. Puis A, puis B et C
dans l'ordre qu'on veut, puis D après B, quand ses réponses existent.

## Definition of Ready

Les trois cases cochées du ticket le restent. À cocher :

- [x] Ce plan est relu. Il remplace `docs/plans/#16_references.md` dans A.
- [x] Les PR 146 et 147 sont fusionnées.
- [x] Les amendements des §2.2 et §5.6 sont accordés, le 3 octobre.
- [ ] Le test de contrat de B passe avec le jeton de lecture de production. Bloque le déploiement
      de B.
- D sort de #16 le 3 octobre, en ticket à part : il attend la connexion interne Notion et la
  preuve de la jonction des identifiants, et ses quatre questions ouvertes y sont reprises.
