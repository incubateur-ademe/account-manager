---
name: sync-docs
description: Synchronise la documentation (docs/architecture.md, CLAUDE.md, README, ADR, memoire) avec ce qui a ete implemente dans la session. Chaque modification est proposee avant d'etre appliquee.
---

# /sync-docs - Synchronisation de la documentation

## Quand l'invoquer

- En fin de session, apres les commits techniques, avant de fermer.
- Quand une decision de conception a ete prise ou revisee pendant la session.
- Pas pour un micro-changement sans impact documentaire. En cas de doute, lance-le.

## Hierarchie documentaire de ce projet

| Document | Role | Qui le fait bouger |
|---|---|---|
| `docs/architecture.md` | **La reference de conception.** Forme du systeme, objets metier, contrat de connecteur, invariants. Fait foi en cas de doute. | uniquement une decision explicitement validee par l'utilisateur |
| `CLAUDE.md` | Le condense operationnel pour l'agent : stack, commandes, invariants, regles. Pas de duplication de `docs/architecture.md`, un renvoi suffit. | changement de stack, de commande, de regle |
| `README.md` | L'onboarding humain : demarrage, commandes, invariants en trois lignes. | changement de prerequis ou de commande |
| ADR (`docs/adr/`) | Trace d'une decision structurante avec ses alternatives. Le repertoire n'existe pas encore, le creer au premier ADR. | decision architecturale nouvelle |
| memoire Claude | Apprentissages personnels et contextuels, non partageables. | gotcha, preference utilisateur |

**Regle centrale** : `docs/architecture.md` n'est pas un journal. On ne le modifie pas parce qu'on a
code quelque chose, on le modifie parce qu'une decision a change. Si l'implementation s'ecarte du
document, le defaut est dans l'implementation jusqu'a preuve du contraire, et c'est ca qu'il faut
remonter a l'utilisateur.

## Etapes

### 1. Analyse des changements

```bash
git diff main --name-only
git log main..HEAD --oneline
```

Resume ce qui a change : nouvelles capacites, nouveaux connecteurs, nouvelles regles, nouvelles
variables d'environnement, nouveaux scripts pnpm, changements de schema Prisma.

### 2. Detection de derive avec `docs/architecture.md`

Avant de toucher quoi que ce soit, verifie la coherence dans ce sens :

- Le code a-t-il introduit un comportement que le document interdit ou ne prevoit pas ?
- Un invariant des sections 4.6 et 4.7 est-il contourne ?
- Le catalogue de la section 4.9 est-il toujours exact (tiers vises, systemes) ?
- Un point de la section 6 "Ce qui reste a trancher" a-t-il ete tranche dans la session ?

Chaque derive detectee se presente a l'utilisateur avec deux issues possibles : corriger le code, ou
mettre a jour le document. **Ne choisis pas seul.**

### 3. CLAUDE.md

Verifie section par section :

- **Stack** : versions reellement installees (`package.json`), pas celles qu'on croit.
- **Commandes** : chaque commande citee existe-t-elle dans `scripts` de `package.json` ?
- **Variables d'environnement** : `src/lib/env.ts` fait foi, la liste doit correspondre exactement.
- **Invariants** : une nouvelle contrainte non negociable a-t-elle emerge ?
- **Structure** : nouveaux repertoires significatifs sous `src/`.

Le CLAUDE.md doit rester **court et dense**. Si une section grossit au point de raconter la
conception, c'est qu'elle appartient a `docs/architecture.md` avec un simple renvoi depuis CLAUDE.md.

Lance le skill global `/claude-md-management:revise-claude-md` s'il est disponible, avec un resume des
apprentissages de la session.

### 4. README.md

Ne modifier que ce qui est factuellement incorrect ou manquant :

- Stack et versions.
- Bloc de demarrage (prerequis, commandes d'install).
- Tableau des commandes.
- Section Invariants : elle resume, elle ne detaille pas.

Ne change ni le style ni la mise en forme existante.

### 5. Variables d'environnement

`src/lib/env.ts` est la source de verite. Verifie que toute variable qu'il attend est documentee dans
le `.env.example` et dans le README.

Le hook anti-`.env` autorise `.env.example` et `.env.dist` precisement pour ca. Il bloque `.env`,
`.env.local` et consorts : ne cherche pas a les lire pour "verifier", la comparaison se fait contre le
schema Zod, pas contre les valeurs reelles. **Aucune valeur reelle de secret ne doit jamais apparaitre
dans un fichier versionne**, y compris a titre d'exemple : mettre une forme, pas une valeur.

### 6. ADR

Un ADR est justifie si une **decision architecturale structurante** a ete prise, qu'elle affecte
durablement la structure du code, et qu'il existait des alternatives.

Un ADR n'est PAS justifie pour : une feature CRUD, un bugfix, un refactoring mineur, un choix de
nommage.

Cas typiques dans ce projet qui en meritent un : ajouter une dependance runtime, changer le mode de
stockage d'un credential (`env` contre `fgp`), introduire un worker ou une file (le socle n'en a pas,
c'est une decision de la section 1.1), changer le pivot d'identite, assouplir un invariant de
collecte ou d'execution.

Si justifie :

1. Creer `docs/adr/` s'il n'existe pas, puis numeroter sequentiellement :
   ```bash
   ls docs/adr/*.md 2>/dev/null | sort | tail -1
   ```
2. Rediger en francais : Contexte, Decision, Options envisagees, Consequences, Liens.
3. Date du jour, statut `Accepted`.
4. Presenter le contenu et **attendre validation** avant de creer le fichier.

Le skill `/architecture-decision` fournit le cadre d'evaluation et le gabarit.

### 7. Memoire

Si la session a produit un apprentissage durable (contrainte cachee, gotcha d'une API amont,
preference utilisateur), l'ajouter a la memoire du projet. Compare avec `CLAUDE.md` :

- **Doublon** : retirer de la memoire, `CLAUDE.md` fait foi car il est partage avec l'equipe.
- **Perime** : supprimer.
- **Partageable** : proposer de le remonter dans `CLAUDE.md`.

MEMORY.md doit rester sous 200 lignes.

## Rapport attendu

```
## /sync-docs - session du <date>

Diff analyse : <N commits>, <M fichiers>

Derive vs docs/architecture.md : <aucune | liste des points + issue proposee>

| Document | Action |
|---|---|
| docs/architecture.md | Modifie (section X) / Inchange |
| CLAUDE.md | Modifie (section X) / Inchange |
| README.md | Modifie / Inchange |
| .env.example | Modifie / Inchange |
| ADR | Cree (numero + titre) / Aucun |
| Memoire | N entrees / Inchange |
```

## Regles dures

- **`docs/architecture.md` ne se modifie pas sans validation explicite de l'utilisateur.**
- **Pas d'ADR redige sans validation.** On propose, on ne redige pas seul.
- **Aucun secret dans un fichier versionne**, pas meme une valeur d'exemple realiste.
- **Pas de duplication** entre `CLAUDE.md` et `docs/architecture.md`. Un renvoi, pas un copier-coller
  qui divergera.
