# Gestionnaire de Comptes de l'Incubateur ADEME

Dépôt : `incubateur-ademe-account-manager`.

Gestion du cycle de vie des accès pour l'incubateur ADEME. Environ 95 personnes
actives, 19 startups d'État, un mainteneur à temps partiel.

Ce document décrit la conception : ce que fait le produit, comment il établit son
périmètre, ses objets métier, et le contrat auquel tout connecteur se conforme. Il
fait référence en cas de doute. Les écrans et le déploiement sont hors périmètre.

---

## 0. Ce que fait le produit

**Donner et retirer des accès depuis un seul endroit, en gardant la trace de qui a
décidé quoi.** L'onboarding et l'offboarding sont les deux moments qui comptent.

Tout le reste est subordonné. Connaître l'état d'un système sert à agir dessus avec
justesse. La détection de comptes sans propriétaire est un effet de bord utile, elle
révèle un offboarding incomplet ou un compte créé à la main, mais elle ne justifie
pas le produit.

Conséquence sur la conception : **la valeur croît avec le nombre de systèmes
couverts, pas avec la finesse sur un seul.** Un outil qui traite deux systèmes sur
dix ne fait gagner aucun temps, l'opérateur ouvrant quand même huit consoles. Les
tiers `assisted` et `manual` sont donc des citoyens de première classe : un système
sans API apparaît dans le même écran, avec son runbook et sa trace d'exécution. Un
système coché à la main dans l'outil vaut mieux qu'un système absent de l'outil.

### Vocabulaire

**Collecte** : lire un système cible pour établir la liste des comptes et des accès
qui y existent réellement.

**Périmètre** : la liste des personnes que l'incubateur suit.

**Compte isolé** : un compte constaté qu'aucune identité du périmètre ne réclame.

**Écart** : une différence entre le collecté et ce que le périmètre justifie. Ce
n'est pas un objet stocké, c'est le résultat d'un calcul.

**Constat** : un écart jugé digne d'action, persisté et réconcilié à chaque collecte.

---

## 1. Forme générale

### 1.1 Une seule surface déployée

Une application Next.js, un PostgreSQL. La collecte est un point d'entrée en ligne de
commande (`src/cli/sync.ts`) lancé en conteneur ponctuel par l'ordonnanceur de la
plateforme.

Pas de worker permanent ni de file de messages **dans le socle**. Un connecteur qui
a besoin de limitation de débit ou de pagination longue décide pour lui-même.

Un ordonnanceur GitHub Actions est écarté : il se désactive après 60 jours
d'inactivité du dépôt, ce qui correspond au profil d'un outil sollicité deux fois par
an. Il mourrait pendant le creux de janvier à août, sans bruit.

### 1.2 Place de n8n

n8n sert au **dernier kilomètre** : notifier, créer un ticket, relancer, et
éventuellement porter des credentials. Il ne porte ni la collecte ni le calcul
d'écart, parce que ses workflows ne sont versionnés nulle part, donc ni testables, ni
auditables, ni reprenables. Une logique qui décide qui perd un accès n'a pas sa place
là.

### 1.3 Ce que le système ne fait pas

Tout ce que beta.gouv automatise derrière l'espace-membre est hors périmètre : leur
organisation GitHub, leur Mattermost, leurs boîtes en `beta.gouv.fr`, et le pipeline
d'offboarding qui les traite. Ces systèmes n'entrent pas au catalogue.

Aucun champ n'est nécessaire pour l'exprimer. Un système absent du catalogue n'est
pas traité, et un système présent sans capability `revoke` déclarée est observé sans
être touché. La déclaration des capabilities dit déjà tout.

**`espace-membre` est aussi un connecteur en lecture seule.** Il ne déclare que
`list` et remonte l'adresse `beta.gouv.fr` d'une personne avec son statut, qui
apparaissent dans sa fiche comme n'importe quel autre accès, à ceci près qu'aucune
action n'est proposée. C'est plus honnête qu'un écran qui ferait comme si cette boîte
n'existait pas, et plus sûr qu'un écran laissant croire qu'on peut la couper. Ce rôle
est distinct de l'ingestion du périmètre décrite en section 2.

### 1.4 Deux couches, deux lieux

| Couche | Où | Contenu | Changement |
|---|---|---|---|
| Le déclaré | git, YAML validé par un schéma | Périmètre transverse, catalogue des systèmes, seuils, dérogations permanentes, configuration des connecteurs | quelques fois par an |
| Le constaté | PostgreSQL | Ce que les connecteurs ont lu, et ce qu'un humain a décidé | tous les jours |

L'écart n'est pas une couche, c'est une fonction pure des deux autres.

Les dérogations temporaires vivent en base avec un `expiresAt` obligatoire, créées
depuis l'interface avec un événement d'audit nominatif. Une dérogation expirée
redevient mécaniquement un écart visible : c'est le mécanisme anti-pourrissement.
Seules les dérogations permanentes vivent en git.

---

## 2. Le périmètre

### 2.1 Le pivot d'identité

