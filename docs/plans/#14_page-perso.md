# Page perso : mes comptes et mes dossiers (#14)

> Plan d'implémentation de l'issue #14. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### Tout écran suppose un opérateur, sans exception

Les onze pages de `src/app` appellent `requireOperateur()` en première ligne de leur composant, de
`src/app/page.tsx:16` à `src/app/departs/[id]/page.tsx:44`. `requireOperateur`
(`src/lib/session.ts:23`) relit l'allowlist à chaque requête et redirige vers `/login` quiconque n'y
figure pas, sans distinguer « pas de session » de « session valide mais pas opérateur ». Cette
absence de distinction est le premier point à corriger : un non-opérateur authentifié se ferait
renvoyer vers un écran de connexion alors qu'il est connecté.

`operateurCourant()` (`src/lib/session.ts:43`) fait la même relecture sans rediriger, et sert
uniquement au bandeau de déconnexion du gabarit (`src/app/layout.tsx:17`).

### Personne d'autre qu'un opérateur ne peut se connecter

Deux verrous, tous les deux dans `src/lib/auth.ts` :

- le rappel `signIn` rend `match !== null` (`src/lib/auth.ts:53-63`), donc refuse le lien magique à
  qui n'est ni dans `OPERATORS` ni dans `BREAK_GLASS_USERNAMES` ;
- le rappel `jwt` ne pose `token.username` que si `resolveOperator` a répondu
  (`src/lib/auth.ts:66-77`), donc une session d'un non-opérateur n'aurait même pas d'identité.

Conséquence directe pour ce ticket : **`/moi` ne sera visitable que par un opérateur tant que #13
n'a pas livré.** Ce plan ne touche pas à `auth.ts`, il installe le point de greffe et dit exactement
ce que #13 devra y changer.

Une chose est déjà prévue en revanche, et le commentaire du dépôt le dit
(`src/lib/auth.ts:31-35`) : `allowInactive: true` accepte les membres inactifs, « quelqu'un dont la
mission vient d'expirer doit pouvoir ouvrir l'outil pour traiter son propre offboarding ». C'est
exactement le public de cette page.

### La fiche d'une personne assemble déjà presque tout, mais pour l'opérateur

`src/app/personnes/[username]/page.tsx` charge en un `Promise.all` la personne, ses identités, ses
constats, la liste des fournisseurs déjà collectés et le dernier run du périmètre (`:150-200`). Elle
sait dire qu'une liste de comptes vide n'est pas une absence de comptes (`:488-497` et `:527-532`),
et affiche une bannière quand la collecte n'est plus fraîche (`:271-284`).

Ce sont les mêmes phrases qu'il faut sur la page perso. Ce n'est pas le même écran pour autant :
celui-ci porte le bouton de départ (`:361`), le détachement d'un compte (`:523`), le lien vers le
journal filtré sur la personne (`:346-351`) et la totalité des constats la concernant (`:429-483`).
Rien de tout cela n'a sa place sur une page vue par la personne elle-même.

### La fraîcheur est déjà un objet de première classe, et il est pur

`fraicheurDe` (`src/core/collecte.ts:34-48`) rend `{ perimee, heures }` et traite l'absence totale de
collecte comme un cas nommé plutôt que comme un zéro. `systemesMuets`
(`src/core/collecte.ts:71-106`) rend, par système attendu, la raison du silence parmi `non-lu`,
`echec` et `perime`. Le tableau de bord s'en sert (`src/app/page.tsx:52-59`), la fiche d'une personne
ne s'en sert qu'à moitié : elle liste les fournisseurs collectés sans dire lesquels se sont tus.

### Les dossiers existent, leur écran est réservé, et il montre tout

`DepartureCase` (`prisma/schema.prisma:299-313`) porte `personId`, `state`, `firstSignalAt`,
`effectiveDate`, `cancelledReason`, et un index sur `personId` (`:311`). Un dossier vivant par
personne (`src/lib/depart.ts:100-125`).

