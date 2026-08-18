# Acteur attendu et validation par étape (#10)

> Plan d'implémentation de l'issue #10. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

**Une étape ne dit pas qui doit la faire.** `PlanStep` (`prisma/schema.prisma:370-405`) porte le
système, le tier, la capacité, l'action, le libellé figé, les paramètres, le risque, l'état attendu,
la marche à suivre, puis l'état de pointage (`state`, `attempts`, `lastError`, `executedAt`). Aucun
champ ne nomme un acteur, aucun ne dit qu'une déclaration attend une contrepartie.

**Le pointage est déjà une déclaration humaine, pas une exécution.** `pointerEtape`
(`src/app/departs/[id]/actions.ts:101-183`) traduit un choix de formulaire en `StepState` via la
table `POINTAGES` (`:21-26`), exige une note sur `SKIPPED` et `FAILED` (`:141-148`), écrit par
`actionTracee`, puis recalcule l'état du plan avec `etatApresPointage` (`:170-178`). Aucun système
cible n'est appelé.

**Qui a pointé n'est nulle part en base.** L'action écrit `state`, `executedAt`, `attempts` et
`lastError` (`src/app/departs/[id]/actions.ts:160-168`), jamais le username. Le nom de l'auteur
n'existe que dans le journal, via `actionTracee` (`src/lib/actions.ts:30-44`). Une règle « personne ne
valide sa propre déclaration » est donc impossible à tenir sans une colonne de plus : c'est le vrai
manque du modèle, davantage que l'acteur lui-même.

**Le cœur est pur et testé, et il ignore l'acteur.** `src/core/depart.ts` expose `peutConfirmer`
(`:28`), `peutPointer(etat: EtatPlan)` (`:57`), `estSoldee(etat: EtatEtape)` (`:68`),
`etatApresPointage(etapes: readonly EtatEtape[])` (`:80`) et `dossierSoldable` (`:95`). Les trois
dernières raisonnent sur un seul axe, l'état déclaré, ce qui suffit tant que rien n'attend un tiers.
Le même fichier porte aussi `systemesDuDepart` (`:121`), `peutRecalculer` (`:153`) et
`etatDUnPlanRemplace` (`:171`), qui ne disent rien du pointage ni de l'acteur.

**L'écran suppose un opérateur, du premier au dernier pixel.** `DepartPage` appelle
`requireOperateur()` (`src/app/departs/[id]/page.tsx:44`), et `requireOperateur` redirige vers
`/login` quiconque n'est pas dans `OPERATORS` ou `BREAK_GLASS_USERNAMES` (`src/lib/session.ts:23-36`,
`src/core/identite.ts:33-39`). Aucun autre rôle n'existe : tant que #13 n'a pas livré la participation
d'un non-opérateur, personne d'autre ne peut se connecter.

**Le contrat de connecteur ne sait pas exprimer un acteur.** `PlannedStep`
(`src/core/connector.ts:184-198`) porte `systemKey`, `capability`, `tier`, `action`, `label`,
`params`, `riskLevel`, `expectedState`, `idempotencyKey`, `manual`. L'écriture en base recopie ce
jeu tel quel dans `enregistrerPlan` (`src/lib/depart.ts:150-191`), avec la table `RISQUE` (`:18`)
comme seul point de traduction entre le vocabulaire du cœur, en minuscules, et l'enum Prisma. Seule
la clé d'idempotence est retouchée au passage : elle est suffixée par l'identifiant du plan, tiré
avant l'écriture, pour que deux plans successifs d'un même dossier ne se disputent pas les mêmes
clés.

**L'empreinte ne couvre que ce qui engage aujourd'hui.** `empreinteDuPlan`
(`src/core/plan.ts:12-31`) hache `systemKey`, `capability`, `action`, `idempotencyKey` et `params`
triés. Ni le libellé ni l'ordre n'y entrent.

**Pièges relevés dans le code existant.**

