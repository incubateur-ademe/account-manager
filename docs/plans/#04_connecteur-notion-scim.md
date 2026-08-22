# Connecteur Notion par SCIM (#4)

> Plan d'implémentation de l'issue #4. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

**Le contrat couvre ce cas, mais il n'est pas figé.** Il a bougé depuis la rédaction de ce plan :
`ObservedDetail` et le champ `details` de `ObservedIdentity` (`src/core/connector.ts:172-186`) y ont
été ajoutés pour porter ce qu'un connecteur sait d'un compte et qu'aucun accès ne dit, rendu tel
quel et jamais interprété. Ce connecteur-ci n'a rien de neuf à réclamer au contrat, ce qui n'est pas
la même chose que de le tenir pour définitif. L'invariant de collecte, lui, est resté intact et
porté par le type : `src/core/connector.ts:214-217` fait que `status: "ok"` implique `errors?:
undefined`, donc seul un cast peut rendre un `ok` menteur. `src/core/connector.ts:97-130` résout le
tier effectif à partir des sondes de credentials, et `src/core/connector.ts:273-287` ne rend
obligatoire que `plan`.

**Le socle de collecte fait déjà tout le travail commun.** `src/lib/sync/collecte.ts:266-268` ouvre
le `SyncRun` en `FAILED` et ne le promeut qu'à la fin. `src/lib/sync/collecte.ts:315-347` ne date
une disparition que si le statut final vaut `OK`, après le garde-fou de chute
(`src/core/collecte.ts:56-61`), qui porte désormais aussi sur les ressources.
`src/lib/sync/collecte.ts:113-127` prévoit le cas d'un accès sans ressource nommée : le système
devient lui-même une ressource sous la clé réservée `(systeme)`. `src/lib/sync/collecte.ts:385-416`
écrit un run `SKIPPED` pour un système non lu, et `src/lib/sync/collecte.ts:365-376` journalise
chaque passage. C'est aussi lui qui décide de ce qu'une identité laisse en base : `champsConstates`
(`src/core/collecte.ts:37-54`) écrit `handle`, `idKind`, `details`, `lastSeenAt` et `vanishedAt`, et
rien d'autre.

**L'orchestration sait déjà quoi faire d'un connecteur sans credential.**
`src/lib/sync/executer.ts:110-126` résout `list`, et bascule sur `noterSystemeNonLu` dès que le tier
vaut `none`, sans compter cela comme un échec (`src/lib/sync/executer.ts:239-243`). Rien à écrire de
ce côté.

**Les écrans se peuplent tout seuls à partir de `CONNECTEURS`.**
`src/connectors/index.ts:14` est la seule liste. `src/app/systemes/page.tsx:33-57` sonde et affiche
le tier effectif, `src/app/page.tsx:68-73` déduit les systèmes muets de cette même liste,
`src/lib/depart.ts:84-96` interroge chaque connecteur pour le plan de départ et signale les systèmes
sans connecteur (`src/app/departs/[id]/page.tsx:225-232`), et
`src/app/comptes-isoles/page.tsx:45-53` remonte tout compte non rattaché, plus tout rattachement
`HEURISTIC`.

**Un connecteur se configure et a une page, depuis le ticket 5.** `ConnectorContract.configSchema`
(`src/core/connector.ts:68-79`) porte le contrat de la clé `connectors.<key>` du fichier de
politique, `src/core/configuration-connecteur.ts` croise les deux, et
`src/lib/configuration-connecteur.ts` rend la valeur validée à un connecteur qui la reçoit sans
aller la chercher. GitHub s'en sert déjà pour ses organisations (`src/connectors/github.ts:26-49`),
avec une fabrique `creerGithub(lireConfig)` que `src/connectors/index.ts:14-16` instancie sur un
accesseur paresseux. `resolveFeatures` (`src/core/connector.ts:139-160`) résout les fonctionnalités
hors socle contre les mêmes sondes que les capacités, et `src/ui/connecteurs/registre.ts` décide
qu'un connecteur a une page. Ce plan hérite donc de deux choses qu'il n'a pas à inventer : un
endroit déclaré où poser un réglage, et un écran où dire ce que le socle ne sait pas porter.

**Le seul connecteur existant sert de patron, et il a été refondu depuis.**
`src/connectors/github.ts` a éclaté sa lecture en trois exports : `lireOrganisation` (`:158-209`)
appelle le réseau, `assemblerOrganisation` (`:252-331`) décide, et `collecter` (`:341-379`) enchaîne
les deux. Le réseau lui-même passe par un type `Lecteur` injecté (`:74`), si bien que `list` se
réduit à `collecter(lireTout)` (`:417`) et que le connecteur se teste sans une seule requête.
Restent en l'état : constante d'API en dur (`:26`), pagination bornée avec refus explicite d'un
inventaire tronqué (`:100-144`), sonde sans le moindre appel réseau (`:405-415`), et un `plan` qui
rend une tâche manuelle avec lien et critère de complétion (`:419-445`).

Le calcul du statut, lui, a changé de principe (`:333-340` pour le raisonnement, `:365-378` pour le
code). Il comptait les organisations en erreur et les comparait à leur nombre ; il compte désormais
celles qui ont rendu quelque chose : `failed` quand aucune n'a rien rendu, `partial` dès qu'il reste
une charge et au moins une erreur, `ok` sinon. Le statut se lit sur ce qui a été rendu, jamais sur
un décompte d'erreurs.

**Ce qui manque.** Aucun fichier `src/connectors/notion.ts`, aucune variable `NOTION_*` lue par le
code : `src/lib/env.ts:14-37` ne connaît que `GITHUB_TOKEN`, facultatif à dessein.
`.env.example:116-125` réserve déjà les emplacements `NOTION_SCIM_TOKEN` d'un côté,
`NOTION_SESSION_TOKEN` et `NOTION_SESSION_SPACE_ID` de l'autre, commentés, avec la distinction
nominatif contre non nominatif déjà écrite.

**Ce qui est déjà écrit comme si le connecteur existait.** `src/core/connector.test.ts:23-27` prend
Notion comme cas d'école de la résolution de tier, avec les identifiants `notion:scim` et
`notion:session` : ce plan reprend ces identifiants tels quels plutôt que d'en inventer d'autres.
`src/core/collecte.test.ts:85` et `docs/deploiement.md:341` citent déjà `notion` en exemple de
système non lu.

**Les pièges, vérifiés dans le code.**

