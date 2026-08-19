# account-manager

Gestionnaire de comptes de l'incubateur ADEME. Donner et retirer des accès depuis un seul endroit, en
gardant la trace de qui a décidé quoi : l'onboarding et l'offboarding sont les deux moments qui
comptent. Environ 95 personnes, 19 startups d'État, un mainteneur à temps partiel.

La valeur est proportionnelle au **nombre de systèmes couverts**, pas à la finesse avec laquelle on en
traite un. Un système couvert à la main dans l'outil vaut mieux qu'un système absent de l'outil : les
tiers `assisted` et `manual` sont des citoyens de première classe, pas des cas dégradés.

## Source de vérité

**`docs/architecture.md` fait référence en cas de doute.** Forme du système, objets métier, contrat de
connecteur, invariants. Lis-le avant toute décision de conception. Ne le duplique pas ici : renvoie
vers lui.

Si le code s'écarte du document, le défaut est dans le code jusqu'à preuve du contraire. Le document
ne se modifie pas sans validation explicite de l'utilisateur.

## Stack

Next 16.3.0 (App Router, `output: "standalone"`), React 19.2.8, TypeScript 7.0.2, Node 24 (`.nvmrc`),
pnpm 11.22.0. Le `tsconfig.json` étend `@tsconfig/strictest` et `@tsconfig/next` ; seule
`exactOptionalPropertyTypes` est désactivée en surcharge, Prisma et NextAuth ne la respectent pas dans
leurs propres types.

Prisma 7.9.1 avec le générateur `prisma-client` (sortie dans `src/generated/prisma`, gitignoré) et
`@prisma/adapter-pg` sur PostgreSQL. **L'URL de la base vit dans `prisma.config.ts`, pas dans
`schema.prisma`.**

NextAuth 5.0.0-beta.32 avec `@incubateur-ademe/next-auth-espace-membre-provider` et nodemailer 8.
`react-dsfr` 1.32.4 (nécessite `sass`, et `react-dsfr update-icons` en `predev`/`prebuild`).

