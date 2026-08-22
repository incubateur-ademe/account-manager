# Page et configuration propres à un connecteur (#5)

> Plan d'implémentation de l'issue #5. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

**Deux crochets morts dans le contrat.** `ConnectorFeature` (`src/core/connector.ts:49-54`) et
`ConnectorContract.features` (`src/core/connector.ts:68`) ne sont lus nulle part : ces deux lignes
sont leurs seules occurrences dans tout le dépôt. `ConnectorFeature.entrypoint`
(`src/core/connector.ts:53`) est une chaîne dont rien ne dit ce qu'elle désigne. Le même sort frappe
`ConnectorContract.scopeSchema` (`src/core/connector.ts:66`) : hors du contrat, sa seule occurrence
est sa déclaration dans le connecteur GitHub (`src/connectors/github.ts:402`). Il faudra y toucher
(voir la décision D8), autant le savoir avant. Le contrat a bougé depuis, mais ailleurs : les
métadonnées de compte y ont ajouté `ObservedDetail` (`src/core/connector.ts:131-134`) et
`ObservedIdentity.details` (`src/core/connector.ts:144`), tous deux du côté collecte, sans toucher
à ces crochets.

**Un seul registre, en Node pur.** `CONNECTEURS` (`src/connectors/index.ts:10`) est importé par la
collecte (`src/lib/sync/executer.ts:1`), le calcul de plan de départ (`src/lib/depart.ts`), le
tableau de bord (`src/app/page.tsx:4`) et l'écran Systèmes (`src/app/systemes/page.tsx:6`). Le CLI
de collecte (`src/cli/sync.ts`) fait trente-quatre lignes et n'importe aujourd'hui que
`node:crypto`, `@next/env`, `@/lib/db` et `@/lib/sync/executer`. La propriété visée par la
Definition of Done est donc déjà vraie, mais rien ne la tient : le jour où un connecteur importera
un composant, personne ne le verra avant que le conteneur de collecte ne grossisse ou ne casse.

**Le connecteur GitHub porte ses sources en dur.** `ORGANISATIONS`
(`src/connectors/github.ts:23`) est une constante, assortie d'un commentaire
(`src/connectors/github.ts:14-22`) qui affirme qu'elle relève de la définition du système et non de
la configuration. Elle est lue à trois endroits : la boucle de collecte
(`src/connectors/github.ts:348`), la validation de scope (`src/connectors/github.ts:402`) et la
production du plan de révocation (`src/connectors/github.ts:427`). Le connecteur reste un objet
littéral exporté (`src/connectors/github.ts:381`), sans fabrique : rien ne permet de lui passer une
configuration. Sa collecte, elle, a déjà sa couture depuis les métadonnées de compte :
`collecter(lire: Lecteur)` (`src/connectors/github.ts:341`) reçoit son lecteur en paramètre, et
`list` se réduit à `collecter(lireTout)` (`src/connectors/github.ts:417`).

**La couche déclarée est complète et éprouvée.** `src/core/policy.ts` porte deux schémas Zod,
`accountsSchema` (ce qui nomme) et `configSchema` (ce qui règle, `src/core/policy.ts:243`).
`src/lib/policy.ts` les charge depuis `POLICY_DIR` (`src/lib/policy.ts:25-27`), rend des messages
d'erreur destinés à quelqu'un qui édite un YAML sans avoir le code sous les yeux
(`src/lib/policy.ts:41-62`) et met la politique en cache au premier appel
(`src/lib/policy.ts:75-78`). Deux commandes s'appuient dessus : `pnpm policy:check`
(`src/cli/verifier-politique.ts`) et `pnpm policy:schema`, qui dérive les JSON Schema des schémas
Zod et refuse qu'ils deviennent une seconde vérité (`src/cli/schema-politique.ts:8-16`).

**Deux entrées réservées y dorment déjà** : `systems[]` (`src/core/policy.ts:320-336`) et
`permanentDerogations` (`src/core/policy.ts:338-354`), toutes deux annoncées comme non lues, dans
le schéma comme dans `config/config.exemple.yaml:52-67`.

**L'écran Systèmes.** `src/app/systemes/page.tsx:30` rend une section par connecteur : capacités
résolues, credentials sondés, dernier relevé. Aucun lien sortant. La page est en
`dynamic = "force-dynamic"` et appelle `requireOperateur()`, comme toutes les autres.

**Ce qui manque, concrètement** : aucune route sous `/systemes/`, aucun endroit où un connecteur
puisse poser un écran, aucun mécanisme de configuration par connecteur, et aucune barrière entre le
monde Node et le monde React. `src/connectors/github.test.ts` existe désormais et couvre
l'assemblage, la dégradation et le coût en requêtes, mais rien n'y touche à la liste des
organisations ni au plan de révocation.

**Pièges déjà en place.**

