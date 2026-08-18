# syntax=docker/dockerfile:1

# Debian et non Alpine : le schema Prisma declare
# binaryTargets ["native", "debian-openssl-3.0.x"]. Bookworm est la Debian dont
# l'OpenSSL est en 3.0.x. Sur Alpine il faudrait "linux-musl-openssl-3.0.x",
# absent du schema. L'ecart de taille entre les deux bases ne represente qu'une
# fraction de cette image, dont le poids vient d'ailleurs (voir docs/deploiement.md).
#
# 24 et non 25 : les versions impaires de Node s'arretent en juin suivant leur
# sortie, une base de production sans correctifs amont est une dette. C'est aussi
# la version de .nvmrc, donc celle sur laquelle l'integration continue verifie :
# construire sur une autre reviendrait a livrer ce qui n'a pas ete teste.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/opt/corepack \
    NEXT_TELEMETRY_DISABLED=1

# openssl est requis par le moteur de schema Prisma sur les images slim.
#
# curl n'est pas la pour nous : le HEALTHCHECK de cette image est ecrit avec node
# et n'a besoin de rien. Il est la pour Coolify, qui fabrique sa propre sonde en
# essayant curl puis wget, et qui remplace celle de l'image par la sienne. Sans
# l'un des deux, le conteneur est declare malade en permanence quel que soit
# l'etat reel du serveur.
#
# Node 24 distribue encore corepack, et le sien accepte le packageManager de ce
# depot : rien a installer. Node 25 l'a retire, une remontee de version demandera
# donc de reintroduire "npm install --global --force corepack@latest" ici.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable pnpm

WORKDIR /app

# ---------------------------------------------------------------------------
# Politique de l'instance, recuperee depuis son propre depot.
#
# Elle nomme des personnes et dessine la carte des acces techniques : elle vit
# hors du depot du code, dans un depot prive. Cette etape la depose dans
# /politique, d'ou l'image finale la copie. L'etape elle-meme n'entre dans
# aucune image : ni le jeton, ni le clone, ni git ne survivent au build.
#
# Elle part de l'image node brute et non de "base" : elle n'a besoin ni de
# corepack ni de pnpm, et l'apt-get de git n'a pas a etre paye deux fois.
#
# Sans CONFIG_REPO, l'etape reussit sans rien deposer. C'est le cas du build
# local et de l'integration continue, qui n'ont aucune politique reelle a
# fournir. L'image demarre alors et refuse de servir, faute d'accounts.yaml :
# mieux vaut ce refus franc qu'un demarrage sur un perimetre vide, qui
# ressemblerait a un incubateur dont tout le monde est parti.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS politique

# BuildKit avertit sur CONFIG_TOKEN (SecretsUsedInArgOrEnv). L'avertissement vise
# le cas ou l'ARG finit dans l'image livree, ce qui n'arrive pas ici : cette etape
# n'en est pas une. Un secret monte serait plus propre encore, mais Coolify ne
# passe que des --build-arg, et une politique qu'on ne sait pas deployer ne
# protege rien.
ARG CONFIG_REPO=""
ARG CONFIG_REF=main
ARG CONFIG_TOKEN=""

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN <<'FETCH'
set -eu

mkdir -p /politique

if [ -z "${CONFIG_REPO:-}" ]; then
  echo "absente (build sans CONFIG_REPO)" > /politique/.revision
  echo "[politique] CONFIG_REPO absent : aucune politique embarquee"
  exit 0
fi

if [ -z "${CONFIG_TOKEN:-}" ]; then
  echo "[politique] CONFIG_REPO est renseigne mais CONFIG_TOKEN est vide" >&2
  exit 1
fi

# Le jeton passe par l'URL et non par la ligne de commande du Dockerfile : le
# heredoc n'est pas expanse a la construction, l'historique de la couche porte
# donc "${CONFIG_TOKEN}" et non sa valeur.
git clone --depth 1 --branch "${CONFIG_REF:-main}" \
  "https://x-access-token:${CONFIG_TOKEN}@github.com/${CONFIG_REPO}.git" /source

# Copie nominative plutot que copie du depot : ce dernier ne fournit que la
# politique, jamais un fichier qui entrerait dans l'image par surprise.
for fichier in accounts.yaml config.yaml; do
  if [ ! -f "/source/${fichier}" ]; then
    echo "[politique] ${fichier} absent de ${CONFIG_REPO}@${CONFIG_REF:-main}" >&2
    exit 1
  fi
  cp "/source/${fichier}" /politique/
done

# Quelle revision de la politique tourne : la question se pose le jour ou un
# ecran affirme quelque chose d'inattendu, et l'image seule n'y repond pas.
echo "${CONFIG_REPO}@${CONFIG_REF:-main} $(git -C /source rev-parse --short HEAD)" \
  > /politique/.revision

rm -rf /source
echo "[politique] $(cat /politique/.revision)"
FETCH