Le pivot est le **`username` beta.gouv**. Il est en lecture seule dans le schéma de
l'espace-membre et aucun code ne le met à jour. L'`uuid` interne de leur API n'est pas
utilisé : aucun endpoint ne permet de le résoudre, c'est un identifiant sans porte
d'entrée.

Une exception, et une seule : l'identifiant fabriqué ici pour quelqu'un que
l'espace-membre ne connaît pas. Il ne sert de pivot à aucune source et n'engage
personne d'autre, mais une faute d'une lettre y empêche la collecte de retrouver la
personne le jour où elle apparaît en amont, et l'outil porte alors deux fiches pour une
seule personne. `Person.usernameFabricated` désigne ces identifiants : posé à la
création, éteint par la collecte le jour où elle adopte la fiche. Lui seul ouvre le
renommage, et la fusion vers la fiche qui porte déjà le bon identifiant. Un vrai
username beta.gouv reste en lecture seule, y compris sur une fiche locale.

### 2.2 Une collecte en un appel

**Le périmètre vient en entier de l'espace-membre**, qui sait désormais dire qui
relève d'un incubateur : une requête pour ses produits et leurs phases, une autre
pour ses membres, la voie de rattachement déjà tranchée. Le miroir public
`beta.gouv.fr` n'est plus interrogé : ses 24 heures de latence n'avaient pas leur
place là où se décide une coupure d'accès, et lui seul ignorait qu'une startup puisse
relever de plusieurs incubateurs.

**Une lecture de plus par personne rattachée à une équipe.** La liste scopée
n'associe aucune mission à ces personnes, puisque leurs missions ne portent aucun
produit de l'incubateur. Leur fiche complète est donc lue à part, sans quoi l'équipe
transverse n'aurait aucune échéance et ne sortirait jamais. La concurrence reste
bornée à huit : rien ne se gagne à aller plus vite qu'un traitement nocturne.

**Une chute du périmètre ne fait disparaître personne.** Le périmètre arrivant en un
seul appel, une réponse tronquée mais valide ferait sortir tout le monde à la fois
sans qu'aucune erreur ne soit levée. Au-delà d'un cinquième perdu d'un coup, la
collecte ne date aucune disparition et se déclare partielle. Ce plancher complète la
règle générale : une collecte qui n'est pas `OK` ne pose jamais de `vanishedAt`.

**Une collecte qui s'arrête doit se voir.** Sans elle, les échéances ne bougent plus
et les statuts restent au vert : les écrans continueraient d'affirmer un périmètre
gelé avec l'assurance d'un périmètre frais, ce qui est la panne la plus discrète de
ce système et la seule qui les fasse mentir tous à la fois. Passé deux fois la
période du traitement quotidien, ils cessent d'affirmer et le disent, sur le tableau
de bord comme sur la fiche d'une personne, où se décide une coupure.

### 2.3 Le rattachement à l'incubateur

Deux voies, mais ce n'est plus ce système qui les lit : l'espace-membre rend un
`attachment` par membre, calculé sur ses propres tables. Il continuera donc de
répondre juste le jour où une startup relèvera de plusieurs incubateurs, ce qu'un
filtre sur un identifiant unique ne saurait pas faire.

**Par produit**, quand une mission porte une startup de l'incubateur. La fin de
rattachement est le maximum des fins de ces missions, que l'API restreint déjà à
l'incubateur : retenir une mission menée ailleurs prolongerait les accès de plusieurs
mois après le départ réel.

**Par équipe.** Une personne rattachée ainsi n'a aucune mission sur un produit de
l'incubateur : sa fin de mission beta.gouv globale fait alors foi, et c'est sa fiche
complète qui la donne.

Le champ `attachment` retient `STARTUPS`, `DECLARED`, `BOTH` ou `NONE`. Il documente
la voie **constatée** par l'espace-membre, « aucune » comprise, et rien d'autre : on n'y
mélange pas du décidé. `LOCAL` portait un second sens sur cet axe et entrait en collision
avec `PersonSource.LOCAL`, qui dit d'où vient la fiche.

La liste transverse de `config/accounts.yaml` et `config/config.yaml` fait **autorité sur l'appartenance** : qui
y est déclaré reste dans l'incubateur même si l'espace-membre ne le rattache à aucune
équipe, sa fiche ne servant alors qu'à dater sa fin. L'en retirer est le geste qui
l'en sort. Une personne qui y figure sans avoir de fiche est signalée à chaque
collecte plutôt que d'être ignorée : c'est une faute de frappe ou une fiche à créer.

**L'appartenance à l'incubateur est calculée, jamais stockée**, au même titre que le
statut. Elle se lit dans cet ordre : une sortie forcée par un opérateur, puis une entrée
forcée, puis les rattachements en cours, collectés et manuels sans préséance entre eux,
puis rien. La liste transverse n'apparaît pas comme source distincte dans cet ordre : la
collecte la matérialise déjà en `attachment = DECLARED`, elle est donc lue sous sa forme
constatée, et il n'y a pas deux chemins à maintenir.