1. **Il n'existe aucun moteur d'exécution.** `execute` et `precheck` ne sont appelés nulle part
(aucune occurrence hors leur déclaration, `src/core/connector.ts:283` et `:246`). Les étapes d'un
plan se pointent à la main, et l'écran le dit en toutes lettres
(`src/app/departs/[id]/page.tsx:165`). Déclarer une capacité `auto` que rien n'exécute afficherait
un tier théorique, ce que `docs/architecture.md` §5.1 interdit explicitement.
2. **`env` est un proxy paresseux qui met en cache tout le schéma au premier accès**
(`src/lib/env.ts:107-115`). Deux conséquences en test : lire une seule variable exige que
`DATABASE_URL` et `ESPACE_MEMBRE_API_KEY` soient présentes, sinon l'accès jette ; et un même fichier
de test ne peut pas observer successivement un jeton présent puis absent sans `vi.resetModules()`
suivi d'un import dynamique.
3. **Aucun test du dépôt ne simule aujourd'hui ni `fetch` ni Prisma.** Un connecteur y est pourtant
couvert depuis : `src/connectors/github.test.ts` fabrique un `Lecteur` factice
(`src/connectors/github.test.ts:19-53`) et vérifie l'assemblage sans réseau. La simulation de
`fetch` reste donc à poser dans ce ticket, mais le patron à suivre existe, et c'est un argument de
plus pour tester le connecteur plutôt que le socle qui l'appelle.
4. **`criticality` et `scopeSchema` sont déclarés mais lus par personne**, contrairement à
`configSchema` que le ticket 5 a rendu vivant. Le schéma de catalogue de `src/core/policy.ts`
déclare le premier dans une entrée que rien ne lit non plus, son propre `.meta()` le disant. Les
renseigner correctement est une question d'honnêteté du contrat, pas un effet visible. À noter que
`scopeSchema` de GitHub a perdu son énumération au passage : les organisations étant désormais
déclarées, elles sont inconnues à la compilation.
5. **Il n'existe pas de dossier `docs/runbooks/`** : un runbook est une chaîne en prose portée par
le contrat (`src/connectors/github.ts:44-45`), pas un chemin de fichier.

## Décisions de conception

### Un seul connecteur livré, et son credential ne sert qu'à lui

Ce ticket livre `notion` avec le seul credential `notion:scim`. Rien du jeton de session, rien de
l'API v3 non documentée. C'est la décision actée du ticket, et elle a une conséquence concrète : le
contrat ne déclare **aucune** `features` (`src/core/connector.ts:49-54`), parce que la seule
fonctionnalité propre envisagée, la gestion des invités, exigerait `notion:session`. Déclarer ici
une fonctionnalité dont le credential appartient à l'autre connecteur reviendrait exactement à ce
que le ticket interdit.

**Une troisième voie existe, et elle est hors périmètre.** Notion documente une Admin API
d'organisation (`https://developers.notion.com/reference/admin/intro.md`), absente du sommaire
visible mais présente dans son index. Elle ne sait pas lister les membres, donc elle ne remplace pas
SCIM pour ce ticket. Elle sait en revanche lister et révoquer les jetons d'accès personnels d'un
workspace, lister et révoquer les connexions MCP, et révoquer les sessions d'un utilisateur. Ce sont
trois accès qui survivent à un départ et que personne ne pense à couper : de la matière pour un
ticket à part, et pour des fonctionnalités hors socle sur la page de ce connecteur. Rien de tout
cela ne se livre ici.

**Deux tensions avec `docs/architecture.md`, levées depuis.** §5.9 décrivait le credential comme non
nominatif et rattachait la gestion des invités à ce connecteur. L'étape 1 a établi l'inverse des
deux : Notion révoque le jeton au départ **comme au changement de rôle** de la personne qui l'a créé,
et SCIM ne sait ni gérer ni même voir les invités. Le document a été corrigé après validation, et
§8 porte désormais la question du porteur du jeton. Le contrat déclarera donc `nominative: true`,
ce qui est une information affichée à l'opérateur et pas un détail.

§5.3 continue de citer la gestion des invités comme exemple de fonctionnalité hors socle, et ce
n'est pas contradictoire : elle affirme qu'un invité ne se rattache jamais à une personne du
périmètre, ce qui reste vrai, et elle ne l'attribue à aucun connecteur nommé. La fonctionnalité
attend seulement une autre voie que SCIM.

### `list` en `auto`, `revoke` en `manual`, sans regret

`list` se déclare `{ requires: ["notion:scim"], tier: "auto" }`, ce que le ticket vise.

`revoke` se déclare `{ requires: [], tier: "manual", runbook }`, inconditionnel, comme
`src/connectors/github.ts:418`. Ce n'est pas un aveu de faiblesse du credential, et ce n'est plus
une supposition : `DELETE /Users/{id}` est documenté, retire du workspace et déconnecte toutes les
sessions actives. C'est un constat sur **l'outil** : aucun moteur n'appelle `execute`, donc une
étape `auto` ne serait exécutée par personne et ne porterait même pas la tâche manuelle qui permet
de la pointer (`src/core/connector.ts:232-238`). Le tier affiché doit être celui qui a lieu
aujourd'hui.

Ce que le credential permet réellement se dit quand même, à l'endroit prévu pour ça : le `scopeNote`
du `CredentialRef`. Le jour où le moteur d'exécution existera, il suffira d'insérer `{ requires:
["notion:scim"], tier: "auto" }` en tête de la liste `revoke` : `resolveCapability` choisira la
meilleure voie praticable et affichera la dégradation toute seule.

### La sonde ne fait aucun appel réseau

`probe` se contente de constater la présence de la variable, comme
`src/connectors/github.ts:439-449`. L'écran Systèmes sonde à chaque affichage
(`src/app/systemes/page.tsx:36`) : une sonde qui appellerait Notion transformerait un
rafraîchissement de page en appel distant, et une panne d'affichage en panne de credential.

La tentation existait pourtant, `GET /ServiceProviderConfig` étant bon marché. Elle ne mène nulle
part : cet endpoint répond 200 **sans authentification**. Il renseigne sur le serveur, jamais sur le
jeton. Une sonde qui l'appellerait afficherait un credential valide alors qu'il serait mort.

### Ancrage d'identité et rapprochement

`externalId` est l'`id` SCIM, opaque et stable, donc `idKind: "opaque"`. `handle` porte le
`userName`, qui est l'adresse de courriel chez Notion, et `emails` reçoit `userName` plus les
`emails[].value` non vides.

