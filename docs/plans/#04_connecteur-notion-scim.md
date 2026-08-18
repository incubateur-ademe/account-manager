# Connecteur Notion par SCIM (#4)

> Plan d'implémentation de l'issue #4. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

**Le contrat est complet et n'a pas besoin d'évoluer.** `src/core/connector.ts:159-162` porte
l'invariant de collecte dans le type : `status: "ok"` implique `errors?: undefined`, donc seul un
cast peut rendre un `ok` menteur. `src/core/connector.ts:84-117` résout le tier effectif à partir des
sondes de credentials, et `src/core/connector.ts:218-232` ne rend obligatoire que `plan`.

**Le socle de collecte fait déjà tout le travail commun.** `src/lib/sync/collecte.ts:251-253` ouvre
le `SyncRun` en `FAILED` et ne le promeut qu'à la fin. `src/lib/sync/collecte.ts:300-326` ne date une
disparition que si le statut final vaut `OK`, après le garde-fou de chute
(`src/core/collecte.ts:10-15`). `src/lib/sync/collecte.ts:117-131` prévoit le cas d'un accès sans
ressource nommée : le système devient lui-même une ressource sous la clé réservée `(systeme)`.
`src/lib/sync/collecte.ts:363-394` écrit un run `SKIPPED` pour un système non lu, et
`src/lib/sync/collecte.ts:343-354` journalise chaque passage.

**L'orchestration sait déjà quoi faire d'un connecteur sans credential.**
`src/lib/sync/executer.ts:109-125` résout `list`, et bascule sur `noterSystemeNonLu` dès que le tier
vaut `none`, sans compter cela comme un échec (`src/lib/sync/executer.ts:227-231`). Rien à écrire de
ce côté.

**Les écrans se peuplent tout seuls à partir de `CONNECTEURS`.**
`src/connectors/index.ts:10` est la seule liste. `src/app/systemes/page.tsx:33-57` sonde et affiche
le tier effectif, `src/app/page.tsx:54-59` déduit les systèmes muets de cette même liste,
`src/lib/depart.ts:69-89` interroge chaque connecteur pour le plan de départ et signale les systèmes
sans connecteur (`src/app/departs/[id]/page.tsx:146-152`), et
`src/app/comptes-isoles/page.tsx:26-33` remonte tout compte non rattaché, plus tout rattachement
`HEURISTIC`.

**Le seul connecteur existant sert de patron.** `src/connectors/github.ts` : constante d'API en dur
(`:25`), pagination bornée avec refus explicite d'un inventaire tronqué (`:57-101`), sonde sans le
moindre appel réseau (`:166-176`), promotion `ok` / `partial` / `failed` calculée à partir des
erreurs accumulées (`:203-221`), et un `plan` qui rend une tâche manuelle avec lien et critère de
complétion (`:223-249`).

**Ce qui manque.** Aucun fichier `src/connectors/notion.ts`, aucune variable `NOTION_*` lue par le
code : `src/lib/env.ts:14-37` ne connaît que `GITHUB_TOKEN`, facultatif à dessein.
`.env.example:116-125` réserve déjà les emplacements `NOTION_SCIM_TOKEN` d'un côté,
`NOTION_SESSION_TOKEN` et `NOTION_SESSION_SPACE_ID` de l'autre, commentés, avec la distinction
nominatif contre non nominatif déjà écrite.

**Ce qui est déjà écrit comme si le connecteur existait.** `src/core/connector.test.ts:17-21` prend
Notion comme cas d'école de la résolution de tier, avec les identifiants `notion:scim` et
`notion:session` : ce plan reprend ces identifiants tels quels plutôt que d'en inventer d'autres.
`src/core/collecte.test.ts:79` et `docs/deploiement.md:341` citent déjà `notion` en exemple de
système non lu.

**Les pièges, vérifiés dans le code.**

