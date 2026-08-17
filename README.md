# Gestionnaire de Comptes de l'Incubateur ADEME

Donner et retirer des accès depuis un seul endroit, en gardant la trace de qui a
décidé quoi. L'onboarding et l'offboarding sont les deux moments qui comptent.

La conception est décrite dans [docs/architecture.md](docs/architecture.md), qui fait
référence en cas de doute.

## Stack

Next.js 16, React 19, TypeScript 7, Prisma 7 sur PostgreSQL, NextAuth 5 avec le
provider Espace Membre beta.gouv, react-dsfr, Biome, Vitest. Node 25, pnpm.

## Démarrage

```bash
pnpm install
cp .env.example .env      # puis renseigner les valeurs
docker compose up -d      # PostgreSQL et serveur de courriel local
pnpm db:migrate
pnpm dev
```

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | serveur de développement |
| `pnpm build` | build de production |
| `pnpm verify` | lint, typecheck et tests |
| `pnpm sync` | collecte sur les systèmes cibles |
| `pnpm db:migrate` | applique les migrations en développement |
| `pnpm db:deploy` | applique les migrations en production |
| `pnpm db:studio` | explorateur de base |

## Cohabitation avec un autre PostgreSQL

Plusieurs projets du parc exposent PostgreSQL sur le port 5432, et deux stacks ne peuvent pas le
partager. Le port hôte est donc paramétrable :

```bash
POSTGRES_PORT=5433 docker compose up -d
```

Il faut alors reporter le port dans `DATABASE_URL`, faute de quoi l'application et la collecte
échouent sur un `prisma` en erreur d'invocation, sans message explicite sur la cause.

## Piège connu

Après une modification du schéma Prisma, il faut lancer **`pnpm db:generate`** puis **redémarrer le
serveur de développement**. Deux caches se cumulent : `prisma migrate dev` applique bien la
migration en base mais ne régénère pas toujours le client, et ce client est ensuite mis en cache sur
`globalThis` pour survivre au rechargement à chaud, si bien qu'il survit aussi à sa propre
régénération. Le symptôme est un `Unknown argument 'X'` ou un `Value 'X' not found in enum 'Y'`
alors que la base et le client généré contiennent bien la valeur. Le typecheck, lui, passe.

## Invariants

Trois règles ne se négocient pas, elles sont détaillées dans le document
d'architecture.

Le journal d'audit précède l'action : aucune écriture sur un système cible ne se fait
sans trace nominative.

Un connecteur ne retourne jamais `ok` s'il a avalé une erreur unitaire. Le type de
retour l'interdit, ce n'est pas une consigne mais une contrainte de compilation.

`ACTIONS_ENABLED=false` force toute exécution en simulation, sans modification de
code. C'est la valeur par défaut.
