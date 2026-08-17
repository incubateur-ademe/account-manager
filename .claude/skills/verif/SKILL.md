---
name: verif
description: Verifie l'implementation en lancant lint Biome, typecheck, tests Vitest et build Next, puis fait une revue post-implementation et rapporte fidelement. A lancer avant de declarer une tache terminee.
---

# /verif - Verification de l'implementation

## Quand l'invoquer

- **Obligatoire** a la fin de toute tache d'implementation, avant de rapporter "termine".
- Apres avoir applique des corrections de review (`/check-review-pr` l'appelle lui-meme).
- Apres avoir ajoute des tests (`/add-tests` l'appelle lui-meme).

## Etapes

Dans cet ordre. **Stop des qu'une etape echoue**, corrige, puis reprends depuis le debut de l'etape.
Ne passe pas a la suivante tant que la precedente n'est pas verte.

### 1. Lint et format

```bash
pnpm lint
```

`biome check .` fait lint **et** verification de format en une passe. Biome 2.5.7 remplace ESLint et
Prettier : il n'y a ni `.eslintrc` ni `.prettierrc` dans ce projet, ne cherche pas a en creer.

Si des violations sont auto-corrigeables :

```bash
pnpm lint:fix
```

puis relance `pnpm lint`. Si des erreurs persistent, **corrige le code**. Ne desactive jamais une
regle Biome (ni par `biome-ignore`, ni dans `biome.json`) pour faire passer le lint sans validation
utilisateur explicite. Les regles qui font le plus mal sont volontaires : `noExplicitAny`,
`noNonNullAssertion`, `noConsole` (sauf dans `src/cli/**`), `noUnusedImports`.

### 2. Typecheck

```bash
pnpm typecheck
```

Soit `next typegen && tsc --noEmit`. TypeScript 7 en `strict` avec `noUncheckedIndexedAccess`,
`noPropertyAccessFromIndexSignature` et `verbatimModuleSyntax`. Un `as` qui fait taire le compilateur
est un echec, pas une correction.

Si le typecheck se plaint de types Prisma manquants ou perimes apres un changement de schema :

```bash
pnpm db:generate
```

Le client est genere par le generateur `prisma-client` dans `src/generated/prisma` (exclu de Biome et
gitignore). C'est normal qu'il n'apparaisse pas dans le diff.

### 3. Tests

```bash
pnpm test
```

Vitest 4, `environment: "node"`, pattern `src/**/*.test.ts`, `passWithNoTests: true`. Ce dernier point
compte : **un run vert ne prouve pas qu'il existe des tests**. Si le perimetre touche de la logique
metier et qu'aucun test ne s'execute, dis-le dans le rapport au lieu de rapporter PASS sec.

Si un test echoue, determine si le bug est dans le test ou dans l'implementation. Ne supprime pas un
test et ne le passe pas en `skip` pour obtenir du vert.

### 4. Build

```bash
pnpm build
```

`prebuild` lance `react-dsfr update-icons` puis `prisma generate`. Le build en `output: "standalone"`
avec `typescript.ignoreBuildErrors: false` catche des choses que `tsc --noEmit` seul rate, notamment
les frontieres client/serveur du DSFR et les erreurs de collecte de routes App Router.

Cette etape peut etre sautee si le changement ne touche ni `src/app/**`, ni `src/ui/**`, ni
`next.config.ts`, ni le schema Prisma. Dans ce cas, dis explicitement dans le rapport qu'elle a ete
sautee et pourquoi. Ne la fais jamais passer pour un PASS.

### Raccourci

`pnpm verify` enchaine `lint`, `typecheck` et `test` (pas le build). Utile pour une boucle rapide,
mais le rapport doit distinguer les trois etapes.

## 5. Revue post-implementation

Relis les changements de la session et verifie :

- Coherence avec `CLAUDE.md` et, en cas de doute sur une decision de conception, avec
  `docs/architecture.md` qui fait reference.
- Les invariants non negociables du projet sont-ils tenus ? En particulier :
  - Aucune ecriture sur un systeme cible sans evenement d'audit nominatif ecrit **avant** l'action.
  - Aucun connecteur ne retourne `ok` en ayant avale une erreur unitaire. Le type `CollectResult`
    l'interdit par construction (`status: "ok"` implique `errors?: undefined`) : si un code contourne
    ca par un cast, c'est un blocage.
  - Aucun `vanishedAt` pose par un run qui n'est pas `ok`.
  - Aucune revocation produite depuis une `ExternalIdentity` dont `matchMethod` vaut `HEURISTIC` ou
    `NONE`.
  - `ACTIONS_ENABLED` non lu ailleurs que via `src/lib/env.ts`, et `RunContext.dryRun` jamais force a
    `false` en dur.
  - Aucun secret en dur, aucun credential logue, aucun `.env` touche.
- Le code est propre : pas de commentaire qui paraphrase le code, pas de dead code, nommage en
  francais coherent avec l'existant.

## 6. Issues mineures hors scope

Si la revue releve des problemes reels mais hors du scope direct de la session (bugs preexistants,
ameliorations reperees dans le code voisin), utilise `AskUserQuestion` :

- Pour chaque issue : fichier, ligne, description courte, severite, correction proposee.
- Suggestions : `["Corrige tout", "Corrige seulement #1, #3", "Ignore tout"]`.
- Si refus, note-les dans le rapport comme "non corrigees (hors scope)".

## Rapport attendu

Format strict, sans hedging :

```
## /verif - <perimetre>

- Lint (biome)   : PASS | FAIL (N erreurs)
- Typecheck      : PASS | FAIL (N erreurs)
- Tests (vitest) : PASS | FAIL (N passes / N echecs) | AUCUN TEST EXECUTE
- Build (next)   : PASS | FAIL | SAUTE (raison)
- Revue          : OK | N points

Statut global : PASS | FAIL

## Details (si FAIL)

<output minimal pertinent, pas un dump complet>
```

## Regles dures

- **Ne masque jamais un echec.** Si lint, typecheck, tests ou build echouent, rapporte-le avec
  l'output pertinent. Ne pretends jamais "tout passe" quand l'output montre des echecs.
- **Ne desactive pas une regle Biome** pour faire passer le lint. Corrige le code.
- **Ne supprime ni ne skip un test** pour faire passer le runner.
- **Ne lance pas `--no-verify`** sur un commit. Si un hook bloque, c'est qu'il y a un vrai probleme.
- **`passWithNoTests` n'est pas un PASS.** Zero test execute sur un changement de logique metier se
  signale.