L'écran `/departs/[id]` affiche en revanche exactement ce que la page perso ne doit pas montrer :
le libellé figé de chaque étape, la note libre saisie par l'opérateur au pointage
(`src/app/departs/[id]/page.tsx:201-205`, alimentée par `lastError`,
`src/app/departs/[id]/actions.ts:159`), et le pied de page nominatif « Plan calculé le X par Y,
confirmé le Z par W » (`:250-252`).

Il n'existe **pas** de route `/departs` : seul `/departs/[id]` est déclaré. `src/app/departs/actions.ts:42`
revalide pourtant `/departs`, chemin qui ne correspond à aucune page. Sans effet aujourd'hui, à ne
pas prendre pour un index existant.

### Les autres pièges relevés dans le code

- **Un rattachement heuristique reste rattaché.** Une `ExternalIdentity` peut porter `personId` et
  `matchMethod: "HEURISTIC"` en même temps ; elle apparaît alors à la fois sur la fiche
  (`src/app/personnes/[username]/page.tsx:519-521`) et dans la file des comptes isolés
  (`src/app/comptes-isoles/page.tsx:24-30`). Les deux écrans le disent, la page perso devra le dire
  aussi, et dire ce qui en découle : aucune coupure ne sera proposée sur ce compte.
- **Le pivot est unique en base.** `Person.username` est `@unique` (`prisma/schema.prisma:92`), donc
  aucune ambiguïté possible sur la correspondance. Il n'y a rien à départager, seulement à ne pas
  inventer de repli.
- **Les constats portent du texte libre et un nom d'opérateur.** `Finding.closeReason` (`:432`) et
  `Finding.closedBy` (`:439`).
- **Le journal indexe l'acteur** (`prisma/schema.prisma:489`) et l'écran l'affiche en clair
  (`src/app/journal/page.tsx:34-50`).
- **La navigation est une liste figée d'écrans d'opérateur** (`src/ui/Navigation.tsx:7-16`), et le
  gabarit ne transmet aujourd'hui qu'un élément de déconnexion (`src/app/layout.tsx:27-29`).
- **Le proxy est optimiste** (`src/proxy.ts:9-22`) : il constate un cookie, il ne le valide pas. Son
  `matcher` (`:28`) couvre déjà toute route nouvelle, `/moi` comprise, mais cela ne dispense
  d'aucune vérification dans la page.
- **Aucun dossier d'arrivée n'existe.** Seul `DepartureCase` est modélisé, et `PlanKind` ne connaît
  que `OFFBOARDING`, `DRIFT_FIX` et `MANUAL_OP` (`prisma/schema.prisma:315-319`). #8 généralise
  dossier et plan ; ce plan doit laisser la place sans la préempter.
- **Les tests du dépôt sont purs.** Les treize fichiers `*.test.ts` vivent dans `src/core` sauf un,
  aucun ne touche la base, `vitest.config.ts` fixe `environment: "node"`.

## Décisions de conception

**D1. Une route, `/moi`, un seul écran, aucune action serveur.** Le pronom nomme mieux le contenu
que n'importe quel substantif, et il ne se confondra pas avec `/personnes/[username]`, qui est la
même personne vue par quelqu'un d'autre. Les modules portent le concept et non la route :
`src/core/espace-perso.ts` et `src/lib/espace-perso.ts`. Aucun `"use server"` dans ce lot : la page
montre ce que l'outil sait, les gestes restent sur les dossiers, conformément au ticket.

**D2. La correspondance est l'égalité stricte du `username` de session avec `Person.username`.**
Pas de repli sur l'adresse, pas de recherche approchante, pas de résolution par une identité
externe. Le pivot d'identité est le `username` beta.gouv, et c'est la seule clé dont les deux côtés
disposent avec certitude. Un repli par adresse reproduirait exactement `EMAIL_EXACT` puis
`HEURISTIC`, c'est-à-dire le mécanisme dont l'invariant du dépôt dit qu'il ne peut jamais produire
de conclusion sur les accès de quelqu'un : ici il produirait pire, l'affichage des comptes d'un
autre. Ferme le point de la DoR sur la correspondance.

