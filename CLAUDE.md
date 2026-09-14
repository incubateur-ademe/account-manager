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

Next 16.3.5 (App Router, `output: "standalone"`), React 19.2.8, TypeScript 7.0.2, Node 24 (`.nvmrc`),
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
| `pnpm test` | étage unitaire (`vitest run --project unite`) |
| `pnpm db:deploy:test` | applique les migrations sur `account_manager_test` |
| `pnpm test:integration` | étage d'intégration, sur cette base dédiée |
| `pnpm test:contrat` | étage de contrat, contre les vraies API distantes |
| `pnpm test:e2e` | étage de bout en bout, à la main avant une livraison |
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

**Une erreur de console à ne pas chercher.** `Failed to execute 'measure' on 'Performance' : 'X'
cannot have a negative time stamp` apparaît en développement, sur n'importe quel écran, et ne
vient pas de ce dépôt. C'est l'instrumentation de performance de React qui mesure un rendu serveur
interrompu par une redirection, ici celle de la barrière de session, avec un compteur laissé à
l'infini négatif. Défaut amont ouvert (`vercel/next.js#86060`), absent de la production, et le
correctif appartient à React : le patch côté Next a été refusé pour cette raison.

Aucune version de la ligne 16.3 n'y change rien, et la raison est mécanique : de 16.3.0 à 16.3.5,
toutes embarquent le même client React (`19.3.0-canary-cbb046ab-20260731`), dont les branches
d'abandon et d'erreur appellent `performance.measure` sans le garde-fou que porte la branche de
rendu normal. Monter `react` n'y ferait rien non plus, le code fautif étant celui que Next embarque
et non celui du `package.json`. Côté React, le défaut est déposé (`react/react#37561`) et deux
correctifs attendent leur revue. Elle ne signale rien de l'application, et rien d'ici ne la fera
taire.

## Tests

> **Peu de tests, mais des gros. Soit du BDD, soit de gros tests d'intégration.
> Ne jamais produire une tonne de petits tests unitaires.**

Un test couvre un comportement métier de bout en bout, se lit comme une histoire (Given / When /
Then), et porte plusieurs assertions. Un fichier avec quinze `it()` de trois lignes est à fusionner.
Vise cinq à dix scénarios costauds par feature, pas cinquante micro-cas.

On teste ce qui coûte cher quand ça casse : résolution du tier, runs de collecte y compris tronqués,
calcul de plan et empreinte, rapprochement d'identité, machines à états, audit, mode simulation.
Emplacement : `src/**/<nom>.test.ts`, à côté du code. Voir le skill `/add-tests`.

**Chaque garantie se tient au plus bas niveau qui sait la tenir.** Avant d'écrire un test, demande-toi
s'il ne descend pas d'un étage : une phrase d'écran sortie dans une table de rédaction s'épingle sans
base ni navigateur, et la vérifier plus haut coûte mille fois plus pour la même garantie.

`src/**/<nom>.test.ts` est l'étage **unitaire** : ni base, ni réseau, ni navigateur. `vitest.config.ts`
lui pose un environnement qui ne mène nulle part, si bien qu'un double oublié échoue au lieu
d'atteindre pour de vrai ce qu'il croyait doubler. `src/etages-de-test.test.ts` tient cette seule
propriété, parce qu'elle est la seule qui pourrisse en silence.

`src/**/<nom>.integration.test.ts` est l'étage d'**intégration** : une vraie base, dédiée, dont le nom
doit finir par `_test`. Il existe pour ce qu'un double écrit à la main ne peut pas honorer sans
réécrire un moteur, à commencer par un compte à travers une relation. La remise à zéro est posée par
le passage de mise en place : un scénario n'a rien à appeler, il sème.

`src/**/<nom>.contrat.test.ts` est l'étage de **contrat** : il interroge une vraie API distante, par
conception. Il existe pour voir une réponse changer de forme sans annonce, ce qu'un enregistrement
figé ne montrerait jamais, et lui donner une adresse morte le viderait de son sens. Il est donc hors
de `pnpm test`, et il s'ignore proprement sans jeton.

`e2e/*.spec.ts` est l'étage de **bout en bout**, hors de `src/`, lancé à la main avant une livraison
et **jamais dans la vérification continue**. Trois choses seulement s'y tiennent : qu'un cookie signé
franchisse la barrière de `src/proxy.ts` et soit décodé, que le même serveur traite deux identités
différemment quand seul le nom change, et qu'un écran s'hydrate au lieu de seulement se rendre. Un
scénario instable s'y supprime, il ne se rejoue pas : `retries` vaut zéro. Le cookie s'y forge plutôt
que de passer par le lien de connexion, si bien qu'une connexion à la main avant une livraison reste
nécessaire.

**Les deux étages du bas ne partent pas d'un clone.** Une fois pour toutes :

```bash
docker compose up -d
docker compose exec postgres createdb -U account_manager account_manager_test
pnpm db:deploy:test
pnpm exec playwright install chromium   # seulement pour le bout en bout
```

Ensuite `pnpm test:integration` et `pnpm test:e2e`. Les deux suivent `POSTGRES_PORT` comme
`docker-compose.yml`, et rien ici ne lit de fichier d'environnement : sur un poste où PostgreSQL
n'écoute pas sur 5432, c'est `POSTGRES_PORT=5433 pnpm test:integration`. Une `DATABASE_URL` déjà
posée l'emporte, et le refus du nom non dédié s'applique quand même.

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

**Conventional Commits, en français, sans scope**, pour les commits comme pour les titres de PR :
`feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, et `!` avant les deux points pour
une rupture. Le titre de la PR compte double, c'est lui qui devient le message du squash sur `main`.
La description suit `.github/pull_request_template.md`, qui demande le pourquoi avant le quoi.

**Un titre dit ce que fait le changement : un verbe à l'infinitif et son objet.** `monter Next en
16.3.5`, `uniformiser le vocabulaire des écrans`. Une cinquantaine de caractères, 72 au plafond. Ni
personnification (« l'écran cesse de mentir »), ni seconde proposition après une virgule, ni
chiffre qui ne fait que résumer le diff. Il se lira seul dans une liste, des mois plus tard, par
quelqu'un qui cherche quand une chose a changé.

**Le corps et la description portent le pourquoi, en restant lisibles jusqu'au bout.** Une liste de
défauts ou de décisions s'écrit en puces, pas en paragraphes. Le cheminement ne s'écrit nulle part :
ce qui a été essayé puis abandonné n'apprend rien à qui relit, seul le résultat compte. Une
description qu'on ne lit pas en entier ne protège de rien. Les deux endroits qui méritent d'être
longs sont ce qui n'a pas été vérifié, et ce qui reste ouvert.

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