Une précision qui compte sur ce dernier point : le socle collecte `emails` et ne le persiste pas, et
`champsConstates` le dit désormais en toutes lettres (`src/core/collecte.ts:24-36`), au même titre
que `lastActivityAt`. Le rapprochement relit la base et ne voit donc que le `handle`
(`src/lib/sync/rapprochement.ts:24-27`). Le renseigner reste juste : c'est ce que le contrat
demande, et le jour où la colonne existera le connecteur n'aura rien à changer. Ce qui fait
effectivement le rattachement d'un compte Notion aujourd'hui, c'est que son `handle` **est**
l'adresse.

Conséquence assumée sur le rapprochement : `src/core/rapprochement.ts:147-156` ne connaît de voie
par login que pour `github`. Un compte Notion se rattache donc par `EMAIL_EXACT`
(`src/core/rapprochement.ts:158-176`, où le `handle` entre dans les adresses observées) quand une
adresse correspond, sinon par `HEURISTIC` sur la partie locale de l'adresse
(`src/core/rapprochement.ts:178-194`), et une identité `HEURISTIC` ne produit jamais de révocation :
elle atterrit dans la file de rattachement (`src/app/comptes-isoles/page.tsx:52`). C'est le
comportement voulu, pas un défaut à contourner.

**Ce que cela donne réellement, mesuré et non estimé.** Sur les 120 sièges du workspace, croisés avec
le référentiel : 74 se rattachent par adresse exacte, donc deviennent révocables ; 16 tombent en
`HEURISTIC` ; 30 ne correspondent à personne. Deux chiffres à retenir de là. Le connecteur produit
bien des révocations, il n'est pas qu'une file de travail manuel, ce que la seule lecture des
adresses laissait craindre. Et il ouvre d'emblée un chantier de 46 rattachements à faire à la main,
dont une part correspond au cas d'usage du ticket, le siège payé pour personne. La livraison doit
donc s'accompagner d'un avertissement : le premier run remplira l'écran des comptes isolés, et ce
n'est pas une anomalie.

### Pas de ressource propre, pas de groupes en v1

Un membre du workspace détient un accès au système entier et à rien de plus précis :
`resourceExternalId` reste indéfini, et le socle rattache l'accès à la ressource réservée
`(systeme)` (`src/lib/sync/collecte.ts:113-127`). Aucune ressource n'est donc émise par le
connecteur.

Les groupes SCIM (`/Groups`) sont écartés de la v1 en connaissance de cause : le workspace en compte
28, ils feraient de bonnes `Resource` comme les équipes GitHub, mais retirer quelqu'un du workspace
le retire de tous ses groupes, donc le chemin de révocation ne perd rien à les ignorer. Ils relèvent
d'un incrément ultérieur, motivé par un besoin de finesse et non par la couverture. Le ticket 28 a
depuis fait des équipes GitHub des `ObservedResource` et des `ObservedGrant` sous la clé `org#id`
(`src/connectors/github.ts:275-307`) : le chemin est donc balisé le jour où les groupes vaudront la
peine, ce qui ne le rend pas plus urgent ici. Corollaire à connaître : le garde-fou de chute porte
désormais aussi sur les ressources (`src/lib/sync/collecte.ts:231-235`), sans effet pour un
connecteur qui n'en émet aucune.

### Le rôle observé est celui de l'espace, et `active` ne veut pas dire ce qu'il dit ailleurs

Ce plan pariait sur une distinction entre membre actif et membre désactivé, calquée sur les
invitations GitHub en attente. L'étape 1 a défait ce pari deux fois.

D'abord, la documentation de Notion donne à `active` une sémantique qui n'est pas celle du SCIM
générique : « Removing a user from your workspace can also be achieved by setting the active user
attribute to false. » Passer `active` à faux n'est pas une suspension réversible, **c'est
l'opération de retrait**. Ensuite, le relevé réel ne rend aucun compte inactif, 120 sur 120 étant
actifs. L'état qu'on voulait modéliser ne se rencontre pas, et s'il se rencontrait il désignerait
quelqu'un qu'on vient de sortir, pas quelqu'un qu'un clic ramènerait.

Le rôle de l'accès porte donc le **rôle d'espace**, qui lui existe : l'extension
`urn:ietf:params:scim:schemas:extension:notion:2.0:User` expose un champ `role` à quatre valeurs,
`owner`, `membership_admin`, `member` et `restricted_member`. Le relevé en observe deux, 115
`member` et 5 `owner` ; le schéma accepte les quatre sans en exiger aucune, un champ absent valant
`member`.

Une imprécision à ne pas maquiller : l'interface de Notion distingue propriétaire d'organisation et
propriétaire de workspace, SCIM non, et les comptes ne se recoupent pas exactement, 5 `owner` rendus
pour 4 propriétaires d'organisation affichés. Le connecteur rend ce que SCIM dit et ne prétend pas
trancher lequel des deux niveaux il désigne.

Un compte `active: false` reste néanmoins rendu comme identité plutôt que filtré. Le filtrer
silencieusement le ferait dater comme disparu par le socle au run suivant, c'est-à-dire affirmer
qu'il n'existe plus alors que Notion le connaît encore. Ce cas n'a simplement pas à porter de
vocabulaire propre.

### La troncature se détecte par `totalResults`, pas par une heuristique

SCIM rend une enveloppe `ListResponse` avec `totalResults`, `startIndex` et `itemsPerPage`. La
collecte compare le nombre d'éléments accumulés à `totalResults` et refuse de rendre `ok` en cas
d'écart. C'est strictement mieux que l'heuristique de `src/connectors/github.ts:152-154`, qui ne
peut que déduire la fin d'une page incomplète. L'étape 1 a vérifié l'enveloppe sur l'instance réelle
: `totalResults` vaut 120, et deux pages en rendent 120.

**Le désordre de pagination, qui demande du code et non de la résignation.**
`GET /ServiceProviderConfig` déclare `sort: false` : l'ordre des pages n'est garanti par rien. Le
workspace dépassant les 100 éléments par page, la collecte en demande deux, et il suffit qu'une
fiche glisse de la seconde vers la première entre les deux requêtes pour qu'elle soit rendue deux
fois pendant qu'une autre n'est jamais rendue.

