---
name: check-review-pr
description: Lit les reviews et commentaires de la PR courante, evalue leur pertinence, applique les fixes justifies, lance /verif, repond et resout les threads. Ne mentionne JAMAIS de bot reviewer.
---

# /check-review-pr - Revue des commentaires de PR

## Quand l'invoquer

- Quand une PR ouverte a recu des commentaires, humains ou bots.
- Pas pour ouvrir une PR : c'est un workflow git classique, hors de ce skill.

## 1. Identifier la PR

```bash
gh pr view --json number,title,url,state,headRefName,reviewDecision
```

Si aucune PR n'est associee a la branche courante, arrete et informe l'utilisateur.

## 2. Recuperer les commentaires

```bash
gh pr view --json reviews,comments
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
gh api repos/{owner}/{repo}/issues/{number}/comments
```

Classe par type : commentaires inline sur du code (priorite haute), commentaires generaux de
discussion, verdicts de review (`approved`, `changes_requested`, `commented`).

## 3. Analyser chaque commentaire

Pour chacun :

1. **Contexte** : lis le fichier et les lignes concernees. Ne juge jamais sur le seul texte du
   commentaire.
2. **Pertinence** : bug reel, amelioration justifiee, convention du projet ? Ou preference
   stylistique, malentendu, cas deja gere ailleurs ?
3. **Conflit avec une regle du projet** : si le commentaire demande quelque chose qui viole un
   invariant de `CLAUDE.md` ou de `docs/architecture.md`, ne l'applique pas. Reponds en citant la
   regle. Si la regle elle-meme merite d'etre rediscutee, remonte-le a l'utilisateur, ne tranche pas
   seul.
4. **Suggestion de code** (blocs `suggestion` GitHub) : extrais le diff propose et evalue-le comme le
   reste. Une suggestion appliquable en un clic n'est pas une suggestion correcte.

Classification :

| Categorie | Action |
|---|---|
| **Bloquant** : bug, faille, violation d'invariant, regression | fix obligatoire avant merge |
| **Pertinent** : amelioration claire, dette evitable | fix recommande, a proposer si non trivial |
| **Discutable** : preference stylistique, alternative raisonnable | discuter, pas de fix automatique |
| **Non pertinent** : faux positif, hors scope, incomprehension | reply explicatif, pas de fix |

Pour un commentaire d'outil d'IA (Copilot, CodeRabbit) : evalue-le sur le fond exactement comme un
commentaire humain, sans deference ni mepris. Ces outils produisent du volume ; filtrer agressivement
en "non pertinent" est legitime et attendu.

## 4. Appliquer les corrections

Pour chaque commentaire classe bloquant ou pertinent :

1. Applique la correction.
2. Verifie qu'elle ne casse rien dans le contexte environnant.
3. Note ce qui a ete fait.

Ne corrige **pas** les commentaires classes discutables ou non pertinents sans validation explicite de
l'utilisateur.

## 5. Resume intermediaire

Avant la verification, presente :

- Pour chaque commentaire : auteur, `fichier:ligne`, resume, verdict, justification.
- Pour les discutables : propose une ou plusieurs implementations et **demande une decision**.
- Statistiques : total, corriges, en attente de decision, ignores.

## 6. Verification

Lance `/verif`. Les corrections de review sont le terrain favori des regressions silencieuses.

## 7. Repondre et resoudre les threads

Format de reponse selon la categorie :

- **Fix applique** : "Corrige dans `<sha>`. `<description courte du changement>`."
- **Discussion** : l'argument ou la question. **Ne pas resoudre** le thread, attendre la suite.
- **Decline** : la raison, factuelle et concise, avec le renvoi vers `docs/architecture.md` ou l'ADR
  concerne s'il y en a un.

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{id}/replies -f body="<message>"
```

Une reponse REST ne resout pas le thread. La resolution passe par GraphQL :

```bash
gh api graphql -f query='{
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: NUMBER) {
      reviewThreads(first: 50) { nodes { id isResolved } }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id'

gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { isResolved } } }'
```

Ne resoudre que les threads dont le fix est applique et confirme, ou dont la declinaison est
argumentee.

## 8. Push

Demande a l'utilisateur avant de pousser. Ne pousse jamais sans son go explicite.

## Regles dures

- **Ne JAMAIS mentionner `@copilot-pull-request-reviewer`** ni aucun bot reviewer dans un commentaire.
  Le tagger declenche la creation de PR parasites et des boucles de review. Repondre au thread sans
  aucune `@mention`.
- **Ne jamais appliquer un fix qui viole un invariant du projet** pour faire plaisir a un reviewer.
  Repondre en citant la regle.
- **Pas de `--force-push`** sans validation utilisateur explicite : ca casse les threads existants.
- **Ne pas commit sur la branche d'un autre auteur** sans delegation explicite.
- **Aucun secret dans une reponse de thread.** Les commentaires de PR sont publics sur un depot
  public : ni valeur d'environnement, ni fragment de token, ni URL signee.

## Rapport attendu

```
## /check-review-pr - PR #<numero>

Commentaires examines : N
- Bloquants     : N (corriges : N, a discuter : N)
- Pertinents    : N (corriges : N, a discuter : N)
- Discutables   : N (en discussion)
- Non pertinents: N (declines)

Threads resolus  : N
Threads ouverts  : N (en attente de decision utilisateur)
/verif           : PASS | FAIL

Statut PR : prete a re-review | encore en discussion
```