- Le tiret cadratin qui remplissait la cellule vide de la colonne « ce qui manque pour faire mieux »
  a disparu depuis : `src/app/systemes/page.tsx:108-112` affiche « sans objet ». Il n'y a plus rien
  à corriger là à l'étape 6, mais la règle tient pour tout ce qu'on écrira sur la page du connecteur.
- `POLICY_DIR` est la seule variable lue hors du schéma Zod de `src/lib/env.ts`, et c'est délibéré
  (`src/lib/policy.ts:9-24`). Une configuration de connecteur ne doit surtout pas ajouter une
  seconde exception.
- La collecte protège déjà contre l'effondrement : `chuteExcessive` (`src/core/collecte.ts:56-61`)
  refuse de dater la moindre disparition quand un run rapporte beaucoup moins que ce que la base
  tient pour vivant. Le socle l'applique deux fois (`src/lib/sync/collecte.ts:320-329`), aux
  identités puis aux ressources, et seulement sur un run `OK`. Ce garde-fou devient un acteur du
  ticket dès lors que la liste des sources collectées devient éditable.
- `src/ui/Navigation.tsx:45` marque l'onglet actif avec `pathname.startsWith`, donc une route
  `/systemes/<cle>` gardera l'onglet Systèmes allumé sans rien changer à la navigation.
- Les routes dynamiques reçoivent `params` sous forme de promesse
  (`src/app/personnes/[username]/page.tsx:41-44` pour le type, `:66` pour l'attente), c'est le
  modèle à recopier.

## Décisions de conception

**D1. La configuration d'un connecteur vit dans le YAML de politique, sous une clé racine
`connectors`.** C'est du déclaré au sens de `docs/architecture.md` §1.4 : versionné, revu, changé
quelques fois par an, reconstructible. Ni l'environnement (qui relève du déploiement et ne porte que
des secrets), ni la base (qui porte le constaté, pas ce qu'on a décidé de regarder).

**D2. La clé `connectors` n'est pas greffée sur `systems[]`, elle vit à côté.** `systems[]` décrit
un système au niveau du catalogue : ce qu'il est, ce qu'il coûte, comment on fait à la main. Il peut
donc décrire un système qu'aucun connecteur ne couvre, ce qui est même tout son intérêt. `connectors`
paramètre une implémentation présente dans le code : une entrée pour une clé sans connecteur est une
faute (D4), là où une entrée de catalogue sans connecteur est normale. Les greffer l'un sur l'autre
obligerait en plus à remplir `label`, `criticality` et `runbook`, que le contrat porte déjà, juste
pour poser un réglage. Conséquence assumée : deux endroits parlent des systèmes dans `config.yaml`,
et la fusion éventuelle du catalogue déclaré avec les contrats reste à trancher, hors de ce ticket.

**D3. La validation se fait en deux temps, et le second temps appartient au connecteur.**
`configSchema` de la politique valide que `connectors` est un dictionnaire de clés vers des objets,
rien de plus : `src/core/policy.ts` ne connaît pas les connecteurs et ne doit pas les connaître,
sous peine de cycle d'imports. Chaque contrat déclare son propre `configSchema` (un `z.ZodType`,
exactement comme `scopeSchema`), et une fonction pure croise les deux. Les schémas Zod restent la
seule vérité, comme pour la politique.

**D4. Une entrée de configuration orpheline est un refus, pas un silence.** Une clé qui ne
correspond à aucun connecteur, ou qui correspond à un connecteur sans `configSchema`, arrête tout
avec un message qui nomme les clés connues. Le mode de panne à éviter est nommé dans le ticket :
« jamais lue de travers ». Une faute de frappe qui laisse le connecteur tourner sur ses défauts est
pire qu'une erreur, parce que l'opérateur croit avoir configuré.

**D5. Le connecteur reçoit sa configuration, il ne va pas la chercher.** Chaque connecteur
configurable est produit par une fabrique qui prend un accesseur paresseux :
`creerGithub(lireConfig: () => ConfigGithub)`. Le registre l'instancie avec la lecture réelle,
`src/connectors/index.ts` reste un tableau, `CONNECTEURS` ne change pas de forme et aucun appelant
n'est touché. L'alternative (le connecteur importe un `configurationDe()` comme il importe `env`)
est écartée : elle le coupe de tout test sans système de fichiers, et prendrait le contre-pied de la
couture que ce connecteur a déjà. `collecter` reçoit son `Lecteur` en paramètre
(`src/connectors/github.ts:341`), et c'est exactement ce dont `src/connectors/github.test.ts` se
sert pour collecter sans réseau : l'injection est le sens dans lequel il va déjà, la configuration
n'a qu'à l'emprunter. L'autre alternative (passer la configuration dans
`RunContext`) est écartée aussi : `probe()` ne reçoit pas de contexte, et typer la configuration
obligerait à rendre `Connector` générique, donc à contaminer tous les appelants pour un besoin que
deux connecteurs sur dix auront.