**Une seconde autorité existe désormais, et elle est assumée.** `ScopeOverride` dit
qu'un opérateur place quelqu'un dans l'incubateur, ou l'en sort, avec une raison
obligatoire et son nom. Le geste de sortie existe donc des deux côtés : retirer de
`scope.transverse` dans le YAML, poser une exclusion dans l'outil. Quand les deux se
contredisent, l'écran affiche la contradiction et nomme le geste manquant, plutôt que de
laisser la collecte nocturne rétablir en silence un rattachement qu'un opérateur a
explicitement retiré.

**Une surcharge dit l'appartenance, elle n'ordonne rien.** Elle ne date aucune
disparition, n'ouvre ni ne ferme aucun constat, ne rend aucune identité révocable ni non
révocable, et ne touche aucun système cible. La personne reste dans les listes et ses
comptes continuent d'être examinés. Sans cette règle, la sortie forcée deviendrait le
moyen le plus rapide de faire disparaître un écart gênant. Ce qui coupe des accès reste
le dossier de départ, avec son plan, sa confirmation et son journal.

### 2.4 Comptes non humains

Bots, comptes de service, jetons d'intégration continue et clés d'API ne passent
**pas** par le modèle `Person`. Les y forcer obligerait à leur inventer des missions
et des dates de fin qui n'existent pas.

**`ServiceAccount`** porte `key`, `label`, `purpose`, un `ownerUsername` obligatoire,
et une revue périodique au lieu d'une échéance. Une revue en retard est un constat au
même titre qu'un accès expiré. Sans ce modèle, ces comptes remonteraient comme sans
propriétaire à chaque exécution, on s'habituerait au bruit et le rapport perdrait sa
valeur.

### 2.5 Personne absente de l'espace-membre

Toute personne ayant des accès doit y avoir une fiche. Un compte observé sans
personne en face est donc le plus souvent une **fiche manquante à créer**, pas un
accès à couper. Deux constats distincts, `UNREGISTERED` et `ORPHAN`, appellent des
actions opposées ; les confondre ferait couper l'accès de gens en poste.

Les personnes hors incubateur relèvent d'un traitement distinct, avec une date de fin
saisie localement.

---

## 3. Objets métier

### 3.1 Déclaré (YAML versionné, validé par un schéma)

- `scope.incubator` : l'acronyme de l'incubateur, `ademe`
- `scope.transverse[]` : usernames de l'équipe transverse, qui font autorité sur
  l'appartenance à l'incubateur
- `scope.local[]` : personnes hors incubateur, avec leur échéance
- `startups.terminalPhases[]` : phases dans lesquelles une startup ne justifie plus
  d'accès
- `systems[]` : le catalogue, voir section 5
- `thresholds` : `graceDays`, `soonDays`, `staleDays`, `maxScopeDrop`,
  `collectStaleHours`
- `serviceAccounts[]` : allowlist des comptes non humains
- `permanentDerogations[]` : `owner` et `reason` obligatoires
- `connectors.<clé>` : réglages propres à chaque connecteur, dont le connecteur visé
  décide la forme et qu'il valide lui-même. Une clé qu'aucun connecteur ne porte fait
  refuser le démarrage, et rien de secret n'y a sa place

Qui peut ouvrir l'outil n'est **pas** déclaré ici mais dans l'environnement, par
`OPERATORS` et `BREAK_GLASS_USERNAMES` : cela relève du déploiement, change sans
livraison de code, et n'a pas à être publié dans un dépôt lisible de tous.

### 3.2 Constaté (PostgreSQL)

**`Person`** : `username` (pivot), `usernameFabricated`, `fullname`, `primaryEmail`,
`communicationEmail`, `githubLogin`, `missionEnd`, `source`, `attachment`, `startups[]`,
`firstSeenAt`, `lastSeenAt`, `vanishedAt`.

`attachment` dit la voie constatée par l'espace-membre, « aucune » comprise. À quel titre
une personne appartient à l'incubateur ne s'y lit pas : cela se calcule, voir §2.3.

On persiste le minimum nécessaire au calcul : ce qui sert de clé, ce qui sert au
rapprochement, ce qui déclenche. Filtrage à l'ingestion, non négociable : `bio`,
`competences`, `domaine`, `legal_status` et `workplace_insee_code` sont jetés dans le
mapper. Un registre d'accès n'a aucun besoin de la biographie ni du statut légal des
gens, et les stocker constituerait un second fichier de personnel.

S'y ajoute ce qui sert à décider sans servir à calculer. Un connecteur peut remonter ce
qu'il sait d'un compte et qu'aucune ressource ni aucun accès ne dit, sous trois
conditions : la donnée est déjà rédigée pour être lue par un humain, le socle ne
l'interprète jamais, et rien de ce qui est un accès n'y entre. Elle se rend telle quelle,
et sa disparition suit celle du compte.

**`Startup`** : `ghid`, `name`, `incubatorGhid`, `currentPhase`, `phaseStart`, plus
les horodatages de constat. La phase dit si une startup est vivante ou terminée.

**`ExternalIdentity`** : un compte observé. `provider`, `externalId`, `idKind`,
`handle`, `personId` **nullable**, `serviceAccountId` nullable, `matchMethod`, plus
les horodatages. Unique sur `(provider, externalId)`.

