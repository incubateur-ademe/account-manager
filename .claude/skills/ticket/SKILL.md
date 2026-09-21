---
name: ticket
description: Avance un ticket de bout en bout en autonomie complete - choix, implementation, PR, review, merge. A invoquer avec un numero d'issue, ou sans argument pour prendre le prochain ticket. Mots-cles - ticket, issue, on passe a la suite, enchaine, autonomie.
---

# /ticket - Avancer un ticket en autonomie

Un seul tour de parole : l'utilisateur lance le skill, le skill rend un rapport final. Entre les
deux, tu decides, tu implementes, tu ouvres, tu reponds, tu merges. Ce qui se demande quand meme
tient aux trois cas de l'etape 3, et l'amendement a `docs/architecture.md` a son etape, la 6.

**Ce skill EST la demande explicite de commit, de push, de PR et de merge** que le `CLAUDE.md`
exige par ailleurs. Ne redemande pas l'autorisation a chaque etape.

## Le contrat

| Regle | Ce que ca veut dire |
|---|---|
| Autonomie complete | Tu vas jusqu'au merge. Les seules validations intermediaires sont les trois cas de l'etape 3, dont l'amendement a `docs/architecture.md`, solde a l'etape 6. |
| Au plus simple | La solution d'un dev senior presse : le moins de code possible, rien de malin. |
| Reutiliser d'abord | Avant d'ecrire, cherche ce qui existe deja. Composant, helper, hook, pattern, libelle. |
| Trouvailles annexes | Un bug croise en chemin se corrige dans la MEME PR. Ni ticket, ni note, ni « pour plus tard ». |
| Frugal sur les tests | Peu de tests, gros, au niveau le plus bas qui tienne la garantie. |
| UX et cohesion | Un ecran neuf ressemble aux autres. Meme vocabulaire, memes composants, memes gestes. |
| Rien a l'oeil | Ce que tu veux voir a un echelon et une commande. Aucun rapport ne sort sur un « a verifier visuellement ». |
| Silence pendant | Pas de narration intermediaire. Ta reflexion te suffit. |
| Rapport a la fin | Concis, en tableaux et puces. Avec les questions de l'etape 6, le seul texte que l'utilisateur lira. |

## 1. Choisir le ticket

Avec un numero en argument, c'est celui-la. Sinon :

```bash
gh issue list --state open --limit 30
```

Ordre de preference, du plus fort au plus faible :

1. Ce qui debloque un autre ticket ou une livraison.
2. Ce qui solde une reserve laissee par la PR precedente.
3. Le plus petit perimetre a valeur egale.
4. Le plus ancien.

Tranche seul. Ne demande que si deux candidats de gros perimetre sont a egalite stricte.

```bash
gh issue view <n> --json title,body,labels
```

Lis aussi l'issue de contexte qu'elle cite, l'ADR qui porte sur sa decision (`docs/adr/`), et le
plan du ticket s'il en a un (`docs/plans/`). Le plan porte la liste des amendements deja proposes
au document d'architecture, dont l'etape 6 a besoin.

## 2. Comprendre avant d'ecrire

- `docs/architecture.md` fait reference en cas de doute. **Il ne se modifie pas sans validation
  explicite de l'utilisateur.** Une question separe deux situations. Le document enonce-t-il une
  decision que ton lot enfreindrait, ou decrit-il un etat que ton lot change ? Une decision
  enfreinte, arrete-toi ici et demande, le defaut est dans le code jusqu'a preuve du contraire, et
  c'est le seul cas ou tu t'arretes avant d'ecrire. Une description que ton lot date, ou un point
  laisse ouvert qu'il referme, continue et solde l'amendement a l'etape 6.
- Navigue le code avec le tool `LSP` avant grep.
- Cherche le precedent : un ecran voisin, un connecteur voisin, un test voisin. Copie sa forme.

## 3. Decider seul

Avant toute `AskUserQuestion`, passe ces trois questions. Si les trois ont une reponse, tu ne
demandes pas.

1. **Le depot a-t-il deja tranche ?** ADR, `CLAUDE.md`, commentaire de code, PR precedente.
2. **Un des choix est-il clairement plus simple a valeur egale ?** Alors c'est lui.
3. **Le choix est-il reversible ?** Un nommage, un libelle, un seuil se changent. Tranche et avance.