**D6. L'accesseur est paresseux, pas résolu à l'import.** `src/connectors/index.ts` est importé par
la collecte, par le web et par `pnpm policy:schema`. Résoudre la configuration à l'import ferait
exiger une politique valide au simple fait de charger le module, ce qui casserait la génération de
schéma dans un dépôt sans politique. C'est le même raisonnement que la validation différée de
`src/lib/env.ts:103-115`.

**D7. Le registre d'interface vit sous `src/ui/connecteurs/`, et l'import ne va que dans un sens.**
`src/ui/` connaît `src/connectors/`, jamais l'inverse. Le registre est un `.ts` sans JSX qui associe
une clé de connecteur à un chargeur d'écran (`() => import("./github/Ecran")`), ce qui garde le
graphe d'imports statique propre et laisse Next découper le bundle. Un test gèle la propriété
(étape 8), sans quoi elle se perdra à la première fonctionnalité un peu pressée.

**D8. GitHub est le premier client du mécanisme, et son commentaire sur les organisations est
révisé.** Le ticket met hors périmètre l'extension de la collecte (teams, outside collaborators,
comptes sans double authentification), pas le fait de rendre les sources déclarables. Livrer le
mécanisme sans qu'aucun connecteur ne le lise reproduirait exactement le crochet mort que ce ticket
vient réveiller. Les organisations passent donc en configuration, avec pour défaut la valeur
actuelle : un déploiement sans clé `connectors` collecte à l'identique. Le commentaire
`src/connectors/github.ts:14-22` disait que ces organisations font partie de la définition du
système ; il devient faux et se réécrit. Conséquence à assumer : `scopeSchema`
(`src/connectors/github.ts:402`) ne peut plus s'appuyer sur `z.enum(ORGANISATIONS)` et devient une
chaîne non vide. On perd une contrainte, sur un champ que personne ne lit encore. Si cette perte
gêne, la parade est de valider le scope contre la configuration résolue au moment où quelqu'un
commencera à le lire, pas maintenant.

**D9. Une page de connecteur existe quand le connecteur a un écran, une configuration ou une
fonctionnalité.** Une seule fonction décide, et les deux appelants (le lien depuis Systèmes, le 404
de la route) s'y réfèrent. Sans elle, on aurait deux règles qui divergeraient, donc un lien mort ou
une page devinable. Un connecteur qui ne remplit aucune des trois conditions n'a pas de page, pas de
lien, et un accès direct à son URL rend 404 : c'est le « rien d'autre » du ticket.

**D10. Les fonctionnalités hors socle restent déclarées dans le contrat, seul leur rendu passe par
le registre.** `ConnectorFeature` est de la donnée pure (clé, libellé, credentials requis,
segment) : elle se résout contre les mêmes sondes que les capacités, et la ligne de commande doit
pouvoir dire un jour qu'une fonctionnalité est indisponible sans charger le moindre composant.
`entrypoint` reçoit enfin un sens : un segment sous `/systemes/<cle>/`.

**D11. Aucune fonctionnalité hors socle n'est implémentée dans ce ticket.** GitHub n'en a pas, et
celle qui viendra en premier (les invités Notion, `docs/architecture.md` §5.9) attend son connecteur.
On livre la déclaration, la résolution et l'affichage ; on ne crée pas les sous-routes tant qu'il n'y
a rien à y mettre, un lien vers une route absente étant pire que pas de lien.

**D12. Aucune configuration de connecteur ne porte de secret.** Elle vit dans un dépôt de
configuration lisible et s'affiche telle quelle sur la page du connecteur. Les credentials restent
dans l'environnement ou derrière fine-grained-proxy, et la page continue de n'afficher d'eux que ce
que `probe()` rend : présent ou absent, avec la raison.

**D13. Pas de tuiles de tableau de bord dans ce ticket.** Le ticket les autorise comme seule
exception à la règle « rien de spécifique dans les écrans génériques », mais aucun point de la
Definition of Done ne les couvre, et le besoin réel est décrit dans `TODO.md` comme un chantier de
tableau de bord à part entière. Rien ici ne les empêche : le registre d'interface est l'endroit
prévu, une fonction de plus à côté du chargeur d'écran.

**D14. Pas de `capacitor`.** Repris tel quel du ticket : rien ne le modélise, rien ne l'empêche.

**D15. Le fichier `src/core/connector.ts` reste en anglais.** Ses identifiants décalquent les
extraits de `docs/architecture.md` §5.1 et §5.4, ses commentaires étant en français ;
`ObservedDetail`, ajouté depuis par les métadonnées de compte, suit déjà cette règle.
`resolveFeatures` y rejoint `resolveCapability`. Tout ce qui est ajouté ailleurs est en français,
conformément aux conventions.

### Tensions avec `docs/architecture.md`