`personId` nullable est le cœur du modèle : **une identité non rattachée est la
définition même de l'écart**. Elle ne se jette ni ne se force vers une personne.

`idKind` documente la qualité de l'ancre. Là où seul l'email existe, la fragilité est
déclarée plutôt que masquée.

Règle dure : une identité dont `matchMethod` vaut `HEURISTIC` ou `NONE` **ne peut
jamais produire une étape de révocation**. Elle alimente une file de rattachement.

**`Resource`** : `provider`, `externalId`, `label`, `url`. Les métadonnées vivent ici
et pas sur l'accès : une page partagée avec N personnes ne duplique pas son titre N
fois.

**`AccessGrant`** : `externalIdentityId`, `resourceId`, `role`, `lastActivityAt`,
plus les horodatages. `vanishedAt` plutôt qu'une suppression : une colonne, et
l'historique est gratuit.

**`Reference`** : un objet possédé, ni accès ni révocable, avec `onOffboard` valant
`ARCHIVE`, `TRANSFER` ou `KEEP`. Une page créée par quelqu'un n'est pas un accès ;
les confondre fait proposer des suppressions absurdes.

**`SyncRun`** : `provider`, `capability`, `startedAt`, `finishedAt`, `status`,
`itemsSeen`, `error`. Une ligne par exécution. Le run **s'ouvre en échec** et n'est
promu qu'à la fin : un processus tué laisse une trace d'échec, pas un run vert.

### 3.3 Décidé (PostgreSQL, immuable)

**`DepartureCase`**, **`Plan`**, **`PlanStep`**, **`Finding`**, **`Derogation`**,
**`StartupAssignment`**, **`ScopeOverride`**, **`AuditEvent`**.

Un rattachement manuel à une startup ne vit pas dans `Person.startups`, que la collecte
réécrit sans condition à chaque passage : c'est un objet daté, avec son auteur, et il se
ferme au lieu de se supprimer. Une surcharge d'appartenance ne vit pas davantage sur
`Person` : ce serait mêler du décidé à une table de constaté.

Les champs d'une étape de plan sont **dénormalisés et figés à la création**. On
stocke la photo, pas une clé étrangère : ce qui a été approuvé doit rester lisible
tel quel dans deux ans. Les libellés de constat, à l'inverse, se recalculent à
l'affichage, puisqu'un constat décrit une situation présente et se réconcilie.

Le journal est en écriture seule, à rétention indéfinie, exportable. Son écriture est
sans attente avec capture d'erreur : une panne du journal ne doit jamais faire échouer
l'action métier, l'inverse n'étant pas vrai.

### 3.4 Reconstructibilité

Tout est reconstructible en rejouant les connecteurs, sauf le journal, les
dérogations et l'état décidé. Le périmètre de sauvegarde critique se réduit à ces
trois familles.

**Ce qu'un opérateur attribue relève de l'état décidé**, et se rejoue depuis le
journal. Rattacher un compte à quelqu'un, l'en détacher, nommer une personne que
l'espace-membre ne connaît pas, corriger l'identifiant qu'on lui a fabriqué, fusionner
sa fiche avec celle qui porte le bon, la rattacher à une startup pour un temps donné,
forcer ou retirer son appartenance à l'incubateur : aucune collecte ne redevinera ces
gestes, mais
chacun y laisse une trace nominative qui suffit à les reconstituer. C'est ce qui
dispense de les déclarer dans le YAML : la politique dit les règles, la base porte
les faits et les décisions, et le journal garantit qu'on peut les retrouver.

**Nommer un compte et construire une identité ne s'équivalent pas.** Attribuer un
premier compte à une fiche, c'est mettre un nom sur ce qui a été observé. Lui en
rattacher un second, alors que rien dans les sources ne relie les deux, c'est
affirmer qu'ils appartiennent à la même personne, et une révocation les coupera tous
les deux. Le second geste se confirme explicitement ; le premier non.

Une fiche créée ainsi n'a **pas d'échéance** tant qu'aucun rattachement daté ne lui en
donne une : elle n'existe que par son compte et vit tant qu'il est observé. Lui en
inventer une reviendrait à prétendre savoir ce qu'aucune source ne dit. Un rattachement
manuel à une startup, lui, porte obligatoirement une date de fin : c'est une décision,
elle est bornée par elle-même, et la fiche a alors une échéance qui n'a rien d'inventé.
La collecte du périmètre ne fait donc disparaître une fiche locale ni tant qu'une de ses
identités est vue, ni tant qu'un de ses rattachements court. Une personne venue de
l'espace-membre qui en sort, elle, continue de lever `SCOPE_EXIT`.

---

## 4. Statuts et constats

### 4.1 Le statut d'une personne

Calculé, jamais stocké, à partir de l'**échéance effective** et de la présence au
référentiel. L'échéance effective est la plus lointaine entre la fin de mission que
l'amont donne et les rattachements manuels en cours. Un rattachement court ne rogne donc
jamais une mission longue, et prolonger un accès est permis, tracé et daté, mais se voit
partout où le statut se lit. Rien n'est écrit dans `Person.missionEnd`, qui reste ce que
l'amont dit.

