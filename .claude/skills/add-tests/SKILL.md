---
name: add-tests
description: Ajoute des tests pour la feature de la session courante, à l'étage le plus bas qui sache tenir la garantie. Peu de tests mais des gros. Propose les scénarios, attend validation, implémente, prouve par mutation, puis lance /verif.
---

# /add-tests - Ajout de tests

## Les deux règles, dans cet ordre

> **1. Chaque garantie se tient à l'étage le plus bas qui sache la tenir.**
>
> **2. Peu de tests, mais des gros. Jamais une nuée de micro-tests.**

La seconde est ancienne et n'a pas bougé. La première la précède : avant de se demander comment
écrire un test, il faut se demander où. Un test placé trop haut est plus lent, plus fragile, et
moins précis dans ce qu'il dit quand il casse.

## Étape 0 : à quel étage ?

**Cette étape passe avant toutes les autres.** Elle se tranche garantie par garantie, pas fichier par
fichier : une même feature en pose souvent à deux étages.

Pose-toi les questions dans cet ordre, et arrête-toi à la première qui répond oui.

**La garantie tient-elle sans base, sans serveur et sans navigateur ?** Alors c'est de l'**unitaire**,
`src/**/<nom>.test.ts`. C'est le cas de toute logique de décision, de toute machine à états, et de
tout texte d'écran extrait dans une table de rédaction. Une phrase qu'un écran promet s'épingle ici
en trois secondes ; la vérifier dans un navigateur coûte mille fois plus pour la même garantie.

**Dépend-elle d'une requête réellement exécutée ?** Alors c'est de l'**intégration**,
`src/**/<nom>.integration.test.ts`. Un `where` avec plusieurs clauses, un `orderBy` qui décide du
résultat, un compte à travers une relation, un index unique posé à la main dans une migration, une
cascade de suppression, un aller-retour JSON dans une colonne. Voir le signal d'alerte ci-dessous.

**Dépend-elle du cookie, de la barrière, de la séparation des droits, ou de l'hydratation ?** Alors
c'est du **bout en bout**, `e2e/*.spec.ts`. Et seulement ça : cet étage ne tourne pas dans la
vérification continue, chaque ajout se paie en minutes et en fragilité.

**En cas de doute, descends.** Un test qu'on découvre trop bas se remonte facilement. L'inverse coûte
une suite qu'on ne croit plus.

### Le signal d'alerte qui dit « intégration »

Tu écris un test unitaire, tu doubles `@/lib/db`, et tu te retrouves à **réécrire la condition** que
le code passe à Prisma : tu filtres `vanishedAt === null` à la main parce que la vraie requête le
fait, tu tries la liste parce qu'il y a un `orderBy`, tu rends un nombre choisi parce qu'il y a un
`count`.

**Arrête-toi. Le test que tu écris ne prouvera rien.** Il vérifiera que tu as écrit le double comme
tu as écrit le code. Retire la clause du code de production : ton test restera vert.

Ce dépôt en porte deux exemples. Le double de `externalIdentity.count`, dans
`src/lib/sync/collecte.test.ts`, type son argument comme `{ where: { provider } }` et refiltre
`vanishedAt === null` de sa propre main : retire cette clause de la requête de production, le test
reste vert, et la collecte se met à compter les partis parmi les vivants. Et
`ressourcesTenuesPourVivantes` compte à travers `grants: { some: { vanishedAt: null } }` : un double
qui réimplémenterait cette jointure vérifierait sa propre jointure, ce qui est le contraire d'un
test.

Un double reste légitime quand il rend une valeur dont le contenu ne décide de rien dans le
scénario. Il devient un mensonge quand la condition qu'il reçoit décide du résultat attendu.

## Ce qui mérite un test dans ce projet

Priorise par le coût d'une régression, pas par la facilité à tester.

| Périmètre | Ce qu'on teste | Étage |
|---|---|---|
| `src/core/connector.ts` | résolution du tier effectif, dégradation, `none` par absence de voie | unitaire |
| Connecteurs (`list`, `plan`, `precheck`, `execute`) | un run complet contre des réponses figées, pagination tronquée et erreur unitaire comprises | unitaire |
| Calcul d'écart et de plan | du périmètre jusqu'aux étapes figées, avec l'empreinte | unitaire |
| Rapprochement d'identité | `matchMethod`, `personId` nul, compte isolé | unitaire |
| Machines à états `AccessCase` et `Plan` | transitions valides et invalides, `graceDays`, expiration | unitaire |
| Textes d'écran extraits en table | ce que la phrase promet, et qu'elle ne promet pas plus que le code ne tient | unitaire |
| Audit | la trace précède l'action, et sa panne ne fait pas échouer l'action | unitaire |
| `ACTIONS_ENABLED=false` | un plan complet s'exécute en simulation sans aucun appel d'écriture | unitaire |
| Garde-fous de chute, datation des disparitions | les comptes de référence et les clauses de vie des écritures | **intégration** |
| Index uniques et partiels posés à la main en migration | la base refuse vraiment, et le code traduit son refus | **intégration** |
| Lectures dont l'`orderBy`, le `distinct` ou une relation décide | le plan courant, le dernier relevé complet, les droits vivants | **intégration** |
| Barrière de session, séparation opérateur et participant, hydratation | le câblage, du cookie au bouton | **bout en bout** |