Il serait tentant de traiter les deux séparément, en se disant qu'un doublon est absorbé par
l'indexation sur `externalId` et qu'un saut produit un écart avec `totalResults`. C'est faux, et
c'est le piège : sur une pagination par décalage au-dessus d'un ordre instable, le saut et le
doublon arrivent **ensemble et en nombre égal**, donc ils s'annulent exactement dans le décompte
des entrées reçues. Le total tombe juste, aucune erreur n'est levée, la collecte se déclare `ok`, et
le socle date comme disparue une personne toujours membre. Le garde-fou de chute ne joue pas non
plus : trois sièges perdus sur cent vingt restent très en deçà du seuil.

La parade est le doublon lui-même, seul signe observable de ce désordre. Le connecteur tient
l'ensemble des identifiants déjà rendus et lève une erreur dès qu'un identifiant revient, ce qui
force la collecte en `partial`, donc interdit toute disparition datée. Corollaire à ne pas oublier :
l'accès se pose par identité et non par entrée, sans quoi deux entrées de même identifiant
créeraient deux accès vivants pour un seul siège.

### Aucune URL de base en variable d'environnement

L'hôte SCIM est une constante du connecteur, comme `src/connectors/github.ts:42`. Un endpoint
configurable depuis l'environnement rend le déploiement invérifiable : deux instances peuvent alors
lire deux systèmes différents en affichant le même écran.

La constante vaut `https://api.notion.com/scim/v2`, l'étape 1 l'a tranché. La précision n'est pas
superflue : Notion publie **trois** hôtes selon les pages, `api.notion.com` dans sa référence SCIM,
`app.notion.com` dans son guide de configuration d'IdP, `www.notion.so` dans le tutoriel Microsoft
Entra. Les trois répondent, et l'API se référence elle-même en `app.notion.com` dans le
`meta.location` de ses réponses. Le connecteur retient celui qui a été éprouvé et ignore
`meta.location`, qui désignerait sinon un hôte dont rien ne garantit qu'il reste servi.

### Un seul fichier, avec la lecture distante exportée

Tout tient dans `src/connectors/notion.ts`, comme pour GitHub, mais la fonction de lecture distante
est exportée : c'est ce qui permet au test de contrat d'interroger l'API sans passer par la
collecte, comme l'exige `docs/architecture.md` §5.7.

Cette décision est celle que la refonte de GitHub a validée entre-temps : son type `Lecteur`
(`src/connectors/github.ts:90`) sépare l'appel réseau de l'assemblage, ce qui est exactement ce que
`lireMembres` doit faire ici. Le patron est donc établi, il n'est plus à inventer.

## Modèle de données

**Aucune migration Prisma. Aucune.** Le connecteur n'ajoute ni modèle, ni champ, ni valeur d'énumération :
`ExternalIdentity`, `Resource`, `AccessGrant` et `SyncRun` couvrent le cas entier avec `provider =
"notion"` (`prisma/schema.prisma:201-235`, `:237-249`, `:251-269`, `:320-333`). La seule ligne
nouvelle créée à l'exécution est la ressource réservée `(systeme)` du provider `notion`, posée par
le socle. `ExternalIdentity` a gagné entre-temps une colonne `details Json?`
(`prisma/schema.prisma:219-223`), déjà migrée : ce plan n'en fait rien, et son existence ne change
donc rien à ce paragraphe.

Si une migration devait malgré tout apparaître, ce serait le signe que la conception a dérivé, et il
faudrait alors lancer `pnpm db:generate` **puis redémarrer `pnpm dev`** : le client généré et le
client mis en cache sur `globalThis` sont deux caches distincts, et un `prisma migrate dev` seul
laisse le runtime servir des métadonnées périmées, avec des symptômes qui accusent le mauvais
coupable (`Unknown argument`, `Value not found in enum`).

La seule évolution de configuration est une variable d'environnement, dans `coreSchema` et non dans
`webSchema` : la collecte en ligne de commande doit la voir.

```ts
NOTION_SCIM_TOKEN: z.string().min(1).optional(),
```

Facultative pour la même raison que `GITHUB_TOKEN` (`src/lib/env.ts:31-36`) : un credential absent
résout le connecteur en `none` et le dit, là où un démarrage refusé rendrait toute la collecte otage
d'un système parmi d'autres.

**Une variable et non une liste, parce qu'il n'y a qu'un workspace.** L'étape 1 a établi qu'un jeton
SCIM vaut pour un workspace et un seul. L'incubateur n'en a qu'un, donc une variable suffit et ce
ticket n'ouvre aucune clé `connectors.notion`. Le jour où un second workspace apparaîtra, c'est là
qu'il se déclarera, le mécanisme livré par le ticket 5 étant fait pour ça, et le connecteur passera
par une fabrique comme GitHub. Livrer aujourd'hui une configuration à un seul élément possible
serait du décor.

## Découpage en étapes

### 1. Établir la réalité de l'API et du credential (faite)

C'était la Definition of Ready du ticket, et elle est levée. Ce qui suit est le constat, relevé sur
l'instance réelle en lecture seule, jamais un `DELETE`. Il remplace les suppositions que ce plan
portait, et plusieurs d'entre elles étaient fausses.

**Le forfait expose SCIM.** Le workspace est sur Entreprise, la section existe, et l'API répond.

**Il n'existe aucune référence d'API chez les développeurs.** `developers.notion.com/docs/scim-api`
rend 404 et le mot n'apparaît pas dans l'index du site. La seule documentation officielle est une
page du centre d'aide, `https://www.notion.com/help/provision-users-and-groups-with-scim`, qui est
une page d'aide par sa forme et une référence d'API par son contenu. Conséquence à porter tout au
long de ce ticket : pas de schéma OpenAPI, pas de changelog, aucun exemple de corps de réponse. Tout
ce que le connecteur analyse est non spécifié, ce qui est l'argument le plus fort en faveur du test de
contrat de l'étape 7.

**L'hôte est `https://api.notion.com/scim/v2`**, parmi trois publiés par Notion selon les pages.

**Le jeton est nominatif, et c'est le fait le plus lourd.** La documentation l'écrit deux fois :
« When a workspace owner leaves the workspace or their role is changed, their token will be revoked
», et « any tokens they created will be revoked and any integrations using that bot will be broken
». Un simple changement de rôle du porteur suffit donc à éteindre la collecte, et n'importe quel
propriétaire de workspace peut le révoquer d'un clic. Seul un propriétaire d'organisation peut en
générer un, et il en faut **un par workspace**. Aucun système de portée n'existe : le jeton porte
l'écriture, y compris la déconnexion de toutes les sessions d'un membre.

