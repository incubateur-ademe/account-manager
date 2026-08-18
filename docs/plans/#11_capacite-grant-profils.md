# Capacité grant des connecteurs et notion de profil (#11)

> Plan d'implémentation de l'issue #11. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

### La capacité `grant` est dans le vocabulaire, servie nulle part

`Capability` l'énumère depuis le premier jour (`src/core/connector.ts:5`). L'écran des systèmes
l'affiche déjà, libellée « Donner » avec sa description « ouvrir un accès »
(`src/app/systemes/page.tsx:15-20`), et la résout comme les autres (`:41-49`). Le seul connecteur du
registre (`src/connectors/index.ts:10`) ne déclare que `list` et `revoke`
(`src/connectors/github.ts:157-162`), donc `resolveCapability("grant", undefined, sondes, runbook)`
rend `tier: "none"` sans dégradation (`src/core/connector.ts:111-116`), cas déjà couvert par un test
(`src/core/connector.test.ts:71-76`).

Conséquence visible aujourd'hui : la page des systèmes affiche « Donner : indisponible » sur GitHub,
sans dire ce qui manque, parce qu'il n'y a rien à dire. Ce n'est pas une panne, c'est un trou.

### Le connecteur refuse tout ce qui n'est pas un retrait, et le refuse par le silence

`src/connectors/github.ts:223-226` :

```ts
if (intent.kind !== "revoke" || intent.subject.kind !== "person") {
  return Promise.resolve([]);
}
```

Une liste vide, pas un refus. L'appelant ne peut pas distinguer « cette personne n'a rien à traiter
ici » de « je ne sais pas répondre à cette question ». C'est tenable tant qu'un seul kind existe,
c'est le premier piège dès que deux coexistent.

### `scopeSchema` est un champ mort, et sa valeur actuelle ne décrit aucun octroi

Le contrat l'exige (`src/core/connector.ts:65-66`) avec le commentaire qui annonce son double emploi,
valider les scopes d'octroi et générer les formulaires. Aucun code ne le lit : la seule occurrence
hors du type est son affectation (`src/connectors/github.ts:163`),
`z.object({ organisation: z.enum(ORGANISATIONS).optional() })`.

Cette forme ne dit rien de ce qu'on accorde. Pas de rôle, donc rien qui distingue un membre d'un
administrateur, et `optional()` laisse passer l'objet vide, qui valide sans désigner quoi que ce soit.
Le champ existe, il n'est pas rempli.

### Le seul chemin de plan part de l'observé, ce qui n'a pas de sens à l'arrivée

`calculerPlanDeDepart` (`src/lib/depart.ts:62-109`) commence par `systemesDeLaPersonne` (`:29-41`),
qui lit les identités non disparues de la personne, puis n'interroge que les connecteurs des
systèmes où elle a été vue avec un rattachement sûr (`:83-95`), toujours avec
`{ kind: "revoke", subject: { kind: "person", username } }` (`:90-93`). Le commentaire de tête
assume ce choix : planifier ailleurs reviendrait à demander de retirer quelqu'un d'un endroit où il
n'est pas (`:20-28`). La répartition des systèmes observés entre révocables et non confirmés est
rendue par `systemesDuDepart` (`src/core/depart.ts:121-143`).

À l'arrivée, ce raisonnement s'inverse point pour point : il n'y a **rien** d'observé, et c'est
justement ce qu'il faut créer. La source des étapes ne peut donc pas être la collecte. C'est
exactement le trou que le profil vient boucher.

### Le socle n'exécute rien, et `precheck` n'est appelé nulle part

`precheck` et `execute` sont déclarés optionnels sur le connecteur (`src/core/connector.ts:228` et
`:231`), aucun connecteur ne les implémente, aucun appelant ne les cherche. Ce qui tient lieu
d'exécution aujourd'hui est une déclaration humaine : `pointerEtape`
(`src/app/departs/[id]/actions.ts:101-183`) traduit un choix de formulaire en `StepState` via la
table `POINTAGES` (`:21-26`), et l'écran le dit en toutes lettres
(`src/app/departs/[id]/page.tsx:121-126`).

`RunContext.dryRun` est déjà câblé sur `!env.ACTIONS_ENABLED` (`src/lib/depart.ts:76`), et la
collecte annonce la simulation dès son démarrage (`src/lib/sync/executer.ts:34-36`). Le garde-fou
est en place, il n'a simplement jamais eu de chemin d'écriture à retenir.

### La résolution du tier est juste, sauf sur un point où la doc et le code divergent

`resolveCapability` (`src/core/connector.ts:84-117`) prend la première déclaration dont tous les
credentials répondent, et renseigne `degradedFrom` avec ce qui manque à la meilleure voie. La boucle
de collecte s'en sert déjà pour annoncer un système non lu plutôt que de l'accuser d'échec
(`src/lib/sync/executer.ts:113-126`).

`docs/architecture.md:383` écrit en revanche : « Si aucune ne répond, la capability tombe à `manual`
s'il existe un runbook, à `none` sinon. » **Le code ne fait pas ça.** Il rend `none` avec le runbook
du contrat (`src/core/connector.ts:111-116`), sans jamais promouvoir quoi que ce soit en `manual` : un
chemin manuel n'existe que s'il est déclaré, avec `requires: []`. Il faut trancher avant de s'appuyer
dessus, parce que la différence décide du sort d'un octroi dont aucun credential ne répond.

### La politique sait déjà porter une règle qui ne nomme personne