# ---------------------------------------------------------------------------
# Dependances completes, cache invalide par le seul lockfile
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# ---------------------------------------------------------------------------
# Build Next. Le script prebuild enchaine "react-dsfr update-icons" puis
# "prisma generate" : le client Prisma est gitignore, il n'existe que grace a
# cette etape.
# ---------------------------------------------------------------------------
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# ---------------------------------------------------------------------------
# Arbre de production pour le CLI et les migrations.
#
# La sortie standalone de Next ne contient que ce que le serveur web trace
# (verifie : @next, next, react, react-dom, pg, @prisma/client). Tout le reste
# est bundle dans les chunks. Le CLI "pnpm sync" et "prisma migrate deploy" ont
# donc besoin de leur propre arbre.
#
# prisma, tsx et @next/env sont promus en dependances de production : ils sont
# des outils de build pour le depot mais des outils d'execution pour l'image.
# Toute nouvelle dependance d'un connecteur declaree dans "dependencies" arrive
# ici automatiquement.
#
# Le front, lui, est retire. Le CLI ne rend aucune page : next et le systeme de
# design pesaient 300 Mo dans cet arbre pour du code qui ne s'execute que dans un
# navigateur, et le serveur web les porte deja dans sa sortie standalone. Liste
# d'exclusion et non d'inclusion, pour que la dependance qu'un connecteur
# apportera demain continue d'arriver sans qu'on touche a ce fichier.
# ---------------------------------------------------------------------------
FROM base AS ops

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN node <<'PROMOTE'
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

// @next/env lit la configuration d'environnement pour le CLI et pour
// prisma.config.ts. Sans cette promotion il se resout quand meme, en remontant
// depuis /app/ops vers l'arbre standalone du serveur web : un emprunt qui marche
// par accident, et que retirer next romprait sans prevenir.
for (const name of ["prisma", "tsx", "@next/env"]) {
  const version = pkg.devDependencies?.[name];
  if (!version) {
    throw new Error(`devDependency introuvable dans package.json : ${name}`);
  }
  pkg.dependencies[name] = version;
}

// La chaine d'authentification part avec : pnpm installe les peerDependencies
// tout seul, et laisser next-auth ici ramenait next par cette porte alors qu'on
// venait de le sortir par l'autre. Aucune de ces entrees n'est atteignable
// depuis le CLI, dont les seuls imports externes sont @next/env, le client
// Prisma et son adaptateur, yaml et zod.
for (const name of [
  "next",
  "react",
  "react-dom",
  "@codegouvfr/react-dsfr",
  "next-auth",
  "@auth/prisma-adapter",
  "@incubateur-ademe/next-auth-espace-membre-provider",
]) {
  if (!pkg.dependencies[name]) {
    throw new Error(`dependance front introuvable, la liste a vieilli : ${name}`);
  }
  delete pkg.dependencies[name];
}

pkg.devDependencies = {};
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));
PROMOTE

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm install --no-frozen-lockfile --store-dir=/pnpm-store

# ---------------------------------------------------------------------------
# Image finale
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PATH=/app/ops/node_modules/.bin:$PATH

WORKDIR /app

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# La politique est lue sur le disque, jamais bundlee, et les deux arbres ne
# travaillent pas depuis le meme repertoire : le serveur web depuis /app, le CLI
# depuis /app/ops. Elle doit donc exister aux deux endroits, sans quoi l'outil
# demarre pour ne servir que des erreurs.
#
# Deux provenances qui ne se recouvrent pas. Du depot du code viennent les
# modeles et les schemas, qui documentent le format. Du depot de configuration
# viennent accounts.yaml et config.yaml, les seuls fichiers que le code lit.
# POLICY_DIR permet au besoin de les chercher ailleurs, un montage par exemple.
COPY --from=builder --chown=node:node /app/config ./config
COPY --from=builder --chown=node:node /app/config ./ops/config

COPY --from=politique --chown=node:node /politique/ ./config/
COPY --from=politique --chown=node:node /politique/ ./ops/config/

COPY --from=ops --chown=node:node /app/node_modules ./ops/node_modules
COPY --from=ops --chown=node:node /app/package.json ./ops/package.json
COPY --from=builder --chown=node:node /app/prisma ./ops/prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./ops/prisma.config.ts
COPY --from=builder --chown=node:node /app/src ./ops/src

# tsconfig dedie : celui du depot etend @tsconfig/strictest et @tsconfig/next,
# deux devDependencies absentes de l'arbre de production. tsx ne verifie pas les
# types, il n'a besoin que des alias de chemins.
COPY --chown=node:node <<'TSCONFIG' /app/ops/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
TSCONFIG

COPY <<'ENTRYPOINT_SH' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e

if [ -f /app/config/.revision ]; then
  echo "[demarrage] politique : $(cat /app/config/.revision)"
fi

if [ "${RUN_MIGRATIONS_ON_BOOT:-true}" = "true" ]; then
  echo "[demarrage] application des migrations Prisma"
  (cd /app/ops && prisma migrate deploy)
  echo "[demarrage] migrations a jour"
else
  echo "[demarrage] RUN_MIGRATIONS_ON_BOOT desactive, aucune migration appliquee"
fi

exec "$@"
ENTRYPOINT_SH

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && cd /app/ops \
    && corepack install \
    && chown -R node:node /opt/corepack

USER node

EXPOSE 3000

# Aucun client HTTP n'est installe : ni curl, ni wget, ni nc dans l'image de base,
# et en ajouter un pour cette seule ligne reviendrait a payer un paquet par sonde.
# node est deja la et sait faire une requete.
#
# Forme exec et non shell : le shell substituerait ce qui ressemble a une commande
# dans la chaine. La fenetre de demarrage couvre les migrations, qui s'appliquent
# avant que le serveur n'ecoute.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
