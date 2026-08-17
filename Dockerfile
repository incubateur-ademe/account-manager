# syntax=docker/dockerfile:1

# Debian et non Alpine : le schema Prisma declare
# binaryTargets ["native", "debian-openssl-3.0.x"]. Bookworm est la Debian dont
# l'OpenSSL est en 3.0.x. Sur Alpine il faudrait "linux-musl-openssl-3.0.x",
# absent du schema.
ARG NODE_IMAGE=node:25-bookworm-slim

FROM ${NODE_IMAGE} AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/opt/corepack \
    NEXT_TELEMETRY_DISABLED=1

# Node 25 ne distribue plus corepack, il faut l'installer explicitement.
# openssl est requis par le moteur de schema Prisma sur les images slim.
#
# --force parce que l'image de base pose deja ses propres relais yarn et npx dans
# /usr/local/bin : sans lui, corepack refuse d'ecraser des fichiers existants et
# l'etape echoue avant meme d'avoir installe pnpm.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --force corepack@latest \
    && corepack enable pnpm

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependances completes, cache invalide par le seul lockfile
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml ./
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
# prisma et tsx sont promus en dependances de production : ils sont des outils
# de build pour le depot mais des outils d'execution pour l'image. Toute
# nouvelle dependance d'un connecteur declaree dans "dependencies" arrive ici
# automatiquement.
# ---------------------------------------------------------------------------
FROM base AS ops

COPY package.json pnpm-lock.yaml ./

RUN node <<'PROMOTE'
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const name of ["prisma", "tsx"]) {
  const version = pkg.devDependencies?.[name];
  if (!version) {
    throw new Error(`devDependency introuvable dans package.json : ${name}`);
  }
  pkg.dependencies[name] = version;
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
# Les fichiers de l'instance ne sont pas dans ce depot : ils nomment des personnes et
# dessinent la carte des acces techniques. Ce qui est copie ici, ce sont les modeles
# et les schemas ; les vrais fichiers arrivent au deploiement, dans ce meme
# repertoire, et POLICY_DIR permet au besoin de les chercher ailleurs.
COPY --from=builder --chown=node:node /app/config ./config
COPY --from=builder --chown=node:node /app/config ./ops/config

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

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