| Statut | Signification |
|---|---|
| `SORTI` | A quitté le référentiel amont, sans preuve de traitement |
| `A_TRAITER` | Échéance dépassée au-delà du délai de grâce |
| `EN_SURSIS` | Échéance dépassée, encore dans le délai de grâce |
| `BIENTOT` | Échéance dans la fenêtre d'anticipation |
| `ACTIF` | Échéance lointaine |
| `SANS_ECHEANCE` | Aucune date de fin connue |
| `ANCIEN` | Échéance dépassée depuis plus de `staleDays` |

Trois règles portent l'essentiel.

**La fin de mission est inclusive** : c'est le dernier jour travaillé. Couper ce
jour-là priverait la personne de sa dernière journée.

**Le délai de grâce absorbe un renouvellement signé en retard.** Une date de fin est
un jalon contractuel, saisi à la main et souvent après coup, pas un départ. Un
offboarding déclenché à tort coûte infiniment plus cher qu'une semaine d'accès en
trop.

**`SORTI` prime sur toute échéance.** Le référentiel amont retire de ses équipes les
membres dont la mission est finie : la personne disparaît de la source au moment
précis où il faut agir. La masquer serait la perdre de vue.

**`ANCIEN` sépare l'historique de l'action.** Sans lui, une mission close il y a
trois ans se retrouve au même rang qu'une close la semaine dernière, et une liste où
tout est urgent ne signale plus rien.

### 4.2 Les constats

Persistés, et **réconciliés à chaque collecte** : ceux qui ne se vérifient plus se
ferment seuls. Un constat qu'il faut clore à la main pour une situation déjà résolue
devient du bruit, et le bruit fait ignorer le reste.

**Clore à la main sert à l'inverse** : dire qu'une situation qui dure a été traitée.
Une personne sortie du référentiel le reste, son constat reviendrait donc à chaque
collecte jusqu'à noyer la file. La clôture exige une raison, retient le nom de son
auteur, et la réconciliation ne rouvre plus ce constat tant que la situation dure.
Le verrou se lève dès qu'elle cesse d'être constatée, sans quoi un épisode ultérieur
ne serait plus jamais signalé et le silence ressemblerait à une absence d'écart.

`SCOPE_EXIT`, gravité haute : quelqu'un que plus aucune source ne réclame. C'est le
constat le plus important, parce que rien d'autre ne le signalerait.

`INACTIVE_STARTUP`, gravité moyenne : toutes les startups d'une personne, collectées
comme rattachées à la main, sont dans une phase terminale, alors que son échéance court
encore. Elle ne travaille donc plus sur rien au sein de l'incubateur.

Trois garde-fous. Le constat épargne qui tient son appartenance d'une équipe (`DECLARED`,
`BOTH`) : son titre ne dépend d'aucune startup, le lui opposer serait un contresens. Il
ne se lève **pas** sur une échéance effective déjà passée, où elle dit la même chose et
la dit mieux ; la comparaison tronque au jour UTC, si bien que le dernier jour travaillé
compte encore comme travaillé. Et une **phase inconnue interdit de conclure** : on ne
propose pas une coupure sur une supposition.

`OVERDUE_MANUAL_ACTION`, gravité haute : une étape de départ a été pointée comme faite,
et le compte est toujours là quand le système a été relu. Une case cochée vaut parole,
pas preuve, et c'est la collecte qui tranche. C'est le seul constat qui naisse d'une
déclaration humaine plutôt que d'un écart entre le collecté et le périmètre.

Poser ou retirer un rattachement manuel ne lève ni ne ferme ce constat sur le champ, et
c'est délibéré : il dépend des phases de toutes les startups et d'une date qui passe
toute seule. Le recalculer dans le geste créerait une seconde vérité, et resterait
incomplet le jour où un rattachement expire sans que personne n'ait cliqué.

Les gestes offerts sur un constat sont ceux qui existent déjà, atteignables là où la
consigne est lue. Aucun ne coupe un accès hors d'un dossier de départ, et aucun ne ferme
le constat en passant : la clôture reste un geste séparé, avec sa raison et le nom de son
auteur.

---

## 5. Contrat de connecteur

### 5.1 Le tier est une résolution, pas une constante

Le tier d'automatisation est une propriété du triplet **(système, opération,
credential disponible)**. Le connecteur déclare ce qu'il sait faire et sous quelle
condition ; le tier effectif est résolu au démarrage selon les credentials présents.

```ts
type Capability = "list" | "grant" | "revoke" | "verify";
type Tier = "auto" | "assisted" | "manual" | "none";

interface CredentialRef {
  id: string;
  source: "env" | "fgp";
  scopeNote: string;      // portée réelle, en clair
  nominative: boolean;    // lié à une personne physique ?
}

interface CapabilityDecl {
  requires: readonly string[];   // vide = inconditionnel, cas du chemin manuel
  tier: Exclude<Tier, "none">;   // "none" ne se déclare pas, il se constate
  reversibleForDays?: number;
  slaHours?: number;
  fragile?: boolean;
  runbook?: string;
}
```

