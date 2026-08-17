---
name: architecture-decision
description: "Evalue une decision d'architecture, documente les arbitrages, choisit un pattern adapte au contexte et redige l'ADR. A utiliser pour un choix technique structurant, un ADR, une evaluation d'alternatives ou une dette technique. Mots-cles : architecture, ADR, pattern, arbitrage, dette technique, decision."
license: MIT
metadata:
  author: jwynia
  adapte-par: incubateur-ademe-account-manager
  version: "1.1"
  type: diagnostic
---

# Decision d'architecture

Evaluer une decision d'architecture, expliciter les arbitrages, choisir un pattern adapte au contexte,
et produire un ADR.

## Quand l'utiliser

- Choix technique structurant (nouvelle dependance runtime, nouveau mecanisme de stockage, nouveau
  mode d'execution).
- Evaluation d'alternatives avec des consequences durables sur la structure du code.
- Redaction d'un ADR.
- Constat de dette technique a arbitrer.

**Ne pas** l'utiliser pour ecrire du code d'implementation, pour un bugfix, ou pour un refactoring
mineur.

## Principe directeur

**C'est le contexte qui decide.** Aucun pattern n'est bon ou mauvais dans l'absolu. La bonne
architecture n'est pas la plus elegante, c'est celle qui sert le mieux son objet tout en restant
maintenable et modifiable.

### Le contexte de ce projet, a garder en tete a chaque arbitrage

- Environ 95 personnes, 19 startups d'Etat, **un mainteneur a temps partiel**.
- Outil sollicite serieusement deux fois par an, avec de longs creux d'inactivite.
- La valeur est proportionnelle au **nombre de systemes couverts**, pas a la finesse avec laquelle on
  en traite un. Un systeme couvert a la main dans l'outil vaut mieux qu'un systeme absent de l'outil.
- Le socle est deliberement pauvre : une application Next, un Postgres, une CLI de collecte en
  conteneur one-off. Pas de worker permanent, pas de file de messages.

Consequence pratique : le biais par defaut penche vers **moins de pieces mobiles**. Toute proposition
qui ajoute un composant a exploiter doit payer son cout d'exploitation en face d'un mainteneur a temps
partiel, pas en face d'une equipe.

`docs/architecture.md` a deja tranche un certain nombre de ces questions avec leurs raisons. **Lis-le
avant de proposer quoi que ce soit.** Rouvrir une decision qui y figure est legitime, mais ca se fait
en argumentant contre la raison ecrite, pas en l'ignorant.

## Le triangle d'arbitrage

| Sommet | Maximise par | Cout |
|---|---|---|
| **Simplicite** | monolithe, appels synchrones, une seule base | plafond de montee en charge |
| **Flexibilite** | services separes, evenementiel, plugins | complexite d'exploitation |
| **Performance** | cache, denormalisation, code optimise | maintenabilite |

Strategies : commencer simple et complexifier a la demande, mesurer avant d'optimiser, utiliser une
abstraction pour differer une decision, evoluer par increments.

## Attributs de qualite, ponderes pour ce projet

| Attribut | Poids ici | Pourquoi |
|---|---|---|
| **Auditabilite** | tres fort | l'objet du produit est de savoir qui a decide quoi ; une action non tracee n'existe pas |
| **Surete** (ne pas couper l'acces de quelqu'un en poste) | tres fort | une fausse revocation coute plus cher que dix revocations manquees |
| **Maintenabilite** | fort | un mainteneur a temps partiel, des creux de six mois |
| **Reprenabilite** | fort | tout doit etre versionne, testable, relisible dans deux ans |
| **Performance** | faible | 95 personnes, execution deux fois par an |
| **Montee en charge** | tres faible | le parc ne grandira pas d'un ordre de grandeur |

Un argument de performance ou de scalabilite qui coute de la simplicite part perdant dans ce projet.
Un argument d'auditabilite ou de surete qui coute de la performance part gagnant.

## Anti-patterns a surveiller ici

- **Logique de decision hors du depot.** Un workflow n8n qui deciderait qui perd un acces n'est ni
  versionne, ni testable, ni auditable. n8n fait le dernier kilometre (notifier, ouvrir un ticket),
  pas le calcul d'ecart. C'est exactement le reproche fait au pipeline d'offboarding de beta.gouv.
- **Credential a portee large sans cloisonnement.** Un token qui porte plus que son usage doit soit
  passer derriere fine-grained-proxy, soit etre declare comme dette explicite dans `CredentialRef`.
  Le cloisonnement par allowlist applicative repose sur le fait que le code ne se trompe pas : ce
  n'est pas un cloisonnement.
- **Marteau dore.** Forcer un cas dans le modele generique parce qu'il existe. La section 4.3 de
  `docs/architecture.md` est la pour ca : si une fonctionnalite oblige a assouplir une regle du socle
  pour exister, elle releve du connecteur et pas du socle.
- **Etat non reconstructible.** Tout doit se rejouer depuis les connecteurs, sauf le journal d'audit,
  les derogations et l'etat decide. Une nouvelle source de verite non reconstructible elargit le
  perimetre de sauvegarde critique : ca se justifie explicitement.
- **Optimisation prematuree.** Cache, pagination sophistiquee, batching : le parc fait 95 personnes.

## Matrice de decision

Pondere les colonnes selon les poids du tableau des attributs de qualite ci-dessus, pas a poids egal.

| Option | Auditabilite | Surete | Maintenabilite | Complexite d'exploitation | Total pondere |
|---|---|---|---|---|---|
| Option A | 5 | 4 | 3 | 2 | ... |
| Option B | 3 | 5 | 4 | 3 | ... |

La matrice ne decide pas a ta place, elle rend l'arbitrage lisible. Si le total contredit ton
intuition, c'est la ponderation qu'il faut discuter, pas le resultat qu'il faut arrondir.

## Gabarit d'ADR

Les ADR vivent dans `docs/adr/` (repertoire a creer au premier ADR), numerotes sequentiellement,
rediges en francais.

```markdown
# ADR-NNNN : <titre>

## Statut

Proposed | Accepted | Deprecated | Superseded par ADR-NNNN

Date : AAAA-MM-JJ

## Contexte

<La situation qui impose une decision. Faits, pas opinions.>

### Contraintes

- <contrainte 1>
- <contrainte 2>

## Decision

<Ce qui est decide, en une a trois phrases.>

### Justification

- <raison 1>
- <raison 2>

## Options envisagees

### <Option A>

Ecartee parce que <raison>.

### <Option B>

Ecartee parce que <raison>.

## Consequences

### Positives

- <benefice>

### Negatives

- <cout assume, y compris la dette creee>

## Liens

- Section concernee de `docs/architecture.md`
- ADR lies
```

## Patterns d'evolution

- **Branch by abstraction** : creer l'abstraction sur l'existant, implementer derriere, basculer,
  supprimer l'ancien.
- **Strangler fig** : nouvelle solution pour les nouveaux cas, migration progressive, retrait de
  l'ancien.
- **Parallel run** : faire tourner les deux, comparer les resultats, basculer quand la confiance est
  la. Le mode `dryRun` du projet est deja une forme de parallel run : il produit le plan sans
  l'executer.

## Dette technique

| Type | Exemples ici | Strategie |
|---|---|---|
| **Conception** | abstraction manquante, couplage fort | refactoring cible |
| **Credential** | token nominatif, credential a portee large | declare dans `CredentialRef`, visible dans l'interface, remboursee par un chemin durable |
| **Test** | connecteur sans test de contrat | ajout du test de contrat quotidien (section 4.8) |
| **Documentation** | ecart entre le code et `docs/architecture.md` | `/sync-docs` |

Une dette assumee et **declaree** vaut mieux qu'une dette masquee. C'est le sens de `scopeNote`,
`nominative` et `fragile` dans le contrat de connecteur : la fragilite est affichee, pas niee.

## Processus

1. Formuler la question en une phrase.
2. Lire ce que `docs/architecture.md` dit deja du sujet.
3. Lister au moins deux alternatives reelles, dont "ne rien faire".
4. Ponderer avec la matrice.
5. Presenter le resultat a l'utilisateur et **attendre sa decision**. Ne redige jamais un ADR seul.
6. Une fois valide, rediger l'ADR et mettre a jour `docs/architecture.md` si la decision y touche
   (via `/sync-docs`).