**L'enveloppe est conforme à ce que ce plan supposait** : `ListResponse`, `totalResults`,
`startIndex`, `itemsPerPage`, pagination en `startIndex` 1-indexé et `count` plafonné à 100. Filtres
sur `email`, `given_name` et `family_name` seulement.

**Un utilisateur rend** `id` (UUID opaque), `userName` (l'adresse), `emails[]`, `displayName`,
`active`, `photos[]`, un `name` et l'extension de rôle. Les rendre obligatoires ferait écarter des
membres comme illisibles, donc les ferait passer pour disparus.

**Rien de `name` n'est garanti, et ce n'est pas ce que deux fiches laissaient croire.** Une première
lecture avait conclu que `formatted` était toujours présent, `givenName` et `familyName` manquant
seulement parfois. Le test de contrat, lancé sur cent fiches, a démenti : il existe des comptes dont
le `name` existe sans `formatted`. Le connecteur ne lit donc aucun sous-champ de `name`, ce qui ne
lui coûte rien puisque le nom d'affichage se lit sur la fiche de la personne et non sur le compte.
C'est la première fois que ce test attrape une affirmation fausse, et il l'a fait avant que la
collecte ne tourne.

**`meta.created` et `meta.lastModified` ne veulent rien dire.** Ce sont des timestamps en
millisecondes rendus sous forme de chaîne, non conformes à la RFC 7643, qui exige un format ISO 8601, et la
documentation prévient elle-même qu'ils « do not reflect meaningful timestamp values ». Aucune
détection d'écart par date n'est possible, et un schéma écrit sur la foi du standard casserait sur
toutes les entrées.

**Les invités n'apparaissent pas.** Le relevé annonce 120, et l'interface compte 120 membres d'un
côté, 14 invités de l'autre. Ce n'est donc plus une déduction depuis la documentation, c'est mesuré.

**Le retrait par l'API existe** : `DELETE /Users/{id}` retire du workspace et déconnecte les sessions
actives. Il ne supprime pas le compte Notion, qui reste à supprimer à la main. Et la restriction que
ce plan pressentait est confirmée : « The workspace owner that created the SCIM bot token cannot be
removed via the API ».

**Le serveur déclare ses limites** par `GET /ServiceProviderConfig`, qui répond **sans
authentification** : `patch` et `filter` vrais, `sort`, `bulk`, `etag` faux. Pas de tri garanti,
donc pas d'ordre de pagination stable ; pas d'etag, donc pas de collecte incrémentale.

**Le rapprochement a été mesuré**, pas estimé : 74 sièges sur 120 se rattachent par adresse exacte,
16 par heuristique, 30 ne correspondent à personne. Les rôles rendus sont 115 `member` et 5 `owner`,
et aucun compte n'est inactif.

Reste un seul point ouvert, mineur : le code rendu par un jeton révoqué, qui déciderait si la sonde
peut distinguer un jeton mort d'un jeton absent. Elle ne le tentera pas de toute façon, faute
d'appeler le réseau.

Livrable produit : `src/connectors/notion-scim.fixture.json`. Seule la forme est reprise du réel, et
l'anonymisation est énumérative parce que ce dépôt est public : adresses en
`prenom.nom@exemple.org`, `id` régénérés, `displayName` et les champs de `name` inventés, `photos[]`
vidé, `meta.location` réécrit sur les identifiants inventés.

**Deux pages et non une**, parce qu'une enveloppe qui se boucle sur elle-même ne prouve rien de la
règle d'arrêt : six entrées annoncées, quatre puis deux, avec le `startIndex` que la seconde requête
doit porter. Les six couvrent les cas qui ont décidé du schéma, et aucune n'est redondante : une
adresse secondaire distincte du `userName`, un propriétaire, une entrée sans extension de rôle, un
compte inactif, un membre restreint. L'entrée au `name` réduit y figure encore mais ne discrimine
plus rien, le connecteur ayant cessé de lire ce champ.

Ce que la fixture ne porte **pas**, délibérément : aucune entrée illisible. Elle décrit ce que Notion
rend, et le scénario 3 fabrique ses fiches sans `id` ni `userName` en mutant une copie. La charge
vit sous une clé `pages` plutôt qu'à la racine, de sorte que chaque enveloppe reste un échantillon
fidèle, comparable tel quel à une capture fraîche et validable aussi strictement qu'on voudra.

### 2. Ouvrir la variable d'environnement et la documenter

Fichiers : `src/lib/env.ts` (ajout dans `coreSchema`, à côté de `GITHUB_TOKEN`), `.env.example`
(décommenter `NOTION_SCIM_TOKEN`, réécrire le commentaire avec la portée réelle établie à l'étape
1), `docs/deploiement.md:391-403` (une ligne dans le tableau des variables de déploiement).

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
- schéma Zod de l'utilisateur SCIM et de l'enveloppe, calé sur ce que l'étape 1 a constaté et non
  sur ce que la documentation promet. La règle qui décide du requis et du facultatif : est requis ce
  sans quoi l'identité ne peut pas exister, tout le reste est facultatif, parce qu'un champ exigé à
  tort fait écarter la fiche, donc la fait dater comme disparue au run suivant. Ce qui donne, requis,
  `id` non vide et `userName` non vide ; facultatifs, `emails[]`, `displayName`, `active`, `name` et
  chacun de ses sous-champs, `photos[]` et `meta`. Trois points où le réel s'écarte du standard et où
  un schéma écrit de mémoire casserait : aucun sous-champ de `name` n'est garanti, pas même
  `formatted`, si bien que le connecteur ne déclare pas ce champ du tout ; `meta.created` et
  `meta.lastModified` sont des
  chaînes de chiffres et non des dates ISO 8601, et ne se lisent de toute façon pas ; l'extension de
  rôle vit sous la clé littérale `urn:ietf:params:scim:schemas:extension:notion:2.0:User`, se lit
  sans refuser les clés inconnues plutôt qu'en strict, et son champ `role` accepte les quatre
  valeurs sans en exiger aucune, un rôle absent valant `member` ;
- `lireMembres()`, exportée, qui pagine et rend les éléments lus avec les erreurs unitaires. La
  règle d'arrêt, faute de quoi rien n'est implémentable : on demande `startIndex = 1`,
  `count = 100`, on retient le `totalResults` de la première enveloppe, puis on redemande avec
  `startIndex = reçus + 1` tant que `reçus` reste inférieur à `totalResults`. On s'arrête aussi dès
  qu'une enveloppe rend zéro élément, sans quoi un `totalResults` menteur ferait boucler sans fin,
  et une borne de dix pages ferme le cas restant en signalant l'anomalie plutôt qu'en rendant un
  inventaire tronqué pour complet. Deux pages suffisent aujourd'hui, la borne est là pour le jour où
  elles ne suffiront plus ;
- deux compteurs distincts, et ne pas les confondre est ce qui décide de la justesse du statut : le
  nombre d'**entrées reçues** dans les enveloppes se compare à `totalResults` et détecte la
  troncature, tandis qu'`itemsSeen` compte les **identités rendues**, donc après écart de ce qui
  était illisible. Les confondre ferait passer une page entièrement illisible pour une page absente,
  ou l'inverse ;
- la conversion des écarts en `CollectError`, que `lireChaque` ne fait pas : il rend des chaînes,
  le contrat attend des objets. `scope` vaut une constante du connecteur, `itemRef` porte le rang
  global de l'entrée dans l'inventaire, et `message` reprend le texte tel quel ;
- `probe`, sans appel réseau ;
- `diagnose`, qui lit **une** page et vérifie qu'au moins un membre porte une adresse
  exploitable et le rôle d'espace. Ces deux champs sont facultatifs, donc leur
  disparition ne casserait pas la collecte : elle ferait cesser les rattachements et
  rendrait tout le monde membre ordinaire, sur des runs parfaitement verts. Une page
  suffit puisqu'une disparition de champ frappe tout le monde à la fois, et qu'un compte
  incomplet relève de la collecte et non du diagnostic ;
- `list`, qui mappe vers `ObservedIdentity` et `ObservedGrant` et calcule le statut : `failed` si
  aucune page n'a pu être lue, `partial` dès qu'une erreur unitaire existe ou que le total collecté
  diffère de `totalResults`, `ok` seulement sinon. Le rôle de l'accès est celui que rend l'extension,
  `member` par défaut quand elle est absente ;
- `plan`, qui rend une étape `revoke` de tier `manual`, risque élevé, `manual.doneWhen` explicite,
  et une clé d'idempotence de la forme `notion:revoke:<username>`. Le `manual.deeplink` vaut
  `https://www.notion.so/settings/members`, quatrième constante du fichier à côté de l'hôte : Notion
  n'expose pas d'adresse par membre, l'opérateur atterrit sur la liste et y cherche l'adresse que
  `doneWhen` lui nomme.

Cette règle de statut est la même que celle de GitHub depuis sa refonte
(`src/connectors/github.ts:350-356`), formulée sur l'autre unité : ce qui décide est qu'il reste
quelque chose à écrire, jamais un décompte d'erreurs. L'unité est ici la page : `failed` quand aucune
n'a rendu d'enveloppe exploitable, `partial` quand il reste une charge et qu'au moins une erreur a
été avalée, `ok` sinon. La condition propre à
SCIM, l'écart avec `totalResults`, s'ajoute à la liste des erreurs unitaires plutôt qu'elle ne
constitue un troisième régime.

Deux casts qu'il ne faut pas confondre. Celui qui est interdit fabrique un `status: "ok"` alors
qu'une erreur a été avalée : c'est la seule façon de contourner le type, et c'est un blocage de
revue. Celui que GitHub emploie ne fait que rétrécir un tableau non vide en `NonEmptyArray`, faute
de pouvoir le prouver au compilateur ; il est sans danger mais évitable, en construisant
`[premiere, ...reste]` à partir d'une erreur nommée plutôt qu'en indexant un tableau dont rien ne
garantit qu'il a un élément. Le connecteur Notion prendra cette seconde forme, précisément parce que
son cas `failed` peut survenir sans erreur préalable si la liste de départ est vide.

### 5. Déclarer le connecteur et vérifier les écrans

Fichier : `src/connectors/index.ts:14`, une entrée de plus dans la liste.

Effets attendus sans autre ligne de code : Notion apparaît dans l'écran Systèmes avec ses capacités
résolues, entre dans le calcul des systèmes muets du tableau de bord, est interrogé au calcul d'un
plan de départ, et ses comptes non réclamés remontent dans les comptes isolés.

Une décision à prendre ici, et une seule : ce connecteur n'ayant ni `configSchema` ni fonctionnalité
déclarée, `aUnePage` (`src/ui/connecteurs/registre.ts`) le rendra faux et Notion n'aura pas de page.
C'est le comportement voulu du ticket 5, et il faut résister à la tentation d'enregistrer un écran
vide pour dire que les invités échappent au connecteur : ce serait une page sans contenu. Cet
avertissement appartient au libellé et au runbook, que l'écran Systèmes affiche déjà. Les deux
renvois de ce document à « la page de ce connecteur » désignent donc celle qu'il obtiendrait le jour
où il déclarerait une fonctionnalité hors socle, pas une page livrée ici.

### 6. Les tests d'intégration du connecteur

Fichier : `src/connectors/notion.test.ts`. Détail des scénarios en section suivante.

### 7. Le test de contrat, sans déclencheur automatique

Fichier : `src/connectors/notion.contrat.test.ts`, et lui seul.

Le test lit `process.env` directement, jamais `env` : passer par le schéma exigerait une base de
données pour vérifier la forme d'une réponse distante. Il s'ignore proprement quand le jeton manque,
de sorte que `pnpm test` reste exécutable sans secret, en local comme sur une contribution externe.

**Aucun déclencheur automatique, et c'est une décision.** Une première version posait un workflow
`schedule` sur GitHub. Elle exigeait de confier à un dépôt **public** un jeton nominatif, sans
portée, capable de retirer un membre du workspace et de le déconnecter de ses sessions : une surface
d'attaque disproportionnée pour une vérification de forme, exfiltrable par quiconque peut pousser un
workflow. Le déplacer vers la production ne règle rien de mieux : une suite de tests ne s'exécute pas
dans un environnement d'exécution, et l'image y vide de toute façon ses `devDependencies`.

Le test se lance donc à la main, par quelqu'un qui détient déjà le jeton, quand il en a besoin :
avant une mise en service, ou quand une collecte se met à rendre `partial` sans raison apparente.

Ce que le déclencheur devait fermer est fermé autrement, et mieux. La collecte détecte d'elle-même
la disparition d'un champ **requis**, puisque le schéma écarte alors les fiches et refuse de
conclure. Elle ne voyait pas celle d'un champ **facultatif** : si `emails` disparaissait, les comptes
déjà rattachés le resteraient, les nouveaux tomberaient en file manuelle, et le seul signe serait une
hausse inexpliquée des comptes isolés.

C'est désormais le rôle du `diagnose` de l'étape 4, que le socle appelle avant toute lecture et dont
un écart interdit la collecte. Il tourne à chaque passage, avec le credential que la collecte a déjà,
sans confier quoi que ce soit à un runner. Le test de contrat garde sa raison d'être en
investigation, où il va plus loin que le diagnostic, mais il n'est plus le seul filet.

**C'est l'étape la plus importante de ce ticket, et l'étape 1 en a fait la démonstration.** Notion ne
publie ni schéma OpenAPI, ni changelog, ni le moindre exemple de corps de réponse pour SCIM : la
seule source est une page d'aide. Tout ce que ce connecteur analyse est donc non spécifié, et un champ
qui disparaîtrait ne se signalerait par aucune annonce. Le test doit vérifier nommément ce que
l'étape 1 a constaté et qui n'est écrit nulle part chez Notion : la présence de l'enveloppe et de
`totalResults`, la présence de `id` et `userName` sur chaque fiche, la clé de l'extension de rôle,
et que les
horodatages restent des chaînes que personne ne lit. Chacun de ces points est un endroit où Notion
peut bouger sans prévenir, et où le silence coûterait des `vanishedAt` sur des gens en poste.

## Tests

Cinq scénarios d'intégration plus un scénario de contrat. Chacun se lit comme une histoire et porte
plusieurs assertions.

**Préalable technique, sinon rien ne démarre.** Avant tout appel qui touche `env`, poser
`DATABASE_URL` et `ESPACE_MEMBRE_API_KEY` avec `vi.stubEnv`, et nettoyer avec `vi.unstubAllEnvs`. Le
scénario 4, qui a besoin d'observer l'absence de jeton après que d'autres ont observé sa présence,
passe par `vi.resetModules()` puis un import dynamique du connecteur : le cache de
`src/lib/env.ts` ne se vide pas autrement.

Le réseau, lui, ne se simule pas par un `vi.stubGlobal` sur `fetch` : ce serait prendre le
contre-pied de la couture que ce connecteur se donne. `lireMembres` reçoit son lecteur en paramètre,
sur le patron de `collecter(lire, organisations)`, et les scénarios lui passent un faux lecteur de la
forme `(startIndex: number, count: number) => Promise<unknown>` qui retient ce qu'on lui a demandé,
exactement comme `src/connectors/github.test.ts` le fait déjà. Seul le scénario 6, le test de
contrat, touche le vrai réseau, et c'est son objet.

### Scénario 1 : une collecte complète rend chaque siège avec son état

Given deux pages SCIM annonçant `totalResults` cohérent, contenant un membre dont l'adresse est
celle d'une personne du périmètre, un propriétaire, et un membre dont l'adresse n'est connue de
personne. When `list` s'exécute. Then le statut vaut
`ok`, `errors` est absent, `itemsSeen` compte les trois, chaque identité porte l'`id` SCIM en
`externalId` et l'adresse en `handle` et dans `emails`, l'accès du propriétaire porte le rôle
`owner` et les autres `member`, la fiche au `name` incomplet est rendue sans être écartée, aucun
accès ne nomme de ressource, et deux appels distincts ont été émis avec le bon `startIndex`. And un
membre `active: false` est rendu comme les autres, sans vocabulaire propre : chez Notion cet état
est un retrait, pas une suspension.

### Scénario 2 : une pagination interrompue ne conclut jamais

Given une première page correcte annonçant plus d'éléments qu'elle n'en contient, et une seconde
requête qui échoue. When `list` s'exécute. Then le statut n'est jamais `ok`, `errors` porte au moins
une entrée qui nomme la pagination, et les éléments déjà lus sont conservés. Le même scénario couvre
le cas où toutes les pages échouent : statut `failed`, aucun élément rendu, ce qui interdit au socle
de dater la moindre disparition (`src/lib/sync/collecte.ts:295-300`).

### Scénario 3 : un membre illisible est écarté seul et l'écart remonte

Given une page dont une entrée n'a pas d'`id`, et une autre dont `userName` a disparu. When `list`
s'exécute. Then les entrées saines sont rendues, le statut vaut `partial`, chaque erreur nomme
l'élément fautif, et `itemsSeen` ne compte que ce qui a été effectivement rendu. C'est le scénario
qui protège contre le pire silence possible : un champ renommé chez Notion qui ferait passer tout le
monde pour absent.

### Scénario 4 : sans credential, le système est annoncé non lu et non en échec

Given un environnement sans `NOTION_SCIM_TOKEN`. When on sonde le connecteur et qu'on résout `list`.
Then la sonde rend `available: false` avec une raison lisible, `resolveCapability` rend le tier
`none` avec `degradedFrom.missing` valant `["notion:scim"]`, ce qui est exactement la condition qui
fait écrire un run `SKIPPED` par `src/lib/sync/executer.ts:120-126`. And un appel direct à `list`
rendrait `failed`, jamais `ok` vide, pour qu'une régression de l'orchestration ne se traduise pas
par un inventaire vide pris pour un inventaire complet.

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
le raisonne `docs/architecture.md` §5.7, lignes 566 à 572.

### Écarté volontairement

Aucun test dédié au schéma Zod seul, ni à l'arithmétique de pagination isolée, ni au mappage vers
`ObservedIdentity` : les cinq scénarios les traversent tous. Aucun test du socle de collecte avec
une base de données : `executerCollecte` est déjà couvert par le contrat de type, et monter une base
pour ce ticket ajouterait une dépendance à l'exécution des tests sans révéler de comportement propre
à Notion.

## Risques et pièges

**Le cast qui rendrait `ok` avec des erreurs.** C'est la seule façon de contourner
`src/core/connector.ts:214-217`, et c'est un blocage, pas un détail de revue. Un `ok` menteur
produit des `vanishedAt`, donc des propositions de révocation sur des gens en poste.

**La troncature silencieuse.** `totalResults` existe et s'avère exact, l'étape 1 l'a vérifié : la
détection d'un inventaire tronqué tient. Ce qui subsiste est plus fin, et une première rédaction de
ce plan s'y est laissé prendre : sur un serveur qui déclare `sort: false`, un saut et un doublon
naissent du même désordre, arrivent en nombre égal et s'annulent dans le décompte des entrées
reçues. Comparer ce décompte au total annoncé ne suffit donc pas, et laisserait passer un `ok`
menteur. C'est la détection du doublon qui ferme le cas, en forçant la collecte en `partial`.

**Un `id` SCIM qui changerait.** Si Notion réattribue un identifiant à un membre supprimé puis
recréé, le socle voit une identité neuve et fait disparaître l'ancienne : le rattachement décidé par
un opérateur est alors perdu sans bruit, puisqu'il vit sur la ligne devenue disparue. Rien à coder,
mais à savoir avant de conclure qu'un rattachement s'est défait tout seul.

**Le premier run ne déclenche aucun garde-fou.** `chuteExcessive` rend faux quand la référence est
nulle (`src/core/collecte.ts:56-61`) : la première collecte Notion crée tout et ne peut rien perdre.
C'est voulu, mais cela signifie qu'une première collecte tronquée passe pour complète si le statut
est `ok`. D'où la sévérité du scénario 2.

**Le jeton porte l'écriture même si l'outil ne lit pas.** Un jeton SCIM permet de supprimer des
membres et de déconnecter leurs sessions. L'outil n'exécutera rien, mais le secret est en
environnement, à portée du processus. Le `scopeNote` doit le dire mot pour mot, et la rotation du
jeton doit précéder toute mise en service d'un chemin d'écriture, au même titre que le triplet OVH
(`docs/architecture.md:539`).

**Le jeton meurt avec le rôle de qui l'a créé, et c'est le risque d'exploitation numéro un.** Ce
n'est pas seulement un départ qui le révoque, un changement de rôle suffit, et n'importe quel
propriétaire de workspace peut le retirer d'un clic. Un outil d'offboarding dont le connecteur
s'éteint quand son porteur change de casquette est une ironie qui coûtera cher un jour de collecte
silencieuse. Deux conséquences concrètes : `nominative: true` dans le contrat, ce qui est une
information affichée et non un détail ; et le jeton devrait être généré par un compte propriétaire
de service si l'organisation en tolère un, plutôt que par une personne. Le runbook doit porter la
consigne de le remplacer avant toute mutation de rôle de son porteur.

**Les invités n'apparaissent pas dans SCIM, c'est mesuré.** Le nombre de sièges rendus correspond
exactement au nombre de membres affiché par l'interface, les invités étant comptés à part. Une fiche sans compte Notion ne veut donc pas dire sans accès à
Notion, et une partie des invités dispose d'un accès que ce connecteur ne verra jamais.
C'est précisément le genre d'affirmation implicite qui trompe sur l'écran où se décide une coupure.
Le libellé du connecteur et le runbook doivent le dire, et la page du connecteur, livrée par le
ticket 5, est l'endroit prévu pour porter un jour la gestion de ces invités.

**Le propriétaire créateur du jeton ne se retire pas par l'API.** Confirmé à l'étape 1, la
documentation l'écrit. Le runbook doit le mentionner, sinon un opérateur cochera « fait » sur une
étape que rien ne peut accomplir. Le retrait de cette personne-là passera toujours par l'interface,
et révoquera au passage le jeton qu'elle avait créé.

**Le test de contrat ne tourne que si quelqu'un le lance.** C'est le prix de la décision de
l'étape 7, et il faut le regarder en face plutôt que de s'en remettre à la bonne volonté : un
contrôle qui dépend d'un geste humain n'a lieu que le jour où l'on soupçonne déjà quelque chose.
Il reste que confier un jeton d'administration à un runner, sur un dépôt public ou dans un
conteneur de production, coûtait plus cher que ce qu'il protégeait.

**L'invariant du journal avant l'action est respecté par construction, et pas par chance.** Ce
connecteur n'écrit sur aucun système tiers : la seule trace le concernant est celle que le socle
pose autour de la collecte (`src/lib/sync/collecte.ts:365-376`). La règle à tenir dans la revue est
qu'aucun appel d'écriture ne doit apparaître dans `probe`, `list` ou `plan`. Le jour où `execute`
arrivera, il passera par `actionTracee` (`src/lib/actions.ts:30-56`), qui journalise avant d'écrire.

**`ACTIONS_ENABLED` reste faux.** Le connecteur ne consulte `ctx.dryRun` nulle part parce qu'il
n'écrit nulle part : c'est cohérent, et cela ne doit pas se transformer en habitude au moment
d'ajouter `execute`.

## Vérification

`pnpm verify` puis `/verif` sont le plancher, pas la preuve. Ce qui atteste que le ticket est fini :

1. **Sans jeton**, `pnpm sync` imprime `[sync] notion non lu : notion:scim`, laisse un `SyncRun` en
`SKIPPED` en base, et la commande sort en 0. Un système non lu n'est pas une panne.
2. **Avec le jeton réel**, `pnpm sync` laisse un `SyncRun` en `OK` dont l'`itemsSeen` égale le
nombre de membres que les paramètres du workspace affichent au même moment. C'est la seule preuve
que la pagination est complète, et aucun test ne peut l'établir. Le parc valait 120 le 22 août 2026,
sur deux pages : c'est un repère historique, pas le critère, qui est l'égalité avec l'inventaire
distant du jour.
3. **Deux `pnpm sync` consécutifs** donnent, au second, zéro identité créée, N revues, zéro
disparue. Une identité recréée à chaque passage signale un `externalId` instable.
4. L'écran Systèmes montre Notion avec `Lire` en automatique et `Retirer` en manuel, la marche à
suivre affichée, et l'état du credential nommé.
5. L'écran Comptes isolés fait apparaître les sièges sans détenteur, qui sont le cas d'usage direct
du ticket. L'ordre de grandeur est connu d'avance : environ 46 comptes non rattachés
automatiquement, dont 30 ne correspondant à personne. Un écran qui en montrerait trois signalerait
un rapprochement trop permissif, un écran qui en montrerait 120 un rapprochement en panne.
6. La fiche d'une personne connue montre son compte Notion, rattaché en `EMAIL_EXACT`, et un compte
rattaché en `HEURISTIC` n'apparaît dans aucun plan de révocation.
7. Un départ ouvert sur cette personne produit une étape Notion manuelle, avec son lien et son
critère de complétion, pointable.
8. **Avec un jeton révoqué**, la collecte rend un run non `OK` sans faire disparaître qui que ce
soit : aucun `vanishedAt` neuf sur `provider = "notion"` après ce run.