**D3. Trois absences distinctes, trois phrases distinctes.** Ne pas avoir de fiche n'est pas une
erreur, et surtout pas la même chose selon ce qu'on a regardé :

| Situation | Ce que la page dit |
|---|---|
| Aucune collecte du périmètre n'a jamais eu lieu | l'outil n'a jamais lu le référentiel, donc il ne sait rien, pas même que vous n'y êtes pas |
| Le périmètre a été collecté, aucune fiche ne porte ce `username` | l'outil ne suit aucune fiche à ce nom, et voici à qui le dire |
| Une fiche existe, aucun compte ne lui est rattaché | ce qui a été regardé, ce qui ne l'a pas été, et ce que le vide veut dire |

Aucun `notFound()` : la page existe et répond 200 dans les trois cas. Un 404 dirait que l'adresse
est fausse alors que c'est la donnée qui manque. Ferme le point de la DoR sur l'absence de fiche.

**D4. Le contenu, champ par champ.** Ce qui est affiché :

| Bloc | Champs | Source |
|---|---|---|
| Vous | `fullname`, `username`, `missionEnd`, `primaryEmail`, `communicationEmail` | `Person` |
| Vos comptes | système, libellé du système, `handle`, `lastSeenAt`, `vanishedAt`, sûreté du rattachement | `ExternalIdentity` |
| Ce qui a été regardé | systèmes observés, systèmes muets avec leur raison, âge de la dernière collecte | `SyncRun` |
| Vos dossiers | nature, état, `firstSignalAt`, `effectiveDate`, nombre d'étapes, nombre restantes | `DepartureCase`, `Plan`, `PlanStep` |

Les deux adresses sont là pour une raison précise : #13 identifiera un porteur de fiche manuelle par
son adresse déclarée, et son point d'attention est qu'une personne qui part perd parfois sa boîte.
La personne est la seule à pouvoir constater qu'une adresse est fausse ou morte, et elle ne le peut
que si elle la voit.

Ce qui est délibérément exclu, et pourquoi :

| Exclu | Raison |
|---|---|
| Le nom des opérateurs (`Plan.createdBy`, `Plan.confirmedBy`, `Finding.closedBy`) | le ticket l'interdit nommément |
| Les libellés d'étape et les notes de pointage (`PlanStep.label`, `PlanStep.lastError`) | texte libre écrit par un opérateur pour un opérateur, il peut nommer n'importe qui |
| Les constats (`Finding`) | file de travail de l'opérateur, avec raison de clôture en texte libre et auteur |
| Le lien vers le journal | il expose des acteurs, y compris sur des événements voisins |
| `attachment`, `source`, `startups[]`, `betaUuid`, `firstSeenAt` | vocabulaire interne au suivi, sans usage pour la personne |
| Les accès détaillés (`AccessGrant`, `Resource`) | une ressource partagée est le premier endroit où une autre personne apparaît ; hors périmètre de ce lot |
| Les comptes isolés, même sur un système où la personne a un compte | par définition, ils ne sont réclamés par personne |

Ferme le point de la DoR sur le contenu arrêté champ par champ.

**D5. La censure est un calcul testé, pas une omission de `select`.** La fonction pure
`assemblerEspacePerso` reçoit en entrée la forme des lignes de la base, nom des opérateurs et notes
d'étape compris, et rend un modèle de vue dont le type ne les porte pas. La requête, elle, sélectionne
ces colonnes délibérément. Une garantie obtenue en oubliant de demander une colonne se perd le jour
où quelqu'un la demande pour autre chose, sans rien casser de visible ; une garantie obtenue par une
fonction dont un test sérialise la sortie entière et cherche le nom de l'opérateur tient face à ce
même jour. Le coût est nul, ce sont les mêmes lignes.

