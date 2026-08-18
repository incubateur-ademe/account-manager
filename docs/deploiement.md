# Déploiement sur Coolify

Ce document décrit comment l'application est construite, déployée et exploitée sur
l'instance Coolify de l'incubateur. Il est la référence opérationnelle ; la
conception, elle, est dans [architecture.md](./architecture.md).

**C'est la première application maison du parc sur Coolify.** Tout ce qui y tourne
aujourd'hui est un service sur étagère (n8n, Twenty, Vaultwarden, ERPNext, Messages,
Grafana), déployé en ressource Docker Compose à partir d'une image publique. Il n'y a
donc aucun précédent de build depuis un dépôt git, de migration de schéma, ni de
tâche planifiée applicative. La section [Ce qui reste incertain](#ce-qui-reste-incertain)
dit franchement où ça peut casser.

---

## 1. Forme de la ressource dans Coolify

| Élément | Valeur |
|---|---|
| Serveur | `localhost / outils` (Scaleway, `51.15.216.229`) |
| Projet | `Outils transverses` |
| Ressource applicative | **Application**, build pack **Dockerfile**, source git |
| Base de données | **PostgreSQL 17 standalone**, ressource séparée du même projet |
| Domaine | `https://comptes.app.ops.incubateur.ademe.fr` (wildcard existant) |
| Port conteneur | `3000` |

### Pourquoi une Application et pas un Docker Compose

Le reste du parc est en Docker Compose parce qu'il s'agit d'images publiques à
assembler. Ici on construit depuis le dépôt, et le type Application donne trois
choses que le type Compose n'a pas : le build sur push git, les tâches planifiées
attachées à la ressource, et l'onglet de configuration du healthcheck.

### Pourquoi une base standalone et pas un service `postgres` dans un compose

Coolify ne sait sauvegarder automatiquement (dump programmé, envoi S3, rétention) que
les **bases standalone**. Un `postgres` déclaré comme service d'un compose n'a pas cet
onglet. Vu ce que contient la base (le journal d'audit et les décisions, c'est-à-dire
la seule partie non reconstructible du système, cf. architecture 3.4), c'est
l'argument décisif.

Contrepartie déjà connue du parc : le conteneur d'une base standalone porte l'UUID de
la ressource et non un nom lisible, il n'y a pas de `container_name` configurable.
C'est le cas de `vaultwarden-postgresql` aujourd'hui, on l'accepte.

### Domaine

Le wildcard `*.app.ops.incubateur.ademe.fr` est déjà en place sur le serveur `outils`,
il ne demande aucune intervention DNS et le certificat est émis par Traefik à la
première requête.

Si l'outil sort de l'évaluation et mérite un nom propre (`comptes.incubateur.ademe.fr`),
créer un **enregistrement A** vers `51.15.216.229` dans la zone OVH, jamais un CNAME.

> Piège coûteux, déjà évité de justesse sur ERPNext : ne jamais poser un
> enregistrement DNS explicite sur un nom couvert par le wildcard. Poser le moindre
> record sur `comptes.app.ops.incubateur.ademe.fr` désactive le wildcard pour ce nom
> (RFC 4592) et rend le site injoignable, certificat compris.

---

## 2. Ce que contient l'image

Le `Dockerfile` produit une image en cinq étapes (`politique`, `deps`, `builder`, `ops`,
`runner`). L'image finale porte **deux arbres de dépendances**, et ce n'est pas un
oubli.

**`/app`, le serveur web.** C'est la sortie `standalone` de Next, environ 50 Mo. Elle
est autonome : Next n'y trace que ce que le serveur HTTP touche réellement. Sur ce
projet, vérification faite, ça se limite à `next`, `react`, `react-dom`, `pg` et
`@prisma/client`. Tout le reste (zod, nodemailer, `@prisma/adapter-pg`, le client
Prisma généré) est **bundlé dans les chunks du serveur** et n'existe plus comme module
résolvable.

**`/app/ops`, l'outillage d'exploitation.** Conséquence directe du point précédent :
`prisma migrate deploy` et la collecte ne peuvent pas fonctionner dans l'arbre
standalone, il leur manque tout. `/app/ops` contient donc un `node_modules` de
production complet, plus `prisma` et `tsx` promus en dépendances de production par le
Dockerfile, plus les sources (`src/`), le schéma (`prisma/`) et `prisma.config.ts`.

Deux conséquences à connaître :

- Une dépendance ajoutée dans `dependencies` de `package.json` arrive automatiquement
  dans `/app/ops`. Rien à faire au Dockerfile quand un connecteur arrive avec son SDK.
- Une dépendance ajoutée dans `devDependencies` mais nécessaire à l'exécution doit
  être ajoutée à la liste de promotion du Dockerfile, comme `prisma` et `tsx`. C'est
  le seul endroit du fichier qui demande une maintenance manuelle.

**`config/accounts.yaml` et `config/config.yaml` sont copiés dans les deux arbres.** La
politique est lue sur le disque et jamais bundlée, or les deux arbres ne travaillent pas
depuis le même répertoire : le serveur web depuis `/app`, le CLI depuis `/app/ops`. Elle
doit donc exister aux deux endroits. Une image qui ne la porterait qu'à un seul
démarrerait normalement pour ne servir que des erreurs, la politique n'étant chargée
qu'au premier écran qui en a besoin.

`/app/ops` embarque un `tsconfig.json` réduit, écrit par le Dockerfile. Celui du dépôt
étend `@tsconfig/strictest` et `@tsconfig/next`, absents de l'arbre de production ;
`tsx` ne vérifie pas les types, il n'a besoin que des alias `@/*`.

### La politique vient d'un autre dépôt

Elle nomme des personnes, désigne des propriétaires de comptes machine et dessine la
carte des accès techniques de l'incubateur. Le code, lui, est public. Les deux fichiers
vivent donc dans
[account-manager-config](https://github.com/incubateur-ademe/account-manager-config),
privé, et l'étape `politique` du Dockerfile va les y chercher au build.

Cette étape part de l'image node brute, installe `git`, clone en profondeur 1, copie
**nommément** `accounts.yaml` et `config.yaml` puis écrit la révision clonée dans
`config/.revision`. Elle n'entre dans aucune image : ni le jeton, ni le clone, ni `git`
ne survivent au build. Seuls les deux fichiers et la révision passent dans `runner`, par
un `COPY --from`.

Trois choix méritent d'être explicités.

**Le jeton ne fuit pas dans l'image finale.** L'étape est intermédiaire, ses couches ne
sont pas exportées. Et le script est un heredoc non expansé à la construction :
l'historique de la couche porte `${CONFIG_TOKEN}`, jamais sa valeur. Un jeton
*fine-grained* limité à ce seul dépôt, en lecture, reste néanmoins la bonne façon de le
créer.

**Sans `CONFIG_REPO`, le build réussit et n'embarque rien.** C'est le cas du build local
et de l'intégration continue, qui n'ont aucune politique réelle à fournir. L'image
démarre alors et refuse de servir, faute d'`accounts.yaml`. Ce refus franc vaut mieux
qu'un démarrage sur un périmètre vide, qui ressemblerait trait pour trait à un
incubateur dont tout le monde serait parti.

**Modifier la politique ne change rien tant qu'on n'a pas redéployé.** C'est la
contrepartie assumée du fetch au build : un déploiement correspond à un état connu de la
politique, et le journal de démarrage dit lequel. Si un jour il faut découpler les deux,
`POLICY_DIR` pointe déjà ailleurs et un montage de fichiers Coolify suffirait, au prix de
cette traçabilité.

Le `.dockerignore` exclut `config/*.yaml`. Sans cette exclusion, un build lancé depuis un
poste de développement embarquerait au passage la politique locale, silencieusement.

### Choix de l'image de base

`node:24-bookworm-slim`, Debian et non Alpine. Le schéma déclare
`binaryTargets = ["native", "debian-openssl-3.0.x"]`, et Bookworm est la Debian dont
l'OpenSSL est en 3.0.x. Sur Alpine il faudrait `linux-musl-openssl-3.0.x`, qui n'est
pas dans le schéma. Le paquet `openssl` est installé explicitement : les images slim
ne l'embarquent pas et le moteur de schéma Prisma en a besoin.

**24 et non 25**, pour deux raisons. Les versions impaires de Node sortent en octobre
et s'arrêtent en juin suivant : construire une production dessus, c'est accepter une
base sans correctifs de sécurité amont. Et 24 est la version de `.nvmrc`, donc celle
sur laquelle l'intégration continue vérifie ; construire sur une autre reviendrait à
livrer ce qui n'a pas été testé.

Node 24 distribue encore corepack, et le sien accepte le `packageManager` de ce dépôt
(vérifié : corepack 0.35.0 active pnpm 10.34.5 sans rien télécharger de plus). Il n'y
a donc rien à installer. Une remontée vers 25, qui ne le distribue plus, demandera de
réintroduire `npm install --global --force corepack@latest`, le `--force` étant requis
parce que l'image de base pose déjà ses propres relais `yarn` et `npx`.

Passer à Alpine n'est pas la piste d'allègement qu'on croit : l'écart entre les deux
bases est de quelques dizaines de mégaoctets sur une image qui en pèse plus de mille,
et il faudrait ajouter `linux-musl-openssl-3.0.x` aux `binaryTargets`. Le poids est
ailleurs, voir plus bas.

L'image de base est un `ARG` (`NODE_IMAGE`), pour pouvoir en changer sans toucher au
reste du fichier.

### Cache des couches

Le `deps` ne copie que `package.json` et `pnpm-lock.yaml` avant l'installation : une
modification de code ne réinstalle rien. Le store pnpm est monté en cache BuildKit,
partagé entre `deps` et `ops`.

### Utilisateur non root

Le conteneur tourne en `node` (uid 1000). Le point d'entrée applique les migrations
puis `exec` le serveur, sans jamais repasser root.

---

## 3. La question des migrations

C'est le seul point où Coolify n'offre pas d'équivalent propre au `postdeploy` de
Scalingo. Voici les options réellement praticables, ce qu'elles valent, et ce qui est
implémenté.

### Option A : la commande de pré-déploiement Coolify. Écartée.

Coolify expose un champ « Pre-deployment command » sur les ressources Application. Le
réflexe est d'y mettre `prisma migrate deploy`. **C'est faux**, et la lecture du code
de Coolify (`ApplicationDeploymentJob::run_pre_deployment_command`) le montre :

```php
$containers = getCurrentApplicationContainerStatus($this->server, ...);
if ($containers->count() == 0) {
    $this->application_deployment_queue->addLogEntry('Pre-deployment command: No running containers found. Skipping.');
    return;
}
...
$exec = "docker exec {$containerName} {$cmd}";
```

La commande est exécutée par `docker exec` dans le conteneur **actuellement en train
de tourner**, donc dans l'image de la version **précédente**. Elle applique les
migrations de la release d'avant, jamais celles qu'on est en train de déployer. Et
s'il n'y a aucun conteneur (premier déploiement, application arrêtée), elle est
silencieusement sautée : la toute première mise en service ne créerait aucune table.

### Option B : la commande de post-déploiement Coolify. Écartée.

Elle, au moins, tourne dans le nouveau conteneur. Deux problèmes quand même. Le
premier est fonctionnel : le proxy route déjà le trafic quand elle démarre, donc
l'application sert pendant quelques secondes sur un schéma non migré. Le second est
plus grave, il est dans le code :

```php
try {
    $this->run_post_deployment_command();
} catch (Exception $e) {
    \Log::warning('Post deployment command failed for '.$this->deployment_uuid.': '.$e->getMessage());
}
```

Une migration qui échoue ne fait **pas** échouer le déploiement. Elle produit une
ligne de warning dans les logs Laravel de Coolify, pas dans le journal de déploiement,
et le déploiement est marqué vert. C'est exactement le mode de panne qu'on ne veut
pas : un schéma partiellement migré présenté comme un succès.

### Option C : un point d'entrée qui migre avant de démarrer. **Retenue.**

Le conteneur applique lui-même ses migrations, avec sa propre image, avant d'ouvrir le
port :

```sh
if [ "${RUN_MIGRATIONS_ON_BOOT:-true}" = "true" ]; then
  (cd /app/ops && prisma migrate deploy)
fi
exec "$@"
```

Ce que ça garantit :

- Les migrations appliquées sont **celles de l'image déployée**, par construction.
- Un échec est bruyant : `set -e`, le conteneur sort en erreur, le healthcheck ne
  passe jamais, le déploiement est rouge et le trafic n'est jamais routé dessus.
- Ça marche au premier déploiement comme aux suivants, sans état préalable.
- Ça marche aussi quand le conteneur redémarre tout seul (reboot du VPS, OOM), là où
  un hook de déploiement ne rejouerait rien.

Ce que ça coûte : quelques secondes de démarrage, et un couplage entre « le service
démarre » et « le schéma est à jour ». C'est un couplage assumé : ici, un service qui
démarre sur un schéma périmé n'a aucune valeur.

**Le risque des instances parallèles.** Deux conteneurs qui démarrent en même temps
lanceraient `migrate deploy` en même temps. Prisma pose une *advisory lock* PostgreSQL
autour de l'application des migrations : le second attend, il ne joue pas les
migrations en double. S'il attend trop longtemps il sort en erreur
(`Timed out trying to acquire a postgres advisory lock`), le conteneur redémarre et
retente sur un schéma désormais à jour. Le pire cas est donc un redémarrage, pas une
corruption.

Deux conséquences pratiques : **ne jamais poser `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`**,
c'est précisément le garde-fou qui rend l'option tenable ; et on reste à **une seule
instance** de l'application, ce que le dimensionnement justifie de toute façon
(95 personnes, une poignée d'opérateurs).

### Option D : une tâche séparée, à la main. **Conservée comme échappatoire.**

Certaines migrations ne doivent pas partir toutes seules : suppression de colonne,
réécriture de données, verrou long sur une grosse table. Pour celles-là, on désactive
le mécanisme automatique le temps de l'opération :

1. Poser `RUN_MIGRATIONS_ON_BOOT=false` dans les variables d'environnement, déployer.
   L'application démarre sur le schéma en l'état.
2. Ouvrir un terminal sur le conteneur depuis Coolify et lancer la migration à la
   main, en regardant ce qu'elle fait :
   ```bash
   cd /app/ops && prisma migrate deploy
   ```
3. Retirer `RUN_MIGRATIONS_ON_BOOT`, redéployer.

C'est aussi le chemin de secours si le démarrage boucle à cause d'une migration : on
coupe le mécanisme, on démarre, on diagnostique dans un conteneur vivant.

### Avant la première mise en service

**Le dossier `prisma/migrations` n'existe pas encore.** Le schéma est validé mais
aucune migration n'a été générée. `prisma migrate deploy` sans migration ne crée aucune
table : il n'a rien à appliquer. L'application démarrerait sur une base vide et
échouerait à la première requête.

Il faut donc, avant le premier déploiement, générer la migration initiale en local et
la **committer** :

```bash
docker compose up -d
pnpm db:migrate    # cree prisma/migrations/<timestamp>_init
git add prisma/migrations && git commit
```

---

## 4. La tâche planifiée de collecte

La collecte est un point d'entrée CLI lancé une fois par jour, pas un worker (cf.
architecture 1.1).

Coolify gère ça nativement : onglet **Scheduled Tasks** de la ressource. Coolify
évalue les tâches toutes les minutes et exécute la commande par `docker exec` dans le
conteneur de la ressource. Ce n'est donc **pas** un conteneur one-off comme sur
Scalingo : la collecte tourne dans le conteneur web, et elle en partage la mémoire.

| Champ | Valeur |
|---|---|
| Name | `sync-quotidien` |
| Command | `sh -c 'cd /app/ops && node --import tsx src/cli/sync.ts'` |
| Frequency | `30 4 * * *` |
| Container | laisser vide (une seule image dans la ressource) |

> **Ne pas écrire `pnpm sync` ici.** Depuis pnpm 11, lancer un script du
> `package.json` déclenche d'abord une vérification des dépendances, qui tente une
> installation. Dans cette image, l'arbre `/app/ops` a été volontairement élagué et son
> `package.json` réécrit : l'installation échoue, et la collecte avec, sur une pile
> d'appels qui ne parle que de pnpm. Le CLI est appelé directement, ce qui est de toute
> façon plus juste : un conteneur de production n'a aucune raison d'invoquer un
> gestionnaire de paquets pour lancer un script.

L'heure est choisie creuse et décalée de l'heure ronde, pour ne pas tomber en même
temps que les tâches planifiées de tout le monde. La collecte lisant une source en
temps réel, un décalage de quelques heures ne change rien à ce qu'elle constate.

### Ce que dit son code de sortie

La commande sort en **1** dès qu'une étape a échoué : périmètre, comptes de service,
report des startups, ou n'importe quel système cible. Ce dernier point est récent :
un connecteur en échec laissait auparavant la tâche se terminer en 0, si bien qu'un
système pouvait ne plus être lu pendant des semaines sans que rien ne devienne rouge.

Un système **non lu faute de credential ne compte pas comme un échec**. Il est annoncé
dans le journal, il laisse une trace `SKIPPED` en base, et il n'y a rien à réparer
cette nuit-là. La distinction se lit dans les deux dernières lignes :

```
[sync] systèmes non lus : notion
[sync] systèmes en échec : github
```

En base, chaque `SyncRun` porte l'un de quatre statuts. `OK` et `PARTIAL` sont des
observations, la seconde n'ayant pas conclu sur les disparitions. `FAILED` est une
panne. `SKIPPED` dit qu'on n'a pas regardé, ce qui n'est ni l'un ni l'autre, et
surtout pas la même chose que l'absence de trace : un système absent des exécutions
serait indiscernable d'un système sans écart.

L'écran d'accueil reprend cette information. Un système en échec, jamais lu, ou muet
depuis plus que le seuil de fraîcheur y est signalé nommément, avec la phrase qui
compte : une fiche qui ne montre aucun compte sur ce système ne dit pas qu'il n'y en a
pas, elle dit qu'on n'a pas regardé.

### Ce que ça impose à l'image

C'est ce qui justifie l'arbre `/app/ops` décrit plus haut. La collecte exécute
`node --import tsx src/cli/sync.ts`, donc l'image doit porter :

- **`tsx`**, qui est une `devDependency` du dépôt mais un outil d'exécution ici. Le
  Dockerfile le promeut en dépendance de production.
- **pnpm**, amorcé au build par `corepack install` pour ne rien télécharger à
  l'exécution. Équivalent sans pnpm, si besoin : `sh -c 'cd /app/ops && tsx src/cli/sync.ts'`.
- **le client Prisma généré**, produit par `prisma generate` au build (il est gitignoré,
  il n'existe jamais dans le dépôt) et copié dans `/app/ops/src/generated`.
- **les alias `@/*`**, résolus par le `tsconfig.json` réduit de `/app/ops`.

### Vérifier une exécution

Coolify conserve la sortie de chaque exécution dans l'onglet Scheduled Tasks. Côté
application, chaque passage laisse une ligne `SyncRun` par connecteur, ce qui est la
source de vérité (l'écran « dernier scan il y a X » en dépend). Pour déclencher à la
main :

```bash
ssh scw-tools "docker exec \$(docker ps -qf name=<uuid-ressource>) sh -c 'cd /app/ops && node --import tsx src/cli/sync.ts'"
```

Tant qu'aucun connecteur n'est enregistré, la commande sort en 0 avec
`aucun connecteur enregistré, rien à collecter`. C'est le résultat attendu aujourd'hui.

---

## 5. Variables d'environnement

La liste complète et commentée est dans [`.env.example`](../.env.example), qui suit le
schéma zod de `src/lib/env.ts`. À régler dans l'onglet Environment Variables de la
ressource Coolify :

| Variable | Valeur en déploiement |
|---|---|
| `DATABASE_URL` | URL interne de la base standalone, copiée depuis sa fiche Coolify |
| `AUTH_SECRET` | `openssl rand -base64 32`, à ne plus changer (invalide les sessions) |
| `AUTH_URL` | `https://comptes.app.ops.incubateur.ademe.fr` |
| `AUTH_TRUST_HOST` | `true`, obligatoire derrière Traefik |
| `SMTP_URL` | `smtp://utilisateur:motdepasse@serveur:port`, identifiants compris |
| `SMTP_EMAIL_FROM` | adresse expéditrice, sur un domaine que le relais accepte |
| `ESPACE_MEMBRE_API_KEY` | clé de l'API protégée |
| `ACTIONS_ENABLED` | `false` tant que la mise en service n'est pas validée |
| `OPERATORS` | usernames beta.gouv, séparés par des virgules |
| `BREAK_GLASS_USERNAMES` | usernames de secours |
| `GITHUB_TOKEN` | jeton fine-grained, organisation `incubateur-ademe`, lecture seule |

`NODE_ENV`, `PORT` et `HOSTNAME` sont posés par l'image, ne pas les redéfinir.
`ESPACE_MEMBRE_URL` a une valeur par défaut correcte.

### Deux pièges des variables Coolify

**L'interpolation n'est pas récursive.** Une variable qui en référence une autre est
remplacée par la valeur *stockée* de celle-ci, sans seconde passe. Poser
`AUTH_URL=$APP_URL` alors que `APP_URL` vaut lui-même `$COOLIFY_URL` livre au conteneur
la chaîne littérale `$COOLIFY_URL`, et le schéma d'environnement la refuse au démarrage
avec un `AUTH_URL : Invalid URL`. Les URL publiques se posent donc en dur : elles
changent une fois tous les deux ans, et l'indirection ne fait économiser aucune saisie.

**`COOLIFY_URL` et `COOLIFY_FQDN` reprennent le port écrit dans le champ Domains.** Un
domaine saisi `https://comptes.incubateur.ademe.fr:3000` donne un `COOLIFY_URL` qui
porte ce `:3000`, alors que ce port n'existe que dans le conteneur : Traefik, lui,
écoute en 443. C'est de là que venait la sonde impossible du premier déploiement, elle
est fabriquée à partir de ce FQDN.

Les variables, elles, ne sont pas touchées : une variable définie par référence à
`$COOLIFY_URL` reçoit l'URL publique **sans le port**, constaté dans le conteneur. Le
port ne contamine donc que ce que Coolify construit lui-même à partir du FQDN.

**Écrire quand même le domaine sans port**, le port du conteneur étant déjà déclaré
dans `Ports Exposes` : c'est une source d'ennuis en moins pour ce qu'elle rapporte.

### Les trois variables de build

Elles ne servent qu'à fabriquer l'image et n'existent plus dans le conteneur. Dans
Coolify, ce sont des variables ordinaires dont on coche **`Build Variable`** : sans cette
case, elles ne sont pas passées en `--build-arg` et le clone de la politique échoue.

| Variable | Valeur |
|---|---|
| `CONFIG_REPO` | `incubateur-ademe/account-manager-config` |
| `CONFIG_REF` | `main` |
| `CONFIG_TOKEN` | PAT *fine-grained*, ce seul dépôt, permission `Contents: read` |

Laisser `CONFIG_REPO` vide produit une image sans politique, qui démarre et refuse de
servir. Le renseigner sans `CONFIG_TOKEN` fait échouer le build tout de suite, plutôt que
de livrer une image muette : c'est presque toujours un oubli de la case à cocher.

Le jeton expire. Le jour où il expirera, c'est le **build** qui cassera, pas
l'application en service, et le message sera un `403` de GitHub au clone.

Deux points de vigilance.

**`OPERATORS` vide ferme la porte à tout le monde.** L'allowlist est le seul filtre
d'accès : une personne authentifiée chez beta.gouv mais absente des deux listes est
refusée. Se mettre dedans avant le premier déploiement, sinon l'application est
inaccessible et la seule issue passe par la base.

**`ACTIONS_ENABLED` reste à `false`** jusqu'à ce que le premier connecteur en écriture
soit vérifié. C'est l'interrupteur général de simulation, il ne se contourne pas par
du code.

### Le relais d'envoi

La connexion se fait par lien à usage unique envoyé par courriel : sans SMTP qui
fonctionne, personne ne se connecte. Trois options, par ordre de préférence :

1. **Scaleway TEM**, déjà utilisé par Messages et ERPNext sur ce serveur. STARTTLS,
   username = Project ID, password = secret key d'une clé API portant la permission
   `TransactionalEmailEmailSmtpCreate`. Le domaine expéditeur doit être vérifié dans
   le projet TEM.
2. Le relais SMTP de l'incubateur, s'il accepte un nouveau client.
3. Un compte dédié chez le fournisseur de messagerie, en dernier recours.

**Le port 587 fonctionne depuis ce serveur**, vérifié au premier déploiement. Ce
document affirmait le contraire, en reprenant la règle générale des Instances
Scaleway, où 25, 465 et 587 sont filtrés en sortie pour endiguer le spam. Elle ne
s'applique pas ici, et cette erreur a coûté un diagnostic : sur 2587, la connexion
s'ouvrait sans qu'aucune bannière n'arrive.

`2587` reste le repli documenté par Scaleway si le filtrage venait à s'appliquer, et
« Enable SMTP » dans le security group de l'Instance le recours suivant.

> Le symptôme d'un port filtré est un `Greeting never received` de nodemailer : la
> connexion TCP s'ouvre, puis plus rien. Un port fermé, lui, donne un
> `ECONNREFUSED` immédiat. Pour trancher sans envoyer de message, la commande de
> diagnostic est dans la section [7](#7-exploitation-courante).

---

## 6. Procédure de bout en bout

### Prérequis

- La migration initiale existe et est committée (section 3).
- Le relais SMTP est choisi et ses credentials sont en main.
- La clé de l'API espace-membre est en main.
- Le dépôt de configuration porte une politique valide, vérifiée par
  `POLICY_DIR=../account-manager-config pnpm policy:check`, et le jeton de lecture qui
  va avec est en main.

### 6.1 Créer la base

Coolify, projet `Outils transverses`, `+ New` puis `Database` puis `PostgreSQL`,
serveur `localhost / outils`.

- Version **17**, pour coller au `postgres:17-alpine` du développement local.
- Nommer la ressource `account-manager-postgresql`.
- Ne pas exposer de port public : l'application la joint par le réseau interne.
- Noter l'URL de connexion **interne** proposée par Coolify.
- Onglet Backups : activer un dump quotidien. La rétention par défaut convient, la
  base est petite. C'est la seule sauvegarde du journal d'audit.

### 6.2 Créer l'application

`+ New` puis `Application` puis `Private Repository (with GitHub App)` ou
`Public Repository` selon la visibilité du dépôt.

- Branche : `main`.
- Build Pack : **Dockerfile**.
- Dockerfile Location : `/Dockerfile`.
- Port Exposes : `3000`.
- Nommer la ressource `account-manager`.

### 6.3 Régler le domaine et le healthcheck

- Domaine : `https://comptes.app.ops.incubateur.ademe.fr`. Coolify en propose un
  aléatoire sous le wildcard, le remplacer.
- Health Check : chemin **`/healthz`**, port `3000`, jamais `/`.
- **Start period : au moins 60 secondes.** Le conteneur applique les migrations avant
  d'écouter. Une fenêtre trop courte le déclare mort pendant qu'il travaille, et le
  proxy ne s'attache jamais.

**Health Check Host : `localhost`, Scheme : `http`.** C'est le réglage qui a coûté le
plus cher au premier déploiement. Coolify construit sa commande à partir de ces champs
et l'exécute **dans le conteneur**, pas depuis l'extérieur. Renseigner le domaine
public y produit ceci :

```
curl -s -X 'GET' -f 'https://comptes.incubateur.ademe.fr:3000/healthz' || wget ... || exit 1
```

Trois erreurs d'un coup : la requête sort sur internet pour revenir, elle demande du
`https` à un serveur qui ne parle que `http`, et elle vise le port du conteneur alors
que Traefik écoute en 443. La sonde ne peut pas réussir, et le conteneur est déclaré
mort quel que soit son état.

**Start period : le défaut de 5 secondes ne suffit pas**, les migrations s'appliquant
avant que le serveur n'écoute.

L'image embarque `curl` et `wget`, uniquement pour cette sonde. Son propre
`HEALTHCHECK` est écrit avec `node` et n'a besoin de rien, mais Coolify remplace celui
de l'image par le sien. Les deux clients et pas seulement `curl` : la commande se
replie sur `wget` quand `curl` échoue, et un `wget: not found` seul masque alors la
vraie erreur, qui est ce que `curl` aurait dit.

**Pourquoi pas `/`.** La racine est captée par le proxy, qui redirige toute requête
sans cookie vers `/connexion` ; elle est `force-dynamic` et fait quatre requêtes en
base. Une sonde posée là mesure une redirection, c'est-à-dire à peu près rien.

`/healthz` répond deux questions et pas une de plus. Le serveur écoute-t-il, et
l'image porte-t-elle une politique lisible. La politique en fait partie parce qu'une
image construite sans elle ne servira jamais rien : le défaut est permanent, et une
sonde verte laisserait ce déploiement remplacer une version qui fonctionnait. La base
n'en fait pas partie, à l'inverse : une base momentanément injoignable est une panne
dont l'application ne peut rien, et la déclarer morte remplacerait une page d'erreur
lisible par une absence de réponse.

Un `503` avec `{"etat":"degrade"}` dit donc, dans son corps, ce qui manque.

### 6.4 Poser les variables

Onglet Environment Variables, section 5. Vérifier `OPERATORS` avant de déployer, et la
case `Build Variable` sur les trois variables `CONFIG_*`.

### 6.5 Déployer

`Deploy`, puis suivre le journal. Le build prend plusieurs minutes la première fois
(installation complète des dépendances, build Next, second arbre de production). Les
suivants réutilisent les couches tant que le lockfile ne bouge pas.

Dans les logs du conteneur, la séquence attendue est :

```
[demarrage] politique : incubateur-ademe/account-manager-config@main a1b2c3d
[demarrage] application des migrations Prisma
... Applying migration `<timestamp>_init`
[demarrage] migrations a jour
   ▲ Next.js 16.3.0
   - Local: http://0.0.0.0:3000
```

Un `[demarrage] politique : absente (build sans CONFIG_REPO)` signale que les variables
de build n'ont pas été prises : l'application démarrera pour ne servir que des erreurs.

### 6.6 Déclarer la tâche planifiée

Onglet Scheduled Tasks, section 4.

### 6.7 Vérifier

```bash
# le conteneur tourne et le proxy est attache
ssh scw-tools 'docker ps --filter name=<uuid-ressource> --format "{{.Names}}\t{{.Status}}"'

# les tables existent
ssh scw-tools 'docker exec <uuid-base> psql -U <user> -d <db> -c "\dt"'
```

Puis, dans un navigateur : la page d'accueil répond, `/connexion` propose la connexion
par lien, un compte de la liste `OPERATORS` reçoit son lien et entre, un compte absent
des deux listes est refusé.

---

## 7. Exploitation courante

**Logs.** Onglet Logs de la ressource, ou
`ssh scw-tools 'docker logs -f <conteneur>'`.

**Vérifier le relais d'envoi**, sans envoyer le moindre message. Dans le terminal du
conteneur, d'abord le réseau, qui ne dépend d'aucune dépendance installée :

```bash
node -e '
const net = require("node:net");
const u = new URL(process.env.SMTP_URL);
const port = Number(u.port || (u.protocol === "smtps:" ? 465 : 587));
console.log("schema:", u.protocol, "| hote:", u.hostname, "| port:", port, "| identifiants:", u.username ? "presents" : "absents");
const s = net.connect({ host: u.hostname, port }, () => console.log("TCP ouvert, attente de la banniere..."));
s.setTimeout(8000);
s.on("data", (d) => { console.log("banniere recue:", d.toString().trim()); s.end(); });
s.on("timeout", () => { console.log("aucune banniere en 8s : port filtre en sortie, ou TLS attendu des la connexion"); s.destroy(); });
s.on("error", (e) => console.log("erreur TCP:", e.message));
'
```

Une bannière `220 ... ESMTP` dit que le relais parle. Puis l'authentification :

```bash
cd /app/ops && node -e '
require("nodemailer").createTransport(process.env.SMTP_URL).verify()
  .then(() => console.log("authentification acceptee"))
  .catch((e) => { console.error("echec :", e.message); process.exit(1); });
'
```

Ces deux commandes répondent en quelques secondes, là où un lien de connexion qui
n'arrive pas ne dit ni si c'est le réseau, ni le port, ni les identifiants, ni le
domaine expéditeur. Ni l'une ni l'autre n'affiche le mot de passe.

**Terminal.** Coolify ouvre un terminal sur le conteneur sans passer par le proxy, ce
qui reste possible même quand l'application ne répond pas. L'outillage est dans
`/app/ops`.

**Éprouver la restauration.** À refaire après tout changement de version de
PostgreSQL, et au moins une fois par an : une procédure de reprise qu'on découvre le
jour de l'incident n'est pas une procédure.

La base tourne en **PostgreSQL 18**, alors que le développement local est en 17. Un
dump produit par une 18 ne se restaure pas dans une 17 : le conteneur d'épreuve doit
donc être une 18. C'est aussi pourquoi l'image du conteneur jetable est écrite en dur
ci-dessous plutôt que déduite.

Coolify sauvegarde la base `postgres` elle-même, celle que l'application utilise, et
dépose le dump dans `/data/coolify/backups/databases/root-team-0/<ressource>/`.

```bash
DUMP=/data/coolify/backups/databases/root-team-0/<ressource>/<fichier>.dmp

docker run -d --name am-restore-test -e POSTGRES_PASSWORD=epreuve postgres:18-alpine
docker cp "$DUMP" am-restore-test:/tmp/dump.dmp
docker exec am-restore-test pg_restore -U postgres -d postgres --no-owner --no-privileges /tmp/dump.dmp
```

La comparaison porte d'abord sur les volumes, puis sur le contenu de ce qui ne se
reconstruit pas. Une collecte régénère les personnes, les identités et les constats ;
le journal d'audit, non.

```bash
REQ='SELECT (SELECT count(*) FROM "Person"), (SELECT count(*) FROM "ExternalIdentity"),
            (SELECT count(*) FROM "Finding"), (SELECT count(*) FROM "AuditEvent")'
docker exec <conteneur-base> psql -U postgres -d postgres -c "$REQ"
docker exec am-restore-test  psql -U postgres -d postgres -c "$REQ"

# Le contenu du journal, et pas seulement son volume
for c in <conteneur-base> am-restore-test; do
  docker exec "$c" psql -U postgres -d postgres -tAc \
    'SELECT md5(string_agg(id || action, chr(124) ORDER BY id)) FROM "AuditEvent"'
done
```

Deux sommes identiques valent mieux que sept compteurs égaux : elles disent que les
lignes sont les mêmes, pas seulement qu'elles sont aussi nombreuses.

```bash
docker rm -f am-restore-test
```

Épreuve du 18 août 2026 : 246 personnes, 49 identités, 49 accès, 15 constats, 53
événements d'audit, 4 runs, 21 startups, 4 comptes de service, tous identiques de part
et d'autre, et sommes de contrôle du journal égales.

**État des migrations.**

```bash
cd /app/ops && prisma migrate status
```

**Rollback.** Coolify garde les images précédentes et permet de redéployer un
déploiement antérieur en un clic. Attention : **le schéma, lui, ne recule pas**. Un
retour arrière sur une release qui avait ajouté une migration laisse la base en avance
sur le code. Prisma n'a pas de `down`. Une migration destructrice se traite donc en
deux temps (ajouter, migrer les données, déployer, puis supprimer dans une release
suivante), pas en pariant sur un rollback.

**Redémarrage.** Un `Restart` rejoue le point d'entrée, donc `migrate deploy`. C'est
idempotent, sans effet quand il n'y a rien à appliquer.

---

## 8. Développement local

Le `docker-compose.yml` de la racine ne sert **qu'au développement**. Il monte
PostgreSQL 17 et Mailpit, rien d'autre : l'application, elle, tourne en `pnpm dev` sur
la machine.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

- PostgreSQL sur `127.0.0.1:5432`, identifiants `account_manager` partout.
- Mailpit : SMTP sur `127.0.0.1:1025`, interface sur <http://localhost:8025>. Tous les
  liens de connexion y atterrissent, aucun courriel ne sort de la machine.

Les deux ports sont liés à `127.0.0.1` et non à `0.0.0.0` : sur un poste en réseau
partagé, une base de développement ouverte à tout le sous-réseau est une invitation.

Pour repartir de zéro : `docker compose down -v`, ce qui supprime le volume et donc la
base.

---

## Ce qui reste incertain

Rien de ce qui suit n'a pu être vérifié en conditions réelles : il n'existe aucune
application maison déployée sur ce Coolify, et rien de ce document n'a encore tourné
sur l'instance. Ce sont les points à surveiller au premier déploiement.

**L'image a été construite et exécutée en local**, contre la base de développement.
Ce qui suit a été vérifié : les quatre étapes passent, le point d'entrée applique les
migrations puis démarre le serveur, la page de connexion répond, et la collecte
s'exécute depuis `/app/ops`. Les trois risques annoncés à la rédaction se sont réglés
ou ne se sont pas produits : la promotion de `prisma` et `tsx` fonctionne, les heredocs
BuildKit aussi, et l'amorçage de corepack a demandé un `--force`, l'image de base
posant déjà ses propres relais dans `/usr/local/bin`.

Deux enseignements de ce premier build. La politique manquait dans l'image :
le CLI échouait et les écrans protégés auraient échoué de même. Et la collecte annonce
proprement `github non lu : github-token` quand le jeton est absent, ce qui confirme le
comportement dégradé attendu d'un credential manquant.

**L'image pesait 1,52 Go, elle en pèse 987 Mo.** L'explication qui figurait ici,
`@prisma/dev` et son PostgreSQL embarqué, était fausse : mesure faite dans l'image,
`@prisma/dev` pèse 18 Mo et n'apparaît même pas dans les huit premiers.

Le poids était ailleurs. L'arbre `/app/ops`, qui ne sert qu'au CLI et aux migrations,
portait `next` (201 Mo), son compilateur natif `@next/swc-linux-arm64-gnu` (86 Mo) et
`@codegouvfr/react-dsfr` (98 Mo), c'est-à-dire du code qui ne s'exécute que dans un
navigateur, et que le serveur web porte déjà de son côté dans sa sortie standalone.
Le CLI, lui, n'importe que `@next/env`, le client Prisma et son adaptateur, `yaml` et
`zod`, ce qu'on peut vérifier en suivant les imports depuis `src/cli/sync.ts`.

L'étape `ops` retire donc ces paquets du `package.json` avant d'installer. Deux pièges
rencontrés en le faisant :

- Retirer `next` ne suffit pas. pnpm installe les `peerDependencies` tout seul, et
  `next-auth` le faisait revenir par cette porte. La chaîne d'authentification part
  donc avec, elle n'est atteignable depuis aucun chemin du CLI.
- `@next/env` doit être promu explicitement. Il se résolvait jusqu'ici en remontant
  depuis `/app/ops` vers l'arbre du serveur web, un emprunt qui fonctionnait par
  accident et que le retrait de `next` aurait rompu sans prévenir.

Un second passage a retiré de cet arbre le PostgreSQL embarqué de `prisma dev` et le
compilateur TypeScript, tiré comme `peerDependency` et auto-installé par pnpm. Le
client arrive généré depuis l'étape de build : il n'y a plus rien à compiler ici.

Ce découpage se fait après installation, ces paquets étant des dépendances fermes du
CLI Prisma qu'aucun réglage n'écarte. La liste s'arrête à ces deux-là et ce n'est pas
par prudence : `@prisma/studio-core`, `@prisma/dev` et `effect` ont été essayés un à
un, chacun fait échouer le CLI dès son démarrage sur un `Cannot find module`. C'est
aussi le symptôme à surveiller après une montée de version de Prisma.

Résultat mesuré dans l'image : `/app/node_modules` 43 Mo, `/app/ops/node_modules`
328 Mo au lieu de 811, et l'image entière à **930 Mo au lieu de 1,52 Go**.
`prisma migrate status`, la collecte et la sonde ont été vérifiés dans le conteneur
après coupe.

**`migrate deploy` sans migration à appliquer sort bien en 0** : vérifié au démarrage
du conteneur local sur une base déjà à jour, qui affiche « No pending migrations to
apply » puis laisse démarrer le serveur.

**Le healthcheck de Coolify sur cette application.** Le parc a déjà payé plusieurs 504
dus à un agrégat de statut malsain qui empêche Traefik de s'attacher au réseau de la
ressource (Twenty, Messages, ERPNext). Le cas est différent ici (une seule ressource,
un seul conteneur), mais si le domaine renvoie 504 alors que le conteneur tourne, la
piste est là : `docker inspect coolify-proxy` pour voir à quels réseaux le proxy est
attaché, et allonger la start period. Désactiver le healthcheck est un contournement
acceptable, on retombe sur « le conteneur tourne ».

**Le comportement des tâches planifiées Coolify** sur une ressource Application n'a
jamais été exercé dans le parc. Le mécanisme est un `docker exec` piloté par un
scheduler qui tourne toutes les minutes ; ce qui reste à voir, c'est le comportement
en cas de redéploiement pendant l'exécution, et la rétention réelle des sorties.

**La sauvegarde a été restaurée et vérifiée.** Voir la procédure en section 7 : dump
de 74 ko restauré dans un conteneur jetable, sept tables comparées ligne à ligne, et
somme de contrôle du journal d'audit identique à la production. L'opération a pris
moins d'une minute et n'a jamais touché la base en service.

**La version de Node est réglée.** L'image construisait sur 25, une version impaire qui
s'arrête en juin, pendant que `.nvmrc` et l'intégration continue vérifiaient sur 24 :
on livrait donc ce qui n'avait pas été testé, sur une base sans correctifs amont. Les
deux sont désormais sur 24, et l'installation manuelle de corepack a disparu avec, celui
de Node 24 acceptant le `packageManager` du dépôt.