- **§5.3** dit qu'une fonctionnalité hors socle a « son propre écran », sans dire où il vit. Ce plan
  le fixe (`/systemes/<cle>/<entrypoint>`), fixe le sens d'`entrypoint`, et pose la frontière entre
  contrat et registre d'interface. La Definition of Done demande explicitement de préciser §5.3 si
  la frontière bouge : elle bouge. La modification est **proposée à l'étape 9 et appliquée seulement
  après validation explicite**, le document ne se modifiant pas sans accord.
- **§1.4 et §3.1** listent le contenu du déclaré sans mentionner de configuration par connecteur.
  L'ajout de `connectors` s'y range naturellement, mais la ligne du tableau §1.4 mérite d'être
  complétée. Même traitement : proposé, pas appliqué d'office.
- **§5.8** tient le catalogue des systèmes dans la documentation, tandis que `systems[]` l'attend
  dans le YAML. Ce plan ne tranche pas ce point et n'y touche pas (D2). Si l'utilisateur veut le
  trancher, il relève de §8 « Ce qui reste à trancher », pas de ce ticket.

## Modèle de données

**Aucune migration Prisma.** Rien de ce qui est ajouté ici n'est constaté : une configuration de
connecteur est déclarée, versionnée et relue à chaque démarrage, et un écran de connecteur ne
persiste rien. `prisma/schema.prisma` n'est pas touché, aucun `prisma migrate dev`, aucun
`pnpm db:generate`, aucun redémarrage à prévoir de ce fait.

Le rappel vaut pour la suite : dès qu'une étape touche `prisma/schema.prisma`, il faut enchaîner
`pnpm db:generate` puis **redémarrer `pnpm dev`**, parce que le client généré est mis en cache sur
`globalThis` et sert sinon des métadonnées périmées (`Unknown argument 'X'`,
`Value 'X' not found in enum 'Y'`). Ici, si une étape a besoin d'une migration, c'est le signe qu'on
a glissé hors du ticket : la configuration a fini en base.

## Découpage en étapes

### Étape 1. Le socle de configuration, en pur

Fichiers : `src/core/policy.ts`, `src/core/connector.ts`, **nouveau**
`src/core/configuration-connecteur.ts`.

- `configSchema` gagne `connectors: z.record(z.string(), z.unknown()).default({})`, avec un `.meta()`
  qui dit à quoi ça sert et que la forme de chaque valeur dépend du connecteur visé.
- `ConnectorContract` gagne `configSchema?: z.ZodType`, documenté comme le contrat de la clé
  `connectors.<key>` du YAML, avec la contrainte D12 (aucun secret) et la contrainte technique de
  l'étape 3 (déclaratif, pas de transformation).
- `src/core/configuration-connecteur.ts` expose une fonction pure :

```ts
export interface ConfigurationsResolues {
  valeurs: ReadonlyMap<string, unknown>;
  erreurs: readonly string[];
}

export function resoudreConfigurations(
  contrats: readonly ConnectorContract[],
  brut: Readonly<Record<string, unknown>>,
): ConfigurationsResolues;
```

Elle applique, pour chaque contrat porteur d'un `configSchema`, le schéma à `brut[key] ?? {}`, ce
qui fait jouer les défauts en l'absence d'entrée ; elle rend toutes les erreurs d'un coup, au format
`  connectors.<cle>.<chemin> : <message>` déjà employé par `src/lib/policy.ts:52-54` et
`src/lib/env.ts:94-97` ; elle refuse une clé sans connecteur correspondant en nommant les clés
connues ; elle refuse une clé visant un connecteur sans `configSchema` (« ce connecteur ne se
configure pas »).

Vérifiable par le test T1 seul, sans base ni système de fichiers.

### Étape 2. Le branchement, et le refus au démarrage

Fichiers : **nouveau** `src/lib/configuration-connecteur.ts`, `src/lib/sync/executer.ts`,
`src/cli/verifier-politique.ts`.

- `src/lib/configuration-connecteur.ts` lit `policy().connectors`, appelle `resoudreConfigurations`,
  met le résultat en cache comme `src/lib/policy.ts:75-78`, et expose deux fonctions :
  `verifierConfigurations(contrats)` qui lève avec le message assemblé, et
  `configurationDe<T>(contrat)` qui rend la valeur validée. Ce module ne doit **jamais** importer
  `@/connectors` : les contrats lui sont passés, faute de quoi on crée un cycle avec les connecteurs
  qui l'utilisent.
- `executerSync` appelle `verifierConfigurations(CONNECTEURS.map((c) => c.contract))` juste après le
  `policy()` de tête (`src/lib/sync/executer.ts:42-47`), dans le même `try` : une configuration
  fausse doit sortir comme une politique fausse, par un message et un code de retour, pas par une
  pile d'appels au milieu de la collecte.
- `pnpm policy:check` ajoute la même vérification et une ligne au résumé
  (`src/cli/verifier-politique.ts:11-28`), du genre `connecteurs configures  2`. C'est la commande
  qui tourne dans le dépôt de configuration, donc le vrai « avant démarrage » de la Definition of
  Done.