**D6. La fraîcheur se dit deux fois, dans les mots de la personne.** Une bannière pour le
référentiel, une pour les systèmes cibles, avec `fraicheurDe` et `systemesMuets` tels quels. Aucun
vocabulaire interne à l'écran : ni `SyncRun`, ni `FAILED`, ni `SKIPPED`, mais « ce système n'a pas
été lu depuis N heures, une liste vide ne dit donc rien de ce que vous y avez ». C'est la seule
décision actée du ticket qui porte sur la forme, et elle porte sur le sens : le vide de cette page
doit être qualifié, sinon il ment.

**D7. Le fournisseur du périmètre n'est pas un système cible.** Comme sur la fiche
(`src/app/personnes/[username]/page.tsx:91-96`), le run `espace-membre` alimente la bannière du
référentiel et sort de la liste des systèmes cibles. Le jour où le connecteur `espace-membre` en
lecture seule de la section 1.3 de `docs/architecture.md` arrivera, il remontera une adresse
`beta.gouv.fr` comme n'importe quel compte : c'est sa clé de connecteur qui entrera alors dans les
systèmes observés, sans que la règle change, puisque c'est la capacité `list` du connecteur qu'on
regarde et non l'ingestion du périmètre.

**D8. Le dossier n'est cliquable que pour un opérateur, et son détail n'est jamais affiché ici.**
Un non-opérateur voit la nature du dossier, son état, ses dates, le nombre d'étapes et le nombre
restantes. Il ne voit ni les libellés ni les notes. Le lien vers `/departs/[id]` n'apparaît que pour
un opérateur tant que #13 n'a pas posé le droit par objet : afficher un lien qui renvoie chez soi
serait une invitation à un mur. Le compteur des restantes passe par `estSoldee`
(`src/core/depart.ts:67`) et jamais par une liste d'états recopiée à la main.

**D9. `requireOperateur` distingue enfin ses deux refus.** Pas de session, on va à `/login`. Session
valide mais hors allowlist, on va à `/moi`. Inerte aujourd'hui, puisque aucune session de
non-opérateur ne peut exister, et indispensable le jour où #13 en crée : sans cela, le premier
non-opérateur connecté rebondirait sur l'écran de connexion sans jamais comprendre pourquoi. La
règle de relecture de l'allowlist à chaque requête ne bouge pas d'un pouce.

**D10. `/moi` n'appelle jamais `requireOperateur`.** Elle appelle `requireUtilisateur()`, nouvelle
fonction de `src/lib/session.ts` qui exige une session et rend `{ username, nom, email, operateur }`,
où `operateur` est recalculé depuis l'allowlist à chaque requête et jamais lu dans le jeton. Toute
autre disposition ferait de `/moi` la destination de sa propre redirection.

**D11. La navigation se réduit pour un non-opérateur.** Le gabarit passe `estOperateur` à
`Navigation`, qui rend la liste complète pour un opérateur et le seul lien « Mon espace » sinon.
L'entrée « Mon espace » est visible dans les deux cas : le ticket dit que la page sert aussi bien un
opérateur qu'une personne venue par un droit sur un dossier.

**D12. Consulter ne se journalise pas.** L'invariant dit que le journal précède l'action, et une
action est une écriture. Journaliser les lectures noierait le journal, dont la valeur tient
précisément à ce que tout ce qu'il contient a changé quelque chose. Aucun appel à `actionTracee` dans
ce lot, et par construction aucune écriture sans trace : il n'y a aucune écriture.

**D13. Le modèle de vue nomme la nature du dossier dès maintenant.** Le champ `nature` ne vaut que
`"depart"` aujourd'hui, la section s'appelle « Mes dossiers » et non « Mes départs », et le libellé
se choisit sur ce champ. Quand #8 généralisera dossier et plan, l'arrivée s'ajoute comme une valeur
et un libellé, pas comme une seconde section greffée à côté. L'ordre de livraison entre #8 et #14
n'a pas d'importance, aucun des deux ne reprend le travail de l'autre.