Ne méritent généralement pas de test dédié : les composants de présentation, les mappers triviaux, le
typage (le compilateur s'en charge), les accesseurs.

## Étapes

### 1. Analyse de la session

```bash
git diff main --name-only
git log main..HEAD --oneline
```

Pour chaque fichier touché, détermine ce qui a changé **sémantiquement** : nouveau comportement,
nouvelle transition, nouvelle voie d'erreur. Pas « quelles fonctions ont bougé ».

### 2. Rédaction des scénarios

En Given / When / Then, avant tout code, et **chacun annoté de son étage**.

```
Scénario : un passage qui perd la moitié du parc ne date personne   [intégration]
  Given quatre comptes vivants et six départs déjà datés
  When une collecte n'en rend que deux
  Then aucune disparition n'est datée
  And les six départs portent toujours leur date d'origine
  Pourquoi pas plus bas : la référence vient d'un `count` avec clause de vie,
  et la datation d'un `updateMany` dont le `notIn` est le seul garde.
```

La ligne **« pourquoi pas plus bas »** est obligatoire dès qu'un scénario sort de l'unitaire. Si tu
n'arrives pas à l'écrire, le scénario descend d'un étage.

Couvre le chemin nominal **et** la dégradation la plus coûteuse. Un cas limite qui ne change aucune
décision métier ne mérite pas son scénario.

### 3. Validation utilisateur avant implémentation

Présente la liste et **attends la confirmation explicite** avant d'écrire une ligne.

```
## Scénarios proposés pour <feature>

Unitaire     : N
Intégration  : N   (chacun avec son « pourquoi pas plus bas »)
Bout en bout : N   (idem, et il en faut une très bonne raison)

1. <titre> [étage] - <une ligne>
...

Écarté volontairement : <ce que tu ne testes pas, et pourquoi>
Descendu d'un étage   : <ce que tu pensais mettre plus haut, et ce qui l'a fait descendre>
```

Les deux dernières sections ne sont pas optionnelles : c'est là que se vérifie que les deux règles
ont été appliquées.

### 4. Implémentation

Communes aux trois étages :

- Imports explicites de `describe`, `it`, `expect`, `vi` depuis `vitest` : les globals ne sont **pas**
  activés.
- Alias `@/` vers `src/`.
- Noms de scénarios : une phrase française qui décrit le comportement, lisible dans le rapport.
- Assertions précises (`toBe`, `toEqual`, `toMatchObject`) plutôt que vagues (`toBeTruthy`).
- Jamais de tiret cadratin ni demi-cadratin.

**Unitaire.** À côté du code. Pour les appels distants, fige des réponses réalistes plutôt que de
doubler la fonction qui les appelle : on teste le parsing et la gestion d'erreur, pas le double. Le
passage de mise en place pose des adresses mortes : un double oublié échoue tout de suite.

**Intégration.** Sème dans un `beforeEach`, rien d'autre : la remise à zéro et la fermeture de la
connexion sont posées par le passage de mise en place. Le client est celui de l'application, pour
exercer le même chemin que le produit. Sème le moins possible : un scénario qui demande quinze tables
est un scénario perdu d'avance. La base se crée une fois, voir `CLAUDE.md`.

**Bout en bout.** Dans `e2e/`, jamais sous `src/`. Nomme les éléments par leur rôle et leur nom
accessible, jamais par un sélecteur CSS ni par `locator("h1")` : le système de design pose ses
propres titres. Prouve l'hydratation par un composant de l'application qui répond, pas par un texte
présent.

### 5. Prouver par mutation

**Un test qui n'a jamais été vu rouge ne prouve rien.** Avant de déclarer terminé :

1. Sauvegarde le fichier de production visé.
2. Casse la garantie, une seule à la fois : retire la clause, inverse la condition, supprime la
   garde.
3. Joue le test, et vérifie qu'il rougit **sur l'assertion attendue** et pas sur autre chose.
4. Restaure depuis la sauvegarde, et vérifie que le fichier est identique.
5. Rejoue : vert.

Une mutation qui laisse le test vert est un résultat, pas un échec : soit le test ne prouve rien et
il faut le renforcer, soit la garantie est tenue à un autre étage, et il faut aller le vérifier
plutôt que de le supposer.

### 6. Vérification

```bash
pnpm test                              # unitaire
pnpm test:integration                  # si un scénario y a été ajouté
pnpm test:e2e                          # idem, et seulement dans ce cas
```

Puis `/verif` pour la passe complète.

## Rapport attendu

```
## /add-tests - <feature>

Scénarios validés     : N unitaires, N intégration, N bout en bout
Fichiers créés        : <liste>
Couvert               : <les comportements, une ligne chacun>
Écarté volontairement : <liste + raison>
Descendu d'un étage   : <liste + ce qui l'a fait descendre>
Mutations jouées      : <mutation → rouge obtenu, une ligne chacune>
pnpm test             : PASS | FAIL (détail)
/verif                : PASS | FAIL
```

## Règles dures

- **L'étage avant le test.** Un scénario hors de l'unitaire sans son « pourquoi pas plus bas » ne
  s'écrit pas, et le doute fait descendre.
- **Ne double jamais une condition que le test vérifie.** Si le double rejoue le `where`, le scénario
  monte d'un étage.
- **Aucun test n'est terminé avant d'avoir été vu rouge.**
- **Un scénario de bout en bout instable se supprime**, il ne se rejoue pas en `retry`.