Demander reste legitime pour : une decision produit qui engage le metier, une migration de donnees
irreversible, un amendement a `docs/architecture.md`. Le dernier a son moment et sa forme, a
l'etape 6.

## 4. Implementer

- Branche depuis `main`, nom en kebab-case francais descriptif, sans prefixe numerique.
- Tout en francais : code, commentaires, erreurs, tests, commits.
- **Par defaut aucun commentaire.** Seulement le POURQUOI non evident.
- Jamais de tiret cadratin ni demi-cadratin, nulle part.
- Un texte d'ecran dit quoi faire, jamais pourquoi la regle existe.
- Une reecriture ne promet jamais plus que l'originale. Mefie-toi des absolus que tu ajoutes.

Sur les tests, applique `/add-tests` : un test couvre un comportement de bout en bout, se lit en
Given / When / Then, porte plusieurs assertions. Pas de nuee de micro-tests.

**Si le lot touche un ecran, nomme le fichier qui le prouvera avant d'ecrire la premiere ligne.**
L'echelon se choisit ici. Choisi apres coup, il est toujours trop cher, et c'est ainsi qu'un lot
finit livre sur une promesse de regarder plus tard.

| Ce que tu veux voir | L'echelon | La commande |
|---|---|---|
| Une phrase d'ecran fausse, ou qui promet plus que le code | table de redaction | `pnpm test` |
| Un bouton qui part sur la mauvaise action, un champ mal nomme | test de composant, `@vitest-environment jsdom` en tete de fichier | `pnpm test` |
| Un ecran qui ne rend rien parce que sa requete est fausse | test d'integration | `POSTGRES_PORT=5433 pnpm test:integration` |
| Un ecran peuple qui deborde en 375, une ligne trop haute, une modale qui ne s'ouvre pas | releve visuel | `RELEVE_VISUEL=1 POSTGRES_PORT=5433 pnpm test:e2e` |
| Un cookie qui franchit une barriere, deux identites qui voient deux choses, un ecran qui s'hydrate | scenario `e2e/*.spec.ts` | `POSTGRES_PORT=5433 pnpm test:e2e` |
| Une collecte lancee depuis l'ecran, et ce que les ecrans en rendent | scenario `e2e/*.spec.ts`, referentiel double par `e2e/faux-espace-membre.ts` | `POSTGRES_PORT=5433 pnpm test:e2e` |

Douze fichiers montent deja de l'interface sans navigateur, et c'est la reponse dans la plupart des
cas. Un test de composant epingle spontanement ce qui se lit et presque rien de ce qui part : lis le
`FormData` que le DOM produit et espionne le double d'action.

Une collecte se joue pour de vrai, `e2e/collecte.spec.ts` en est le precedent. Le referentiel des
personnes est double en local, `ESPACE_MEMBRE_URL` etant la seule adresse amont que ce depot sait
pointer ailleurs sans toucher au code de production. Les trois connecteurs gardent leur hote en dur,
restent sans credential, se resolvent au tier `none`, et la collecte les saute en le disant. Ce qui
se prouve ainsi est le perimetre, les startups et les constats. Le transport d'un connecteur
appartient a son test de contrat.

Un scenario neuf dans `e2e/` est le dernier recours, et il se justifie dans la PR. Le semis est deja
ecrit. `semer(semerLesEcransPleins)` pose les ecrans pleins, `ouvrirUneSession(contexte, { username,
personId })` forge le cookie, et le serveur n'a aucun credential. Hors du referentiel double, aucune
adresse de cet environnement n'ecoute. Trois pieges.

- `getByRole("heading", { level: 1 })` attrape le mauvais titre, react-dsfr en injectant un par modale.
- Une plainte de React fait echouer le scenario, sauf `negative time stamp`, qui ne vient pas d'ici.
- Un seul fichier se joue avec `pnpm test:e2e e2e/<fichier>.spec.ts`, un seul scenario avec `-g`.

**Un ecran neuf entre dans `ECRANS` de `e2e/releve-visuel.spec.ts`.** `src/app/ecrans-releves.test.ts`
refuse sinon, et il refuse aussi une exclusion que plus aucun ecran ne justifie.