**D14. Un compte rattaché par recoupement le dit, et dit ce qui en découle.** Plutôt que de masquer
un rattachement `HEURISTIC` ou `NONE`, la page l'affiche avec sa conséquence : ce compte ne
produira aucune coupure tant que le rattachement n'est pas confirmé. C'est vrai, c'est utile à la
personne, et c'est l'invariant du dépôt énoncé à voix haute plutôt que dissimulé derrière un écran
qui trierait sans le dire.

**D15. Tension avec `docs/architecture.md`, et ce qu'on en fait : aucune modification proposée.** Le
document annonce en tête que « les écrans et le déploiement sont hors périmètre », donc un écran de
plus ne le contredit pas. Sa section 6 pose que seule l'équipe transverse agit : la page perso
n'offre aucun geste, elle ne l'entame pas. Sa section 3.2 impose de ne persister que le minimum : ce
plan n'ajoute aucun champ, ce qui est vérifiable au fait qu'il n'a aucune migration. La délégation,
elle, arrive avec #13, dont la DoD porte déjà la mise à jour de la section 6. Rien n'est donc à
modifier ici, et rien ne le sera sans validation explicite de l'utilisateur.

## Modèle de données

**Aucune migration Prisma. Le schéma n'est pas touché.**

Tout ce qu'il faut existe et est indexé : `Person.username` est unique
(`prisma/schema.prisma:92`), `ExternalIdentity.personId` est indexé (`:184`),
`DepartureCase.personId` aussi (`:311`), `Plan.departureCaseId` aussi (`:352`), `PlanStep.planId`
aussi (`:403`), et `SyncRun` porte `(provider, startedAt)` (`:283`). Les quatre requêtes de la page
tombent sur des index existants.

Que ce plan n'ait pas de migration est en soi une vérification : la page perso ne stocke rien de
nouveau sur les personnes, ce que la section 3.2 de `docs/architecture.md` exige en filtrant dès
l'ingestion.

Rappel qui vaut si une étape ultérieure devait toucher le schéma, ce que ce plan ne prévoit pas :
**toute modification de `prisma/schema.prisma` exige `pnpm db:generate` puis un redémarrage de
`pnpm dev`.** Les deux caches se cumulent, `prisma migrate dev` ne régénère pas toujours le client de
`src/generated/prisma`, et le client est mis en cache sur `globalThis`, donc il survit à la
régénération et sert des métadonnées périmées. Le symptôme est un typecheck vert et un runtime qui
refuse un champ.

## Découpage en étapes

**1. La session sait dire « connecté » sans dire « opérateur ».** Ajouter à `src/lib/session.ts` :

```ts
export interface Utilisateur {
  username: string;
  email: string | null;
  nom: string | null;
  operateur: boolean;
}

export async function utilisateurCourant(): Promise<Utilisateur | null>;
export async function requireUtilisateur(): Promise<Utilisateur>;
```

`operateur` est calculé par `estOperateur(username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES)`
à chaque appel, jamais lu dans le jeton. `requireUtilisateur` redirige vers `/login` en l'absence de
session et ne redirige jamais vers `/moi`. `requireOperateur` est réécrit sur `utilisateurCourant`
et sépare ses deux refus (D9). `operateurCourant` reste, ou devient un mince appel de
`utilisateurCourant`, au choix de l'implémentation, sans changer son contrat.
Fichiers : `src/lib/session.ts`.

Livrable vérifiable : tous les écrans existants se comportent exactement comme avant pour un
opérateur, et un `pnpm typecheck` propre.

**2. Le cœur, pur et testable.** `src/core/espace-perso.ts` porte les types et une seule fonction
d'assemblage. Entrée : la forme des lignes lues, le catalogue des systèmes couverts sous la forme
`readonly { key: string; label: string }[]`, les relevés de collecte, l'instant, et les seuils.
Sortie : un modèle de vue censuré (D5).

```ts
export type EspacePerso =
  | { fiche: "absente"; motif: "jamais-collecte" | "inconnue"; observation: Observation }
  | { fiche: "connue"; identite: IdentiteVue; comptes: readonly CompteVu[];
      dossiers: readonly DossierVu[]; observation: Observation };
```