Résolution au démarrage : pour chaque capability, la première déclaration dont tous
les credentials répondent donne le tier effectif. Si aucune ne répond, la capability
tombe à `manual` s'il existe un runbook, à `none` sinon.

Le jour où un credential expire, le connecteur dégrade proprement, le plan l'affiche
avec la raison, et le runbook prend le relais. Il ne plante pas, et surtout il ne
conclut pas faussement qu'il n'y a aucun accès.

**Le plan affiche toujours le tier effectif et ce qui manque pour faire mieux, jamais
le tier théorique.** Le runbook est requis même sur les capabilities `auto` : un
chemin automatique qui tombe redevient un chemin manuel.

Un connecteur `none` produit quand même un `SyncRun`, avec un statut non vérifiable
et sa date de dernière revue. Un système absent des exécutions serait indiscernable
d'un système sans écart.

### 5.2 Comptes rattachés, comptes isolés

Le socle ne connaît qu'un type de compte : celui qui devrait correspondre à une
identité du périmètre. Un compte qu'aucune n'en réclame est **isolé**, ce qui n'est
pas une catégorie déclarée mais l'état d'un compte constaté. Le cas d'usage direct
est le siège payé pour personne.

### 5.3 Fonctionnalités propres à un connecteur

Un connecteur peut porter des fonctionnalités hors socle, avec leur propre écran, qui
ne passent ni par `Person` ni par `AccessGrant`. La gestion des invités Notion en est
une : ils ne sont jamais rattachés à une personne du périmètre, puisqu'un membre
interne n'a pas d'accès invité.

Règle : si une fonctionnalité oblige à assouplir une règle du socle pour exister,
c'est qu'elle relève de cette section.

**Où cela vit.** Un connecteur a une page à lui sous `/systemes/<clé>`, atteignable
depuis l'écran Systèmes, qui porte sa configuration et ses fonctionnalités. Elle
n'existe que quand il a quelque chose à montrer : un écran, une configuration ou au
moins une fonctionnalité déclarée. Sinon pas de lien, et l'adresse rend 404.
L'`entrypoint` d'une `ConnectorFeature` désigne un segment sous cette page.

**Deux registres, un seul sens d'import.** Le contrat déclare la fonctionnalité, qui
est de la donnée pure et se résout contre les mêmes sondes que les capacités : la
ligne de commande doit pouvoir dire qu'une fonctionnalité est indisponible sans
charger le moindre composant. Le rendu passe par un registre d'interface, qui associe
une clé de connecteur à un chargeur d'écran. `src/ui/` connaît `src/connectors/`,
jamais l'inverse, et un test parcourt le graphe d'imports depuis les entrées en ligne
de commande pour tenir la propriété.

**Rien de spécifique dans les écrans génériques.** Le socle ne pose qu'un lien vers
cette page. La seule exception envisagée est le tableau de bord, où un connecteur
pourra poser des tuiles : c'est un chiffre, pas une fonctionnalité.

### 5.4 Interface d'exécution

```ts
interface Connector {
  readonly contract: ConnectorContract;
  probe: () => Promise<readonly CredentialProbe[]>;
  list?: (ctx: RunContext) => Promise<CollectResult>;
  plan: (intent: Intent, ctx: RunContext) => Promise<readonly PlannedStep[]>;
  precheck?: (step: PlannedStep, ctx: RunContext) => Promise<PrecheckResult>;
  execute?: (step: PlannedStep, ctx: RunContext) => Promise<StepOutcome>;
}
```

`plan` est le seul obligatoire. C'est ce qui fait d'un système purement manuel un
connecteur de plein droit : il ne sait ni lister ni exécuter, mais il sait dire qu'à
l'arrivée de quelqu'un il faut faire telle chose, avec le lien et le critère de
complétion.

L'invariant de collecte est porté par le type de retour, pas par la discipline de
chaque implémentation : `status: "ok"` implique l'absence d'erreurs.

### 5.5 Où vivent les credentials

Mixte, décidé système par système.

`fgp` pour tout credential à portée large que le fournisseur ne sait pas cloisonner.
Le triplet OVH en est le cas d'école : il porte le compte entier, et le cloisonnement
reposerait sinon sur le fait que notre code ne se trompe pas. Derrière
fine-grained-proxy, l'allowlist s'applique côté proxy, l'application ne détient
jamais le jeton amont, et les appels sont journalisés au même endroit.

`env` pour les fournisseurs qui savent émettre des credentials nativement restreints,
typiquement un jeton GitHub limité à une organisation.

`nominative: true` marque un credential lié à une personne physique. C'est une dette
explicite, qui apparaît dans l'interface et justifie de préférer un chemin dégradé
mais durable quand il en existe un.

### 5.6 Invariants

**Collecte.** Un connecteur ne retourne jamais `ok` s'il a avalé une erreur unitaire :
une pagination tronquée qui remonte `ok` produirait de fausses conclusions de
révocation. Et un run non `ok` ne fait rien disparaître, il conserve le dernier état
constaté.