- `src/app/departs/[id]/page.tsx:265` teste `dossierSoldable("EXECUTED")`, qui est vrai par
  construction. Le vrai garde-fou est `restantes === 0` (`:102`), calculé avec `estSoldee` : toute
  nouvelle raison d'attendre doit passer par cette fonction, sinon le bouton de clôture réapparaît.
- Les états sont lus par cast (`etape.state as EtatEtape`, `:102`, `:207-208`,
  `actions.ts:172`). Ajouter une seconde dimension sans la typer proprement produirait des
  combinaisons que rien n'interdit.
- La confrontation nocturne ne regarde que `state: "SUCCEEDED"`
  (`src/lib/sync/constats.ts:220-221`) pour lever `OVERDUE_MANUAL_ACTION`. Tout changement du sort
  d'une étape déclarée puis contestée se répercute donc sur cette file.
- `docs/architecture.md` §6, « Qui agit, et comment on valide » (lignes 541 à 558) pose que seule
  l'équipe transverse agit, qu'il n'y a ni approbateurs multiples ni quorum, et annonce le point de
  greffe : « un plan créé par un lead naîtra en attente au lieu de naître confirmable ». Ce ticket
  pose ce point de greffe, il ne l'active pas.
- #8 généralise `DepartureCase` et `Plan`. Tout ce qui suit est additif sur `PlanStep` et sur des
  fonctions pures : les deux ordres de livraison tiennent, sans reprise de migration.

## Décisions de conception

**D1. Deux dimensions orthogonales, pas de nouvelles valeurs de `StepState`.** Une étape porte ce
qui a été déclaré (`state`) et où en est la validation de cette déclaration (`validation`). Ajouter
`AWAITING_VALIDATION` à `StepState` obligerait à décliner chaque déclaration validable
(`SUCCEEDED`, `ALREADY_ABSENT`, `SKIPPED`) en deux valeurs, et l'enum dirait deux choses à la fois.
Ferme la DoR sur l'effet d'une étape en attente : elle n'est ni soldée ni en échec, elle est déclarée
et suspendue.

**D2. `StepActor` porte `DELEGATE` dès la première migration.** Le délégué n'a aucun chemin de code
avant #13, mais ajouter une valeur d'enum plus tard rejoue la migration et le double cache Prisma,
avec l'erreur `Value 'X' not found in enum 'Y'` décrite dans les instructions du dépôt. Une valeur inerte coûte
zéro, une valeur ajoutée après coup coûte un incident.