`Observation` regroupe `fraicheur`, `systemesObserves` et `systemesMuets`, parce que ces trois
choses ne se lisent qu'ensemble et qu'aucun écran ne doit pouvoir en afficher une sans les autres.
Le catalogue est passé en paramètre plutôt qu'importé : `src/core` ne connaît pas `src/connectors`,
et la fonction reste testable sans registre.
Fichiers : `src/core/espace-perso.ts`.

**3. La lecture en base.** `src/lib/espace-perso.ts` expose
`chargerEspacePerso(username: string, maintenant: Date): Promise<EspacePerso>`. Un `Promise.all` de
quatre requêtes : la fiche avec ses identités triées, ses dossiers avec leur dernier plan et les
états de ses étapes, le dernier run du fournisseur de périmètre, et le dernier relevé `list` par
système. La clause de la fiche est `where: { username }`, en égalité stricte, et rien d'autre (D2).
La fonction ne fait qu'appeler le cœur avec `CONNECTEURS` et `policy().thresholds`.
Fichiers : `src/lib/espace-perso.ts`.

**4. L'écran.** `src/app/moi/page.tsx`, serveur, `export const dynamic = "force-dynamic"` comme
partout ailleurs. Appelle `requireUtilisateur()`, puis `chargerEspacePerso`. Quatre sections :
« Vous », « Vos comptes », « Ce qui a été regardé », « Vos dossiers ». Les bannières de fraîcheur
sont en tête, pas en bas, parce qu'elles qualifient tout ce qui suit. Le lien vers `/departs/[id]`
est conditionné à `utilisateur.operateur` (D8). Métadonnée de titre : « Mon espace ».
Fichiers : `src/app/moi/page.tsx`.

**5. La navigation et l'atterrissage.** `src/app/layout.tsx` passe à `utilisateurCourant` et
transmet `estOperateur` à `Navigation`, qui rend soit la liste complète augmentée de « Mon espace »,
soit ce seul lien. Le composant `Deconnexion` est inchangé, il prend déjà un `username`.
Fichiers : `src/app/layout.tsx`, `src/ui/Navigation.tsx`.

**6. Les tests.** Les cinq scénarios ci-dessous.
Fichiers : `src/core/espace-perso.test.ts`.

## Tests

Fichier : `src/core/espace-perso.test.ts`, pur, sans base, comme tout `src/core`. Cinq scénarios,
chacun raconté en Given / When / Then et portant plusieurs assertions.

**1. Rien de ce qui concerne quelqu'un d'autre ne franchit la fonction.** Given une fiche
`personne.exemple` avec deux comptes, un dossier dont le plan a été créé par `operateur.exemple` et
confirmé par `autre.operateur`, une étape portant le libellé « Retirer du groupe des
administrateurs » et une note de pointage citant `tierce.personne`, et un constat clos par
`operateur.exemple` avec une raison en texte libre. When on assemble l'espace perso de
`personne.exemple`. Then la sortie contient bien les deux comptes, le dossier, son état et ses
compteurs. Then une sérialisation complète de la sortie ne contient ni `operateur.exemple`, ni
`autre.operateur`, ni `tierce.personne`, ni le libellé d'étape, ni la note, ni la raison de clôture.
C'est l'assertion qui tient la DoD : elle survit à l'ajout d'un champ dans le modèle de vue, là où
une assertion champ par champ ne le ferait pas.

**2. Ne pas avoir de fiche n'est pas une erreur, et ne veut pas dire la même chose selon ce qu'on a
regardé.** Given aucune fiche pour `personne.exemple`. When aucune collecte du périmètre n'a jamais
eu lieu, Then la sortie est `fiche: "absente"` avec le motif `jamais-collecte`, et la fraîcheur dit
qu'aucune collecte n'a eu lieu plutôt qu'un âge de zéro heure. When une collecte du périmètre a eu
lieu il y a deux heures, Then le motif devient `inconnue`. Then dans les deux cas la sortie porte
quand même l'observation complète, systèmes muets compris : quelqu'un sans fiche a le droit de
savoir que l'outil ne regarde plus rien.