**Exécution.** Précheck avant chaque étape, comparé à l'état attendu. « Déjà absent »
compte comme un succès, c'est le cas nominal quand une autre automatisation est passée
avant. L'empreinte du plan est recalculée au démarrage de l'exécution et pas seulement
à la confirmation. Clé d'idempotence unique par étape. Ordre de réversibilité
décroissante. Plafond de masse au-delà duquel une confirmation supplémentaire est
demandée. Et `ACTIONS_ENABLED=false` force tout en simulation, sans modification de
code.

### 5.7 Tests de contrat

Chaque connecteur porte un test exécuté quotidiennement, indépendant de la collecte,
qui vérifie que la forme de la réponse distante n'a pas changé. L'API de
l'espace-membre n'a ni versionnement ni revalidation de sortie, et les API Notion, SCIM
comprise, ne sont pas documentées : sans ce test, la panne est silencieuse et se
découvre au moment d'agir.

### 5.8 Catalogue

Tous les systèmes du catalogue apparaissent dans les écrans, quel que soit leur tier.
Un système en `manual` ne coûte qu'une entrée de configuration et un runbook, et rend
l'offboarding complet au lieu de partiel.

| Système | Objet | Tier visé |
|---|---|---|
| `notion` | membres du workspace, par SCIM | `auto` |
| `notion-trombi` | page trombinoscope d'une personne | `manual` |
| `espace-membre` | adresse `beta.gouv.fr` et son statut | `auto`, lecture seule |
| `github` | organisations `incubateur-ademe` et `incubateur-ademe-admin` | `auto` |
| `email-list` | alias et redirections, implémentation OVH | à établir |
| `vaultwarden` | collections et accès | à établir |
| `scalingo` | collaborateurs par application | à établir |
| `grafana` | comptes de l'instance auto-hébergée | à établir |
| `sentry` | organisation, sur l'instance de beta.gouv | à établir |
| `teams-o365` | appartenance Teams et compte `.ext@ademe.fr` | en attente |

`github` vise `auto` sans réserve : c'est le seul dont le fournisseur sait émettre un
credential nativement restreint à une organisation, sans proxy. C'est aussi l'accès le
plus critique du parc.

`email-list` n'est pas un connecteur OVH générique : son objet est le rattachement
d'une personne à un alias. Un alias a plusieurs destinataires, donc retirer une
personne c'est retirer une destination. Cas à traiter explicitement : retirer la
dernière destination rend l'alias silencieusement inopérant, ce qui en fait une action
à risque élevé sous une apparence anodine.

`sentry` tourne sur l'instance de beta.gouv, seul cas d'instance partagée. Ce que le
connecteur peut faire dépend des droits de l'incubateur sur sa propre organisation.

`teams-o365` figure par anticipation et dépendra de `teams-auto`, qui porte l'accès à
Graph, le compte de service et le certificat. L'application appellera cette brique
sans jamais détenir les credentials Microsoft.

### 5.9 Premiers connecteurs implémentés

Deux connecteurs éprouvent le contrat, à condition de tomber de part et d'autre de la
ligne `auto` contre `manual`.

**`notion`**, tier `auto` : membres du workspace par SCIM. Un siège attribué sans
identité en face est un compte isolé. Son credential est **nominatif** : Notion révoque
le jeton au départ de la personne qui l'a créé comme à son simple changement de rôle, et
n'importe quel propriétaire de workspace peut le retirer. Il porte l'écriture sur le
workspace entier et ne se cloisonne pas côté fournisseur ; il reste en `env` tant
qu'aucun chemin d'écriture n'est livré. Le propriétaire qui l'a créé est le seul compte
que l'API ne sait pas retirer, trou permanent du chemin de révocation.

La gestion des invités reste une fonctionnalité propre, portée depuis
`n8n-automations`, mais elle ne peut pas reposer sur ce credential : SCIM ne sait ni les
lire ni les gérer, et Notion les compte à part des membres. Conséquence à tenir partout
où se décide une coupure : une fiche sans compte Notion ne signifie pas sans accès à
Notion.

**`notion-trombi`**, tier `manual` : créer ou mettre à jour la page d'une personne
dans le trombinoscope à l'arrivée, l'archiver au départ. Le choix est délibéré : c'est
un octroi et non une révocation, il produit une tâche lisible plutôt qu'un appel
d'API, et il porte sur une référence où archiver ne veut pas dire supprimer. Si le
contrat ne sait pas exprimer ce cas aussi bien qu'une révocation SCIM, il est faux.

---

## 6. Octroi et profils

À terme, tout accès accordé passe par l'outil, ou y est déclaré quand il a été posé à
la main. Sans cette règle, le déclaré ment en quelques semaines. La collecte reste le
filet : elle révèle les accès accordés hors de l'outil, ce qui permet de les
régulariser au lieu de les découvrir au départ de la personne.

