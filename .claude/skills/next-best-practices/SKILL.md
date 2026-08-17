---
name: next-best-practices
description: Bonnes pratiques Next.js - conventions de fichiers, frontieres RSC, patterns de donnees, API async, metadata, gestion d'erreur, route handlers, images et fontes, bundling, autohebergement
user-invocable: false
---

# Bonnes pratiques Next.js

Reference a appliquer quand on ecrit ou qu'on relit du code Next.js dans ce projet.

## Contexte du projet

- Next 16.3.0, React 19.2.8, TypeScript 7, App Router uniquement.
- `output: "standalone"` et `reactStrictMode: true` (voir `next.config.ts`). Le projet est autoheberge, pas sur Vercel.
- `cacheComponents` n'est **pas** active. Le skill `next-cache-components` decrit ce qu'il faudrait faire si on l'activait, ce n'est pas l'etat courant.
- L'UI passe par `react-dsfr`. La separation client/serveur du DSFR vit dans `src/ui/dsfr/`, ne la contourne pas.
- Auth par NextAuth 5 beta. Les helpers sont dans `src/lib/auth.ts`.
- Les fiches ci-dessous sont une reference technique amont conservee en anglais volontairement, pour eviter d'introduire des erreurs de traduction sur des noms d'API.

## Conventions de fichiers

Voir [file-conventions.md](./file-conventions.md) : structure, fichiers speciaux, segments dynamiques,
route groups, routes paralleles et interceptees, renommage `middleware` en `proxy` en v16.

## Frontieres RSC

Voir [rsc-boundaries.md](./rsc-boundaries.md) : detection des composants client async (invalide),
props non serialisables, cas des Server Actions.

## Patterns async

Voir [async-patterns.md](./async-patterns.md) : `params` et `searchParams` async, `cookies()` et
`headers()` async, codemod de migration.

## Choix du runtime

Voir [runtime-selection.md](./runtime-selection.md). Dans ce projet, tout est en runtime Node :
Prisma, `nodemailer` et l'adaptateur `pg` en dependent. Ne pas passer une route en Edge.

## Directives

Voir [directives.md](./directives.md) : `'use client'`, `'use server'`, `'use cache'`.

## Fonctions

Voir [functions.md](./functions.md) : hooks de navigation, fonctions serveur (`cookies`, `headers`,
`draftMode`, `after`), fonctions de generation (`generateStaticParams`, `generateMetadata`).

## Gestion d'erreur

Voir [error-handling.md](./error-handling.md) : `error.tsx`, `global-error.tsx`, `not-found.tsx`,
`redirect`, `notFound`, `forbidden`, `unauthorized`, `unstable_rethrow` dans les blocs catch.

## Patterns de donnees

Voir [data-patterns.md](./data-patterns.md) : Server Components contre Server Actions contre Route
Handlers, evitement des cascades (`Promise.all`, Suspense, preload), fetch cote client.

## Route handlers

Voir [route-handlers.md](./route-handlers.md) : bases de `route.ts`, conflit GET avec `page.tsx`,
comportement runtime, quand preferer une Server Action.

## Metadata et images OG

Voir [metadata.md](./metadata.md) : metadata statique et dynamique, `generateMetadata`, generation
d'images avec `next/og`, conventions de metadata par fichier.

## Optimisation des images

Voir [image.md](./image.md) : `next/image` plutot que `<img>`, images distantes, `sizes`,
placeholders, `priority` pour le LCP.

## Optimisation des fontes

Voir [font.md](./font.md). Attention : le DSFR embarque ses propres fontes via `react-dsfr`. Ne pas
ajouter un `next/font` qui entrerait en concurrence avec la typographie du systeme de design.

## Bundling

Voir [bundling.md](./bundling.md) : paquets incompatibles serveur, imports CSS, polyfills, soucis
ESM/CommonJS, analyse de bundle.

## Scripts

Voir [scripts.md](./scripts.md) : `next/script` contre balise native, `id` obligatoire sur les
scripts inline, strategies de chargement.

## Erreurs d'hydratation

Voir [hydration-error.md](./hydration-error.md) : causes courantes, debug via l'overlay, correctifs.

## Frontieres Suspense

Voir [suspense-boundaries.md](./suspense-boundaries.md) : bailout CSR avec `useSearchParams` et
`usePathname`, hooks qui exigent une frontiere.

## Routes paralleles et interceptees

Voir [parallel-routes.md](./parallel-routes.md) : modales avec `@slot` et `(.)`, `default.tsx`,
fermeture correcte via `router.back()`.

## Autohebergement

Voir [self-hosting.md](./self-hosting.md) : `output: 'standalone'`, cache handlers pour l'ISR
multi-instance, checklist de deploiement, endpoint de sante.

## Astuces de debug

Voir [debug-tricks.md](./debug-tricks.md) : endpoint MCP, rebuild cible avec `--debug-build-paths`.