Vérifiable à la main : `POLICY_DIR` pointé sur un répertoire portant une clé inconnue, puis
`pnpm policy:check` doit refuser en nommant la clé fautive et les clés connues.

### Étape 3. Le JSON Schema composé, et le modèle

Fichiers : `src/cli/schema-politique.ts`, `config/config.exemple.yaml`, `config/config.schema.json`
(régénéré, pas édité).

`schema-politique.ts` a déjà le droit d'importer `@/connectors` : c'est un CLI Node pur, il ne
tombe pas sous la frontière de l'étape 8. Après `z.toJSONSchema(configSchema)`
(`src/cli/schema-politique.ts:27`), il remplace le nœud `connectors` par un objet dont les
`properties` sont les `z.toJSONSchema(contrat.configSchema)` des connecteurs qui en ont un, avec
`additionalProperties: false` pour que l'éditeur refuse une clé inconnue comme le fait le runtime.
La saisie assistée devient réelle au lieu d'être un objet libre.

Deux points mesurés et non supposés :

- `z.toJSONSchema` lève `Transforms cannot be represented in JSON Schema` dès qu'un schéma contient
  un `.transform()`. Un `configSchema` de connecteur doit donc rester déclaratif. C'est une
  contrainte à écrire dans le commentaire du contrat, pas à découvrir en régénérant.