Un profil est un ensemble d'accès associé à un rôle. L'onboarding applique un profil,
l'offboarding le retire, ce qui rend les deux symétriques par construction. Un accès
hors profil porte une justification et une échéance. Un accès élevé porte une échéance
obligatoire et ne se reconduit jamais par prolongation de mission, sans quoi un rôle
d'administration se renouvelle silencieusement.

### Qui agit, et comment on valide

Seule l'équipe transverse agit. Il n'y a pas de délégation aux leads dans cette
version : elle ajouterait un modèle d'autorisation et des demandes en attente pour un
besoin qui n'est pas là.

La validation se réduit donc à ce qui la justifie, regarder avant d'agir : le plan est
calculé et figé avec son empreinte, l'opérateur le lit et confirme, l'empreinte est
recalculée au démarrage de l'exécution et un écart repasse en confirmation, tout est
journalisé nominativement.

Pas d'approbateurs multiples, pas de fenêtre de rétractation, pas de quorum. Ces
mécanismes protègent contre le fait qu'une personne décide seule pour une autre, ce
qui n'arrive pas tant que la même équipe demande et exécute. Seul garde-fou conservé :
le plafond de masse.

Le jour où la délégation arrivera, elle se greffera ici sans toucher au reste : un
plan créé par un lead naîtra en attente au lieu de naître confirmable.

---

## 7. L'API espace-membre : ce qu'elle donne, et ses pièges

Les routes en lecture accessibles à un service sont protégées par un en-tête
`X-Api-Key` ; tout le reste est derrière une session utilisateur. Trois sont
utilisées ici, toutes scopées par le `ghid` de l'incubateur, jamais par un `uuid` :
`/api/protected/incubators/{ghid}/startups` pour les produits et leurs phases,
`/incubators/{ghid}/members` pour le périmètre, et `/members/{username}` pour une
fiche complète. Les routes au singulier qui les précédaient existent toujours, mais
sont dépréciées.

Quatre pièges vérifiés sur l'API réelle, à connaître avant de toucher au mapper.

**Les missions d'un membre scopé sont restreintes à l'incubateur.** C'est ce qui rend
la liste directement exploitable, mais une personne rattachée par sa seule équipe n'a
alors aucune mission : sans lire sa fiche complète, elle n'aurait pas d'échéance.

**Une mission peut porter des produits d'un autre incubateur.** Seuls les `ghid` du
périmètre sont retenus, sinon des produits étrangers entreraient dans la fiche.

**Les dates n'ont pas la même origine selon le champ.** Une fin de mission arrive à
minuit UTC, une fin de phase à 23h00 UTC, soit le lendemain à Paris. Tronquer la
chaîne décalerait cette seconde d'un jour et couperait un accès la veille du dernier
jour travaillé. Tout passe par le fuseau de Paris.

**Le filtre d'activité ne se demande pas.** La liste des membres accepte
`status=active` ; son défaut renvoie aussi les missions terminées, et c'est ce qu'il
faut. Masquer les partants reviendrait à ne jamais leur couper leurs accès, au moment
précis où il le faudrait.

Un document OpenAPI existe désormais et les réponses sont validées par un schéma en
sortie, mais le dépôt a supprimé des pans entiers de fonctionnalités en quelques
mois. D'où le test de contrat quotidien de la section 5.7.

**Rien n'est cru sur parole en entrée.** Ce que leur contrat déclare obligatoire est
exigé à la lecture, sans quoi un champ renommé chez eux se lirait ici comme une
valeur absente : tout le monde deviendrait sans échéance, plus personne n'expirerait,
et aucune erreur ne serait levée. Un élément illisible est écarté seul plutôt que de
faire tomber le périmètre entier ; l'écart remonte, donc la collecte ne se dit pas
complète, donc elle ne date aucune disparition.

Cette validation attrape un changement de structure, pas la disparition d'une valeur
facultative. Une date de fin de mission peut légitimement manquer, celle d'une
mission en cours : si ce champ était renommé sans rien changer d'autre, le silence
serait indétectable ici. C'est au test de contrat de s'étonner que plus aucune
échéance ne remonte.

**La connexion, elle, dépend encore d'une route dépréciée.** Le provider NextAuth
utilisé pour le login a `/api/protected/member/{username}` en dur dans son client, et
cette adresse ne se configure pas depuis ce dépôt. Le jour où l'espace-membre retirera
ses routes au singulier, plus personne ne pourra se connecter : la version de ce
paquet est donc à suivre, et à relever avant ce retrait.

---

## 8. Ce qui reste à trancher

- Fermeture automatique d'un constat selon le métier de la personne, qui attend leur
  catégorisation. La clôture à la main, elle, existe : voir la section 4.2.
- Droits réels de l'incubateur sur son organisation Sentry, hébergée chez beta.gouv.
- Ce que l'API de l'instance Vaultwarden expose réellement, avant de fixer son tier.
- Frontière définitive avec `teams-auto` pour le volet Entra.
- Rotation du triplet OVH avant toute mise en service d'un chemin d'écriture.
- Porteur du jeton SCIM Notion : compte de service propriétaire de l'organisation, ou à
  défaut rotation avant toute mutation de rôle de son porteur.