**3. Une liste de comptes vide est qualifiée par ce qui a été lu.** Given une fiche sans aucun
compte rattaché, un catalogue de trois systèmes. When aucun des trois n'a jamais été lu, Then les
trois sont muets avec la raison `non-lu` et la sortie ne prétend nulle part qu'il n'y a pas de
compte. When l'un a été lu il y a une heure, un autre a échoué, et le troisième a été lu il y a
deux fois le seuil, Then le premier est dans les systèmes observés, le deuxième est muet pour
`echec`, le troisième est muet pour `perime` avec son âge en heures. Then une fiche portant un
compte sur un système muet garde ce compte dans la liste : le silence porte sur ce qu'on ne voit
plus, pas sur ce qu'on a vu.

**4. Une personne partie voit ce qui la concerne, sans le détail des gestes.** Given une fiche
portant un `vanishedAt`, deux dossiers, l'un clos et l'autre en cours dont le plan compte cinq
étapes dont deux pointées faites, une déjà absente, une écartée et une encore à faire. When on
assemble. Then les deux dossiers sortent, ordonnés du plus récent au plus ancien, avec leur état et
leurs dates. Then le dossier en cours annonce cinq étapes et une restante, le compteur ayant été
obtenu par `estSoldee`, donc « déjà absent » et « écartée » comptent pour soldées. Then le dossier
clos n'annonce aucune restante. Then aucun libellé d'étape n'apparaît nulle part.

**5. Un compte rattaché par recoupement se signale, et ne promet aucune coupure.** Given trois
comptes de la fiche : un rattaché par login GitHub, un rattaché par déclaration, un rattaché par
heuristique, plus un quatrième compte du même système rattaché à personne. When on assemble. Then
les trois premiers sortent et le quatrième non. Then le compte heuristique porte un rattachement non
sûr, les deux autres un rattachement sûr. Then un compte disparu porte sa date de disparition et
reste affiché, parce qu'un compte qu'on ne voit plus est justement ce que la personne doit pouvoir
constater.

## Risques et pièges

**Personne ne peut éprouver le vrai cas d'usage avant #13.** Aucun non-opérateur ne peut se
connecter, donc le chemin « une personne venue par un droit sur un dossier » ne sera exercé par
aucun humain dans ce lot. C'est le risque principal, et il ne se contourne pas : ni en assouplissant
`signIn`, ni en simulant un rôle par un paramètre d'URL. Ce qui est vérifiable l'est par le test du
cœur avec `operateur: false` et par la lecture. Il faut le dire dans la PR plutôt que de laisser
croire que la page a été essayée telle qu'elle servira.

**La censure se perd au premier champ ajouté sans y penser.** Un modèle de vue qui grossit finit par
recopier une ligne de la base. Le scénario 1, qui sérialise toute la sortie, est la seule barrière
qui ne dépend pas de la vigilance de qui ajoute le champ. Ne pas le transformer en assertions
champ par champ.

**`revalidatePath("/moi")` serait un contresens.** Le contenu dépend de qui regarde. Aucune action
existante ne doit ajouter ce chemin à sa liste de revalidation, et `src/app/departs/actions.ts:42`,
qui revalide déjà un `/departs` inexistant, montre que la liste n'est pas relue souvent.

**La redirection croisée peut boucler.** Si `/moi` appelait `requireOperateur`, un non-opérateur y
serait renvoyé par une fonction qui l'y renvoie déjà. `requireUtilisateur` et `requireOperateur`
doivent rester deux fonctions distinctes, et `/moi` la seule page à n'utiliser que la première.

**Une fiche absente n'est pas un 404.** Répondre `notFound()` enverrait la personne chercher une
faute dans une adresse correcte, au lieu de lui dire que l'outil ne la connaît pas. C'est aussi le
premier écran d'un nouvel arrivant, dont la fiche n'existera parfois pas encore.

