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
`prisma migrate deploy` et `pnpm sync` ne peuvent pas fonctionner dans l'arbre
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

`node:25-bookworm-slim`, Debian et non Alpine. Le schéma déclare
`binaryTargets = ["native", "debian-openssl-3.0.x"]`, et Bookworm est la Debian dont
l'OpenSSL est en 3.0.x. Sur Alpine il faudrait `linux-musl-openssl-3.0.x`, qui n'est
pas dans le schéma. Le paquet `openssl` est installé explicitement : les images slim
ne l'embarquent pas et le moteur de schéma Prisma en a besoin.

Node 25 ne distribue plus corepack, il faut donc l'installer (`npm install --global
corepack@latest`) avant de pouvoir l'activer. Le champ `packageManager` de
`package.json` fixe ensuite la version exacte de pnpm.

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

## 4. La tâche planifiée `pnpm sync`

La collecte est un point d'entrée CLI lancé une fois par jour, pas un worker (cf.
architecture 1.1).

Coolify gère ça nativement : onglet **Scheduled Tasks** de la ressource. Coolify
évalue les tâches toutes les minutes et exécute la commande par `docker exec` dans le
conteneur de la ressource. Ce n'est donc **pas** un conteneur one-off comme sur
Scalingo : la collecte tourne dans le conteneur web, et elle en partage la mémoire.

| Champ | Valeur |
|---|---|
| Name | `sync-quotidien` |
| Command | `sh -c 'cd /app/ops && pnpm sync'` |
| Frequency | `30 4 * * *` |
| Container | laisser vide (une seule image dans la ressource) |

L'heure est choisie creuse et décalée de l'heure ronde, pour ne pas tomber en même
temps que les tâches planifiées de tout le monde. La collecte lisant une source en
temps réel, un décalage de quelques heures ne change rien à ce qu'elle constate.

### Ce que ça impose à l'image

C'est ce qui justifie l'arbre `/app/ops` décrit plus haut. `pnpm sync` exécute
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
ssh scw-tools "docker exec \$(docker ps -qf name=<uuid-ressource>) sh -c 'cd /app/ops && pnpm sync'"
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
| `EMAIL_SERVER` | URL SMTP du relais d'envoi |
| `EMAIL_FROM` | adresse expéditrice autorisée par ce relais |
| `ESPACE_MEMBRE_API_KEY` | clé de l'API protégée |
| `ACTIONS_ENABLED` | `false` tant que la mise en service n'est pas validée |
| `OPERATORS` | usernames beta.gouv, séparés par des virgules |
| `BREAK_GLASS_USERNAMES` | usernames de secours |
| `GITHUB_TOKEN` | jeton fine-grained, organisation `incubateur-ademe`, lecture seule |

`NODE_ENV`, `PORT` et `HOSTNAME` sont posés par l'image, ne pas les redéfinir.
`ESPACE_MEMBRE_URL` a une valeur par défaut correcte.

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

1. **Scaleway TEM**, déjà utilisé par Messages et ERPNext sur ce serveur. Port
   **2587** en STARTTLS, username = Project ID, password = secret key d'une clé API
   portant la permission `TransactionalEmailEmailSmtpCreate`. Le domaine expéditeur
   doit être vérifié dans le projet TEM.
2. Le relais SMTP de l'incubateur, s'il accepte un nouveau client.
3. Un compte dédié chez le fournisseur de messagerie, en dernier recours.

> Les ports 25, 465 et 587 sont bloqués en sortie sur les Instances Scaleway. C'est la
> raison du port 2587. Si même 2587 expire, il faut cocher « Enable SMTP » dans le
> security group de l'Instance.

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
- Health Check : chemin `/`, port `3000`. La page d'accueil est prérendue et ne touche
  pas la base : elle teste que le serveur répond, pas que tout va bien, ce qui est
  exactement ce qu'on veut d'une sonde de vivacité.
- **Start period : au moins 60 secondes.** Le conteneur applique les migrations avant
  d'écouter. Une fenêtre trop courte le déclare mort pendant qu'il travaille, et le
  proxy ne s'attache jamais.

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

**Terminal.** Coolify ouvre un terminal sur le conteneur sans passer par le proxy, ce
qui reste possible même quand l'application ne répond pas. L'outillage est dans
`/app/ops`.

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
migrations puis démarre le serveur, la page de connexion répond, et `pnpm sync`
s'exécute depuis `/app/ops`. Les trois risques annoncés à la rédaction se sont réglés
ou ne se sont pas produits : la promotion de `prisma` et `tsx` fonctionne, les heredocs
BuildKit aussi, et l'amorçage de corepack a demandé un `--force`, l'image de base
posant déjà ses propres relais dans `/usr/local/bin`.

Deux enseignements de ce premier build. La politique manquait dans l'image :
le CLI échouait et les écrans protégés auraient échoué de même. Et la collecte annonce
proprement `github non lu : github-token` quand le jeton est absent, ce qui confirme le
comportement dégradé attendu d'un credential manquant.

**L'image pèse 1,53 Go**, non les 500 à 700 Mo espérés. L'essentiel de l'écart vient de
l'arbre `/app/ops`, où `prisma`, promu en dépendance de production, entraîne
`@prisma/dev` et son PostgreSQL embarqué (`pglite`), inutile en production. Si l'espace
du VPS devient un sujet, c'est le premier endroit où couper : n'installer que
`@prisma/client` et le CLI strictement nécessaire à `migrate deploy`, ou appliquer les
migrations autrement.

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

**La sauvegarde de la base n'a jamais été restaurée.** Activer le dump ne prouve rien.
Un test de restauration sur une base jetable doit être fait avant que l'outil porte
des décisions réelles, parce que le journal d'audit est la seule donnée non
reconstructible du système.

**Node 25 n'est plus une version supportée** (les versions impaires sortent en octobre
et s'arrêtent en juin suivant). C'est ce que dit `.nvmrc`, et l'image le suit pour ne
pas diverger du développement, mais une base de production sans correctifs de sécurité
amont est une dette. Le passage à la LTS se fait en une ligne, via l'`ARG NODE_IMAGE`,
et devrait s'accompagner d'une mise à jour de `.nvmrc` et de `engines`.