**Biome 2.5.7 remplace ESLint et Prettier.** Il n'y a ni `.eslintrc` ni `.prettierrc`, n'en crée pas.
Vitest 4, `environment: "node"`, pas de globals : importe `describe`, `it`, `expect` depuis `vitest`.
Zod 4 pour la validation.

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | serveur de développement |
| `pnpm build` | build de production |
| `pnpm start` | serveur de production |
| `pnpm lint` | `biome check .` (lint **et** format) |
| `pnpm lint:fix` | `biome check --write .` |
| `pnpm format` | `biome format --write .` |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm test` | `vitest run` |
| `pnpm verify` | lint + typecheck + test |
| `pnpm sync` | collecte sur les systèmes cibles |
| `pnpm db:generate` / `db:migrate` / `db:deploy` / `db:studio` | Prisma |

`pnpm verify` ne fait pas le build. Lance `/verif` pour la vérification complète.

**Après toute modification du schéma Prisma, lance `pnpm db:generate` puis redémarre `pnpm dev`.**
Deux caches se cumulent. `prisma migrate dev` applique bien la migration en base mais **ne régénère
pas toujours** le client de `src/generated/prisma` : le typecheck passe pendant que le runtime
refuse le champ, avec une erreur du genre `Unknown argument 'X'`. Et le client est mis en cache sur
`globalThis` pour survivre au rechargement à chaud sans épuiser le pool de connexions, donc il
survit aussi à `prisma generate` et sert des métadonnées périmées, d'où le redémarrage. Symptôme
voisin : `Value 'X' not found in enum 'Y'` alors que la base et le client généré sont à jour.

## Tests

> **Peu de tests, mais des gros. Soit du BDD, soit de gros tests d'intégration.
> Ne jamais produire une tonne de petits tests unitaires.**

Un test couvre un comportement métier de bout en bout, se lit comme une histoire (Given / When /
Then), et porte plusieurs assertions. Un fichier avec quinze `it()` de trois lignes est à fusionner.
Vise cinq à dix scénarios costauds par feature, pas cinquante micro-cas.

On teste ce qui coûte cher quand ça casse : résolution du tier, runs de collecte y compris tronqués,
calcul de plan et empreinte, rapprochement d'identité, machines à états, audit, mode simulation.
Emplacement : `src/**/<nom>.test.ts`, à côté du code. Voir le skill `/add-tests`.

## Invariants non négociables

**Le journal d'audit précède l'action.** Aucune écriture sur un système cible sans trace nominative
écrite avant. L'écriture est en fire-and-forget avec capture d'erreur (`src/lib/audit.ts`) : une panne
du journal ne doit jamais faire échouer l'action métier, mais l'inverse n'est pas vrai.

**Un connecteur ne retourne jamais `ok` s'il a avalé une erreur unitaire.** C'est porté par le type
`CollectResult` dans `src/core/connector.ts` : `status: "ok"` implique `errors?: undefined`. Un cast
qui contourne ça est un blocage, pas un détail. Corollaire : un run non `ok` ne pose aucun
`vanishedAt`, il conserve le dernier état constaté.

**`ACTIONS_ENABLED=false` par défaut.** Toute exécution est une simulation tant que rien ne l'autorise
explicitement. `RunContext.dryRun` en découle et ne se force jamais à `false` en dur.

**Jamais de secret en dur.** Toute variable passe par le schéma Zod de `src/lib/env.ts`, qui fait foi
sur la liste attendue : `NODE_ENV`, `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `SMTP_URL`,
`SMTP_EMAIL_FROM`, `ESPACE_MEMBRE_URL`, `ESPACE_MEMBRE_API_KEY`, `ACTIONS_ENABLED`, `OPERATORS`,
`BREAK_GLASS_USERNAMES`. Ce dépôt manipule un triplet OVH à portée compte entier, un token de session
Notion nominatif et un jeton GitHub d'organisation : un hook `PreToolUse` bloque tout accès aux
fichiers `.env`. Seuls `.env.example` et `.env.dist` sont manipulables, et uniquement avec des formes,
jamais des valeurs réelles.

**Le `username` beta.gouv est le pivot d'identité.** L'`uuid` interne de l'API espace-membre n'est pas
utilisé : il n'est résolvable par aucun endpoint, c'est un identifiant sans porte d'entrée. Un
identifiant fabriqué ici, et lui seul, se renomme : `Person.usernameFabricated` le désigne, la
collecte l'éteint en adoptant la fiche. Voir `docs/architecture.md` §2.1.

**Une identité dont `matchMethod` vaut `HEURISTIC` ou `NONE` ne peut jamais produire une révocation.**
Elle alimente une file de rattachement manuel. `ExternalIdentity.personId` nullable est le cœur du
modèle : une identité non rattachée est la définition même de l'écart, elle ne se jette ni ne se force
vers une personne.

## Conventions

Tout en **français** : code, commentaires, messages d'erreur, noms de tests, documentation, commits.

**Jamais de tiret cadratin (U+2014) ni de tiret demi-cadratin (U+2013)**, nulle part : ni prose, ni
commentaire, ni code, ni message de commit. Virgule, deux-points, parenthèses ou point à la place. Le
tiret simple `-` reste normal pour les listes et le kebab-case.

**Par défaut, aucun commentaire.** Un commentaire ne s'écrit que quand le POURQUOI est non évident :
contrainte cachée, invariant subtil, contournement d'un bug précis. Jamais pour paraphraser le code,
jamais pour référencer une tâche ou une PR.

Alias `@/` vers `src/`. Modules ESM. `src/generated/**` est du code généré : ni relu, ni édité, ni
commité.

Pas de commit sans demande explicite. Aucun trailer `Claude-Session`, aucun `Co-Authored-By`, aucune
mention "Generated with Claude Code" dans un artefact versionné.

## Skills

`/verif` (vérification avant de déclarer terminé), `/add-tests`, `/sync-docs`, `/check-review-pr`,
`/architecture-decision`, `/code-review`. Références Next chargées à la demande :
`next-best-practices`, `next-cache-components`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
