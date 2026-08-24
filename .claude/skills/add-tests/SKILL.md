---
name: add-tests
description: Ajoute des tests Vitest pour la feature de la session courante. Peu de tests mais des gros - BDD ou grosse integration, jamais une nuee de micro-tests unitaires. Propose les scenarios, attend validation, implemente, puis lance /verif.
---

# /add-tests - Ajout de tests

## Regle non negociable

> **Peu de tests, mais des gros. Soit du BDD, soit de gros tests d'integration.
> Ne jamais produire une tonne de petits tests unitaires.**

C'est la regle de l'utilisateur, elle prime sur toute habitude par defaut. Concretement :

- Un test couvre un **comportement metier complet** de bout en bout, pas une fonction isolee.
- Il se lit comme une histoire : etat initial, action, resultat observable. Given / When / Then.
- Plusieurs assertions dans un meme test sont normales et souhaitables : c'est le scenario qui est
  l'unite, pas l'assertion.
- **Signaux d'alerte** : un fichier de test avec quinze `it()` de trois lignes chacun, un test par
  branche de `if`, un test qui verifie qu'un getter retourne ce qu'on lui a mis. Tout ca se supprime
  ou se fusionne.
- Un helper pur et trivial ne merite pas son test dedie. Il est couvert par le scenario qui
  l'utilise. On teste ce qui casse et ce qui coute cher quand ca casse.

Ordre de grandeur vise : cinq a dix scenarios costauds pour une feature, pas cinquante micro-cas.

## Ce qui merite un test dans ce projet

Priorise par le cout d'une regression, pas par la facilite a tester :

| Perimetre | Ce qu'on teste | Pourquoi |
|---|---|---|
| `src/core/connector.ts` | resolution du tier effectif, degradation, `none` par absence de voie | c'est le contrat auquel tous les connecteurs se conforment |
| Connecteurs (`list`, `plan`, `precheck`, `execute`) | un run complet contre des reponses distantes figees, y compris pagination tronquee et erreur unitaire | un `ok` menteur produit de fausses revocations |
| Calcul d'ecart et de plan | du perimetre + collecte jusqu'aux steps figes, avec l'empreinte | c'est ce que l'operateur confirme |
| Rapprochement d'identite | `matchMethod`, `personId` nul, compte isole | une identite forcee vers une personne coupe l'acces de quelqu'un en poste |
| Machine a etats `AccessCase` et `Plan` | transitions valides et invalides, `graceDays`, expiration | un depart deduit d'un seul signal est un bug grave |
| Audit | l'evenement est ecrit avant l'action, et une panne d'audit ne fait pas echouer l'action | invariant du produit |
| `ACTIONS_ENABLED=false` | un plan complet s'execute en simulation sans aucun appel d'ecriture | garde-fou principal |
| Tests de contrat de connecteur | la forme de la reponse distante n'a pas change (section 4.8 de `docs/architecture.md`) | les API amont ne sont ni versionnees ni documentees |

Ce qui ne merite generalement **pas** de test dedie : les composants DSFR de presentation, les
mappers triviaux, le typage (le compilateur s'en charge), les getters et setters.

## Etapes

### 1. Analyse de la session

```bash
git diff main --name-only
git log main..HEAD --oneline
```

Pour chaque fichier touche, determine ce qui a change **semantiquement** : nouveau comportement,
nouvelle transition d'etat, nouvelle voie d'erreur. Pas "quelles fonctions ont bouge".

### 2. Redaction des scenarios

Ecris-les en Given / When / Then avant tout code :

```
Scenario : un run de collecte partiel ne fait rien disparaitre
  Given une identite deja connue sur le provider notion
  And une collecte qui remonte status "partial" avec une erreur de pagination
  When le socle applique le resultat
  Then vanishedAt reste nul sur l'identite
  And le SyncRun est enregistre en PARTIAL avec son erreur
```

Un scenario par comportement observable, pas par fonction appelee. Couvre le chemin nominal **et** le
chemin de degradation le plus couteux. Les cas limites qui ne changent pas la decision metier ne
meritent pas leur scenario.

### 3. Validation utilisateur avant implementation

Presente la liste et **attends la confirmation explicite** avant d'ecrire une ligne de test :

```
## Scenarios proposes pour <feature>

1. <titre> - <une ligne>
2. <titre> - <une ligne>
...

Total : N scenarios.
Ecarte volontairement : <ce que tu as decide de ne pas tester, et pourquoi>
```

La section "ecarte volontairement" n'est pas optionnelle : c'est la ou se verifie que la regle
"peu de tests mais des gros" a ete appliquee.

### 4. Implementation

- Emplacement : `src/**/<nom>.test.ts`, a cote du code teste. C'est le pattern de `vitest.config.ts`
  (`include: ["src/**/*.test.ts"]`) et l'existant (`src/core/connector.test.ts`).
- Alias `@/` disponible, il est declare dans `vitest.config.ts`.
- Imports explicites de `describe`, `it`, `expect`, `vi` depuis `vitest` : les globals ne sont **pas**
  actives dans ce projet.
- Nommage : `it("un run partiel ne fait rien disparaitre", ...)`. Une phrase francaise qui decrit le
  comportement, lisible dans le rapport de run.
- Assertions precises (`toBe`, `toEqual`, `toMatchObject`) plutot que vagues (`toBeTruthy`).
- Pour les appels distants, fige des reponses realistes en fixture plutot que de mocker la fonction
  qui les appelle. On veut tester le parsing et la gestion d'erreur, pas le mock.
- Pas de test qui touche la vraie base ni un vrai systeme cible. Si un scenario l'exige, remonte-le a
  l'utilisateur au lieu de l'improviser.

### 5. Verification

```bash
pnpm test
```

Puis lance `/verif` pour la passe complete.

## Rapport attendu

```
## /add-tests - <feature>

Scenarios valides   : N
Fichiers crees      : <liste>
Couvert             : <les comportements, en une ligne chacun>
Ecarte volontairement : <liste + raison>
pnpm test           : PASS | FAIL (detail)
/verif              : PASS | FAIL
```

## Regles dures

- **Scenarios valides avant code.** Jamais d'implementation sans go-ahead utilisateur sur la liste.
- **Peu de tests, mais des gros.** Si tu te retrouves a ecrire un dixieme `it()` de quatre lignes,
  arrete-toi : tu es en train de violer la regle, fusionne.
- **Ne teste pas le mock.** Si le test passerait meme avec l'implementation supprimee, il ne sert a
  rien.
- **Un test rouge ne se skip pas.** Il se comprend, puis soit le test soit le code se corrige.