1. **Il n'existe aucun moteur d'exécution.** `execute` et `precheck` ne sont appelés nulle part
   (aucune occurrence hors `src/core/connector.ts:228`). Les étapes d'un plan se pointent à la main,
   et l'écran le dit en toutes lettres (`src/app/departs/[id]/page.tsx:125`). Déclarer une capacité
   `auto` que rien n'exécute afficherait un tier théorique, ce que `docs/architecture.md` §5.1
   interdit explicitement.
2. **`env` est un proxy paresseux qui met en cache tout le schéma au premier accès**
   (`src/lib/env.ts:107-115`). Deux conséquences en test : lire une seule variable exige que
   `DATABASE_URL` et `ESPACE_MEMBRE_API_KEY` soient présentes, sinon l'accès jette ; et un même
   fichier de test ne peut pas observer successivement un jeton présent puis absent sans
   `vi.resetModules()` suivi d'un import dynamique.
3. **Aucun test du dépôt ne simule aujourd'hui ni `fetch` ni Prisma** : tous les fichiers `*.test.ts`
   portent sur des fonctions pures de `src/core`. L'infrastructure de simulation est donc à poser
   dans ce ticket, et c'est un argument de plus pour tester le connecteur, et non le socle qui
   l'appelle.
4. **`criticality` et `scopeSchema` sont déclarés mais lus par personne** : seuls le type et
   `src/connectors/github.ts:146,163` les mentionnent. Les renseigner correctement est une question
   d'honnêteté du contrat, pas un effet visible.
5. **Il n'existe pas de dossier `docs/runbooks/`** : un runbook est une chaîne en prose portée par le
   contrat (`src/connectors/github.ts:27-28`), pas un chemin de fichier.

## Décisions de conception

### Un seul connecteur livré, et son credential ne sert qu'à lui

Ce ticket livre `notion` avec le seul credential `notion:scim`. Rien du jeton de session, rien de
l'API v3 non documentée. C'est la décision actée du ticket, et elle a une conséquence concrète : le
contrat ne déclare **aucune** `features` (`src/core/connector.ts:49-54`), parce que la seule
fonctionnalité propre envisagée, la gestion des invités, exigerait `notion:session`. Déclarer ici une
fonctionnalité dont le credential appartient à l'autre connecteur reviendrait exactement à ce que le
ticket interdit.

