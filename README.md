# Gestionnaire de Comptes de l'Incubateur ADEME

Donner et retirer des accès depuis un seul endroit, en gardant la trace de qui a
décidé quoi. L'onboarding et l'offboarding sont les deux moments qui comptent.

La conception est décrite dans [docs/architecture.md](docs/architecture.md), qui fait
référence en cas de doute.

## Stack

Next.js 16, React 19, TypeScript 7, Prisma 7 sur PostgreSQL, NextAuth 5 avec le
provider Espace Membre beta.gouv, react-dsfr, Biome, Vitest. Node 24, pnpm.

## Démarrage

```bash
pnpm install
cp .env.example .env                                # puis renseigner les valeurs
cp config/accounts.exemple.yaml config/accounts.yaml
cp config/config.exemple.yaml config/config.yaml
docker compose up -d                                # PostgreSQL et serveur de courriel local
pnpm db:migrate
pnpm dev
```

## Configuration

L'application lit deux fichiers YAML dans `config/`, absents de ce dépôt.

**`accounts.yaml` nomme** : le périmètre suivi et les comptes de service, avec leurs
propriétaires. Il est obligatoire, l'application refuse de servir sans lui.
**`config.yaml` règle** : seuils, vocabulaire, catalogues. Tout y a un défaut, il est
donc facultatif.

Ce qui nomme ne vit pas avec le code. La politique de l'instance ADEME est dans un dépôt
privé dédié, [account-manager-config](https://github.com/incubateur-ademe/account-manager-config),
que le build va chercher au moment de fabriquer l'image. Ce dépôt-ci ne porte que les
modèles `config/*.exemple.yaml`, à copier pour démarrer, et les schémas JSON qui les
valident.

Les schémas sont **générés** depuis les schémas Zod de `src/core/policy.ts`, jamais
écrits à la main. Chaque champ y porte sa description et un exemple, ce qui donne
l'autocomplétion et la validation dans l'éditeur, y compris depuis un dépôt qui n'a pas
le code sous la main. Après toute modification de `src/core/policy.ts`, lancer
`pnpm policy:schema`.

Pour vérifier une politique sans démarrer l'application, ici ou ailleurs :

```bash
POLICY_DIR=../account-manager-config pnpm policy:check
```

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | serveur de développement |
| `pnpm build` | build de production |
| `pnpm verify` | lint, typecheck et tests |
| `pnpm sync` | collecte sur les systèmes cibles |
| `pnpm policy:check` | valide la politique et en affiche le résumé |
| `pnpm policy:schema` | régénère les schémas JSON depuis Zod |
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