`configSchema` (`src/core/policy.ts:243-359`) porte les seuils, le vocabulaire des phases terminales,
et deux catalogues réservés dont `systems[]` (`:320-336`), explicitement annoncé comme non lu. Chaque
champ porte son `.meta()` parce que c'est le seul endroit que le générateur de JSON Schema sait lire
(`src/core/policy.ts:3-8`), et `pnpm policy:schema` en dérive `config/config.schema.json`
(`src/cli/schema-politique.ts:22-31`). La séparation est déjà tenue : `accounts.yaml` nomme des
personnes, `config.yaml` non (`docs/architecture.md:190-206`).

### Ce qui manque entièrement

- Aucune valeur `ONBOARDING` dans `PlanKind` (`prisma/schema.prisma:315-319`), et `Plan` ne se
  rattache à une personne que par `departureCaseId` (`:332-348`). C'est le périmètre de #8.
- Aucun état « déjà présent » : `StepState` (`prisma/schema.prisma:361-368`) et `EtatEtape`
  (`src/core/depart.ts:4`) ne connaissent que `ALREADY_ABSENT`, tout comme `PrecheckResult` et
  `StepOutcome` (`src/core/connector.ts:200-208`).
- Aucune notion de profil, nulle part.
- Aucune échéance décidée : `PlanStep` (`prisma/schema.prisma:370-405`) porte `reversibleUntil` mais
  rien qui dise jusqu'à quand un accès accordé est censé vivre. `FindingKind.EXPIRED_GRANT` existe
  pourtant déjà (`:406-418`) et n'a aucun producteur.

### Les pièges déjà présents dans le code

1. **`ETAPE[etape.state as EtatEtape]` casse la page sur un état inconnu**
   (`src/app/departs/[id]/page.tsx:24-31` et `:207`). Le rendu lit `pointee.severite` juste après :
   ajouter une valeur à `StepState` sans ajouter sa ligne au dictionnaire produit un écran blanc,
   pas un libellé manquant. Même piège en miniature sur `TIER` (`:18-22` et `:206`), sauvé par un
   `??` qui n'existe pas pour `ETAPE`.
2. **`estSoldee` décide de la clôture** (`src/core/depart.ts:68-70`), et `restantes`
   (`src/app/departs/[id]/page.tsx:102`) en découle. Un état soldable oublié dans cette fonction
   produit un dossier qui ne se clôt jamais, sans message d'erreur.
3. **`policy()` met la politique en cache pour la vie du processus** (`src/lib/policy.ts:22` et
   `:68-71`). Un profil corrigé ne prend effet qu'au redémarrage, ce qui est acceptable mais doit être
   dit à l'écran, sinon un opérateur corrige un scope et voit le même refus.
4. **Le journal est en fire-and-forget** (`src/lib/audit.ts:16-37`), et `actionTracee` écrit la trace
   avant l'écriture puis une seconde en échec si elle a levé (`src/lib/actions.ts:30-56`). Toute
   boucle d'exécution doit reproduire cet ordre par étape, pas seulement au démarrage.
5. **L'empreinte hache `params`** (`src/core/plan.ts:12-31`). Tout ce qu'un octroi met dans ses
   paramètres, scope compris, entre dans ce qui a été approuvé. C'est voulu, et c'est aussi ce qui
   rendra obsolète tout brouillon en vol quand un profil changera.
6. **Le rapprochement est le garde-fou d'identité, et le socle le porte maintenant en dur.** La règle
   « seules `DECLARED`, `GITHUB_LOGIN` et `EMAIL_EXACT` autorisent une révocation » vit dans
   `METHODES_REVOCABLES` et `autoriseUneRevocation` (`src/core/rapprochement.ts:23-31`), lues par le
   calcul du plan comme par les constats : elle ne se recopie plus chez l'appelant. `normaliserLogin`
   (`:69-81`) reste le seul endroit qui sait réduire un login GitHub saisi à la main.
7. **#8 généralise le dossier et le plan.** Tout ce qui suit est soit dans `src/core`, soit dans le
   connecteur, soit additif sur `PlanStep`. Seule l'étape E7 (les écrans d'arrivée) attend
   réellement #8 ; les six premières tiennent dans les deux ordres de livraison.

## Décisions de conception

**D1. Le profil vit dans la politique, dans `config.yaml`, et pas en base.** Trois raisons, dans
l'ordre. Un profil ne nomme personne : c'est un rôle, donc il appartient au fichier non sensible, à
côté de `systems[]` qui l'attend déjà (`src/core/policy.ts:320-336`). Il est validé au chargement,
donc un scope faux est refusé bien avant qu'un plan existe, ce que la DoD exige. Et il change ce que
« développeur » ouvre comme accès sur le système le plus critique du parc : le faire passer par une
revue de fichier plutôt que par un formulaire est le bon niveau de friction. L'argument de #9 pour
mettre les modèles en base ne s'applique pas ici : il repose sur le fait qu'un lead de startup édite
le modèle de sa startup depuis sa page, alors qu'un profil est de l'incubateur, et
`docs/architecture.md:543-545` pose que seule l'équipe transverse agit. Ferme la DoR sur la forme du
profil et sur qui l'écrit.