**D3. Comportement du délégué, spécifié même sans implémentation.** Un délégué est une personne
rattachée à un dossier précis par un droit par objet (#13), typiquement un lead de startup. Il pourra
pointer les étapes dont il est l'acteur attendu et valider celles dont `validationBy` vaut
`DELEGATE`. Il ne valide jamais une étape attendue d'un opérateur. Tant que #13 n'a pas livré,
`roleSurDossier` ne rend jamais `DELEGATE` : une étape `DELEGATE` reste pointable par un opérateur en
substitution (D6), donc aucun dossier ne se bloque. Ferme la DoR sur la liste des acteurs.

**D4. Trois combinaisons, et elles seules.** `validationBy` vaut `OPERATOR` ou `DELEGATE`, jamais
`SUBJECT`, et jamais la même valeur qu'`expectedActor`. Restent : opérateur valide porteur, opérateur
valide délégué, délégué valide porteur. C'est exactement la liste du ticket. La personne concernée ne
valide jamais, sans quoi « j'ai retiré l'accès administrateur » vaudrait preuve parce que son auteur
le redit une seconde fois. Vérifié par une fonction pure à la construction du plan et par une
contrainte `CHECK` en base : aucune ligne ne doit pouvoir affirmer le contraire, même écrite à la
main.

**D5. Un refus renvoie l'étape à `PENDING`, avec sa raison.** `FAILED` dit « l'accès est resté
ouvert et l'action a été tentée », ce qui bloque le dossier en `PARTIALLY_EXECUTED` et appelle une
reprise hors plan. Un refus dit autre chose : la preuve n'est pas faite, refais ou explique. L'étape
redevient donc à faire, `validation` passe à `REFUSED` et `validationNote` porte l'avis du
validateur, obligatoire. Ferme la DoR sur le sort d'une étape déclarée faite puis refusée.

**D6. Le validateur attendu qui pointe lui-même vaut validation.** Un opérateur qui coche à la place
du porteur a vu la chose : exiger ensuite qu'un second opérateur le confirme bloquerait l'outil sur
une instance à un seul mainteneur, ce qui est le cas nominal ici. Le pointage pose donc directement
`ACCEPTED` avec le déclarant comme validateur, et le journal montre les deux gestes d'une seule main.
Dans tous les autres cas, la déclaration passe en `AWAITING`.

**D7. Personne ne valide sa propre déclaration.** La règle porte sur le username, pas sur le rôle :
`declaredBy` est comparé au valideur. C'est la raison d'être de la colonne `declaredBy` ; sans elle la
règle serait déclarative et fausse.

**D8. Un opérateur peut valider ce qu'un délégué aurait dû valider.** Le contraire coincerait un
dossier dès que le délégué s'évapore, situation banale au moment précis où l'outil sert. L'inverse
n'est pas vrai : un délégué ne valide que ce qui lui est explicitement confié.

**D9. Un opérateur porteur de son propre dossier est `SUBJECT`, pas `OPERATOR`.** `roleSurDossier`
regarde d'abord si l'utilisateur est la personne du dossier. Sans cette priorité, quelqu'un
instruirait son propre départ et validerait ses propres cases. Conséquence assumée : un opérateur qui
part a besoin d'un autre opérateur pour valider ses étapes sensibles, ce qui est exactement le but.

**D10. `expectedActor` et `validationBy` entrent dans l'empreinte du plan.** Qui doit agir et qui doit
contrôler font partie de ce qu'un opérateur approuve en confirmant. Effet à la livraison : les plans
encore en brouillon voient leur empreinte changer et deviennent non confirmables, il faut les
recalculer. Le socle sait déjà le faire : `peutRecalculer` (`src/core/depart.ts:153`) autorise le
geste sur un brouillon démenti, l'action `recalculerPlan` (`src/app/departs/[id]/actions.ts:244`)
l'exécute, et `BoutonRecalculer` (`src/app/departs/[id]/Pointage.tsx:117`) l'offre depuis l'alerte
d'obsolescence. Effet secondaire à corriger dans le même lot : le texte de cette alerte
(`src/app/departs/[id]/page.tsx:128-143`) affirme qu'une collecte est passée, ce qui deviendra
parfois faux ; il doit dire que le plan ne décrit plus ce qu'il faudrait faire aujourd'hui, comptes
observés ou répartition des rôles.

**D11. Pointer et valider restent des déclarations.** Aucun appel sortant, aucun connecteur invoqué,
`ACTIONS_ENABLED` hors sujet et inchangé. La validation est un second regard humain ; la contrepartie
machine reste la collecte du lendemain, qui confronte la déclaration au système réel
(`src/core/constat.ts:186-207`).

**D12. Tension avec `docs/architecture.md` §6, et ce qu'on en fait.** Le document dit qu'il n'y a
pas d'approbateurs multiples. La validation par étape n'en introduit pas : elle ne double pas
l'opérateur, elle encadre ce qu'un non-opérateur déclare, c'est-à-dire précisément la délégation que
le §6 annonce comme point de greffe. Le ticket #10 ne demande pas de mise à jour documentaire, et
#13 la porte déjà dans sa DoD. Ce plan propose donc un ajout de deux phrases au §6, à soumettre à
l'utilisateur avant écriture, et à appliquer avec #13 : « La validation se décide étape par étape.
Une étape confiée à la personne concernée ou à un délégué déclare qui doit la contrôler ; une étape
d'opérateur ne se fait pas contrôler. » Rien n'est modifié dans le document sans validation explicite.

**D13. Aucun assouplissement de la règle d'identité.** Une identité `HEURISTIC` ou `NONE` ne produit
toujours aucune étape de révocation, et ce n'est plus une intention : `autoriseUneRevocation`
(`src/core/rapprochement.ts:29`) porte la règle, `systemesDuDepart` (`src/core/depart.ts:121`) la
fait respecter au calcul du plan, `src/lib/sync/executer.ts` la relit à l'exécution. Confier une
étape au porteur ne contourne rien : la source des étapes de connecteur ne change pas, seul leur
destinataire est nommé.

## Modèle de données

Une migration, additive, sans reprise de données : les défauts couvrent l'existant.

```prisma
enum StepActor {
  OPERATOR
  SUBJECT
  DELEGATE
}

enum StepValidation {
  NONE
  AWAITING
  ACCEPTED
  REFUSED
}
```

Ajouts sur `PlanStep` :

```prisma
  expectedActor StepActor      @default(OPERATOR)
  validationBy  StepActor?
  validation    StepValidation @default(NONE)

  declaredBy     String?
  validatedBy    String?
  validatedAt    DateTime?
  validationNote String?

  @@index([validation])
```

`validation` reste à `NONE` tant que rien n'est déclaré, y compris sur une étape qui exige une
validation : il n'y a rien à valider avant qu'un humain ait parlé. L'état est stocké et non déduit,
parce qu'un refus est un fait daté et signé, et non l'absence des autres possibilités.

`@@index([validation])` sert la file « ce qui attend quelqu'un », que #13 et #14 liront par dossier
et par personne.

Contrainte à ajouter à la main dans le fichier SQL généré, après `prisma migrate dev --create-only` :

```sql
ALTER TABLE "PlanStep"
  ADD CONSTRAINT "PlanStep_validation_combinaison"
  CHECK (
    "validationBy" IS NULL
    OR ("validationBy" <> 'SUBJECT'::"StepActor" AND "validationBy" <> "expectedActor")
  );
```

Prisma ne connaîtra pas cette contrainte, PostgreSQL la fera respecter. C'est voulu : l'invariant
« la personne concernée ne se valide pas » doit tenir face à une écriture manuelle, pas seulement
face au code de l'application.

Nom de migration proposé : `acteur_attendu_et_validation`, dans la lignée de
`20260818161504_marche_a_suivre_figee`.

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`.** Les deux caches se
cumulent : `prisma migrate dev` applique la migration sans toujours régénérer le client de
`src/generated/prisma`, et le client est mis en cache sur `globalThis`, donc il survit à la
régénération et sert des métadonnées périmées. Deux enums arrivent d'un coup : le symptôme typique
sera `Value 'AWAITING' not found in enum 'StepValidation'` alors que la base et le client sont à
jour.

## Découpage en étapes

**1. Schéma, enums et migration.** Ajouter les deux enums et les sept colonnes, générer la migration
en `--create-only`, y coller la contrainte `CHECK`, appliquer, régénérer, redémarrer. Vérifier qu'un
dossier existant s'affiche sans erreur, toutes ses étapes en `OPERATOR` / `NONE`.
Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_acteur_attendu_et_validation/migration.sql`.

**2. Le cœur : types et règles pures.** Dans `src/core/depart.ts`, ajouter les types et les
fonctions, et faire passer les fonctions existantes à deux dimensions.

```ts
export type Acteur = "OPERATOR" | "SUBJECT" | "DELEGATE";
export type EtatValidation = "NONE" | "AWAITING" | "ACCEPTED" | "REFUSED";

export interface EtapeSuivie {
  etat: EtatEtape;
  validation: EtatValidation;
}

export function estSoldee(etape: EtapeSuivie): boolean {
  if (etape.validation === "AWAITING" || etape.validation === "REFUSED") {
    return false;
  }
  return etape.etat === "SUCCEEDED" || etape.etat === "ALREADY_ABSENT" || etape.etat === "SKIPPED";
}

export function etatApresPointage(etapes: readonly EtapeSuivie[]): EtatPlan {
  if (etapes.length === 0) {
    return "EXECUTED";
  }
  if (etapes.some((etape) => etape.etat === "PENDING" || etape.validation === "AWAITING")) {
    return "EXECUTING";
  }
  return etapes.every((etape) => estSoldee(etape)) ? "EXECUTED" : "PARTIALLY_EXECUTED";
}
```

Nouvelles fonctions du même fichier : `roleSurDossier(username, dossier, estOperateur): Acteur | null`
avec la priorité du porteur (D9) ; `combinaisonValide(acteurAttendu, validationBy): boolean` (D4) ;
`peutPointer(etatPlan, acteurAttendu, role): Verdict`, qui garde ses refus actuels sur l'état du plan
puis refuse un rôle qui n'est ni l'acteur attendu ni `OPERATOR` ; `validationApresPointage(validationBy,
roleDuDeclarant): "NONE" | "AWAITING" | "ACCEPTED"` (D6) ; `peutValider({ validationBy, validation,
declaredBy }, valideur): Verdict`, qui refuse une étape qui n'attend rien, un rôle `SUBJECT` ou
absent, un délégué sur une validation d'opérateur, et le déclarant lui-même (D7, D8).
Fichiers : `src/core/depart.ts`.

**3. Le contrat de connecteur et l'empreinte.** Ajouter à `PlannedStep` deux champs facultatifs, dans
le vocabulaire minuscule du cœur : `actor?: "operator" | "subject" | "delegate"` et
`validationBy?: "operator" | "delegate"`. Les intégrer à `empreinteDuPlan` (D10). Aucun connecteur
existant ne les pose : `github` reste en `operator` sans validation, ce qui laisse son plan inchangé
à la valeur d'empreinte près.
Fichiers : `src/core/connector.ts`, `src/core/plan.ts`.

**4. L'écriture du plan.** Dans `enregistrerPlan`, deux tables de traduction sur le modèle de
`RISQUE`, et le refus net d'une combinaison invalide au moment de figer les étapes : une étape
impossible doit mourir là où elle est écrite, pas à l'affichage.
Fichiers : `src/lib/depart.ts`.

**5. Les actions serveur.** `pointerEtape` lit désormais `expectedActor`, `validationBy` et le rôle
de l'opérateur courant, refuse par `peutPointer`, écrit `declaredBy`, et pose la validation rendue par
`validationApresPointage`. Nouvelle action `validerEtape` : verdict `accepter` ou `refuser`, note
obligatoire au refus, garde `peutValider`, écriture par `actionTracee` avec le verbe
`depart.validation`, puis recalcul de l'état du plan par `etatApresPointage`. Le refus n'incrémente
pas `attempts` : ce compteur mesure les tentatives de l'acteur, pas les avis du validateur. Les deux
écritures passent par un `updateMany` conditionné sur l'état lu, pour qu'une seconde validation
concurrente ne produise ni double trace ni écrasement silencieux.
Fichiers : `src/app/departs/[id]/actions.ts`.

**6. Le journal.** Ajouter `"depart.validation": "Validation d'une étape de départ"` au catalogue des
libellés. Le type de cible `etape` existe déjà. Un refus reste `result: "SUCCESS"` : ce champ dit si
l'action a été effectuée, pas quel avis elle portait, et un refus consigné en `FAILURE` polluerait
tous les filtres du journal.
Fichiers : `src/app/journal/libelles.ts`.

**7. L'écran.** Sur chaque étape : un badge d'acteur attendu (« à faire par la personne concernée »,
« à faire par le délégué », rien quand c'est l'opérateur, pour ne pas décorer le cas nominal), un
badge « en attente de validation », l'avis du validateur quand l'étape a été refusée, et le nom du
validateur quand elle est acceptée. Le formulaire de validation n'apparaît que sur une étape
`AWAITING` et se désactive avec un message explicite quand l'opérateur courant en est le déclarant.
Corriger `dossierSoldable("EXECUTED")` en `dossierSoldable(plan.state)` et reformuler le message
d'obsolescence (D10) sans perdre le `BoutonRecalculer` qui y est logé. Le compteur des restantes
suit `estSoldee`, il inclut donc les étapes en attente sans autre modification.
Fichiers : `src/app/departs/[id]/page.tsx`, `src/app/departs/[id]/Pointage.tsx`.

**8. Tests et documentation.** Les scénarios ci-dessous, puis la proposition d'amendement du §6
soumise à l'utilisateur, non appliquée dans ce lot.
Fichiers : `src/core/depart.test.ts`, `src/core/plan.test.ts`.

## Tests

Tout le cœur est pur et testé sans base, comme le reste de `src/core`. Cinq scénarios, chacun raconté
en Given / When / Then et portant plusieurs assertions.

**1. Le cycle complet d'une étape à validation, refus compris.** Given une étape confiée à la
personne concernée et validée par un opérateur, sur un plan confirmé. When elle la déclare faite,
Then la validation passe en attente, l'étape n'est pas soldée, le plan reste `EXECUTING` et le
dossier n'est pas soldable. When l'opérateur refuse avec un motif, Then l'étape redevient à faire,
elle porte l'avis et son auteur, et le plan reste `EXECUTING` sans jamais passer par
`PARTIALLY_EXECUTED`. When elle redéclare et que l'opérateur accepte, Then l'étape est soldée, le
plan est `EXECUTED` et le dossier devient soldable.

**2. Personne ne valide sa propre déclaration, et rien ne se bloque pour autant.** Given une étape
attendue du porteur et validée par un opérateur. When l'opérateur la pointe lui-même en substitution,
Then elle est acceptée d'emblée avec lui comme validateur, sans passer par l'attente. When le porteur
l'a déclarée et que ce même porteur tente de valider, Then refus. When le déclarant est un opérateur
et qu'il tente de valider sa propre déclaration, Then refus, tandis qu'un second opérateur y est
autorisé. Emplacement : `src/core/depart.test.ts`.

**3. Chacun ne touche que ce qui le regarde.** Given un dossier dont le porteur est `personne.exemple`
et un opérateur `operateur.exemple`. Then le porteur peut pointer une étape `SUBJECT`, ne peut pointer
ni une étape `OPERATOR` ni une étape `DELEGATE`, l'opérateur peut pointer les trois, un inconnu ne
peut rien pointer, et un opérateur qui est lui-même le porteur de son dossier est vu comme porteur,
donc ne valide pas ses propres étapes. Then une étape `DELEGATE` reste pointable par l'opérateur tant
qu'aucun délégué n'existe.

**4. Un plan dont tout est coché mais dont une étape attend ne se déclare pas exécuté.** Given des
étapes toutes déclarées. Then une seule en attente suffit à garder le plan en cours et à interdire la
clôture du dossier. Then une étape en échec et une étape en attente donnent `EXECUTING` et non
`PARTIALLY_EXECUTED` : quelque chose bouge encore. Then une fois la dernière validation acceptée, le
verdict retombe sur ce que disent les déclarations, `EXECUTED` ou `PARTIALLY_EXECUTED` selon
l'échec.

**5. Une combinaison impossible est refusée avant d'atteindre la base.** Then les trois combinaisons
prévues sont acceptées, une validation par la personne concernée est refusée, une validation par le
même acteur que celui qui agit est refusée, et une étape sans validation est valide quel que soit son
acteur. Le même jeu sert de garde-fou de lecture pour la contrainte `CHECK`.

**6. L'empreinte suit qui doit agir.** Dans `src/core/plan.test.ts` : Given deux calculs identiques
au seul acteur attendu près, Then les empreintes diffèrent, donc un plan en brouillon dont la
répartition des rôles a changé n'est plus confirmable en l'état.

## Risques et pièges

**Le double cache Prisma, avec deux enums d'un coup.** Le typecheck passera pendant que le runtime
refusera `expectedActor` ou la valeur `AWAITING`. `pnpm db:generate` puis redémarrage, sans
exception.

**L'élargissement de l'empreinte invalide les brouillons en vol.** Tout plan `DRAFT` existant devient
obsolète à la livraison et doit être recalculé. Ce n'est plus une impasse : `recalculerPlan` remplace
un brouillon démenti depuis l'écran et `etatDUnPlanRemplace` (`src/core/depart.ts:171`) range
l'ancien en `STALE`. Le parc en compte peu, et le message affiché est aujourd'hui mensonger dans ce
cas précis : sa reformulation fait partie du lot, pas d'un suivi.

**Le refus referme silencieusement un constat d'action déclarée.** `actionsDeclarees`
(`src/lib/sync/constats.ts:219-221`) ne lit que les étapes `SUCCEEDED`. Une étape refusée redevient
`PENDING`, donc le `OVERDUE_MANUAL_ACTION` qui l'accusait se referme à la réconciliation suivante.
Ce n'est pas un accès refermé, c'est une déclaration retirée : le dossier continue de porter l'étape à
faire, et c'est lui qui fait foi. À surveiller si un jour la file des constats sert de tableau de bord
des accès ouverts.

**Le mécanisme ne filtre encore rien.** Tant que #13 n'a pas livré, aucun porteur ne peut se
connecter : toute étape `SUBJECT` sera pointée en substitution par un opérateur, donc acceptée
d'emblée (D6). Il ne faut pas en conclure que la validation ne sert à rien, ni la court-circuiter
pour « simplifier » : ce champ est le contrat que #13 et #14 vont lire pour décider ce que chacun
voit.

**L'invariant du journal.** La validation doit passer par `actionTracee` comme le reste, sinon la
trace suivrait l'écriture au lieu de la précéder. Un refus n'est pas un `result: "FAILURE"`.

**Deux gestes concurrents sur la même étape.** L'action lit puis écrit sans transaction
(`src/app/departs/[id]/actions.ts:114-178`). Avec la validation, deux onglets ouverts peuvent valider
deux fois ou valider une étape que quelqu'un vient de repointer. L'écriture conditionnée sur l'état lu
est le minimum ; sans elle, l'incohérence est silencieuse et le journal montre deux avis pour une
seule étape.

**Le compteur `attempts`.** Il compte les tentatives de l'acteur. L'incrémenter au refus lui ferait
mesurer deux choses à la fois et rendrait illisible toute statistique de reprise.

**Une étape confiée à quelqu'un qui perd ses accès.** Un porteur en cours de départ peut perdre sa
boîte avant d'avoir pointé. C'est le point d'attention de #13, mais il se prépare ici : une étape
`SUBJECT` bloquée doit rester rattrapable par un opérateur en substitution, ce que D6 garantit par
construction.

**Une seule source pour chaque vocabulaire.** Les unions du cœur et les enums Prisma ne doivent se
rencontrer que dans les tables de traduction de `src/lib/depart.ts`, sur le modèle de `RISQUE`. Deux
listes qui dérivent l'une de l'autre finissent par diverger sans que rien ne le signale.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build. Au-delà :

- La migration s'applique sur une base portant déjà des dossiers, et un dossier antérieur s'affiche
  sans erreur avec toutes ses étapes en acteur opérateur et validation `NONE`.
- La contrainte tient : un `INSERT` ou un `UPDATE` en SQL posant `validationBy = 'SUBJECT'`, ou
  `validationBy` égal à `expectedActor`, est refusé par PostgreSQL.
- Cycle manuel de bout en bout sur un dossier de test, une étape passée à la main en
  `expectedActor = SUBJECT` et `validationBy = OPERATOR` : pointage, attente, refus motivé, retour à
  faire, nouveau pointage, acceptation, clôture. Le bouton de clôture reste absent tant qu'une étape
  attend, et le message compte bien l'étape en attente parmi les restantes.
- Le journal montre, dans l'ordre, la trace du pointage puis celle de la validation, chacune
  nominative, avec le verbe traduit à l'écran et le refus consigné en succès.
- `ACTIONS_ENABLED` reste à `false` et aucun appel sortant n'a lieu pendant le cycle : ni le pointage
  ni la validation n'invoquent de connecteur.
- Relecture de la DoD du ticket point par point : plan non exécuté tant qu'une étape attend, dossier
  clos seulement quand plus rien n'attend, deux traces nominatives distinctes, tests couvrant le
  refus.
- La proposition d'amendement de `docs/architecture.md` §6 est soumise à l'utilisateur et laissée
  non appliquée si elle n'est pas validée.