- En mode de sortie (le défaut, et ce qu'utilise déjà le fichier existant), un champ pourvu d'un
  `.default()` ressort en `required`. Le `config.schema.json` actuel a déjà cette caractéristique
  pour `systems`, `thresholds` et les autres. On ne change rien à ce comportement dans ce ticket :
  y toucher réécrirait tout le fichier existant pour un confort d'éditeur, ce qui n'a rien à faire
  ici.

`config/config.exemple.yaml` gagne un bloc `connectors` commenté sur le modèle des blocs réservés
existants (`config/config.exemple.yaml:52-67`), montrant la configuration GitHub avec sa valeur par
défaut et disant qu'omettre le bloc revient exactement à écrire ce défaut.

Vérifiable : `pnpm policy:schema` puis `pnpm policy:check`, et le diff de `config.schema.json` ne
doit contenir que le nœud `connectors`.

### Étape 4. GitHub lit ses organisations

Fichiers : `src/connectors/github.ts`, `src/connectors/index.ts`.

- Un `configSchema` GitHub : `z.object({ organisations: z.array(z.string().min(1)).min(1).default(["incubateur-ademe"]) })`.
  Le `.min(1)` sur le tableau n'est pas décoratif, voir les risques : une liste vide produirait une
  collecte réussie et vide.
- `github` devient `creerGithub(lireConfig)` et l'export nommé reste, instancié dans
  `src/connectors/index.ts` avec `() => configurationDe(CONTRAT_GITHUB)`. Les trois lectures de
  `ORGANISATIONS` (`:348`, `:402`, `:427`) passent par l'accesseur, sauf `scopeSchema` qui devient
  une chaîne non vide (D8). La boucle vit dans `collecter` (`src/connectors/github.ts:341-379`), qui
  reçoit déjà son `Lecteur` en paramètre : les organisations lui arrivent de la même façon, et
  `list` continue de n'être que l'appel de `collecter` avec le lecteur réel. Le commentaire `:14-22`
  est réécrit : les organisations sont désormais déclarées, et un connecteur GitHub visant d'autres
  organisations est le même connecteur autrement configuré.
- `plan` lit la configuration à chaque appel, comme `list`. Il est appelé par
  `src/lib/depart.ts:91` : rien à changer côté appelant.

Vérifiable par le test T4, et par `pnpm sync` sur une base locale sans clé `connectors`, dont la
sortie doit être identique à celle d'avant l'étape.

### Étape 5. Le registre d'interface et la route

Fichiers : **nouveaux** `src/ui/connecteurs/registre.ts`, `src/ui/connecteurs/github/Ecran.tsx`,
`src/app/systemes/[cle]/page.tsx`.

- `registre.ts` (aucun JSX, imports de type uniquement côté React) :

```ts
type ChargeurEcran = () => Promise<{ default: ComponentType<{ contrat: ConnectorContract }> }>;

const ECRANS: Readonly<Record<string, ChargeurEcran>> = {
  github: () => import("./github/Ecran"),
};

export function ecranDe(cle: string): ChargeurEcran | undefined;
export function aUnePage(contrat: ConnectorContract): boolean;
```

`aUnePage` porte la règle D9 : un écran enregistré, ou un `configSchema`, ou au moins une
fonctionnalité déclarée.

- `src/app/systemes/[cle]/page.tsx` : `dynamic = "force-dynamic"`, `requireOperateur()`, `params`
  en promesse, `notFound()` si la clé ne correspond à aucun connecteur ou si `aUnePage` est faux.
  Elle rend un socle commun (rappel du contrat, credentials sondés, configuration effective telle
  qu'elle est résolue, fonctionnalités et leur disponibilité) puis, s'il existe, l'écran propre du
  connecteur. Le socle commun est rendu une fois ici plutôt que recopié par chaque connecteur.
- `github/Ecran.tsx` reste sobre : les organisations suivies, ce qu'elles impliquent (les retirer
  fait disparaître les comptes qui n'y sont plus vus), et où éditer le fichier. Rien qui écrive.
- La configuration affichée est celle qui a été résolue, défauts compris, jamais le YAML brut : ce
  qu'on veut lire sur cet écran, c'est ce que le connecteur va vraiment faire.

Vérifiable : `/systemes/github` répond, `/systemes/inconnu` rend 404, l'onglet Systèmes reste
allumé.

### Étape 6. Le lien depuis l'écran Systèmes

Fichiers : `src/app/systemes/page.tsx`.

Un lien par section, posé seulement quand `aUnePage(contrat)` est vrai, et rien d'autre : ni badge,
ni colonne, ni bloc spécifique. Le texte de l'alerte de bas de page
(`src/app/systemes/page.tsx:133-138`) est ajusté si la mention du catalogue devient trompeuse une
fois que du code lit `connectors`.

Vérifiable à l'oeil : un connecteur sans page ne montre aucune différence avec aujourd'hui.

### Étape 7. Les fonctionnalités hors socle

Fichiers : `src/core/connector.ts`, `src/app/systemes/[cle]/page.tsx`.

- `resolveFeatures(features, probes)` rejoint `resolveCapability` dans `src/core/connector.ts`, et
  rend pour chaque fonctionnalité sa disponibilité et les credentials manquants. Même logique de
  résolution que les capacités : ce qui est indisponible se dit, il ne se cache pas.
- `ConnectorFeature.entrypoint` reçoit son commentaire de sens (segment sous `/systemes/<cle>/`).
- La page du connecteur affiche les fonctionnalités déclarées, sans lien tant qu'aucune sous-route
  n'existe (D11).

Vérifiable par le test T5, en attendant un connecteur qui en déclare.

### Étape 8. Le garde-fou de frontière

Fichiers : **nouveau** `src/cli/frontiere.test.ts`.

Un test qui parcourt le graphe d'imports depuis `src/cli/sync.ts` (imports statiques et dynamiques,
résolution de l'alias `@/`, extensions `.ts`, `.tsx`, `/index.ts`) et échoue si le parcours atteint
un fichier `.tsx`, un module sous `src/ui/` ou `src/app/`, ou un specifier commençant par `react`,
`next/` ou `@codegouvfr/`. `@next/env` ne commence pas par `next/` et reste donc autorisé sans
exception à écrire.

Deux exigences sur ce test, détaillées dans les risques : une contre-épreuve, et l'échec sur import
non résolu.

### Étape 9. La documentation

Fichiers : `docs/architecture.md` (§5.3, tableau §1.4, liste §3.1), `CLAUDE.md` si la commande ou
l'invariant méritent une ligne, `config/config.exemple.yaml` (déjà fait à l'étape 3).

Les diffs de `docs/architecture.md` sont **proposés et attendent une validation explicite**. Le
skill `/sync-docs` couvre exactement ce passage.

## Tests

Cinq scénarios, chacun une histoire à plusieurs assertions. Pas de test de rendu React :
`vitest.config.ts` fixe `environment: "node"` et le dépôt n'embarque aucune bibliothèque de rendu.

**T1. Une configuration de connecteur, du fichier au connecteur.**
`src/core/configuration-connecteur.test.ts`
*Given* trois contrats fictifs : un avec un schéma à défauts, un avec un schéma sans défaut, un sans
schéma du tout. *When* on résout des configurations brutes successives. *Then* l'absence d'entrée
rend les défauts (le comportement d'avant le ticket est conservé) ; une entrée valide est prise
telle quelle, complétée par les défauts des champs absents ; une entrée invalide est refusée avec un
chemin complet `connectors.<cle>.<champ>` et le message du schéma ; une clé inconnue est refusée en
nommant les clés connues ; une entrée visant le contrat sans schéma est refusée en le disant ;
plusieurs fautes dans le même fichier remontent toutes ensemble, parce qu'un YAML se corrige en une
passe et non en cinq allers-retours.

**T2. GitHub collecte les organisations qu'on lui déclare, et rien d'autre.**
`src/connectors/github.test.ts`, qui existe déjà et porte quatre scénarios sur l'assemblage, la
dégradation et le coût en requêtes : c'est un `describe` de plus, pas un fichier neuf. Aucun double
de `fetch` à écrire non plus, le fichier a déjà son faux `Lecteur`, qui retient les chemins demandés
(`src/connectors/github.test.ts:19-53`).
*Given* un connecteur construit avec deux organisations et ce lecteur. *When* on collecte.
*Then* les deux organisations sont interrogées et aucune autre ; membres, invitations en attente et
accès portent la bonne ressource ; le statut est `ok` sans erreurs. *When* une organisation répond
en erreur, *Then* le statut est `partial`, les erreurs nomment l'organisation fautive, et les
identités de l'autre sont intactes. *When* les deux échouent, *Then* le statut est `failed` et
aucune identité n'est rendue. Ces trois issues sont bien celles de la règle de statut en vigueur,
qui compte les organisations ayant rendu quelque chose (`src/connectors/github.ts:365-378`) et non
les erreurs. Aucun cas ne doit produire `ok` avec des erreurs : c'est l'invariant de collecte, et
c'est ce qui décide si des `vanishedAt` seront posés. Le plan de révocation est vérifié dans la
foulée : une étape par organisation configurée, avec sa clé d'idempotence.

**T3. La collecte en ligne de commande n'embarque aucune interface.** `src/cli/frontiere.test.ts`
*Given* le graphe d'imports issu de `src/cli/sync.ts`. *Then* aucun fichier `.tsx`, aucun module
sous `src/ui/` ou `src/app/`, aucun paquet d'interface n'y figure. *And* en contre-épreuve, le
parcours atteint bien `src/connectors/github.ts` et `src/lib/sync/collecte.ts`, sans quoi un test
vert ne prouverait que la panne du parcours. *And* un import non résolu fait échouer le test au lieu
d'être ignoré, sinon le premier renommage de fichier troue la frontière en silence. *And* le sens
autorisé est vérifié : depuis `src/ui/connecteurs/registre.ts`, on atteint `@/core/connector` sans
que `src/connectors/` n'atteigne jamais `src/ui/`.

**T4. Une page n'apparaît que quand le connecteur a quelque chose à montrer.**
`src/ui/connecteurs/registre.test.ts`
*Given* quatre contrats : un nu, un avec un `configSchema`, un avec une fonctionnalité, un avec un
écran enregistré. *Then* seul le premier n'a pas de page, donc pas de lien sur l'écran Systèmes et
404 sur son URL. *And* toute clé du registre d'écrans correspond à un connecteur réel de
`CONNECTEURS`, faute de quoi le registre porterait un écran inatteignable.

**T5. Une fonctionnalité hors socle dont le credential manque s'annonce, elle ne disparaît pas.**
Ajout d'un `describe` à `src/core/connector.test.ts`, qui porte déjà la résolution des capacités.
*Given* deux fonctionnalités, l'une sans exigence, l'autre exigeant un credential absent des sondes.
*Then* la première est disponible, la seconde est rendue avec la liste de ce qui lui manque, et un
credential absent des sondes compte comme indisponible et jamais comme acquis, exactement comme pour
les capacités.

## Risques et pièges

**Une configuration vide qui vide la base.** C'est le risque principal, et la règle de statut
actuelle n'a fait que déplacer sa forme. Une liste vide ne rend plus `status: "ok"` avec zéro
élément : aucune organisation n'ayant rendu quoi que ce soit, `collecter` prend la branche
`rendues === 0` (`src/connectors/github.ts:365-367`) et rend `failed` avec une liste d'erreurs elle
aussi vide, dont le premier élément est un `undefined` sous un cast. Le socle la parcourt aussitôt
(`src/lib/sync/collecte.ts:289-293`) et casse sur une erreur qui n'a aucun rapport apparent avec la
configuration. Le garde-fou `chuteExcessive` (`src/core/collecte.ts:56-61`) n'est même pas consulté,
il ne joue que sur un run `OK` ; compter dessus reviendrait de toute façon à laisser le filet
décider à la place du schéma. Le `.min(1)` sur le tableau est obligatoire, et le test T2 doit
couvrir le refus.

**Retirer une organisation de la configuration est un geste à conséquence.** Sous le seuil de
`maxScopeDrop`, la collecte suivante datera légitimement les disparitions des comptes qui n'y sont
plus vus, ainsi que celles de ses équipes, devenues des ressources depuis les métadonnées de compte,
et l'écran des constats les fera remonter. Ce n'est pas un bug, c'est le comportement
attendu, mais l'écran du connecteur doit le dire en toutes lettres : c'est le genre de réglage qui
paraît anodin dans un YAML et coupe des accès deux jours plus tard.

**Le test de frontière qui passe au vert sans rien parcourir.** Un alias mal résolu, une extension
oubliée, un `import()` non reconnu, et le parcours s'arrête à la première ligne : le test devient
un décor. D'où la contre-épreuve et l'échec sur import non résolu, tous deux non négociables.

**Les imports de type ne comptent pas, les imports mixtes si.** `verbatimModuleSyntax` est activé
(`tsconfig.json:6`), donc un `import type { X } from "..."` est effacé à la compilation et ne charge
rien. En revanche `import { type Capability, resolveCapability } from "@/core/connector"`
(`src/app/systemes/page.tsx:7`) est un import mixte qui, lui, émet. Le test doit distinguer les deux,
sans quoi il refusera `import type { ComponentType } from "react"` dans le registre, qui est
parfaitement légitime.

**Le cycle d'imports.** `src/lib/configuration-connecteur.ts` doit recevoir les contrats en
paramètre et ne jamais importer `@/connectors`, sinon un connecteur qui l'utilise ferme la boucle.
Un cycle ESM ne casse pas toujours bruyamment : il rend un module partiellement initialisé, souvent
un `undefined` au premier accès, à un endroit qui n'a aucun rapport.

**La validation qui arrive trop tard.** La politique est lue paresseusement et mise en cache. Sans
la vérification en tête de `executerSync` et dans `pnpm policy:check`, une configuration fausse ne
se manifesterait qu'au premier accès, donc au milieu d'une collecte nocturne ou sur l'écran d'un
opérateur. Aucun conteneur ne lance `policy:check` au démarrage aujourd'hui (rien dans le
`Dockerfile`), ce qui rend ces deux points d'appel d'autant plus importants.

**La clé orpheline silencieuse.** Retirer un connecteur du code en laissant sa configuration dans le
YAML doit refuser le démarrage, pas être ignoré. C'est le pendant de la version de format
(`src/core/policy.ts:22-26`) : un fichier et un code qui n'avancent plus ensemble se disent.

**Un secret qui finit dans le YAML.** Le mécanisme de configuration rend tentant d'y poser un jeton :
le fichier est versionné, potentiellement dans un dépôt lisible, et l'écran du connecteur l'affiche.
La règle est dans le contrat (D12) ; toute revue de connecteur doit la vérifier.

**La page du connecteur comme porte dérobée du socle.** C'est le chemin naturel pour écrire sans
passer par le socle. Toute écriture depuis un écran de connecteur passe par `actionTracee`
(`src/lib/actions.ts:30`), donc trace nominative avant l'action, et respecte `ACTIONS_ENABLED`, donc
simulation par défaut. Ce ticket ne livre aucune écriture, mais la règle se pose maintenant, pendant
qu'il n'y a rien à corriger.

**`pnpm policy:schema` qui casse sur un `.transform()`.** Mesuré : `z.toJSONSchema` lève
`Transforms cannot be represented in JSON Schema`. Le premier connecteur qui écrira
`z.string().transform(...)` dans son `configSchema` cassera la génération, à un endroit qui n'a
aucun rapport apparent avec son connecteur.

**`scopeSchema` affaibli.** Passer de `z.enum(ORGANISATIONS)` à une chaîne non vide fait perdre une
contrainte. Elle ne protège personne aujourd'hui (le champ n'est lu nulle part), mais la perte doit
être notée pour ne pas la redécouvrir au moment d'implémenter l'octroi (`docs/architecture.md` §6).