Prouve qu'un test neuf mord : casse le code qu'il couvre, vois-le echouer, remets. Une mutation
trop grossiere ne prouve rien.

## 5. Verifier

Lance `/verif`. Rien ne part tant qu'il n'est pas vert. Sa section 6 ne pose pas sa question ici,
la ligne « Trouvailles annexes » du contrat y a deja repondu. Il ne masque aucun echec, ne desactive
aucune regle, ne supprime aucun test. **Il ne rend aucun ecran.**

Des que le lot change ce qu'un ecran affiche, l'ecran lui-meme ou ce qu'il lit, lance le releve
visuel et fige ce qu'il montre :

```bash
RELEVE_VISUEL=1 POSTGRES_PORT=5433 pnpm test:e2e
```

Trois minutes et demie, toutes les routes ouvertes en 1440 et en 375 sur un semis plein. Il tient les
huit plafonds de `e2e/seuils-visuels.json` et rien de plus. Le lancer ne prouve pas qu'un ecran
montre la bonne chose, et ne solde donc pas l'assertion que l'echelon de l'etape 4 demandait.

Une commande qui ne peut pas tourner se repare, elle ne s'omet pas. La base dediee et le navigateur
se posent une fois, `CLAUDE.md` dit comment.

Playwright vide `test-results/` au lancement suivant : copie le rapport ailleurs avant de relancer
quoi que ce soit.

## 6. Solder les amendements a `docs/architecture.md`

Avant d'ouvrir la PR, parce qu'un amendement retenu part dans le meme lot que le code qui le rend
vrai.

**Un amendement se demande, il ne se reporte pas.** Ecrit en reserve, il n'a aucune date de
reprise. Le document continue alors de decrire ce que le code ne tient plus, et c'est lui qui fait
reference en cas de doute.

Ce qui entre ici est ce que **ton lot** a date ou a comble. Trois sources le portent deja. La
section « Les amendements a `docs/architecture.md` » du plan, les liens et les consequences de
l'ADR, et ce que tu as constate en ecrivant. Relis les trois, puis les sections du document que
ton diff touche. Ce qu'un plan propose sans que tu y touches reste ou c'est ecrit.

Un plan qui pose ses amendements « soumis, jamais appliques » decrit l'etat d'avant cette etape.
Un accord obtenu ici s'applique.

Le geste est une `AskUserQuestion`, un amendement par question, quatre au plus par appel. Les
appels se suivent jusqu'au dernier amendement, les descriptions devenues inexactes d'abord, et la
premiere question dit combien suivent. Aucun amendement ne reste hors des questions. Chaque
question porte la section visee, la phrase a reprendre et la formulation proposee. Trois options,
`Appliquer dans cette PR`, `Laisser ouvert` et `Reformuler`.

- L'outil ne rend que le libelle choisi. Une autre formulation n'arrive que par la reponse libre.
- Un accord vaut pour cette formulation et pour elle seule. Ecris-la dans `docs/architecture.md`
  ici meme, sans passer par `/sync-docs`, dont l'etape 2 rouvrirait la question tranchee.
- `Reformuler` sans texte ouvre un second appel, un seul, qui propose une formulation revue.
- Une question refusee se retente une fois, apres l'avoir dit.
- Part en reserve ce qui n'a pas ete retenu, un `Reformuler` reste sans texte, et une question
  refusee deux fois ou restee sans reponse. La reserve, c'est « Ce qui reste ouvert » de la
  description de PR et « Reste ouvert » du rapport, avec la raison quand elle a ete donnee.
- Aucun amendement : n'ouvre aucune question, et le rapport porte « sans objet ».

## 7. Ouvrir la PR

- Titre en Conventional Commits francais sans scope, verbe a l'infinitif et son objet, une
  cinquantaine de caracteres. **Il devient le message du squash sur `main`, il compte double.**
- Description selon `.github/pull_request_template.md`, le pourquoi avant le quoi, en puces.
- Le cheminement ne s'ecrit nulle part. Ce qui a ete essaye puis abandonne n'apprend rien.
- Les deux endroits qui meritent d'etre longs : ce qui n'a pas ete verifie, et ce qui reste ouvert.
- **Aucun trailer `Claude-Session`, aucun `Co-Authored-By`, aucune mention "Generated with Claude
  Code".**