**D2. Un profil et un modèle de plan (#9) sont deux objets différents, et la frontière est nette.** Un
modèle porte ce qu'aucun système ne connaît, texte libre et critère de complétion. Un profil porte des
accès sur des systèmes couverts par un connecteur, avec un scope validé par ce connecteur. Ils se
rencontrent à l'instanciation : le plan d'arrivée assemble les étapes des modèles et les étapes des
octrois. Sans cette frontière, on se retrouverait avec deux façons de déclarer la même chose et une
divergence garantie.

**D3. Un accès de profil désigne un système par sa clé de connecteur et porte un `scope` opaque à la
politique.** Forme retenue : `{ system, scope, expiresInDays? }`. La politique valide la structure,
pas le contenu du scope. Le contenu est validé dans une seconde passe, contre le `scopeSchema` du
connecteur. Ferme la DoR sur la désignation des scopes par connecteur.

**D4. Deux passes de validation, et non une.** Faire entrer les `scopeSchema` des connecteurs dans
`configSchema` donnerait une validation en un coup, mais rendrait la politique illisible dès qu'elle
nommerait un système que la version déployée ne connaît pas encore. Or `policy()` lève, et
`executerSync` s'arrête net sur une politique invalide (`src/lib/sync/executer.ts:42-47`) : une faute
de frappe dans un profil arrêterait la collecte nocturne de tout le parc. La première passe, dans le
schéma Zod, garantit que le fichier se charge. La seconde, `verifierProfils`, est appelée par
`pnpm policy:check`, par la construction du plan et par l'écran des profils, et refuse au bon moment
sans jamais faire tomber le reste.

**D5. Le scope GitHub devient strict et complet : organisation et rôle, sans optionnel.**

```ts
scopeSchema: z.strictObject({
  organisation: z.enum(ORGANISATIONS),
  role: z.enum(["member", "admin"]),
})
```

`strictObject` refuse la clé en trop, qui est la faute de frappe la plus probable dans un YAML écrit à
la main. Plus d'`optional()` : un octroi qui ne dit pas ce qu'il ouvre n'est pas un octroi. Chaque
champ porte son `.meta()`, pour la même raison que dans `src/core/policy.ts:3-8`. Ferme la DoR sur le
scope GitHub.

**D6. Le jeton d'écriture est un credential distinct du jeton de lecture.** `probe` ne sait pas
distinguer un jeton en lecture seule d'un jeton d'administration : il teste la présence de la variable
(`src/connectors/github.ts:166-176`), et le `scopeNote` du credential actuel dit lui-même « en lecture
seule » (`:152-154`). Déclarer `grant` comme `auto` sur `github-token` afficherait donc un tier
théorique que le premier `PUT` démentirait par un 403, exactement ce que le ticket interdit. On
introduit `github-token-admin`, adossé à `GITHUB_ADMIN_TOKEN`, optionnel dans le schéma d'environnement
au même titre que son aîné (`src/lib/env.ts:31-36`). Tant qu'il est absent, l'octroi GitHub se résout
en `manual` et l'écran dit ce qui manque pour faire mieux.

**D7. Toute capacité `grant` déclare une voie manuelle inconditionnelle, et c'est vérifié.** Le code
ne promeut rien en `manual` tout seul, contrairement à ce qu'annonce `docs/architecture.md:383`. On
garde le comportement du code, qui est le bon : une voie manuelle se déclare, elle ne se devine pas.
On ajoute en contrepartie un test de contrat sur le registre : tout connecteur déclare, pour `grant`
comme pour `revoke`, au moins une déclaration avec `requires: []`. C'est la seule façon de garantir
qu'un octroi ne disparaisse jamais d'un plan. La phrase de la documentation est à corriger, elle
décrit une résolution qui n'existe pas.

**D8. Un octroi impossible produit une étape, jamais une omission.** Si la capacité résout en `none`,
l'étape est émise quand même, à ce tier, portant le runbook du contrat et ce qui manque. Une ligne
d'arrivée qui manque est précisément le mode de panne que ce produit existe pour éviter : un accès
qu'on croit ouvert et qui ne l'est pas ne se découvre qu'au moment où la personne en a besoin, ou
jamais. Symétriquement, un profil qui nomme un système dont le connecteur ne déclare aucune capacité
`grant` est refusé à la validation, pas silencieusement ignoré : c'est une faute de politique, pas un
état du monde. Ferme la DoR sur le comportement d'un octroi indisponible.

**D9. Le socle passe au connecteur les identifiants fiables de la personne, jamais une supposition.**
`SubjectRef` gagne un champ optionnel :

```ts
export type SubjectRef =
  | { kind: "person"; username: string; handles?: Readonly<Record<string, string>> }
  | { kind: "service"; key: string };
```

`handles` est indexé par clé de système. Il est rempli par le socle à partir de deux sources et deux
seulement : le champ amont de la fiche (`Person.githubLogin`, réduit par `normaliserLogin`,
`src/core/rapprochement.ts:69-81`), et les identités déjà observées de la personne sur ce système
dont le `matchMethod` passe `autoriseUneRevocation` (`src/core/rapprochement.ts:23-31`), seul
endroit où cette liste vit désormais. **Une identité rattachée par `HEURISTIC` ou non rattachée
n'entre jamais dans `handles`.** L'invariant est écrit pour la révocation, il vaut au moins autant
ici : accorder un accès administrateur au compte de quelqu'un d'autre parce qu'il lui ressemble est
plus grave que de couper le mauvais. La solution alternative, laisser le connecteur interroger
l'espace-membre lui-même, est écartée : elle ferait dépendre un connecteur de la collecte d'un autre
système.

**D10. Sans handle fiable, l'octroi automatique dégrade en manuel, il ne devine pas.** Le connecteur
émet alors une étape `manual` dont le `doneWhen` exige que le login soit d'abord renseigné dans
l'espace-membre. Un humain sait qui est la personne, l'API non. Cette dégradation est portée par le
connecteur et non par `resolveCapability`, qui ne parle que de credentials : ce qui manque ici est une
donnée, pas un secret.

**D11. « Déjà présent » est une valeur d'état à part entière, pas une réinterprétation de « déjà
absent ».** `PrecheckResult`, `StepOutcome`, `StepState` et `EtatEtape` gagnent `ALREADY_PRESENT`.
Réutiliser `ALREADY_ABSENT` en lui donnant le sens « déjà dans l'état attendu » ferait dire deux
choses à une seule valeur, et l'écran afficherait « déjà absent » sous une étape d'octroi. Renommer en
un terme neutre coûterait une réécriture d'enum et de toutes les lignes existantes pour un gain
cosmétique. L'ajout est additif, il ne touche aucune ligne en base.

**D12. Le précheck est une lecture, il tourne donc même en simulation, et il peut solder une étape.**
`ACTIONS_ENABLED=false` interdit d'écrire, pas de regarder. Un précheck qui constate que l'accès est
déjà ouvert solde l'étape, en simulation comme en vrai, parce que ce constat est vrai indépendamment
du droit d'écrire. C'est aussi ce qui donne son sens à la DoD : « déjà présent compte comme un
succès ». Le précheck tourne également sur les étapes manuelles : éviter d'envoyer un humain faire
quelque chose de déjà fait est le meilleur usage qu'on puisse en faire.

**D13. En simulation, une étape prête à être exécutée ne change pas d'état.** Elle reste à faire, et
le compte rendu dit ce qui aurait été appelé. Poser `SUCCEEDED` sur une simulation ferait mentir le
dossier, poser `SKIPPED` ferait croire qu'un humain l'a écartée en connaissance de cause. Le seul
état honnête est l'absence de changement, plus une trace au journal.

**D14. L'échéance d'un octroi est absolue, et la fonction qui la calcule ne voit pas la mission.**
`echeanceDOctroi(expiresInDays, maintenant)` ne prend pas `missionEnd` en paramètre. C'est la forme la
plus forte de la règle « ne se reconduit jamais par simple prolongation de mission » : elle est portée
par la signature et non par la discipline de l'appelant, comme l'invariant de collecte est porté par
`CollectResult` (`src/core/connector.ts:158-162`). Reconduire un accès élevé exige un nouveau plan,
donc une nouvelle décision tracée.

**D15. Un accès qui produit une étape à risque élevé sans échéance fait échouer la construction du
plan.** La vérification porte sur les étapes rendues par le connecteur, pas sur le profil seul : c'est
le connecteur qui sait qu'un rôle `admin` vaut `riskLevel: "high"`. Le refus nomme le profil, le
système et le rôle. Conséquence assumée : un profil qui ouvre une administration doit porter
`expiresInDays`, sinon il ne s'instancie pas du tout.

**D16. L'octroi hors profil n'a pas d'écran dans ce lot, et l'échéance qu'il exigerait est déjà
modélisée.** `PlanStep.justification` et `PlanStep.grantExpiresAt` sont posés dès cette migration,
avec la règle qui les gouverne. Le seul producteur pour l'instant est le profil lui-même. Ajouter
l'écran plus tard n'exigera ni migration ni reprise de données. C'est un écart assumé avec
`docs/architecture.md:535-539`, qui décrit le hors profil comme acquis : la documentation décrit la
cible, ce lot en livre la moitié qui a un producteur.

**D17. La confrontation de l'empreinte au démarrage de l'exécution est faite ici, pour le sens
arrivée.** `docs/architecture.md:461-462` l'exige, #8 l'a inscrite dans ses décisions, et aucune boucle
d'exécution n'existait jusqu'ici pour la porter. L'exécution recalcule le plan, compare à
`confirmedDigest` (`prisma/schema.prisma:340`) et refuse en bloc si l'écart existe. Si #8 livre le
même mécanisme pour le sens départ, les deux convergent sur une seule fonction.

## Modèle de données

Une migration, additive, sans reprise de données. Nom proposé : `octroi_et_profils`, dans la lignée de
`20260818161504_marche_a_suivre_figee`.

```prisma
enum StepState {
  PENDING
  SKIPPED
  SUCCEEDED
  ALREADY_ABSENT
  ALREADY_PRESENT
  STALE
  FAILED
}
```

Ajouts sur `PlanStep` :

```prisma
  grantExpiresAt DateTime?
  justification  String?

  @@index([grantExpiresAt])
```

`grantExpiresAt` est de l'état décidé et vit donc ici, pas sur `AccessGrant`
(`prisma/schema.prisma:203-221`) : cette table est reconstruite par la collecte
(`docs/architecture.md:266-270`), une échéance décidée y serait effacée à la première nuit.
L'index sert le balayage qui produira les `EXPIRED_GRANT` (`prisma/schema.prisma:406-418`), constat
déjà déclaré et sans producteur ; il n'est pas lu par ce lot.

`justification` reste nul pour tout accès venu d'un profil : le profil est la justification. Il
n'aura de valeur que le jour où un octroi hors profil sera saisi.

**Ce qui ne vient pas d'ici.** `PlanKind.ONBOARDING` et le rattachement d'un plan à une personne hors
dossier de départ appartiennent à #8 : les poser ici produirait deux migrations qui ajoutent la même
valeur d'enum et un conflit à la première application. Ce plan les traite en prérequis.

**Environnement.** `src/lib/env.ts` gagne, dans `coreSchema`, à côté de `GITHUB_TOKEN` et pour les
mêmes raisons (`:31-36`) :

```ts
GITHUB_ADMIN_TOKEN: z.string().min(1).optional(),
```

Facultative par construction : son absence dégrade proprement l'octroi en manuel, elle ne doit pas
empêcher l'application de démarrer. `.env.example` gagne la ligne, en forme, jamais en valeur.

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`.** Les deux caches se
cumulent : `prisma migrate dev` ne régénère pas toujours le client de `src/generated/prisma`, et le
client est mis en cache sur `globalThis` (`src/lib/db.ts`), donc il survit même à une régénération.
Symptôme attendu si l'un des deux est oublié : `Value 'ALREADY_PRESENT' not found in enum 'StepState'`
au moment où une étape se solde, avec un typecheck vert.

**Politique.** Aucune migration, mais deux fichiers à régénérer et à commiter :
`config/config.schema.json` par `pnpm policy:schema`, et `config/config.exemple.yaml` qui gagne une
section `profiles` commentée, sur le modèle des sections réservées existantes (`:52-67`).

## Découpage en étapes

### E1. Le contrat sait exprimer un octroi

Ajouter `ALREADY_PRESENT` à `PrecheckResult` et `StepOutcome`, ajouter `handles` à `SubjectRef` (D9),
et documenter dans le commentaire de `scopeSchema` qu'il fait foi sur les scopes de profil.

Ajouter le test de contrat du registre (D7) : chaque connecteur déclare une voie inconditionnelle pour
`grant` et pour `revoke`.

Fichiers : `src/core/connector.ts`, `src/connectors/index.ts` (nouveau `src/connectors/index.test.ts`).

Vérifiable : `pnpm test` passe, le test de contrat échoue si on retire la voie manuelle de GitHub.

### E2. GitHub sait donner

Réécrire `scopeSchema` (D5). Déclarer la capacité :

```ts
grant: [
  { requires: [CREDENTIAL_ADMIN], tier: "auto", reversibleForDays: 7, runbook: RUNBOOK_GRANT },
  { requires: [], tier: "manual", runbook: RUNBOOK_GRANT },
],
```

Ajouter la sonde du second credential, en miroir de la première (`src/connectors/github.ts:166-176`).
Étendre `plan` : sur un intent `grant`, valider le scope contre `scopeSchema`, résoudre la capacité,
émettre une étape par organisation visée, avec `riskLevel: "high"` pour `admin` et `medium` pour
`member`, `expectedState: { membre: true, role }`, et `idempotencyKey`
`github:<org>:grant:<username>:<role>`. Sans handle fiable, forcer le tier manuel (D10). Garder le
libellé, le deeplink et le `doneWhen` au niveau de précision de la révocation existante (`:241-246`).

Écrire `precheck` et `execute`, en isolant l'interprétation de la réponse dans une fonction pure
`interpreterAppartenance(statut, corps, attendu)` pour qu'elle soit testable sans réseau :

- `GET /orgs/{org}/memberships/{username}` en 404 donne `READY` ;
- état `active` ou `pending` avec le rôle attendu donne `ALREADY_PRESENT` ;
- état présent avec un autre rôle donne `STALE`, avec l'attendu et le constaté.

`execute` appelle `PUT /orgs/{org}/memberships/{username}` avec `{ role }` et rend `SUCCEEDED` avec
`evidence` portant l'état renvoyé.

Fichiers : `src/connectors/github.ts`, `src/lib/env.ts`, `.env.example`.

Vérifiable : sur la page des systèmes, GitHub affiche « Donner : à faire à la main » avec
« automatique si : github-token-admin » tant que la variable est absente.

### E3. Les profils dans la politique

Ajouter `profiles[]` à `configSchema` (`src/core/policy.ts`), avec `.meta()` sur chaque champ et un
`refine` d'unicité des clés sur le modèle de `serviceAccounts` (`:211-215`).

```yaml
profiles:
  - key: developpeur
    label: Developpeur d'une startup d'Etat
    accesses:
      - system: github
        scope:
          organisation: incubateur-ademe
          role: member
  - key: administration-github
    label: Administration de l'organisation GitHub
    accesses:
      - system: github
        scope:
          organisation: incubateur-ademe
          role: admin
        expiresInDays: 180
```

Créer `src/core/octroi.ts` avec la seconde passe (D4) :

```ts
export interface SystemeOffrantOctroi {
  key: string;
  scopeSchema: z.ZodType;
  octroiDeclare: boolean;
}

export interface RefusDOctroi {
  profil: string;
  systeme: string;
  motif: string;
}

export function verifierProfils(
  profils: readonly Profil[],
  catalogue: readonly SystemeOffrantOctroi[],
): readonly RefusDOctroi[];

export function echeanceDOctroi(expiresInDays: number | undefined, maintenant: Date): Date | null;
```

Brancher `verifierProfils` dans `pnpm policy:check` (`src/cli/verifier-politique.ts`), et régénérer
les schémas JSON.

Fichiers : `src/core/policy.ts`, `src/core/octroi.ts`, `src/cli/verifier-politique.ts`,
`config/config.exemple.yaml`, `config/config.schema.json`.

Vérifiable : `pnpm policy:check` refuse un profil qui nomme un système inconnu, un scope avec une
organisation hors liste, et une clé en trop, en nommant le profil et le champ à chaque fois.

### E4. La migration et les libellés

Appliquer la migration décrite plus haut, puis étendre les quatre endroits qui énumèrent les états, en
une seule passe pour ne pas laisser un écran cassé entre deux commits : `EtatEtape`
(`src/core/depart.ts:4`), `estSoldee` (`:68-70`), la table `ETAPE` de l'écran
(`src/app/departs/[id]/page.tsx:24-31`) et la table `POINTAGES` de l'action
(`src/app/departs/[id]/actions.ts:21-26`), qui gagne un choix `deja-present`. Ajouter `none` à la
table `TIER` de l'écran (`:18-22`) pour l'étape que D8 rend possible.

Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_octroi_et_profils/migration.sql`,
`src/core/depart.ts`, `src/app/departs/[id]/page.tsx`, `src/app/departs/[id]/actions.ts`.

Vérifiable : un dossier de départ antérieur s'affiche sans erreur et se pointe comme avant ; le test
existant de `etatApresPointage` (`src/core/depart.test.ts:69`) passe toujours, et son pendant
`ALREADY_PRESENT` passe aussi.

### E5. L'assemblage d'un plan d'arrivée

Ajouter dans `src/core/octroi.ts` la fonction d'assemblage, qui prend tout par paramètre et ne touche
ni la base ni l'environnement :

```ts
export interface OctroiCalcule {
  etapes: readonly PlannedStep[];
  refus: readonly RefusDOctroi[];
}

export function assemblerOctrois(
  profil: Profil,
  connecteurs: readonly Connector[],
  sujet: SubjectRef,
  sondesParSysteme: ReadonlyMap<string, readonly CredentialProbe[]>,
  ctx: RunContext,
  maintenant: Date,
): Promise<OctroiCalcule>;
```

Elle valide les scopes, appelle `plan` avec `{ kind: "grant", subject, scope }`, applique la règle
d'échéance (D14, D15) et pose `grantExpiresAt` sur les étapes concernées. Un `refus` non vide vaut
échec de construction : aucun plan n'est enregistré.

Créer `src/lib/arrivee.ts`, coquille de base sur le modèle de `src/lib/depart.ts` : elle lit la
personne, construit `handles` selon D9, sonde les connecteurs, appelle `assemblerOctrois`, calcule
l'empreinte avec `empreinteDuPlan` (`src/core/plan.ts:12`) et enregistre le plan par le mécanisme
générique de #8, en réutilisant la table `RISQUE` (`src/lib/depart.ts:18`). L'enregistrement tire son
identifiant de plan et suffixe par lui les clés d'idempotence des étapes
(`src/lib/depart.ts:158-182`) : `PlanStep.idempotencyKey` est unique en base, la clé rendue par le
connecteur ne l'est pas, et deux plans successifs d'un même sujet porteraient sinon les mêmes clés.

Fichiers : `src/core/octroi.ts`, `src/lib/arrivee.ts`.

Vérifiable : les tests d'assemblage passent avec un connecteur factice ; l'empreinte de deux
assemblages qui ne diffèrent que par le rôle diffère.

### E6. Le précheck et la boucle d'exécution

Créer `src/core/execution.ts`, purement décisionnel :

```ts
export interface Decision {
  /** Nul quand rien n'est acquis : une simulation ne solde aucune étape. */
  etat: EtatEtape | null;
  executer: boolean;
  motif: string;
}

export function decider(precheck: PrecheckResult, dryRun: boolean): Decision;
export function apresExecution(issue: StepOutcome): EtatEtape;
```

Créer `src/lib/execution.ts` avec `executerPlan(planId, maintenant)` : recalcul de l'empreinte et
comparaison à `confirmedDigest` (D17), puis, étape par étape, dans l'ordre de réversibilité
décroissante voulu par `docs/architecture.md:462-463` : trace au journal avant l'appel, `precheck`,
`decider`, `execute` seulement si `executer` vaut vrai, écriture de l'état, seconde trace en échec si
l'appel a levé. Une étape sans `execute` chez son connecteur reste manuelle après précheck.

L'action serveur qui déclenche la boucle passe par `actionTracee` (`src/lib/actions.ts:30`), comme
tout geste humain.

Fichiers : `src/core/execution.ts`, `src/lib/execution.ts`, une action serveur dans le segment
d'arrivée.

Vérifiable : avec `ACTIONS_ENABLED=false`, aucun appel sortant, les étapes prêtes restent à faire, une
étape déjà présente se solde, le journal porte une ligne par étape.

### E7. Les écrans

Sur l'écran d'ouverture d'une arrivée, un choix de profil alimenté par la politique, avec le rappel
que la politique est lue au démarrage (piège 3). Sur l'écran du plan, l'affichage de `grantExpiresAt`
et du refus de construction s'il y en a un. Sur la page des systèmes
(`src/app/systemes/page.tsx`), afficher le scope attendu de chaque connecteur, rendu par
`z.toJSONSchema(contrat.scopeSchema)` : c'est le second usage annoncé par le contrat, et il ferme le
constat du ticket sur le champ mort.

Cette étape est la seule qui attend #8 pour son point d'accroche.

Fichiers : `src/app/systemes/page.tsx`, le segment d'arrivée livré par #8.

### E8. Documentation et politique d'exemple

Proposer l'amendement de `docs/architecture.md` : §3.1 pour ajouter `profiles[]` à la liste du
déclaré, §5.1 pour corriger la phrase de la ligne 383 qui décrit une résolution que le code ne fait
pas, §5.8 pour distinguer le jeton de lecture du jeton d'administration sur la ligne GitHub, et §6
pour décrire la forme retenue du profil et l'état exact du hors profil. **Proposer, pas appliquer** :
le document ne se modifie pas sans validation explicite.

## Tests

Cinq scénarios, tous exécutables sans base et sans réseau, comme le reste de `src/core`. Chacun se lit
en Given / When / Then et porte plusieurs assertions.

**1. Un profil ne s'instancie que si tout ce qu'il désigne existe et se valide.**
Emplacement : `src/core/octroi.test.ts`. Given un catalogue portant un système qui déclare un octroi
et un système qui n'en déclare aucun. When on valide un profil correct, Then aucun refus. When il
nomme un système absent du catalogue, Then un refus qui nomme le profil et le système. When il nomme
le système sans octroi, Then un refus distinct du précédent, parce que les deux appellent des gestes
différents : corriger une clé, ou attendre qu'un connecteur sache faire. When le scope porte une
organisation hors liste, une clé en trop, ou omet le rôle, Then trois refus, chacun désignant le champ
fautif. Then la validation d'un profil ne dépend d'aucun credential : elle rend le même verdict, sondes
présentes ou absentes.

**2. L'arrivée sur GitHub produit une étape réelle, automatique ou manuelle selon le credential.**
Emplacement : `src/connectors/github.test.ts`. Given une personne dont le login GitHub est connu et
fiable. When le jeton d'administration manque, Then l'étape existe, son tier vaut `manual`, elle porte
le runbook, le deeplink et son `doneWhen`, et `resolveCapability` annonce `automatique si :
github-token-admin`. When le jeton est présent, Then la même étape passe en `auto` avec la même
`idempotencyKey` : ce qui engage n'a pas changé, seul le chemin. When le login est inconnu, Then
l'étape retombe en manuel quel que soit le credential, et son `doneWhen` exige que le login soit
d'abord renseigné en amont. Then un rôle `admin` vaut `riskLevel: "high"` et un rôle `member` non.
Then l'empreinte de deux plans ne différant que par le rôle diffère (`src/core/plan.ts:12`).

**3. Personne ne reçoit un accès sur la foi d'une ressemblance.**
Emplacement : `src/core/octroi.test.ts`. Given une personne dont la fiche amont ne porte aucun login,
et une identité observée sur GitHub rattachée à elle par `HEURISTIC`. When on construit les `handles`
du sujet, Then ils sont vides, et l'étape d'octroi est manuelle. When la même identité est rattachée
par `GITHUB_LOGIN`, Then le handle est retenu et l'étape peut être automatique. Then un handle issu
d'une identité disparue n'est jamais retenu. Then le handle retenu est réduit par `normaliserLogin`,
si bien qu'une saisie amont sous forme d'URL complète de profil donne le même résultat qu'un login nu.

**4. Rien ne s'écrit tant que rien ne l'autorise, et un accès déjà présent se solde quand même.**
Emplacement : `src/core/execution.test.ts`. Given un plan confirmé et `dryRun` à vrai. When le
précheck rend `READY`, Then aucune exécution, aucun changement d'état, et un motif de simulation
lisible. When il rend `ALREADY_PRESENT`, Then l'étape est soldée et `estSoldee` le confirme, en
simulation comme hors simulation : le constat ne dépend pas du droit d'écrire. When il rend `STALE`,
Then l'étape passe en `STALE`, jamais en exécution : c'est le cas du compte déjà membre avec un autre
rôle, qu'un `PUT` promouvrait silencieusement. When `dryRun` est faux et le précheck `READY`, Then
l'exécution a lieu une fois et l'issue `SUCCEEDED` solde l'étape. Then une issue `FAILED` retryable
laisse l'étape reprenable et le plan non clôturable.

**5. Un accès élevé sans échéance ne s'instancie pas, et une échéance ne se reconduit pas.**
Emplacement : `src/core/octroi.test.ts`. Given un profil qui ouvre un rôle d'administration sans
`expiresInDays`. When on assemble, Then aucun plan : un refus qui nomme le profil, le système et le
rôle. When le même profil porte `expiresInDays`, Then l'assemblage réussit et l'étape porte une
échéance absolue calculée depuis l'instant de construction. Then la même construction faite pour une
personne dont la mission finit dans dix ans et pour une personne dont la mission finit demain donne la
même échéance : la fonction ne connaît pas la mission, ce qui rend la reconduction impossible par
construction et non par vigilance.

## Risques et pièges

**Un jeton d'écriture qui n'écrit pas.** La sonde teste la présence d'une variable, pas les droits
qu'elle porte. Un `GITHUB_ADMIN_TOKEN` renseigné avec un jeton en lecture seule affiche `auto` et
échoue en 403 au premier appel réel. Deux atténuations : le message d'échec doit nommer la permission
GitHub attendue plutôt que de rendre le corps brut, et la mise en service se fait sur une organisation
de test avant l'organisation réelle. Une sonde qui appellerait l'API à chaque rendu de page a été
écartée : la page des systèmes sonde tous les connecteurs à chaque affichage
(`src/app/systemes/page.tsx:33-57`).

**Le `PUT` d'appartenance promeut sans prévenir.** `PUT /orgs/{org}/memberships/{username}` appliqué à
un membre existant avec `role: admin` fait une escalade de privilège, et rend 200. C'est la raison
d'être du `STALE` du précheck, et c'est la ligne à ne jamais assouplir « parce que l'étape est
idempotente ». Elle ne l'est pas.

**Une invitation n'est pas une adhésion.** Le `PUT` sur un non-membre crée une invitation en attente,
que la collecte remonte déjà sous un rôle préfixé qu'elle invente (`src/connectors/github.ts:134-138`).
Une étape d'octroi réussie signifie donc « invitation envoyée », pas « accès ouvert ». Le libellé et
le `doneWhen` doivent le dire, sans quoi un dossier se clôt sur un accès que personne n'a accepté. La
capacité `verify`, hors de ce lot, est le vrai remède.

**Le dictionnaire d'états de l'écran casse la page, il ne dégrade pas.**
`src/app/departs/[id]/page.tsx:213` lit `pointee.severite` sans garde. Livrer `ALREADY_PRESENT` en base
avant d'ajouter sa ligne au dictionnaire produit un écran d'erreur de segment, pas un libellé absent.
Les deux vont dans le même commit, c'est l'unique raison d'être de l'étape E4 groupée.

**`estSoldee` gouverne la clôture en silence.** Oublier `ALREADY_PRESENT` dans
`src/core/depart.ts:68-70` donne un dossier dont toutes les cases sont vertes et que le bouton de
clôture refuse, sans message. Le test 4 assert cette fonction directement pour cette raison.

**Le double cache Prisma, avec une valeur d'enum.** `pnpm db:generate` puis redémarrage, sans
exception. Le typecheck passera pendant que le runtime refusera `ALREADY_PRESENT`.

**Un profil modifié invalide les brouillons en vol.** Le scope entre dans `params`, donc dans
l'empreinte (`src/core/plan.ts:12-31`). Changer le rôle d'un profil rend obsolète tout plan
d'arrivée encore en brouillon, qui doit être recalculé. C'est le comportement voulu : la personne qui
confirme doit avoir lu ce qu'elle confirme. Le socle sait déjà remplacer un brouillon démenti,
`peutRecalculer` et `etatDUnPlanRemplace` (`src/core/depart.ts:153-173`) servis par l'action
`recalculerPlan` du départ (`src/app/departs/[id]/actions.ts:244-288`) : l'arrivée reprend ce geste
plutôt que d'en inventer un autre.

**La politique est en cache pour la vie du processus** (`src/lib/policy.ts:22` et `:68-71`). Un profil
corrigé ne prend effet qu'au redémarrage. L'écran de choix du profil doit le dire, sinon un opérateur
corrige un scope, relit le même refus, et conclut que la correction est fausse.

**Un profil supprimé alors qu'un plan le référence.** Les étapes sont figées à la création
(`src/lib/depart.ts:145-149`), donc un plan déjà instancié reste lisible et exécutable. La règle à
tenir est de ne jamais re-résoudre le profil à l'affichage d'un plan existant : seul le recalcul
d'empreinte le fait, et il doit alors conclure à l'obsolescence, ce qui est le bon verdict.

**La divergence entre `docs/architecture.md:383` et `src/core/connector.ts:111-116`.** Tant qu'elle
n'est pas tranchée, un connecteur qui oublie sa voie manuelle rend `none` là où la documentation
laisse croire à un repli automatique. D7 pose le test de contrat qui rend l'oubli impossible, et E8
propose la correction du texte. Ne pas livrer l'un sans l'autre.

**Le plafond de masse n'existe pas.** `docs/architecture.md:463-464` le cite comme unique garde-fou
conservé, aucun code ne le porte. Un plan d'arrivée est petit par nature, donc ce lot ne le pose pas.
Le noter reste nécessaire : la première boucle d'exécution est précisément l'endroit où il devra vivre.

**L'ordre du journal.** La trace par étape précède l'appel, et un échec en pose une seconde, sur le
modèle exact de `src/lib/actions.ts:43-55`. Une boucle qui journaliserait ses résultats en fin de
parcours perdrait précisément les étapes qui ont fait tomber le processus.

**Les octrois hors profil restent une intention.** Les colonnes existent, la règle d'échéance existe,
l'écran non. Il ne faut ni présenter ce lot comme fermant `docs/architecture.md:535-539`, ni
court-circuiter `justification` en la remplissant automatiquement depuis le profil : elle doit rester
nulle tant que personne ne l'a écrite, sinon la file des accès à justifier naîtra déjà pleine de faux.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build. Au-delà :

- La migration s'applique sur une base portant déjà des dossiers de départ, et un dossier antérieur
  s'affiche et se pointe sans erreur, tous ses états rendus avec leur libellé.
- `pnpm policy:check` refuse, en nommant à chaque fois le profil et le champ : un système inconnu, un
  système sans capacité d'octroi, une organisation hors liste, une clé de scope en trop, un rôle
  manquant, et un accès élevé sans `expiresInDays`. Il accepte le fichier d'exemple.
- `pnpm policy:schema` régénère `config/config.schema.json`, le diff ne contient que la section
  `profiles`, et le fichier est commité.
- La page des systèmes affiche, jeton d'administration absent, « Donner : à faire à la main » avec
  « automatique si : github-token-admin », et le scope attendu rendu depuis `scopeSchema`. Le jeton
  renseigné, la même ligne passe en « automatique » sans changer le reste.
- Un plan d'arrivée est calculé de bout en bout avec `ACTIONS_ENABLED` à faux, et la boucle
  d'exécution est lancée : aucune requête sortante en écriture, le précheck seul est appelé, les
  étapes prêtes restent à faire, le compte rendu dit ce qui aurait été appelé.
- Le chemin d'écriture réel se vérifie contre un connecteur factice et, si un essai en conditions
  réelles est jugé nécessaire, contre une organisation GitHub de test. Jamais contre
  `incubateur-ademe` avant que le jeton d'administration ait été créé, tracé et sa portée relue.
- Le journal montre, dans l'ordre, la trace nominative du déclenchement, puis une trace par étape
  avant chaque appel, avec un résultat qui distingue la simulation du succès.
- Un accès déjà présent constaté par le précheck solde son étape et fait avancer le plan, y compris
  en simulation.
- Relecture de la DoD du ticket point par point : étapes réelles pour GitHub selon le credential,
  scope refusé à la construction et non au moment d'agir, aucune écriture sans autorisation
  explicite, précheck avant chaque étape avec « déjà présent » compté comme un succès, tests couvrant
  l'octroi en simulation, le tier dégradé et le scope refusé.
- Les propositions d'amendement de `docs/architecture.md` §3.1, §5.1, §5.8 et §6 sont soumises à
  l'utilisateur et laissées non appliquées si elles ne sont pas validées.