**Le composant serveur asynchrone chargé dynamiquement.** L'écran de connecteur est un composant
serveur chargé par `await ECRANS[cle]()`. Sans `dynamic = "force-dynamic"` sur la route, Next
tenterait un rendu statique et la session comme la politique manqueraient au build. Toutes les
pages existantes portent cette directive, il n'y a pas de raison d'innover ici.

## Vérification

Au-delà de `pnpm verify`, lancer `/verif`, qui ajoute le build Next, absent de `pnpm verify` et seul
capable de faire tomber une route dynamique mal formée.

Ensuite, la Definition of Done point par point :

1. `node --import tsx src/cli/sync.ts` sur une base locale tourne, avec la même sortie qu'avant le
   ticket lorsqu'aucune clé `connectors` n'est déclarée. Le test T3 tient la propriété d'absence
   d'interface, mais l'exécution réelle reste la preuve que rien n'est cassé.
2. `/systemes` pose un lien vers `/systemes/github` et rien d'autre. Un connecteur retiré du registre
   d'écrans, sans `configSchema` ni fonctionnalité, ne montre aucune différence avec aujourd'hui, et
   son URL rend 404.
3. Trois configurations fautives passées à `pnpm policy:check` : une clé inconnue, un type faux, une
   liste vide. Les trois refusent, et chaque message dit quoi corriger et où. Ce sont ces trois
   sorties qu'il faut relire, pas seulement le code de retour.
4. Le diff de `config/config.schema.json` ne contient que le nœud `connectors`, et un éditeur ouvert
   sur `config/config.exemple.yaml` propose bien `organisations` en saisie assistée.
5. Le test de frontière échoue quand on lui donne une violation : ajouter temporairement un import
   d'interface dans `src/connectors/github.ts`, constater le rouge, retirer. Un garde-fou qu'on n'a
   jamais vu échouer n'a pas encore prouvé qu'il garde quelque chose.
6. `docs/architecture.md` §5.3 relu avec l'utilisateur, et modifié seulement après son accord.