**Tension à signaler avec `docs/architecture.md`.** La ligne 518 rattache la gestion des invités au
connecteur `notion`, celui-ci, alors que SCIM ne sait pas gérer les invités (limitation documentée
par Notion, à confirmer à l'étape 1) et que le ticket range cette fonctionnalité hors périmètre. Le
ticket tranche pour ce plan. Le document ne se modifie pas ici : la reformulation de §5.9 se propose
au moment où le connecteur à jeton de session arrivera, et elle demande une validation explicite.

### `list` en `auto`, `revoke` en `manual`, sans regret

`list` se déclare `{ requires: ["notion:scim"], tier: "auto" }`, ce que le ticket vise.

`revoke` se déclare `{ requires: [], tier: "manual", runbook }`, inconditionnel, comme
`src/connectors/github.ts:161`. Ce n'est pas un aveu de faiblesse du credential : SCIM sait très
probablement supprimer un membre par `DELETE /Users/{id}` (à établir à l'étape 1). C'est un constat
sur **l'outil** : aucun moteur n'appelle `execute`, donc une étape `auto` ne serait exécutée par
personne et ne porterait même pas la tâche manuelle qui permet de la pointer
(`src/core/connector.ts:196-197`). Le tier affiché doit être celui qui a lieu aujourd'hui.

Ce que le credential permet réellement se dit quand même, à l'endroit prévu pour ça : le `scopeNote`
du `CredentialRef`. Le jour où le moteur d'exécution existera, il suffira d'insérer
`{ requires: ["notion:scim"], tier: "auto" }` en tête de la liste `revoke` : `resolveCapability`
choisira la meilleure voie praticable et affichera la dégradation toute seule.

### La sonde ne fait aucun appel réseau

`probe` se contente de constater la présence de la variable, comme
`src/connectors/github.ts:166-176`. L'écran Systèmes sonde à chaque affichage
(`src/app/systemes/page.tsx:36`) : une sonde qui appellerait Notion transformerait un rafraîchissement
de page en appel distant, et une panne d'affichage en panne de credential.

### Ancrage d'identité et rapprochement

`externalId` est l'`id` SCIM, opaque et stable, donc `idKind: "opaque"`. `handle` porte le `userName`,
qui est l'adresse de courriel chez Notion, et `emails` reçoit `userName` plus les `emails[].value`
non vides.

Conséquence assumée sur le rapprochement : `src/core/rapprochement.ts:113-121` ne connaît de voie par
login que pour `github`. Un compte Notion se rattache donc par `EMAIL_EXACT`
(`src/core/rapprochement.ts:123-141`) quand une adresse correspond, sinon par `HEURISTIC` sur la
partie locale de l'adresse (`src/core/rapprochement.ts:146-159`), et une identité `HEURISTIC` ne
produit jamais de révocation : elle atterrit dans la file de rattachement
(`src/app/comptes-isoles/page.tsx:29`). C'est le comportement voulu, pas un défaut à contourner.

### Pas de ressource propre, pas de groupes en v1

Un membre du workspace détient un accès au système entier et à rien de plus précis :
`resourceExternalId` reste indéfini, et le socle rattache l'accès à la ressource réservée
`(systeme)` (`src/lib/sync/collecte.ts:117-131`). Aucune ressource n'est donc émise par le
connecteur.

Les groupes SCIM (`/Groups`) sont écartés de la v1 en connaissance de cause : ils feraient de bonnes
`Resource`, mais retirer quelqu'un du workspace le retire de tous ses groupes, donc le chemin de
révocation ne perd rien à les ignorer. Ils relèvent d'un incrément ultérieur, motivé par un besoin de
finesse et non par la couverture.

### Un membre désactivé reste un compte observé

Un utilisateur SCIM `active: false` est rendu comme identité, avec un rôle qui le dit :
`role: "membre"` quand il est actif, `role: "membre-desactive"` sinon. Deux raisons. Un compte
désactivé se réactive d'un clic, exactement comme une invitation GitHub en attente, que le connecteur
existant remonte pour cette raison précise (`src/connectors/github.ts:118-119`). Et le filtrer
silencieusement le ferait dater comme disparu par le socle au run suivant, c'est-à-dire affirmer
qu'il n'existe plus alors que Notion le connaît toujours.

L'alternative écartée était de ne rendre que les comptes actifs : elle simplifie le comptage de
sièges, au prix d'un `vanishedAt` qui ment. Si l'étape 1 établit que la réponse porte aussi le rôle
d'espace (propriétaire contre membre), ce rôle remplacera `membre`, pas avant.

### La troncature se détecte par `totalResults`, pas par une heuristique

SCIM rend une enveloppe `ListResponse` avec `totalResults`, `startIndex` et `itemsPerPage`. La
collecte compare le nombre d'éléments accumulés à `totalResults` et refuse de rendre `ok` en cas
d'écart. C'est strictement mieux que l'heuristique de `src/connectors/github.ts:93-95`, qui ne peut
que déduire la fin d'une page incomplète.

### Aucune URL de base en variable d'environnement

L'hôte SCIM est une constante du connecteur, comme `src/connectors/github.ts:25`. Un endpoint
configurable depuis l'environnement rend le déploiement invérifiable : deux instances peuvent alors
lire deux systèmes différents en affichant le même écran.

### Un seul fichier, avec la lecture distante exportée

Tout tient dans `src/connectors/notion.ts`, comme pour GitHub, mais la fonction de lecture distante
est exportée : c'est ce qui permet au test de contrat d'interroger l'API sans passer par la collecte,
comme l'exige `docs/architecture.md` §5.7.

## Modèle de données

**Aucune migration Prisma. Aucune.** Le connecteur n'ajoute ni modèle, ni champ, ni valeur d'énumération :
`ExternalIdentity`, `Resource`, `AccessGrant` et `SyncRun` couvrent le cas entier avec
`provider = "notion"` (`prisma/schema.prisma:159-187`, `:189-201`, `:203-222`, `:271-288`). La seule
ligne nouvelle créée à l'exécution est la ressource réservée `(systeme)` du provider `notion`, posée
par le socle.

Si une migration devait malgré tout apparaître, ce serait le signe que la conception a dérivé, et il
faudrait alors lancer `pnpm db:generate` **puis redémarrer `pnpm dev`** : le client généré et le
client mis en cache sur `globalThis` sont deux caches distincts, et un `prisma migrate dev` seul
laisse le runtime servir des métadonnées périmées, avec des symptômes qui accusent le mauvais coupable
(`Unknown argument`, `Value not found in enum`).

La seule évolution de configuration est une variable d'environnement, dans `coreSchema` et non dans
`webSchema` : la collecte en ligne de commande doit la voir.

```ts
NOTION_SCIM_TOKEN: z.string().min(1).optional(),
```

Facultative pour la même raison que `GITHUB_TOKEN` (`src/lib/env.ts:31-36`) : un credential absent
résout le connecteur en `none` et le dit, là où un démarrage refusé rendrait toute la collecte otage
d'un système parmi d'autres.

## Découpage en étapes

### 1. Établir la réalité de l'API et du credential (aucun code)

C'est la Definition of Ready du ticket, et c'est bloquant : rien ne s'écrit avant.

À établir sur l'instance réelle, en lecture seule, jamais un `DELETE` :

- l'hôte qui répond réellement, les deux étant documentés à des endroits différents
  (`api.notion.com/scim/v2` d'un côté, `www.notion.so/scim/v2` de l'autre) ;
- la forme exacte de l'en-tête d'authentification et le code rendu par un jeton invalide (401 ou 403,
  ce qui décide si l'on peut distinguer un jeton mort d'un jeton absent) ;
- l'enveloppe : présence et exactitude de `totalResults`, `startIndex`, `itemsPerPage`, comportement
  d'un `count` supérieur à 100 ;
- la forme d'un utilisateur : `id`, `userName`, `name`, `emails`, `active`, et l'existence ou non
  d'un attribut de rôle d'espace ;
- si les invités apparaissent ou non dans `/Users` ;
- **le caractère nominatif du jeton** : qui peut le générer, survit-il au départ de la personne qui
  l'a créé, et la limitation documentée selon laquelle le propriétaire créateur du jeton ne peut pas
  être retiré par l'API. La réponse va dans `nominative` et dans le runbook.

Livrable : une réponse réelle anonymisée, réduite à trois ou quatre entrées, enregistrée en
`src/connectors/notion-scim.fixture.json`. Les noms et adresses y sont remplacés par des formes
neutres du genre `prenom.nom@exemple.org` : ce dépôt est public.

Si le workspace n'est pas sur un plan qui expose SCIM, l'étape s'arrête là et le ticket avec :
le connecteur resterait `SKIPPED` indéfiniment, ce qui est un comportement correct mais pas une
livraison.

### 2. Ouvrir la variable d'environnement et la documenter

Fichiers : `src/lib/env.ts` (ajout dans `coreSchema`, à côté de `GITHUB_TOKEN`), `.env.example`
(décommenter `NOTION_SCIM_TOKEN`, réécrire le commentaire avec la portée réelle établie à l'étape 1),
`docs/deploiement.md:390-403` (une ligne dans le tableau des variables de déploiement).

Vérifiable : `pnpm typecheck` passe, et `pnpm sync` se comporte exactement comme avant, la variable
n'étant encore lue par personne.

### 3. Extraire la lecture élément par élément

`src/lib/espace-membre.ts:73-105` porte `Lecture<T>` et `lireChaque`, qui implémentent une règle du
document d'architecture : un élément illisible est écarté seul, l'écart remonte, donc la collecte ne
se dit pas complète, donc elle ne date aucune disparition. Cette règle vaut pour tout connecteur.

Déplacement pur vers `src/core/lecture.ts`, `src/lib/espace-membre.ts` important depuis là. Aucun
changement de comportement, aucun test à modifier : `pnpm test` doit rester vert à l'identique.

Fichiers : `src/core/lecture.ts` (nouveau), `src/lib/espace-membre.ts`.

### 4. Écrire le connecteur

Fichier : `src/connectors/notion.ts`, un seul.

Contenu, dans l'ordre :

- constantes : hôte, identifiant de credential `notion:scim`, runbook de retrait en prose ;
- schéma Zod strict de l'utilisateur SCIM et de l'enveloppe, calé sur ce que l'étape 1 a constaté et
  non sur ce que la documentation promet ;
- `lireMembres()`, exportée, qui pagine en `startIndex` / `count`, borne le nombre de pages, applique
  `lireChaque` à chaque page, et rend les éléments lus avec les erreurs unitaires ;
- `probe`, sans appel réseau ;
- `list`, qui mappe vers `ObservedIdentity` et `ObservedGrant` et calcule le statut : `failed` si
  aucune page n'a pu être lue, `partial` dès qu'une erreur unitaire existe ou que le total collecté
  diffère de `totalResults`, `ok` seulement sinon ;
- `plan`, qui rend une étape `revoke` de tier `manual`, risque élevé, avec `manual.deeplink` vers les
  membres du workspace, `manual.doneWhen` explicite, et une clé d'idempotence de la forme
  `notion:revoke:<username>`.

Le statut ne se construit jamais par un cast : la forme du retour suit
`src/connectors/github.ts:203-221`, où le premier élément d'erreur est extrait pour satisfaire
`NonEmptyArray`.

### 5. Déclarer le connecteur et vérifier les écrans

Fichier : `src/connectors/index.ts:10`, une entrée de plus dans la liste.

Effets attendus sans autre ligne de code : Notion apparaît dans l'écran Systèmes avec ses capacités
résolues, entre dans le calcul des systèmes muets du tableau de bord, est interrogé au calcul d'un
plan de départ, et ses comptes non réclamés remontent dans les comptes isolés.

### 6. Les tests d'intégration du connecteur

Fichier : `src/connectors/notion.test.ts`. Détail des scénarios en section suivante.

### 7. Le test de contrat et son déclenchement quotidien

Fichiers : `src/connectors/notion.contrat.test.ts`, `.github/workflows/` (un second workflow, sur
`schedule`).

Le test lit `process.env` directement, jamais `env` : passer par le schéma exigerait une base de
données pour vérifier la forme d'une réponse distante. Il s'ignore proprement quand le jeton manque,
de sorte que `pnpm test` reste exécutable sans secret, en local comme sur une contribution externe.

## Tests

Cinq scénarios d'intégration plus un scénario de contrat. Chacun se lit comme une histoire et porte
plusieurs assertions.

**Préalable technique, sinon rien ne démarre.** Avant tout appel qui touche `env`, poser
`DATABASE_URL` et `ESPACE_MEMBRE_API_KEY` avec `vi.stubEnv`, et nettoyer avec `vi.unstubAllEnvs`. Le
scénario 4, qui a besoin d'observer l'absence de jeton après que d'autres ont observé sa présence,
passe par `vi.resetModules()` puis un import dynamique du connecteur : le cache de
`src/lib/env.ts:107-115` ne se vide pas autrement. `fetch` se remplace par `vi.stubGlobal`.

### Scénario 1 : une collecte complète rend chaque siège avec son état

Given deux pages SCIM annonçant `totalResults` cohérent, contenant un membre actif dont l'adresse est
celle d'une personne du périmètre, un membre désactivé, et un membre dont l'adresse n'est connue de
personne. When `list` s'exécute. Then le statut vaut `ok`, `errors` est absent, `itemsSeen` compte les
trois, chaque identité porte l'`id` SCIM en `externalId` et l'adresse en `handle` et dans `emails`,
le désactivé porte le rôle qui le dit, aucun accès ne nomme de ressource, et deux appels distincts
ont été émis avec le bon `startIndex`.

### Scénario 2 : une pagination interrompue ne conclut jamais

Given une première page correcte annonçant plus d'éléments qu'elle n'en contient, et une seconde
requête qui échoue. When `list` s'exécute. Then le statut n'est jamais `ok`, `errors` porte au moins
une entrée qui nomme la pagination, et les éléments déjà lus sont conservés. Le même scénario couvre
le cas où toutes les pages échouent : statut `failed`, aucun élément rendu, ce qui interdit au socle
de dater la moindre disparition (`src/lib/sync/collecte.ts:300`).

### Scénario 3 : un membre illisible est écarté seul et l'écart remonte

Given une page dont une entrée n'a pas d'`id`, et une autre dont `userName` a disparu. When `list`
s'exécute. Then les entrées saines sont rendues, le statut vaut `partial`, chaque erreur nomme
l'élément fautif, et `itemsSeen` ne compte que ce qui a été effectivement rendu. C'est le scénario qui
protège contre le pire silence possible : un champ renommé chez Notion qui ferait passer tout le
monde pour absent.

### Scénario 4 : sans credential, le système est annoncé non lu et non en échec

Given un environnement sans `NOTION_SCIM_TOKEN`. When on sonde le connecteur et qu'on résout `list`.
Then la sonde rend `available: false` avec une raison lisible, `resolveCapability` rend le tier
`none` avec `degradedFrom.missing` valant `["notion:scim"]`, ce qui est exactement la condition qui
fait écrire un run `SKIPPED` par `src/lib/sync/executer.ts:119-125`. And un appel direct à `list`
rendrait `failed`, jamais `ok` vide, pour qu'une régression de l'orchestration ne se traduise pas par
un inventaire vide pris pour un inventaire complet.

### Scénario 5 : un départ produit une tâche pointable, jamais une action silencieuse

Given une personne du périmètre observée sur Notion. When on demande un plan de révocation. Then
l'étape rendue porte le tier `manual`, un risque élevé, une clé d'idempotence unique, un runbook, un
lien direct et un critère de complétion non vide. And un intent d'octroi ou visant un compte de
service ne produit aucune étape.

### Scénario 6, fichier séparé : la forme de la réponse distante n'a pas changé

Given un jeton SCIM réel, et rien à faire s'il est absent. When on interroge l'API en lecture. Then
l'enveloppe porte les champs attendus, au moins un membre actif est rendu, chaque membre a un `id`
non vide et une adresse exploitable. Cette dernière assertion est le seul filet contre une
disparition de champ facultatif, que la validation de la collecte ne peut pas voir, exactement comme
le raisonne `docs/architecture.md` lignes 602 à 606.

### Écarté volontairement

Aucun test dédié au schéma Zod seul, ni à l'arithmétique de pagination isolée, ni au mappage vers
`ObservedIdentity` : les cinq scénarios les traversent tous. Aucun test du socle de collecte avec une
base de données : `executerCollecte` est déjà couvert par le contrat de type, et monter une base pour
ce ticket ajouterait une dépendance à l'exécution des tests sans révéler de comportement propre à
Notion.

## Risques et pièges

**Le cast qui rendrait `ok` avec des erreurs.** C'est la seule façon de contourner
`src/core/connector.ts:159-162`, et c'est un blocage, pas un détail de revue. Un `ok` menteur produit
des `vanishedAt`, donc des propositions de révocation sur des gens en poste.

**La troncature silencieuse.** Si `totalResults` s'avère absent ou faux sur l'instance réelle, la
détection de troncature repose alors sur une page incomplète, ce qui est plus faible. À trancher à
l'étape 1, pas au moment de coder.

**Un `id` SCIM qui changerait.** Si Notion réattribue un identifiant à un membre supprimé puis
recréé, le socle voit une identité neuve et fait disparaître l'ancienne : le rattachement décidé par
un opérateur est alors perdu sans bruit, puisqu'il vit sur la ligne devenue disparue. Rien à coder,
mais à savoir avant de conclure qu'un rattachement s'est défait tout seul.

**Le premier run ne déclenche aucun garde-fou.** `chuteExcessive` rend faux quand la référence est
nulle (`src/core/collecte.ts:10-15`) : la première collecte Notion crée tout et ne peut rien perdre.
C'est voulu, mais cela signifie qu'une première collecte tronquée passe pour complète si le statut
est `ok`. D'où la sévérité du scénario 2.

**Le jeton porte l'écriture même si l'outil ne lit pas.** Un jeton SCIM permet de supprimer des
membres. L'outil n'exécutera rien, mais le secret est en environnement, à portée du processus. Le
`scopeNote` doit le dire mot pour mot, et la rotation du jeton doit précéder toute mise en service
d'un chemin d'écriture, au même titre que le triplet OVH (`docs/architecture.md:623`).

**Les invités n'apparaissent pas dans SCIM.** Une fiche sans compte Notion ne veut donc pas dire sans
accès à Notion. C'est précisément le genre d'affirmation implicite qui trompe sur l'écran où se décide
une coupure. Le libellé du connecteur et le runbook doivent le dire.

**Le propriétaire créateur du jeton ne se retire pas par l'API.** À confirmer à l'étape 1. Si c'est
vrai, le runbook doit le mentionner, sinon un opérateur cochera « fait » sur une étape que rien ne
peut accomplir.

**Le déclencheur quotidien du test de contrat peut mourir sans bruit.** Un workflow `schedule`
GitHub se désactive après soixante jours sans activité du dépôt, ce qui est le motif pour lequel
`docs/architecture.md` §1.1 l'écarte pour la collecte. Le risque est ici accepté et nommé : un test de
contrat qui cesse de tourner ne coupe l'accès de personne, contrairement à une collecte. Il tourne
aussi en intégration continue sur chaque contribution quand le secret est disponible.

**L'invariant du journal avant l'action est respecté par construction, et pas par chance.** Ce
connecteur n'écrit sur aucun système tiers : la seule trace le concernant est celle que le socle pose
autour de la collecte (`src/lib/sync/collecte.ts:343-354`). La règle à tenir dans la revue est
qu'aucun appel d'écriture ne doit apparaître dans `probe`, `list` ou `plan`. Le jour où `execute`
arrivera, il passera par `actionTracee` (`src/lib/actions.ts:30-56`), qui journalise avant d'écrire.

**`ACTIONS_ENABLED` reste faux.** Le connecteur ne consulte `ctx.dryRun` nulle part parce qu'il
n'écrit nulle part : c'est cohérent, et cela ne doit pas se transformer en habitude au moment
d'ajouter `execute`.

## Vérification

`pnpm verify` puis `/verif` sont le plancher, pas la preuve. Ce qui atteste que le ticket est fini :

1. **Sans jeton**, `pnpm sync` imprime `[sync] notion non lu : notion:scim`, laisse un `SyncRun` en
   `SKIPPED` en base, et la commande sort en 0. Un système non lu n'est pas une panne.
2. **Avec le jeton réel**, `pnpm sync` laisse un `SyncRun` en `OK`, et `itemsSeen` est **comparé à la
   main** au nombre de membres affiché dans les paramètres du workspace Notion. C'est la seule preuve
   que la pagination est complète : aucun test ne peut l'établir.
3. **Deux `pnpm sync` consécutifs** donnent, au second, zéro identité créée, N revues, zéro disparue.
   Une identité recréée à chaque passage signale un `externalId` instable.
4. L'écran Systèmes montre Notion avec `Lire` en automatique et `Retirer` en manuel, la marche à
   suivre affichée, et l'état du credential nommé.
5. L'écran Comptes isolés fait apparaître le siège attendu sans détenteur, qui est le cas d'usage
   direct du ticket.
6. La fiche d'une personne connue montre son compte Notion, rattaché en `EMAIL_EXACT`, et un compte
   rattaché en `HEURISTIC` n'apparaît dans aucun plan de révocation.
7. Un départ ouvert sur cette personne produit une étape Notion manuelle, avec son lien et son critère
   de complétion, pointable.
8. **Avec un jeton révoqué**, la collecte rend un run non `OK` sans faire disparaître qui que ce soit :
   aucun `vanishedAt` neuf sur `provider = "notion"` après ce run.