- Ferme l'issue avec un mot-cle anglais (`Closes #n`), le francais ne ferme rien.
- `gh pr create --body-file -` pour passer la description sur l'entree standard. `--body -` publie
  un tiret.

Si le lot a modifie la doc ou la memoire hors `docs/architecture.md`, passe par `/sync-docs`.
Un amendement retenu a l'etape 6 s'ecrit dans « Les decisions qui meritent une relecture », avec sa
section et la formulation validee.

## 8. Attendre la review et repondre

Applique `/check-review-pr`, dont le resume intermediaire reste interne ici : rien ne s'affiche
avant le rapport final. En plus :

- **Attends un verdict, jamais l'absence d'attente.** Un relecteur automatique peut etre saute, en
  pause ou a court de quota, et il ne rattrape pas le commit manque.
- Ne poste jamais de commentaire general de ta propre initiative. Seulement des reponses dans les
  threads.
- Ne mentionne jamais de bot relecteur, ni par `@`, ni par son nom.
- Une remarque juste se corrige dans la foulee, puis `/verif`, puis tu reponds et tu resous le
  thread. Une remarque fausse se refute avec la preuve, poliment, sans la corriger.
- Une correction qui date une phrase de `docs/architecture.md` rouvre l'etape 6 avant le merge.
- Les remarques « Outside diff range » ne sont dans aucune liste de threads, seulement dans le
  corps de la review. Va les chercher.

Boucle jusqu'a ce que tous les threads soient resolus et la CI verte.

## 9. Merger

Quand la CI est verte et qu'aucun thread n'est ouvert :

```bash
gh pr merge --squash --delete-branch
```

Puis reviens sur `main` et `git pull`.

Si le merge est refuse (protection, review humaine requise, conflit), ne force rien : dis-le dans
le rapport avec ce qui manque.

## Rapport final

Avec les questions de l'etape 6, le seul texte que l'utilisateur lit. Concis, factuel, en tableaux
et puces.

```
## <n> - <titre du ticket>

| | |
|---|---|
| PR | <url> |
| Etat | merge | en attente de <quoi> | bloque |
| Verif | lint PASS, types PASS, tests N/N, build PASS |
| Navigateur | releve visuel N ecrans, plafonds tenus, ou « sans objet, aucun ecran touche » |

### Ce qui change
- <une puce par changement, du point de vue de qui s'en sert>

### Trouvailles corrigees en chemin
- <une puce par bug annexe corrige dans la PR, ou « aucune »>

### Amendements a `docs/architecture.md`
- <une puce par amendement : la section visee, le verdict, applique ou mis en reserve. Ou
  « sans objet ».>

### Reste ouvert
- <ce qui attend une decision, ou « rien ». Jamais un ecran que personne n'a regarde, jamais un
  amendement au document d'architecture qu'aucune question n'a porte.>
```

Pas de recit, pas de narration des etapes, pas de liste de commandes lancees.

## Regles dures

- Ne declare jamais terminee une tache dont la verification n'est pas verte.
- Ne presente jamais une couverture partielle comme exhaustive.
- Ne modifie pas `docs/architecture.md` sans validation explicite.
- Ne mets pas en reserve un amendement a `docs/architecture.md` sans avoir pose la question, qu'il
  vienne de l'ecriture ou d'une correction de review.
- Ne merge pas une PR dont un thread reste ouvert.
- Ne laisse pas un serveur ou un processus de test tourner derriere toi.
- Ne rends jamais un rapport qui reporte une verification a l'oeil humain. Chaque ligne du tableau
  de l'etape 4 porte une commande. La ligne `Navigateur` du rapport n'a pas de valeur « non joue ».

Ce qu'un controle tient, et ce qui n'en a pas. `src/app/ecrans-releves.test.ts` refuse un ecran
qu'aucun releve n'ouvre, et il tourne dans `pnpm verify`. Rien ne verifie que tu as lance le releve,
ni que ton scenario assertait la bonne chose, ni que tu as pose les questions de l'etape 6. Ces
trois-la tiennent a la relecture, et a elle seule.