**Le repli par adresse reviendra par la porte de service.** Le jour où quelqu'un constatera qu'un
utilisateur ne voit rien alors qu'il a des comptes, la tentation sera de chercher sa fiche par
`primaryEmail`. C'est exactement le rapprochement heuristique, appliqué à l'écran le plus sensible
du produit. La bonne réponse est de rattacher son compte côté opérateur, geste qui existe déjà
(`src/app/comptes-isoles/actions.ts:159`).

**Le compteur des étapes restantes va changer de forme avec #10.** `estSoldee` y prend un objet à
deux dimensions au lieu d'un état. Le compteur de la page perso doit passer par cette fonction et
non par une liste d'états recopiée, sinon une étape en attente de validation sera comptée comme
soldée et la personne lira que son dossier est fini alors qu'il ne l'est pas.

**Un opérateur qui n'a pas de fiche est un cas réel, pas théorique.** `OPERATORS` vit dans
l'environnement, pas dans le périmètre : quelqu'un peut être opérateur sans figurer au référentiel.
Il verra donc la page « absente », ce qui est correct, et c'est aussi le seul moyen de vérifier ce
cas avant #13.

**Le libellé d'un système muet ne doit pas devenir un vocabulaire d'exploitation.** « FAILED »,
« SKIPPED » ou « SyncRun » sur cette page transformeraient une information en énigme. La règle est
simple : ce qui s'affiche ici se lit sans connaître le modèle.

**Deux écrans peuvent se contredire sur un compte heuristique.** Il apparaît sur la page perso
comme rattaché mais non sûr, et dans la file des comptes isolés de l'opérateur
(`src/app/comptes-isoles/page.tsx:24-30`). Les deux formulations doivent rester cohérentes, sinon
une personne lira « c'est votre compte » pendant qu'un opérateur lira « ce compte n'a pas de
détenteur ».

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build. Au-delà :

1. **Un opérateur ouvre `/moi` et s'y reconnaît.** Sa fiche, ses comptes, ses dossiers. Les écrans
   existants continuent de fonctionner à l'identique, y compris la déconnexion du bandeau.
2. **Aucun nom d'opérateur dans la page rendue.** Sur une base de développement, poser sur un
   dossier de l'utilisateur connecté un plan dont `createdBy` vaut `operateur.exemple` et une étape
   dont `lastError` cite `tierce.personne`, puis chercher ces deux chaînes dans le source HTML de
   `/moi`. Aucune occurrence.
3. **Un utilisateur sans fiche.** Ajouter à `OPERATORS` un username qui n'a aucune ligne `Person`,
   se connecter, ouvrir `/moi` : la page répond, dit qu'aucune fiche ne correspond, et aucun
   `error.tsx` ne s'affiche. C'est le seul chemin qui exerce ce cas avant #13, et il ferme le
   premier point de la DoD.
4. **Base sans aucune collecte.** La page distingue bien « jamais collecté » de « fiche inconnue »,
   et n'affiche aucun âge en heures.
5. **Un système en échec.** Forcer un dernier `SyncRun` `FAILED` sur `github` : `/moi` dit que ce
   système n'est pas observé et ne laisse pas croire que la liste des comptes est complète. Ferme le
   troisième point de la DoD.
6. **La navigation réduite.** Vérifiable seulement par un forçage local de `estOperateur` à `false`
   tant que #13 n'a pas livré. Le noter comme tel dans la PR, sans le présenter comme un essai en
   conditions réelles.
7. **Le journal ne bouge pas.** Ouvrir `/moi` plusieurs fois, vérifier qu'aucun événement n'est
   ajouté : la consultation n'écrit rien, donc elle ne trace rien, et l'invariant reste entier
   puisqu'il n'y a pas d'action.
8. **`ACTIONS_ENABLED` reste à `false` et aucun connecteur n'est appelé.** Relecture ciblée :
   `src/lib/espace-perso.ts` ne lit `CONNECTEURS` que pour le couple clé et libellé, et n'appelle ni
   `probe`, ni `list`, ni `plan`.
