# Faire participer à un dossier quelqu'un qui n'est pas opérateur (#13)

> Plan d'implémentation de l'issue #13. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.
>
> Reprise du 2026-08-30, sur le code de `985ee29`. Le plan initial avait été écrit avant le lot 5 :
> `DepartureCase` est devenu `AccessCase`, `src/core/depart.ts` est devenu `src/core/dossier.ts`,
> `/departs` est devenu `/dossiers`. Toutes les citations ont été recalculées dans les fichiers.
>
> Les dix décisions restées ouvertes après cette reprise, et l'addendum de périmètre qui les
> accompagnait, ont été tranchées. Elles vivent désormais dans le corps du plan, chacune à l'endroit
> où elle s'exécute, avec sa justification et ce qu'elle écarte. Ce document ne porte plus de section
> de décisions ouvertes, et aucun de ses arbitrages n'attend d'être rendu : ce qui y reste en
> suspens est nommé comme tel, et appartient à un autre ticket. Deux choses en dépendent encore
> néanmoins, et ce ne sont pas des arbitrages de conception : les amendements proposés à
> `docs/architecture.md` ne s'écrivent pas sans accord explicite, et l'observation nommée en D21
> peut rouvrir le seul choix pris sous une condition non levée.

## Ce qui existe aujourd'hui

**Une seule porte, et elle ne s'ouvre qu'aux opérateurs.** Le rappel de connexion passe par le
provider `espace-membre-beta-gouv-email` (`src/app/login/actions.ts:45`), et le callback `signIn`
rend `match !== null` où `match` vient de `resolveOperator` (`src/lib/auth.ts:52-65`). Quiconque
n'est ni dans `OPERATORS` ni dans `BREAK_GLASS_USERNAMES` (`src/lib/env.ts:38-39`) est refusé avant
même de recevoir un lien. Il n'existe aucun second rôle, aucun second provider.

**L'allowlist est relue à chaque requête, et c'est le modèle à imiter.** `requireOperateur`
(`src/lib/session.ts:23-36`) revérifie `estOperateur` à chaque passage plutôt que de faire confiance
au jeton, avec le commentaire qui l'explique (`src/lib/session.ts:18-21`). La session est en
stratégie `jwt` (`src/lib/auth.ts:41`) : elle porte un username signé pour des semaines, donc tout
droit stocké dedans serait un droit que rien ne sait retirer.

**Le proxy ne valide rien et ne doit pas commencer.** `proxy()` constate la présence d'un cookie et
redirige sinon (`src/proxy.ts:9-22`), son matcher couvre déjà `/dossiers/*` (`src/proxy.ts:28`). Il
n'a ni base de données ni session validée : un contrôle par dossier y serait un décor.

**Le passage tracé exige un opérateur, en dur.** `actionTracee` appelle `requireOperateur()` en
première ligne (`src/lib/actions.ts:36-37`), écrit le journal avant l'action (`:50`), puis écrit, et
repose sa trace en échec si l'écriture lève (`:58-62`). Toute écriture humaine passe par là, et
c'est exactement ce qui rend l'invariant tenable. Tel quel, aucun non-opérateur ne peut écrire quoi
que ce soit sans sortir du seul chemin qui journalise.

**Mais onze actions serveur lisent la base avant leur garde.** `actionTracee` n'est appelé qu'après
plusieurs `findUnique`, et chacune de ces lectures rend son propre message d'erreur : `enregistrerRevue`
(`src/app/comptes-de-service/actions.ts:21`), `rattacherIdentite` (`src/app/comptes-isoles/actions.ts:45`),
`creerFichePourCompte` (`src/app/comptes-isoles/creer.ts:37` puis `:63`),
`cloreConstat` (`src/app/constats/actions.ts:24`), les cinq actions de personne
(`src/app/personnes/[username]/actions.ts:35, 136, 147, 179, 244, 327, 385`), `modifierFiche`
(`src/app/personnes/[username]/edition.ts:88`) et `lancerCollecte` par `collecteEnCours`
(`src/app/collectes/actions.ts:35`). Sept fichiers en tout. Le dépôt connaît le raisonnement inverse
et l'applique déjà à deux endroits, `renommerFiche` (`edition.ts:295`, avec le commentaire `:291-294`)
et `autoriserDatation` (`collectes/actions.ts:98`). Tant que seuls des opérateurs ont une session,
c'est inerte. **Ce ticket est précisément celui qui en donne une à quelqu'un d'autre.**

`creerFichePourCompte` est la plus parlante des onze, et c'est aussi celle que ce plan ouvre par
ailleurs. Elle n'importe même pas `requireOperateur` (`creer.ts:3-6`) et rend quatre messages
distincts avant d'atteindre `actionTracee` (`:71`) : « Ce compte n'est plus en base. » (`:50`),
« Ce compte est déclaré comme compte de service. » (`:53`), « Ce compte est déjà rattaché. » (`:60`)
et « « ${username} » existe déjà : rattachez le compte à cette fiche. » (`:68`). Le dernier est une
sonde d'existence sur `Person.username`, qui rend en prime l'identifiant normalisé.

**Le username beta.gouv et l'adresse ne se confondent jamais.** `candidateUsernames` écarte toute
valeur contenant une arobase (`src/core/identite.ts:14-20`), le provider force l'identifiant en
minuscules et le passe à l'API espace-membre, et l'adaptateur du paquet route sur la présence d'une
arobase : `createUser` et `getUserByEmail` délèguent à l'adaptateur Prisma dès que la valeur en
contient une, et n'appellent l'espace-membre que sinon
(`node_modules/@incubateur-ademe/next-auth-espace-membre-provider/dist/Adapter.js:12` et `:27`). Le
wrapper de callbacks, lui, ne déclenche sa résolution que quand `account.provider` vaut son propre
identifiant **et** que la phase est `verificationRequest` (`dist/Callbacks.js:9`), et délègue au
nôtre dans tous les autres cas (`:26`). Un second provider par adresse se greffe donc sans toucher ni
à l'adaptateur ni au wrapper.

**L'adresse à laquelle part le lien n'est pas tout à fait celle de la base.** Le paquet calcule
`communication_email === "primary" ? primary_email : secondary_email`, sans repli
(`dist/ProviderConfig.js:27`, `dist/Adapter.js:7`). La collecte calcule
`communication_email === "secondary" ? (secondary_email ?? primary_email ?? null) : (primary_email ?? null)`
(`src/core/membre.ts:161-165`). Et `src/lib/espace-membre.ts:63` valide `communication_email` comme
une chaîne libre. Deux divergences sont donc atteignables : pour toute autre valeur que `"primary"`
et `"secondary"`, le lien part sur la secondaire pendant que la base porte la principale ; pour
`"secondary"` avec une secondaire nulle, le lien ne part sur rien pendant que la base porte la
principale. Tout ce qui, dans ce plan, suppose que la base sait où le lien partira repose sur une
égalité qui n'est pas garantie.

**Une fiche créée à la main n'a aucune adresse.** `creerFichePourCompte` pose `username`,
`usernameFabricated: true`, `fullname`, `attachment: "NONE"`, `source: "LOCAL"`, `startups: []`,
`firstSeenAt` et `lastSeenAt`, et rien d'autre (`src/app/comptes-isoles/creer.ts:79-91`) ;
l'identifiant est fabriqué par `normaliserIdentifiant` (`src/core/fiche-manuelle.ts:15-22`, appelée
`creer.ts:32`). C'est l'issue #1, livrée, qui ouvre l'édition de ces champs, adresses comprises
(`edition.ts:85`), et qui rend cet identifiant renommable (`edition.ts:287`).

**Le dossier suppose un opérateur du premier au dernier pixel.** `DossierPage` appelle
`requireOperateur()` (`src/app/dossiers/[id]/page.tsx:517`), affiche toutes les étapes sans filtre,
et nomme en bas de page l'auteur et le confirmateur du plan (`:1112-1114`). Le fichier fait 1123
lignes. Sept actions sont exportées (`src/app/dossiers/[id]/actions.ts:123, 199, 405, 540, 607, 706,
796`), dont six passent par `actionTracee` (`:162, 338, 484, 580, 647, 748`) ; `lancerExecution` s'en
dispense à dessein, et le dit (`:792-794`).

**Le rôle sur un dossier ne sait pas dire `DELEGATE`.** `roleSurDossier`
(`src/core/dossier.ts:197-206`) prend un username, un dossier et un booléen d'appartenance à
l'équipe, rend `SUBJECT` pour le porteur, `OPERATOR` sinon si le booléen est vrai, et `null` dans
tous les autres cas. Son commentaire `:193-195` est explicite : « `DELEGATE` n'en sort jamais : il
n'existe aucun droit par objet à lire. » C'est ce ticket qui pose ce droit. Deux sites de production
l'appellent, tous deux avec `true` : `src/app/dossiers/[id]/page.tsx:642` et
`src/app/dossiers/[id]/actions.ts:79` (dans `roleDeLOperateur`). Huit appels de plus dans
`src/core/dossier.test.ts` (`:478, 598, 599, 600, 605, 609, 671, 708`).

**Depuis #67, la garde du pointage lit deux faits, pas un.** `peutPointer`
(`src/core/dossier.ts:164-179`) reçoit un `Declarant` (`:144-147`), c'est-à-dire un rôle **et** une
appartenance à l'équipe, et refuse déjà ce qui nous intéresse : `:172-177` rend « Cette étape ne vous
revient pas » dès que `declarant.role !== acteurAttendu && !declarant.operateur`. Un participant se
construit donc `{ role: "DELEGATE", operateur: false }` et le type convient tel quel, sans évoluer ;
dupliquer ce contrôle ailleurs donnerait deux règles à maintenir. Aujourd'hui `pointerEtape` passe
`operateur: true` en dur (`actions.ts:268-271`) parce que `requireOperateur` a muré l'action avant.

**Aucune origine ne pose l'acteur attendu ni le contrôleur.** Les colonnes existent depuis le lot 5 :
`expectedActor` (`prisma/schema.prisma:595`, défaut `OPERATOR`), `validationBy` (`:608`, nullable),
`validation` (`:612`), `declaredBy` (`:617`), `validatedBy` (`:618`). Mais rien ne les produit.
`src/core/connector.ts:314-315` les déclare optionnelles sur `PlannedStep`, `src/lib/dossier.ts:421-422`
les recopie si elles sont présentes, `src/lib/execution.ts:379` les lit. Aucun connecteur, ni
`etapesDepuisModeles` (`src/core/modele-plan.ts:275`), ni l'octroi ne les écrit, et
`PlanTemplateStep` (`prisma/schema.prisma:675-706`) ne porte ni l'une ni l'autre :
`SELECTION_ETAPE` (`src/lib/modele-plan.ts:20-29`) ne sélectionne que `key`, `position`, `title`,
`runbook`, `deeplink`, `doneWhen`, `input` et `riskLevel`. Toute étape vaut donc « un opérateur
agit, personne ne contrôle ». C'est le constat de #66, et c'est le prérequis dur de l'étape 7 de ce
plan.

**L'accueil et la navigation ne connaissent que deux états.** `AccueilPage` appelle
`requireOperateur()` (`src/app/page.tsx:48`), donc un non-opérateur connecté serait renvoyé vers
`/login` alors qu'il a une session valide. Le layout résout `operateurCourant()`
(`src/app/layout.tsx:17`) et ne rend le bouton de déconnexion que s'il répond (`:27`), tandis que le
menu s'affiche entier dès qu'on n'est pas sur `/login` (`src/ui/Navigation.tsx:27-28`). Ce menu
compte **onze** liens (`src/ui/Navigation.tsx:8-20`). Un participant les verrait tous, ils le
rejetteraient tous, et il n'aurait aucun moyen de se déconnecter.

**Le filtre « personne » du journal ne regarde l'acteur que sur les sessions.**
`src/app/journal/criteres.ts:133-146` construit un `OR` par `flatMap` sur tous les identifiants
qu'une fiche a portés (`identifiantsLies`, `:75-111`), et n'y met `actorUsername` que couplé à
`targetType: "session"` (`:144`). Ce que quelqu'un fait lui-même sur une étape n'apparaîtrait pas
dans son historique.

**Pièges relevés dans le code existant.**

- `User.email` et `User.username` sont uniques (`prisma/schema.prisma:18`, `:23`). Deux voies
  d'authentification qui atterrissent sur la même ligne `User` héritent l'une des attributs de
  l'autre, et l'adaptateur ne rétro-remplit jamais un `username` sur une ligne existante.
- `VerificationToken` est unique sur `(identifier, token)` (`prisma/schema.prisma:64-70`, le
  `@@unique` en `:69`) et sert les deux providers. Le premier y range un username normalisé, le
  second y rangerait une adresse : deux espaces de noms disjoints, mais rien dans le schéma ne le
  garantit.
- La cascade du dossier n'est pas uniforme. `AccessCase.person` est en `Cascade`
  (`prisma/schema.prisma:449`), mais `Plan.accessCase` est en `SetNull` (`:497`), ce que
  `src/core/fiche-manuelle.ts:212-215` dit en toutes lettres : supprimer une fiche laisse « les plans
  du dossier supprimé avec un `accessCaseId` nul, vivants mais introuvables ». Une participation
  cascadera parce que sa propre relation le déclarera, pas parce que le dossier cascade tout.
- `Derogation` (`prisma/schema.prisma:750-763`) est le précédent exact de ce qu'il faut construire :
  une raison obligatoire, un auteur, un `expiresAt` obligatoire (`:759`). C'est la discipline anti
  pourrissement décrite en `docs/architecture.md:96-99`.
- **`docs/architecture.md` §6 décrit déjà ce ticket.** La sous-section « Qui agit, et comment on
  valide » (`:878-916`) a été réécrite par #69 : elle n'affirme plus que seule l'équipe transverse
  agit, elle énonce la règle sur la liste de l'environnement (`:880-884`), et sa promesse de greffe
  (`:910-916`) décrit littéralement une « délégation de l'exécution déclarative, où quelqu'un qui
  n'est pas opérateur voit un dossier et y pointe les étapes qui le nomment ». Voir D19.
- Il n'existe **aucune** contrainte `CHECK` dans les 22 migrations du dépôt, et le lot 5 a écrit
  pourquoi (`prisma/migrations/20260827090000_acteur_attendu_et_validation/migration.sql:21-27`) : le
  critère est qu'« aucune course ne peut en produire une invalide », et il distingue ces cas des
  « deux index uniques partiels de ce schema, ou l'invariant n'etait pas tenu par le code seul ».
- Les tests ne touchent jamais la base : `vitest.config.ts` tourne en `environment: "node"`. En
  revanche **tout ce qui est testé n'est pas pur** : `src/app/dossiers/[id]/actions.test.ts` teste
  des actions serveur avec `vi.mock("@/lib/session")` (`:104`) et `vi.mock("@/lib/db")` (`:133`). Un
  harnais existe, et ce plan peut s'en servir.

**Deux plans voisins mordent sur celui-ci, et il faut s'y caler plutôt que les doubler.** #14 pose la
route `/moi`, `requireUtilisateur()`, l'interface `Utilisateur` de `src/lib/session.ts`, la
séparation des deux refus de `requireOperateur` et la réduction de la navigation pour un
non-opérateur, en annonçant que tout cela reste inerte tant que #13 n'a créé aucune session de
non-opérateur. Aucun de ces objets n'existe aujourd'hui dans `src/` : c'est donc #13 qui crée la
forme minimale, et #14 qui la reprend (D17 bis). #8 est hors sujet : le renommage `AccessCase` est
passé, la clé étrangère naît directement sous `accessCaseId`.

## Décisions de conception

**D1. Rien dans le jeton ne dit ce qu'on a le droit de faire.** Le jeton porte qui est là, la base
dit ce qu'il peut. C'est la seule façon de tenir « un droit révoqué prend effet immédiatement, sans
attendre l'expiration d'une session » avec une stratégie `jwt`. Chaque page et chaque action relisent
le droit, exactement comme `requireOperateur` relit l'allowlist (`src/lib/session.ts:18-21`). Rien du
lot 5 ne l'entame, et c'est la décision la plus solide du plan.

**D2. Deux voies d'identification, disjointes par construction.** Qui existe dans l'espace-membre
entre par le provider actuel, sans rien changer à son fonctionnement : c'est l'espace-membre qui
décide où part le lien, et le username beta.gouv reste le pivot. Qui n'a qu'une fiche locale entre
par un second provider nodemailer, sur une adresse déclarée sur sa fiche. Une même personne n'a
jamais le choix entre les deux : la voie par adresse n'est ouverte qu'aux fiches dont
`ficheEditable` répond vrai (`src/core/fiche-manuelle.ts:50-61`), c'est-à-dire `source === "LOCAL"`
et pas déclarée dans `scope.local`. Le prédicat brut sur la colonne ne suffit pas : `PersonSource`
compte trois valeurs (`prisma/schema.prisma:76-80`), et une personne déclarée dans `scope.local` est
`LOCAL` tout en étant reconstruite chaque nuit depuis le YAML avec des adresses nulles. Deux portes
de force inégale vers la même personne reviendrait à ne garder que la plus faible.

**Une exception, et une seule, est nommée en D9 ter** : le canal qu'un opérateur déclare à l'octroi
ouvre la voie par adresse quelle que soit la source de la fiche. Elle ne contredit pas le principe,
elle en marque la limite : ce que D2 refuse est une porte que personne n'a décidé d'ouvrir, pas une
porte nominative, journalisée et bornée par l'échéance d'un droit.

**D3. Le formulaire de connexion reste à un seul champ.** L'arobase route vers la bonne voie, comme
elle route déjà dans l'adaptateur du paquet et dans `candidateUsernames`
(`src/core/identite.ts:17`). Demander à quelqu'un de choisir sa voie, c'est lui demander de savoir
comment l'outil est construit.

**D4. Le gate se pose avant l'envoi, et il se repose au retour du lien.** `sendToken` appelle
`callbacks.signIn` avec `email: { verificationRequest: true }` (`send-token.js:23-27`), lève
`AccessDenied` sur un refus (`:30`, `:33`), et ne génère le jeton (`:43`), ne l'envoie (`:48`) ni ne
l'écrit (`:61-65`) qu'après. Un refus posé plus tard ferait de cet outil un relais qui envoie du
courrier à n'importe quelle adresse saisie par n'importe qui.

Mais ce n'est que la première des deux invocations. `signIn` est rappelé quand le lien est suivi, par
`handleAuthorized({ user, account })` (`callback/index.js:167`), **sans** le champ `email`. Écrire le
contrôle sous un `if (email?.verificationRequest)` ouvrirait donc une session à un lien émis à T et
suivi à T+20 minutes alors que le droit a été révoqué à T+1. Le contrôle s'exécute aux deux
invocations, sur l'état du moment : un lien émis avant une révocation ne vaut plus rien après elle.
D1 sauve la page du dossier, elle ne sauve pas la création de la session.

**D5. L'écran de connexion rend une seule chaîne, quoi qu'il arrive.** Et c'est une correction du
comportement existant, pas une propriété de la voie nouvelle : aujourd'hui `loginAction` rend trois
messages distincts, saisie vide (`:39`), `AccessDenied` (`:51`) et le reste (`:53-54`). Or `sendToken`
appelle `adapter.getUserByEmail` **hors du `try`** (`send-token.js:14`, dont le `try` ne couvre que
`callbacks.signIn`, `:22-31`), et le wrapper y appelle `member.getByUsername`, qui lève sur tout
statut non ok. Un username inconnu de l'espace-membre part donc vers `:54` et un username connu hors
allowlist vers `:51`. C'est un oracle d'appartenance à l'annuaire beta.gouv entier, non authentifié,
en production aujourd'hui.

Le message devient donc unique et neutre, saisie vide comprise : les branches `:39`, `:51` et
`:53-54` disparaissent, le diagnostic part au `console.error` et au journal, que seuls les opérateurs
lisent, et un opérateur qui se trompe d'identifiant perd son diagnostic à l'écran. Coût assumé.

**L'unification est totale, et c'est ce qui la rend utile.** Ne neutraliser que la voie nouvelle
aurait été moins coûteux et n'aurait rien fermé : l'oracle qui existe aujourd'hui ne porte pas sur cet
outil, il porte sur l'annuaire beta.gouv entier, et il s'interroge sans être connecté. Protéger nos
quelques fiches locales tout en continuant de répondre, à qui le demande, si telle personne figure
dans l'annuaire, aurait été un garde-fou posé du mauvais côté de la porte.

**Le message ne suffit pas à lui seul, et le canal le plus visible n'est pas le texte : c'est
l'URL.** Aujourd'hui les deux branches n'atterrissent pas au même endroit. L'acceptation fait rendre
à `sendToken` un `{ redirect: ".../verify-request?..." }` (`send-token.js:67-72`), donc `signIn` lève
une redirection, que `loginAction` relance telle quelle (`:47-49`, `if (isRedirect(error)) { throw
error; }`) : le navigateur quitte `/login`. Le refus, lui, lève `AccessDenied` (`send-token.js:33`),
capté en `:50`, et rend une chaîne affichée en place par le `stateRelatedMessage` de l'`Input`
(`src/app/login/LoginForm.tsx:20-21`) : le navigateur reste sur `/login`. Unifier le texte sans
unifier la destination ne ferme rien, et rendrait infalsifiable la vérification « le même écran »
que ce plan s'impose.

`signIn` est donc appelé avec `redirect: false`, et `loginAction` rend la même chaîne dans les deux
branches sans jamais rediriger : l'écran de confirmation d'envoi devient un état du formulaire de
`/login`, pas une page distincte. La destination demandée reste portée par le lien et non par la
réponse au formulaire, `destination()` (`:29-31`) continuant d'alimenter `redirectTo`, qui ne joue
qu'au retour du lien.

Trois autres canaux disent encore la même chose. **Le temps** :
l'acceptation seule fait `Promise.all([sendRequest, createToken])` (`send-token.js:66`), donc une
poignée de main SMTP complète en plus, d'où une temporisation plancher sur les deux branches. **Les
erreurs de la branche acceptée** : SMTP indisponible ou `VerificationToken` en échec ne surviennent
que sur une adresse acceptée, donc elles se rattrapent et rendent le même message. **La saisie
malformée** : `defaultNormalizer` (`send-token.js:74-104`) lève sur deux arobases ou un guillemet
avant même `callbacks.signIn`, donc `voieDeConnexion` refuse ces formes en amont.

**D6. Aucune adresse saisie par un visiteur anonyme n'entre au journal.** Le journal est en écriture
seule et à rétention indéfinie (`docs/architecture.md` §3.3, `:374`) : y déverser des adresses tapées
par n'importe qui construirait un second fichier de personnel, ce que §3.2 (`:275`) refuse
explicitement pour les fiches. C'est tenable sans écrire une ligne de plus : `candidateUsernames`
filtre l'arobase (`src/core/identite.ts:17`), donc `candidateUsernames(user)[0]` vaut `undefined` sur
une saisie par adresse (`src/lib/auth.ts:58`), et `audit()` accepte un `actorUsername` absent
(`src/core/audit.ts:5`). `VerificationToken.identifier` n'est écrit qu'après l'autorisation.

Une réserve à écrire plutôt qu'à promettre : « une tentative non résolue journalise un refus sans
cible » est impossible sur la voie espace-membre sans toucher au paquet. Sur un 404, le wrapper rend
faux en `Callbacks.js:21-23` sans jamais appeler notre `signIn`. La symétrie des deux voies n'existe
pas de ce côté, et prétendre le contraire dans le plan ferait chercher un bug là où il y a une
dépendance.

**D7. Le droit est une ligne par couple dossier et personne, et il est ancré sur la fiche, pas sur
l'adresse.** L'adresse est un moyen de preuve, l'identité est une `Person`. Ancrer le droit sur une
adresse le ferait survivre à une correction de fiche et le rendrait intransférable au moment où la
personne change de boîte.

**D7 bis. L'identification par adresse se fait sur `Person.communicationEmail` seule, et l'unicité
est en base.** `primaryEmail` n'ouvre rien : sur une fiche collectée elle porte la boîte beta.gouv,
et la faire identifier ferait entrer par la porte faible quelqu'un qui doit entrer par la forte. Les
deux colonnes sont `String?` sans `@unique` (`prisma/schema.prisma:108-109`), et `validerChamps` ne
vérifie qu'une arobase après `trim().toLowerCase()` (`src/core/fiche-manuelle.ts:103-116`) : sans
contrainte, deux fiches peuvent porter la même adresse, la résolution devient un `findFirst` sans
`orderBy` donc non déterministe, et quiconque contrôle la seconde fiche détourne le canal.

**Attention à ne pas se tromper de raison.** Un index unique ordinaire suffirait à écarter les
nuls : PostgreSQL en accepte autant qu'on veut sous une contrainte d'unicité, et ce dépôt le prouve
trois fois, `User.email`, `User.username` et `Person.betaUuid` étant tous `String? @unique` alors que
chaque fiche locale naît sans identifiant beta (`src/app/comptes-isoles/creer.ts:79-91`). Une simple
déclaration `communicationEmail String? @unique` donnerait donc l'unicité sans une ligne de migration
écrite à la main. L'index du dossier vivant n'est pas le modèle : sa clause filtre des valeurs **non
nulles** pour exclure les dossiers clos, ce qu'aucune déclaration ne sait exprimer.

**La migration manuelle se justifie par la portée, pas par les nuls.** La forme retenue est
`WHERE "communicationEmail" IS NOT NULL AND "source" = 'LOCAL'`, parce que D2 n'ouvre cette voie
qu'aux fiches locales et que l'unicité au-delà n'achète rien. Elle achète même un risque, décrit
juste après : deux fiches collectées qui partagent une boîte d'équipe casseraient la collecte de
nuit sans qu'aucune saisie ne soit en cause. L'index se documente dans `schema.prisma` sans y
figurer, comme le fait `AccessCase` (`prisma/schema.prisma:452-456`, « Sans cette ligne, la garde
serait invisible a qui lit ce fichier »).

**Mais il ne mord pas là où le plan initial le croyait.** « À la saisie, où un opérateur peut
corriger » ne vaut que pour les fiches locales. Sur une fiche collectée, personne ne saisit :
`champsCollectes` (`src/lib/sync/perimetre.ts:103-134`) réécrit `communicationEmail` **sans
condition** (`:113`), depuis `emailDeContact(membre)` (`:255`, `:280`), et deux membres qui partagent
une boîte d'équipe en adresse secondaire produisent la même valeur. La correction promise y est
impossible : `ficheEditable` rend `{ editable: false, raison: "COLLECTEE" }` dès que
`source !== "LOCAL"` (`src/core/fiche-manuelle.ts:54-56`) et `modifierFiche` refuse en conséquence
(`edition.ts:96-98`). Le vrai lieu de la collision est donc la collecte de nuit, et son effet est
silencieux : l'écriture lève par personne, la boucle l'attrape (`perimetre.ts:333`), le passage
tombe en `PARTIAL` (`:359`), et la fiche concernée cesse d'être mise à jour, échéance et
`vanishedAt` compris. Même collision hors collecte : `rattacherIdentite` crée une fiche `LOCAL` avec
`communicationEmail: emailDeContact(horsPerimetre)` (`src/app/comptes-isoles/actions.ts:138-155`),
dans un `actionTracee` qui ne traite aucun `P2002`.

C'est cette collision-là que la portée `LOCAL` de l'index évite, et c'est ce qui décide de sa
forme. Reste le cas où deux fiches locales portent la même adresse : le contrôle préalable de la
section Vérification le remonte avant d'écrire la migration, et il se corrige à la saisie, une fiche
locale étant éditable par construction. Si l'on voulait un jour l'unicité au-delà des fiches
locales, il faudrait d'abord traiter la collision de collecte, pas seulement élargir l'index.

**Et cet index ne couvre qu'une des deux sources d'adresse depuis D9 ter.** Le canal déclaré à
l'octroi est la seconde, et aucun index ne peut l'unifier sans interdire du même coup à une même
personne de porter le même canal sur deux dossiers. Le refus de pluralité de D14 bis y devient donc
la seule garde, et il compte des personnes distinctes plutôt que des lignes.

**Et cette garde lit avant d'écrire, donc deux octrois simultanés sur le même canal la passent tous
les deux.** Aucune contrainte ne peut la doubler, pour la raison ci-dessus, et une transaction
sérialisée pour un geste que deux opérateurs poseraient à la seconde près sur la même adresse coûte
plus qu'elle ne protège. Le fait est écrit ici plutôt que découvert : la collision se manifeste au
`signIn` suivant, où le refus de pluralité écarte les deux candidats, et la sortie est la révocation
de l'un des deux droits. C'est bruyant et réparable, là où une adresse silencieusement partagée ne le
serait pas.

**D8. Le rôle se déduit, il ne se stocke pas.** Le titulaire du droit qui est aussi la personne du
dossier est le porteur, `SUBJECT` au sens du lot 5 ; tout autre titulaire est `DELEGATE`. Stocker le
rôle en plus de `AccessCase.personId` créerait deux vérités pour un même fait, et c'est la seconde
qui se périmerait. Cohérent avec la règle du dépôt : le statut d'une personne est calculé et jamais
stocké (`docs/architecture.md` §4.1, `:509`).

**D9. `expiresAt` et `reason` sont obligatoires, sur le modèle de `Derogation`.** Un droit sans
échéance ne se retire jamais parce que personne ne se souvient qu'il existe, et un droit sans motif
ne se relit pas. La révocation à la main reste possible à tout instant et prime sur l'échéance. Le
plafond de durée est celui de D9 bis, et il ne protège que contre le dossier qui reste ouvert
longtemps, ce qui arrive : un plan partiellement exécuté ne solde pas.

**D9 bis. Deux constantes de durée, et elles ne disent pas la même chose : trente jours de plafond,
quatorze par défaut.** Un plafond qui est aussi le défaut n'est pas un plafond, c'est une durée
unique déguisée : le formulaire proposerait le maximum, personne ne le baisserait, et D9 aurait posé
une échéance que rien ne serre. Le défaut est donc strictement inférieur au plafond, et les deux
vivent côte à côte dans `src/core/participation.ts`, exportées, pour que le formulaire qui
préremplit, l'action qui refuse et le test qui les lit tiennent la même valeur. Une durée recopiée
dans le formulaire est un plafond que le formulaire peut dépasser en silence.

**Ce que l'action refuse se dit ici**, parce que c'est ce qui fonde le retrait de la contrainte en
base plus bas : une durée qui n'est pas un entier strictement positif et au plus égal au plafond est
refusée avant toute écriture, et le refus vit dans l'action et non dans le seul formulaire. Zéro et
les valeurs négatives comptent : sans elles, un octroi poserait une échéance déjà passée ou égale à
sa date de départ, c'est-à-dire exactement la ligne que la contrainte retirée aurait attrapée. Les
quatre cas, zéro, négatif, valide et au-dessus du plafond, sont des scénarios de test et non des
gardes supposées.

Trente jours est l'horizon que l'outil appelle lui-même « proche » pour une fin de mission, si bien
qu'un droit ne survit jamais à la fenêtre pendant laquelle l'outil qualifie le départ d'imminent.
**Sans lire `thresholds.soonDays` pour autant** (`src/core/policy.ts:351-360`) : coupler ferait qu'un
réglage de politique déplacerait une règle d'autorisation, et c'est exactement la confusion que
`docs/architecture.md:880-884` sépare. La coïncidence des deux nombres se dit dans le commentaire,
elle ne se code pas.

Les deux autres échelles du dépôt ont été écartées, chacune pour sa raison. Sept jours
(`VALIDITE_JOURS`, `src/lib/dossier.ts:36`) est une péremption de constat, pas la bonne échelle, et
imposerait un ré-octroi hebdomadaire, c'est-à-dire exactement le geste que D9 existe pour empêcher :
mettre le maximum pour ne plus y penser. Cent quatre-vingts jours (`staleDays`,
`src/core/policy.ts:361-370`) est un accès permanent, et contredit D15 mot pour mot.

**D9 ter. L'octroi porte l'adresse à laquelle le lien partira. C'est un canal, pas un ancrage.** Le
droit reste la ligne, ancré sur la `Person` (D7) ; l'adresse n'est que le moyen de prouver une
identité, et elle se remplace sans toucher au droit. Sans ce champ, l'outil n'a aucun geste à offrir
quand la boîte de quelqu'un meurt pendant son départ, c'est-à-dire au moment précis où le mécanisme
sert le plus. Et pour une fiche collectée, il n'a aucune autre voie : `ficheEditable` rend
`{ editable: false, raison: "COLLECTEE" }` dès que `source !== "LOCAL"`
(`src/core/fiche-manuelle.ts:54-56`), `modifierFiche` refuse en conséquence
(`src/app/personnes/[username]/edition.ts:96-98`), et la destination du lien espace-membre est décidée
par l'amont seul (`ProviderConfig.js:24-28`). La dégradation assumée, où l'opérateur repointe à la
main à la place de la personne, est écartée pour cette raison : elle laisse l'outil sans réponse dans
le cas qui justifie le ticket.

Trois conséquences, et aucune n'est facultative.

D'abord, **le canal déclaré à l'octroi ouvre la voie par adresse quelle que soit la source de la
fiche**, ce qui est une exception mesurée à D2. L'exclusivité des deux voies vaut pour l'adresse
portée par la fiche, que personne n'a choisie pour ce dossier-là ; un canal tapé par un opérateur
dans un formulaire d'octroi nominatif, journalisé, borné par l'échéance du droit et incapable de
produire un opérateur (D14, verrou 3), n'est pas la porte faible que D2 refuse. La personne d'une
fiche collectée garde sa porte forte par ailleurs, et les deux mènent à la même `Person` et aux mêmes
droits.

Ce que l'index de D7 bis cesse alors de couvrir, et qu'il faut dire : la résolution d'une adresse a
désormais deux sources, la `communicationEmail` d'une fiche locale et le canal d'une participation
vivante. Aucun index ne peut interdire à deux participations de deux personnes différentes de porter
le même canal sans interdire du même coup à une même personne de le porter sur deux dossiers, qui est
le cas normal d'un délégué. Le refus de pluralité de D14 bis devient donc la seule ligne de défense
sur cette source-là ; il porte sur le nombre de **personnes** distinctes que l'adresse désigne, et
c'est pour ça qu'il se teste en premier.

Ensuite, **les quatre refus de D14 bis portent aussi sur ce canal**, à l'octroi et de nouveau au
`signIn`. Un canal dont la partie locale correspond à un identifiant d'allowlist se refuse à la
saisie, là où un opérateur peut encore corriger, et pas seulement à la connexion.

Enfin, **l'octroi refuse une fiche dont le `username` figure dans `OPERATORS` ou dans
`BREAK_GLASS_USERNAMES`**. Une participation n'ajoute rien à qui a déjà tout, `roleSurDossier` rendant
`OPERATOR` avant `DELEGATE` (voir étape 3) : la refuser ne retire aucun geste à personne, et elle
ferme la seule voie par laquelle ce champ pourrait servir à ouvrir une session assise sur la fiche
d'un opérateur.

**D10. Le droit meurt avec le dossier par déduction, pas par écriture.** Une participation sur un
dossier qui n'est plus vivant n'ouvre rien, et la ligne reste en base comme trace. Écrire une
révocation au moment de `cloreDossier` ajouterait une écriture qui peut échouer là où une lecture ne
peut pas.

**Quels états ouvrent : `dossierVivant` fait foi, et rien d'autre.** La règle se lit par
`dossierVivant` (`src/core/dossier.ts:448`) et jamais par un littéral, son commentaire `:434-438`
disant pourquoi, « un dictionnaire exhaustif fait tomber le typecheck le jour où une valeur s'ajoute
à l'énum, là où un tableau littéral aurait continué de mentir en silence », et les trois actions du
dossier gardant déjà dessus (`actions.ts:148`, `:249`, `:448`). La règle du plan initial, « un
dossier dont l'état n'est pas `DONE` », est écartée pour deux raisons à la fois : elle en serait le
troisième exemplaire littéral, et elle laisserait un droit vivant sur un dossier **annulé**,
`CaseState` comptant cinq valeurs (`prisma/schema.prisma:399-405`).

**L'octroi, lui, se refuse en plus sur `WATCH`, et cette règle-là mérite sa phrase.** `WATCH` est un
départ soupçonné et pas décidé : y octroyer un droit revient à dire à quelqu'un « on soupçonne le
départ de X » avant que quiconque l'ait tranché. C'est une divulgation, pas un accès. Les deux règles
restent distinctes et ne se confondent pas : `dossierVivant` gouverne ce qui ouvre, le refus de
`WATCH` gouverne ce qui s'écrit, et fondre le second dans le premier ferait un second dictionnaire
d'états là où il n'en faut qu'un.

Dans les deux cas, la règle se lit et ne s'écrit pas : rien ne pose de révocation au moment où le
dossier change d'état.

**D11. Ce qu'un participant voit découle de `expectedActor`, et de rien d'autre.** C'est la
formulation même du ticket. Elle impose un prérequis dur pour l'étape 7 : tant qu'aucune origine ne
pose `expectedActor` ni `validationBy`, toutes les étapes valent `OPERATOR` et un participant verrait
un dossier vide. La colonne existe depuis le lot 5, le prérequis a donc changé de porteur et pas de
nature : c'est **le chantier des modèles de plan porteurs de contrôleur** qui le lève, celui que #66
appelle à trancher en premier lieu et qui vit dans le même lot 6 que ce ticket. Vérification qui
coûte une seconde avant d'y toucher : `SELECT DISTINCT "expectedActor" FROM "PlanStep";` ne doit
rendre que `OPERATOR`.

**D11 bis. `validerEtape` s'ouvre au délégué, et `validationApresPointage` cesse d'établir la
substitution sur le rôle.** Les deux vont ensemble : ouvrir la première sans corriger la seconde
ouvrirait un trou plutôt qu'une fonctionnalité.

*Le formulaire.* `validerEtape` (`src/app/dossiers/[id]/actions.ts:405`) accepte un délégué. La
répartition « un délégué contrôle le porteur » est prévue par le lot 5 et documentée
(`src/core/dossier.ts:246-247`), et `peutValider` l'accepte déjà telle quelle : il ne refuse
`DELEGATE` que face à `validationBy === "OPERATOR"` (`:315`). La laisser fermée reviendrait à faire
poser par le chantier des modèles de plan des contrôleurs que rien n'atteint, donc à rendre inutile
la moitié de ce qu'il va écrire.

*Le pointage.* `validationApresPointage` (`:263-274`) établit aujourd'hui la substitution sur le seul
rôle : `roleDuDeclarant === validationBy && roleDuDeclarant !== acteurAttendu` (`:271-273`). Deux
faits distincts y sont testés d'un coup, et un seul des deux survit à l'arrivée de `DELEGATE`. Que le
déclarant ne soit pas l'acteur attendu se lit encore par le rôle, `roleSurDossier` n'en rendant qu'un
seul par personne. Mais que le déclarant **soit le contrôleur attendu** ne s'en déduit plus :
`roleDuDeclarant === validationBy` dit « ce déclarant est un délégué », jamais « ce déclarant est le
délégué que cette étape attend », et rien ne sait distinguer deux délégués l'un de l'autre. C'est mot
pour mot ce que le commentaire de `combinaisonValide` dit déjà (`:222-227`), « `roleSurDossier` ne
rend jamais `DELEGATE`, là où `OPERATOR` sort d'une liste nommée » ; ce ticket est celui qui lui
retire sa prémisse.

La règle devient donc nominative du côté du contrôleur, qui est celui qui casse : `ACCEPTED` demande
que le déclarant soit **nommément établi comme le contrôleur attendu**, et qu'il ne soit pas l'acteur
attendu. Seul `OPERATOR` satisfait aujourd'hui le premier terme, parce que la liste qui le nomme est
celle de l'environnement et que `roleSurDossier` ne rend ce rôle qu'après l'avoir lue ; `DELEGATE` ne
le satisfait jamais, faute d'une étape qui nomme son contrôleur. Un délégué qui pointe une étape
attendue du porteur laisse donc l'étape en `AWAITING`, et c'est un autre délégué qui la signe par
`validerEtape`, `peutValider` refusant le déclarant lui-même par son nom (`:327`). L'inverse, poser
la comparaison sur le nom de l'acteur attendu, ne ferme rien : le déclarant y diffère du porteur dans
les deux cas, celui du contrôleur délégué comme celui du contrôleur opérateur, et la règle rendrait
`ACCEPTED` dans les deux.

La fonction reçoit donc le déclarant par son nom autant que par son rôle, et le nom du porteur, seul
nom qu'un rôle désigne aujourd'hui. Ce second nom est redondant tant que `roleSurDossier` rend
`SUBJECT` au porteur avant tout le reste, et il s'écrit quand même, pour la raison du paragraphe
suivant. Le coût se compte à trois endroits, pas à un : un site d'appel de production
(`src/app/dossiers/[id]/actions.ts:329-333`), où le porteur est déjà relu (`:235`) ; les **huit
appels existants** de `src/core/dossier.test.ts` (`:486`, `:504`, `:547`, `:561`, `:592`, `:806`,
`:829`, `:830`), tous à trois arguments positionnels, tous à reprendre, les nouveaux paramètres ne
pouvant pas être optionnels sans laisser par défaut la règle même que cette correction retire, là où
le quatrième fait de `roleSurDossier` se range en option pour cette raison exacte (étape 3) ; et le
scénario neuf du test 7.

*Ce que cette correction achète, et ce qu'elle n'achète pas.* Elle ne referme pas un trou ouvert
aujourd'hui, et le plan ne le prétend pas : un déclarant de rôle `DELEGATE` ne peut pointer qu'une
étape que son propre rôle attend, `peutPointer` refusant tout le reste à qui n'est pas de l'équipe
(`src/core/dossier.ts:172-177`), si bien que `roleDuDeclarant === acteurAttendu` et que
l'auto-validation ne se déclenche pas. Ce qu'elle achète est l'indépendance : cette sûreté-là est le
produit de deux autres règles, le refus de `peutPointer` et l'ordre porteur puis opérateur puis
délégué de `roleSurDossier`, et rien n'avertira qui touchera à l'une des deux qu'il déplace aussi une
règle de signature. Détecter une substitution par le rôle ne tient que tant qu'un rôle désigne une
personne unique ou une liste nommée, et `DELEGATE` est le premier qui désignera plusieurs personnes
que rien ne distingue à ce niveau. Sans cette correction, `docs/architecture.md:900-901`, « comparée
sur le nom et non sur le rôle », devient faux le jour où un modèle pose un contrôleur délégué.

*Ce que ce ticket n'élargit pas.* Le même raisonnement vaut pour `OPERATOR`, dont le rôle désigne lui
aussi plusieurs personnes : un opérateur qui pointe en substitution obtient `ACCEPTED` signé de son
propre nom, ce que `peutValider` lui refuserait par le formulaire (`:327`). Ce n'est pas un oubli,
c'est un comportement voulu, documenté (`:253-256`) et testé, et l'aligner ferait attendre un second
opérateur sur un outil qui en compte un. Le changer appartient à une issue séparée : voir « Ce qui
reste à ouvrir ailleurs ».

**D11 ter. Le participant a sa route, il n'a pas une version censurée de celle de l'opérateur.**
`src/app/dossiers/[id]/page.tsx` fait 1123 lignes et livre du contexte d'équipe en une demi-douzaine
d'endroits qui n'ont rien en commun : la note libre `etape.lastError`, écrite par un opérateur pour
un opérateur (`:454-456`), `etape.declaredBy` (`:462`), `etape.validatedBy` et `etape.validationNote`
(`:474-476`, `:480-482`), `runbook` et `deeplink` (`:415-421`), le pied de page `createdBy` et
`confirmedBy` (`:1112-1114`), l'empreinte du plan (`:538`), la clé de profil (`:749-750`), le plafond
de masse et les écarts de modèle (`:1007-1082`), et tout ce que la requête charge par étape
(`:551-572`), `systemKey`, `capability`, `idempotencyKey`, `riskLevel`, `lastError` et
`grantExpiresAt`.

Un modèle de vue censuré sur cette route est écarté, et pas parce que la forme serait mauvaise :
`docs/plans/#14_page-perso.md:155` l'écrit bien, « la censure est un calcul testé, pas une omission
de `select` ». Elle coûte un audit permanent de 1123 lignes à chaque champ ajouté, et surtout elle
rédacte par soustraction : elle laisse passer, par construction, tout ce qu'on ajoutera demain sans y
penser. La route dédiée coûte un écran de plus et fait disparaître la classe entière de fuites d'un
coup. Ce que les deux écrans partagent, la liste des étapes qui nomment le participant, se rend
depuis un composant partagé ; le reste, l'en-tête, les gestes et le pied de page, ne se partage pas
parce que ce n'est pas le même.

**D12. `actionTracee` s'élargit, il ne se double pas.** Un second chemin d'écriture pour les
non-opérateurs perdrait sa trace le jour où quelqu'un l'oublierait. Deux précisions que le plan
initial n'avait pas, et sans lesquelles l'élargissement ne se code pas.

D'abord, `exige` ne suffit pas. `actionTracee` rappelle `requireOperateur()` de son côté
(`src/lib/actions.ts:37`), et la moitié des actions du dossier ont besoin du nom **avant** de
l'appeler : `pointerEtape` résout l'identité en première ligne et le dit (`actions.ts:203-205`), « la
garde précède la trace : `peutPointer` a besoin de savoir qui pointe avant qu'on écrive quoi que ce
soit, et `declaredBy` a besoin de son nom ». Quatre points d'accroche y sont hors d'`actionTracee`
(`:205`, `:262`, `:268-271`, `:369`), même structure dans `validerEtape` (`:409`, `:457`, `:465`) et
dans `confirmerPlan` (`:127`). Une seconde résolution dans `actionTracee` serait une seconde lecture
en base, donc un second endroit où le droit peut être lu autrement que par le premier. `ActionTracee<T>`
accepte donc un `Utilisateur` déjà résolu, passé par l'appelant ; `exige` ne sert que pour les actions
qui n'ont pas besoin du nom en amont.

Ensuite, la valeur qui identifie le dossier est toujours dérivée de l'objet relu en base, jamais du
formulaire. Le motif inverse existe déjà : `cloreDossier` lit son `dossierId` dans `formData`
(`actions.ts:546`). Si `pointerEtape` faisait de même, un participant ayant un droit sur X pointerait
une étape de Y en soumettant `dossierId = X`. Aujourd'hui `pointerEtape` dérive bien le dossier de
l'étape relue (`:233-235`), et ce plan l'écrit noir sur blanc plutôt que de compter dessus.

**D13. La voie d'identification figure dans la charge utile de chaque écriture d'un non-opérateur.**
`actorUsername` dit qui, `after.voie` dit comment son identité a été prouvée. Sans ça, une fiche
fabriquée nommée comme un opérateur produit une ligne `actorKind: HUMAN, actorUsername:
"operateur.exemple", action: "auth.signin", targetType: "session"` strictement indiscernable de la
connexion réelle de cet opérateur, et le filtre du journal la fait remonter dans son historique
(`criteres.ts:144`). C'est la seule chose qui distingue un username beta.gouv d'un identifiant
fabriqué au journal.

**D14. Un identifiant fabriqué ne doit jamais pouvoir devenir un username d'opérateur.** C'est le
vrai danger du ticket, et il demande quatre verrous, pas trois.

*Ce qui rend l'escalade possible.* Le seul calcul de la qualité d'opérateur est
`estOperateur(username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES)`
(`src/core/identite.ts:33-39`), appelé en `src/lib/session.ts:27` et `:47`. Il prend une chaîne et ne
sait pas d'où elle vient. Or `renommerFiche` ne compare rien aux allowlists : ni `OPERATORS` ni
`BREAK_GLASS_USERNAMES` n'apparaissent dans `src/app/personnes/[username]/edition.ts` ni dans
`src/app/comptes-isoles/creer.ts`. Ses seules gardes sont `requireOperateur()` (`:295`), `renommable()`
(`:309`), la longueur minimale (`:317`) et l'unicité de `Person.username`. Et `normaliserIdentifiant`
produit exactement `[a-z0-9.]` (`src/core/fiche-manuelle.ts:15-22`), la forme même d'un username
beta.gouv. Il suffit donc qu'un opérateur de bonne foi renomme une fiche fabriquée en
`operateur.exemple` : c'est la raison d'être de #1, personne ne le vivra comme un octroi de droits,
aucune confirmation, aucun avertissement, aucune trace distincte.

1. **Le jeton porte `Person.id`**, un cuid que rien n'édite, jamais le username.
2. **Le callback `jwt` ne consulte `resolveOperator`** que lorsque `account.provider` vaut
   `ESPACE_MEMBRE_PROVIDER_ID`.
3. **`Utilisateur` porte deux champs distincts**, `username` pour nommer et `operateur` pour
   autoriser, et `operateur` vaut faux **par construction** dès que `voie` vaut la voie par adresse.
   La qualité d'opérateur ne se calcule que sur un username issu du jeton posé par la voie
   espace-membre.
4. **`renommerFiche` et `creerFichePourCompte` refusent tout identifiant présent dans `OPERATORS` ou
   dans `BREAK_GLASS_USERNAMES`**, en le disant. L'allowlist se lit dans `webEnv` et se passe en
   argument au cœur pur, comme `estOperateur` le fait déjà.

Le quatrième n'est pas un doublon des trois autres : c'est le seul qui protège un allowlisté sans
fiche. Les verrous d'adresse sont ancrés sur un état qui n'existe que pour des gens déjà connus, une
ligne `User` née d'une connexion antérieure ou une `Person` collectée. Un `BREAK_GLASS_USERNAMES`
qui ne s'est jamais connecté n'est couvert par aucun des trois. Retirer l'un des quatre au motif que
les autres suffisent est un refus de revue.

**D14 bis. La voie par adresse refuse quatre choses, et la première doit distinguer la ligne `User`
qu'elle a elle-même créée.** Elle refuse toute adresse qui désigne plus d'une personne, cas que
l'index de D7 bis rend impossible sur les fiches locales mais qu'il ne couvre pas sur les canaux
d'octroi de D9 ter, si bien que ce refus n'est pas décoratif et se teste en premier ; toute adresse
portée par une fiche que `ficheEditable` ne dit pas modifiable, **sauf** quand elle vient d'un canal
d'octroi, qui est précisément là pour ce cas ; toute adresse dont la partie locale correspond à un
identifiant d'allowlist ; et toute adresse portée par une ligne `User` **qui n'est pas celle de cette
fiche**.

Ce quatrième refus est le moins intuitif, et sa formulation naïve, « toute adresse portée par une
ligne `User`, munie d'un `username` ou non », enferme dehors le participant lui-même dès sa
**deuxième** connexion. Le chemin, vérifié dans le paquet installé : au premier lien suivi,
`callback/index.js:171` appelle `handleLoginOrRegister` ; `handle-login.js:55` teste
`account.type === "email"`, `:57` ne trouve rien, et la branche `:74-79` appelle `createUser` (`:76`)
; `Adapter.js:11-13`, l'adresse contenant une arobase, délègue à l'adaptateur Prisma, qui crée une
ligne `User` avec cet email et **sans** `username`. La stratégie `jwt` n'y change rien : `:81-87`
n'évite que `createSession`, jamais `createUser`. À la demande de lien suivante,
`send-token.js:14` résout cette ligne, hors du `try`, et la passe à `callbacks.signIn` (`:23-27`),
donc à `adresseRecevable`, qui refuserait la personne pour la ligne qu'elle vient elle-même de faire
naître.

La règle est donc : `adapter.getUserByEmail` rend nul, **ou** rend une ligne dont l'email est
exactement l'adresse qui vient de résoudre ce candidat, la `communicationEmail` de la fiche **ou** le
`channelEmail` d'une participation vivante de cette même fiche (D9 ter), et dont le `username` est
nul. Les deux origines comptent, et l'oubli de la seconde retournerait le refus contre le parcours
même que D9 ter existe pour servir : sur une fiche collectée, la `communicationEmail` est la boîte
beta.gouv que la collecte réécrit sans condition (`src/lib/sync/perimetre.ts:113`), jamais le canal,
et la ligne `User` que le premier lien fait naître porte le canal. Une règle indexée sur la seule
fiche enfermerait donc dehors, dès sa deuxième demande de lien, la personne dont la boîte vient de
mourir, c'est-à-dire exactement celle pour qui le champ a été créé. C'est suffisant, et pour une
raison précise : toute ligne née de la voie espace-membre porte un `username`
(`Adapter.js:14-24` le pose depuis l'API), donc une ligne sans `username` sur une adresse que le
premier refus vient de déclarer sans ambiguïté de personne ne peut appartenir qu'au titulaire de
cette fiche. L'ordre des refus est donc porteur et pas cosmétique : c'est le premier qui rend le
quatrième sûr. Une variante plus lourde mais plus explicite existe, rattacher la ligne `User` à la
`Person` dès sa création et faire porter le refus sur « une ligne dont le rattachement désigne une
autre fiche » ; elle coûte une colonne et n'apporte rien tant que le premier refus tient.

Ce que le refus continue de fermer, et qui est le vrai danger : une ligne `User` **munie** d'un
`username` est celle d'un opérateur qui s'est déjà connecté, et l'adopter donnerait au participant
une session assise sur elle. Sur `account.type === "email"`, si `getUserByEmail` trouve une ligne,
elle est en effet **adoptée** et seul `emailVerified` est mis à jour (`handle-login.js:58-73`, la
mise à jour en `:68-71`).

Reste le cas symétrique, que ce refus ne peut pas couvrir parce qu'aucune ligne n'existe encore
quand il s'exécute : un opérateur qui ne s'est **jamais** connecté, dont l'adresse est déclarée sur
une fiche locale. La fiche reçoit une participation, la personne suit son lien, une ligne `User`
naît avec cette adresse et sans `username`. Plus tard l'opérateur se connecte. `send-token.js:14`
résout cette ligne, puis `Callbacks.js:14` calcule `w = e.user.username || e.user.email` : `username`
est nul, donc `w` vaut l'adresse, donc `member.getByUsername(adresse)` répond 404, donc `:21-23` rend
faux **sans jamais appeler notre `signIn`**. `AccessDenied`, pour toujours, jusqu'à une intervention
en base. Contre celui-là, le seul garde-fou est le troisième refus, sur la partie locale
d'allowlist ; il est heuristique, et c'est à écrire plutôt qu'à masquer.

**D15. Il n'y a pas de compte, il y a un dossier ouvert.** La voie par adresse n'est ouverte que tant
qu'une participation vivante existe sur cette fiche. Le canal d'entrée naît avec le droit et meurt
avec lui. Pendant exact de `Derogation.expiresAt` obligatoire (`prisma/schema.prisma:759`) et de
`docs/architecture.md:96-99`.

Ce qui reste, et qu'il faut dire : la session, elle, survit à la mort du droit. Le cookie reste
valide pour toute la durée du jeton NextAuth (`callback/index.js:196`, `sessionMaxAge`), et une ligne
`User` demeure que rien ne supprime jamais. C'est D1 qui rattrape, en refusant à chaque page et à
chaque action, pas l'expiration du canal. Il n'y a pas de compte dormant à retirer, il y a une
session dormante qui n'ouvre plus rien.

**D16. Le lien de la voie par adresse est valable trente minutes.** Il existe pour être suivi tout de
suite, et un lien de connexion transféré est un accès transféré. C'est implémentable tel quel :
`send-token.js:45` lit `provider.maxAge ?? 86400`. Deux bornes différentes à ne pas confondre : le
lien vaut trente minutes, la session qu'il ouvre vaut la durée du jeton NextAuth. La voie
espace-membre n'est pas touchée, c'est le chemin des opérateurs et le modifier sortirait du
périmètre.

**D17. Rien ici n'écrit sur un système cible.** Octroyer, révoquer, se connecter, pointer : ce sont
des écritures locales et des déclarations. `ACTIONS_ENABLED` reste hors sujet et à `false`, aucun
`dryRun` n'est à câbler, aucun connecteur n'est invoqué. Corollaire à tenir : ce chemin ne doit
jamais servir à glisser un geste qui toucherait un fournisseur.

**D17 bis. `/moi` et `requireUtilisateur` naissent ici, et #14 les reprend.** La branche
conditionnelle du plan initial est tranchée par le code : `src/app/moi` n'existe pas, et
`requireUtilisateur`, `utilisateurCourant` et `Utilisateur` n'existent nulle part dans `src/`. #13
crée donc la forme minimale décrite par `docs/plans/#14_page-perso.md:252-265`, et #14 l'enrichit.
Une seconde page d'atterrissage et un second résolveur de session obligeraient à savoir laquelle fait
foi, et la réponse changerait avec l'ordre de livraison.

**D18. Aucune variable d'environnement nouvelle.** Les opérateurs vivent dans l'environnement parce
qu'ils changent sans livraison et concernent l'outil entier. Une participation porte sur un objet,
change tous les jours et se révoque en un clic : elle relève du décidé, donc de PostgreSQL
(`docs/architecture.md` §1.4, `:87`). `docs/architecture.md:880-884` le renforce depuis #69 : la
liste des opérateurs vit hors du dépôt et n'est pas celle du rattachement. Un droit par objet n'a
rien à y faire. `src/lib/env.ts` n'est pas modifié.

**D19. `docs/architecture.md` §6 décrit déjà ce ticket : il n'y a plus de tension, il y a un texte à
passer au présent.** Le plan initial argumentait contre trois citations qui n'existent plus. Depuis
#69, la sous-section « Qui agit, et comment on valide » vit en `:878-916` et dit ceci :

- `:880-884` : « **Seuls agissent ceux que l'environnement autorise.** La liste qui les nomme vit
  hors du dépôt, avec la configuration de déploiement ». La règle porte sur la liste, plus sur
  l'équipe transverse. C'est elle que #13 complète, et il n'y a pas de lecture qui sauve le document
  sans le modifier.
- `:910-916` : « ce qui se prépare est autre chose, une délégation de l'exécution déclarative, où
  quelqu'un qui n'est pas opérateur voit un dossier et y pointe les étapes qui le nomment, sans en
  calculer ni en confirmer aucun. L'attente était bien le mécanisme, elle vit sur l'étape et non sur
  le plan. » C'est la description littérale de ce ticket.

Ce qui reste à écrire, et qui se propose à l'étape 8 sans s'appliquer : `:880` devient une phrase à
deux niveaux, la liste ouvre l'outil, un droit par objet ouvre un dossier et rien d'autre ; la phrase
« Il n'y a pas de délégation aux leads dans cette version » (`:884-886`) tombe ; `:910-916` passe au
présent et dit où vit le droit ; `CaseParticipation` entre dans la liste du décidé (`:376-377`).

Et **la Definition of Done du ticket est à amender** : « `docs/architecture.md` §6 est mis à jour :
la délégation arrive, et elle se greffe là où le document l'avait prévu » est infalsifiable contre
`:910-911`, qui dit exactement l'inverse, « ne se greffera pas où ce document l'avait prévu ».

**D20. Aucun assouplissement de la règle d'identité.** Une identité dont `matchMethod` vaut
`HEURISTIC` ou `NONE` ne produit toujours aucune étape de révocation. `autoriseUneRevocation` reste
le seul filtre, via `systemesDuDepart` (`src/core/dossier.ts:567-574`). Ce ticket ne change ni la
source des étapes ni leur calcul, seulement qui a le droit de les regarder et de les pointer.

**D21. La bascule d'une fiche locale vers `BETA` se signale, et le canal se marque mort.** La
collecte peut adopter une fiche fabriquée au milieu d'un dossier : `champsCollectes`
(`src/lib/sync/perimetre.ts:103-134`) réécrit **sans condition** `primaryEmail` et
`communicationEmail` (`:112-113`) et `source` (`:121`), et pose `usernameFabricated: false` (`:108`),
par `prisma.person.update` (`:152`) ou `prisma.person.create` (`:159`). Une fiche `LOCAL` dont
l'identifiant finit par correspondre à un membre de l'espace-membre passe donc `BETA` du jour au
lendemain, ses adresses saisies sont écrasées, `ficheEditable` cesse de la dire modifiable, et le
canal porté par la fiche n'ouvre plus au `signIn` suivant. Un lien déjà envoyé cesse de fonctionner
au milieu d'un dossier, sans que personne n'ait rien fait.

Le droit survit, son canal se marque mort, et le fait s'écrit. Deux gestes concrets : la collecte
journalise la bascule quand la fiche porte au moins une participation vivante, par une ligne `SYSTEM`
sur le modèle de celle qu'elle écrit déjà en fin de passage (`src/lib/sync/perimetre.ts:438-445`) ;
et la liste des droits marque « canal mort » toute participation dont ni le canal d'octroi ni la
fiche ne résolvent plus, avec les deux sorties qui la rattrapent, ré-octroyer en déclarant une
adresse (D9 ter), ou dire à la personne d'entrer par son identifiant beta.gouv. D9 ter désamorce en
grande partie le cas : une participation octroyée avec un canal explicite traverse la bascule
intacte, la collecte n'écrivant que sur `Person`.

**Ce choix s'écarte de ce que la reprise recommandait, et c'est délibéré.** La bascule automatique
vers la voie espace-membre est séduisante, la fiche étant désormais un membre : même personne, même
dossier, et la porte forte s'ouvre à la place de la faible. Mais elle repose sur une hypothèse jamais
levée, celle que l'adresse résolue par le provider pour une fiche fraîchement adoptée est
atteignable. Basculer sur une voie dont on n'a pas observé le comportement enfermerait quelqu'un
dehors au milieu de son dossier, en silence, ce qui est le pire des trois échecs possibles. On prend
donc l'option sûre sous les deux hypothèses : elle coûte un geste d'opérateur quand la bascule
automatique aurait marché, et elle ne coûte rien quand elle n'aurait pas marché.

**Ce qu'il faudrait observer pour rouvrir ce choix**, parce qu'un arbitrage pris faute d'observation
doit dire laquelle le lèverait. Sur une fiche que la collecte vient d'adopter, quatre points, dans
cet ordre : que `member.getByUsername(username)` réponde 200 ; que la fiche rendue soit active, sans
quoi le wrapper refuse avant que notre `signIn` ne soit appelé (`Callbacks.js:17-18`) ; que le
sélecteur `communication_email` désigne une adresse non nulle, sachant que toute valeur autre que
`"primary"` retombe sur `secondary_email` sans repli (`ProviderConfig.js:27`) ; et qu'un courrier
envoyé à cette adresse arrive réellement. Les quatre tenus, la bascule silencieuse devient sûre et le
signalement peut redevenir informatif au lieu d'appeler un geste. Un seul manquant, l'option retenue
ici reste la bonne.

**D22. Le déplacement des participations est du travail de #13, pas du plan de fusion de #1.** #1 est
livré et son mécanisme est en place : `EtapeFusion` est une union fermée de onze variantes
(`src/core/fiche-manuelle.ts:217-228`), exécutée par un `switch` dans la transaction
(`src/app/personnes/[username]/edition.ts:462`). Sans une douzième variante, `supprimer-fiche`
(`:228`) laisse la cascade du schéma emporter les participations de la fiche source, sans une ligne
d'erreur et sans une ligne au journal : le droit disparaît, la personne perd son accès au milieu d'un
dossier, et rien ne dit pourquoi. Le commentaire de l'union l'annonce lui-même (`:208-216`),
« supprimer la fiche source avant d'avoir tout déplacé fait agir les cascades du schéma à notre
place ». Renvoyer ce travail au plan de #1 reviendrait à demander la retouche d'un ticket livré pour
un objet qui n'existait pas quand il a été écrit.

Un cas que ni #1 ni la première rédaction de ce plan ne voyaient : `@@unique([accessCaseId,
personId])` entre en collision dès que les deux fiches portent une participation sur le même dossier.
Le dépôt connaît déjà ce motif et son traitement, `Finding.dedupKey` étant unique sur toute la table
et `fermer-constats` réglant la collision par un abandon nommé
(`src/core/fiche-manuelle.ts:299-303`). Même traitement ici, à une précision près qui décide :
**c'est la plus récente qui survit, et l'autre est abandonnée en étant nommée au journal**, quelle
que soit la fiche dont elle vient. Dire « celle de la source est abandonnée » serait un raccourci
faux dès que la fiche fabriquée porte le droit le plus récent, ce qui arrive précisément quand un
opérateur vient de le poser avant de découvrir le doublon. À dates de dépôt égales, celle de la
fiche cible l'emporte, parce qu'elle est celle qui survit à la fusion et que le départage doit être
déterministe plutôt que juste. Les deux ordres se testent. Fondre les deux droits en un seul, en
gardant la plus lointaine échéance et en concaténant les motifs, est écarté : ce serait fabriquer un
octroi que personne n'a décidé, avec une échéance que personne n'a choisie.

## Modèle de données

Une migration, additive, sans reprise de données : le modèle est nouveau et vide.

```prisma
model CaseParticipation {
  id String @id @default(cuid())

  accessCaseId String
  personId     String

  /// Motif obligatoire, comme sur une dérogation : un droit dont personne ne sait
  /// plus pourquoi il a été posé ne se retire jamais.
  reason String

  /// L'adresse à laquelle le lien de connexion partira, quand un opérateur en a
  /// déclaré une ici. Nulle, le canal est celui de la fiche. C'est un moyen de
  /// preuve borné par l'échéance du droit, jamais l'ancrage du droit : celui-ci
  /// est personId, et lui seul.
  channelEmail String?

  grantedBy String
  grantedAt DateTime @default(now())
  expiresAt DateTime

  revokedAt     DateTime?
  revokedBy     String?
  revokedReason String?

  accessCase AccessCase @relation(fields: [accessCaseId], references: [id], onDelete: Cascade)
  person     Person     @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([accessCaseId, personId])
  @@index([personId, revokedAt])
  @@index([expiresAt])
  @@index([channelEmail])
}
```

Deux relations inverses à ajouter : `participations CaseParticipation[]` sur `AccessCase`
(`prisma/schema.prisma:407-461`) et sur `Person` (`:92-151`).

`onDelete: Cascade` est déclaré sur les deux relations, et il faut le déclarer : la cascade du
dossier n'est pas uniforme, `Plan.accessCase` étant en `SetNull` (`:497`). Poser `SetNull` ici par
symétrie produirait des droits orphelins pointant vers rien.

Aucun enum de rôle : il se déduit de la comparaison entre `personId` et `accessCase.personId` (D8).
Une seule colonne d'adresse, et c'est le canal de D9 ter. L'adresse **affichée** continue, elle, de
se lire sur la fiche, comme un libellé de constat se recalcule plutôt que de se figer
(`docs/architecture.md` §3.3, `:374`) : les deux ne se confondent pas, `channelEmail` dit où l'outil
enverra un lien, la fiche dit ce que l'amont sait de la personne, et c'est justement quand les deux
divergent que le champ sert. Son index n'est pas décoratif : c'est par lui que la connexion résout
une adresse, sur le chemin le plus chaud du ticket. Et ce n'est **pas** un index unique, pour la
raison écrite en D9 ter, une même personne portant légitimement le même canal sur deux dossiers.

**L'unicité sur le couple est voulue, et elle a une conséquence à traiter.** Ré-octroyer après
révocation réécrit la même ligne. Mais `grantedAt @default(now())` date alors le **premier** octroi
et non celui qui court, ce qui rend l'échéance illisible et l'audit trompeur. Le ré-octroi repose
donc explicitement les cinq champs de l'octroi, `grantedAt`, `grantedBy`, `reason`, `expiresAt` et
`channelEmail`, et remet `revokedAt`, `revokedBy` et `revokedReason` à nul, en un seul `update`
conditionné. `channelEmail` en fait partie sans exception : le laisser en place ferait survivre à un
nouvel octroi une adresse choisie pour l'ancien, c'est-à-dire exactement la boîte qui vient de
mourir. L'historique des octrois vit dans le journal, qui est déjà la voie de reconstruction de tout
ce qu'un opérateur attribue (`docs/architecture.md` §3.5, `:474-486`).

**Index unique partiel sur l'adresse d'identification**, à coller à la main dans le fichier généré
après `prisma migrate dev --create-only` (D7 bis) :

```sql
-- Prisma ne sait pas exprimer un index partiel, d'ou l'ecriture a la main ; il n'y voit
-- pas de derive et le laisse en place. La clause WHERE ne sert pas a autoriser plusieurs
-- lignes nulles, PostgreSQL les autorise deja sous un index unique ordinaire : elle
-- borne l'unicite aux fiches que la voie par adresse ouvre reellement. L'etendre aux
-- fiches collectees casserait la collecte de nuit le jour ou deux membres partagent une
-- boite d'equipe, sans qu'aucune saisie soit en cause et sans que personne ne puisse
-- corriger, ces fiches n'etant pas editables.
CREATE UNIQUE INDEX "Person_communicationEmail_unique"
  ON "Person" ("communicationEmail")
  WHERE "communicationEmail" IS NOT NULL AND "source" = 'LOCAL';
```

**Ce que cette écriture à la main coûte, et pourquoi elle est quand même assumée.** À la différence
de l'index du dossier vivant, qui filtre sur des valeurs non nulles
(`WHERE "state" IN ('WATCH', 'CANDIDATE', 'CONFIRMED')`) et que Prisma ne saurait effectivement pas
exprimer, `communicationEmail String? @unique` produirait ici exactement la même garantie sans
migration `--create-only` ni commentaire de rattrapage. Le dépôt le prouve trois fois : `betaUuid
String? @unique` sur `Person` (`prisma/schema.prisma:105`) coexiste avec toutes les fiches locales,
que `creer.ts:79-91` crée sans jamais le renseigner, et `User.email` (`:18`) comme `User.username`
(`:23`) sont dans le même cas, cette dernière étant nulle sur toute ligne née de la voie par adresse.
L'écriture à la main est un choix : elle laisse l'index visible dans la migration à côté de sa
raison, au prix d'une main qui doit le recopier. Le nom `Person_communicationEmail_unique` est une
proposition, la seule convention constatée dans le dépôt étant
`AccessCase_un_seul_vivant_par_sens`.

Il se documente dans `schema.prisma` sans y figurer, en commentaire au-dessus des deux colonnes
d'adresse, sur le modèle exact de `AccessCase` (`prisma/schema.prisma:452-456`).

**Pas de contrainte `CHECK` sur `expiresAt > grantedAt`.** Le critère du lot 5 est écrit noir sur
blanc (`prisma/migrations/20260827090000_acteur_attendu_et_validation/migration.sql:21-27`) :
« aucune course ne peut en produire une invalide », ce qui distingue ces cas des « deux index uniques
partiels de ce schema, ou l'invariant n'etait pas tenu par le code seul ». Ici la course n'existe
pas : `expiresAt` se calcule depuis `grantedAt` et les constantes de D9 bis, dans la même action,
sans rien qui puisse s'intercaler. La garder aurait coûté une garde en base à documenter dans
`schema.prisma` sous peine d'être invisible à qui le lit, pour un invariant que le code tient seul.
Et elle ne verrait pas le vrai défaut de datation, le ré-octroi qui laisse `grantedAt` sur le premier
octroi : c'est le paragraphe ci-dessus qui le traite, en reposant les cinq champs.

Nom de migration proposé : `participation_a_un_dossier`, dans la lignée de
`20260818161504_marche_a_suivre_figee`.

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`.** Les deux caches se
cumulent : `prisma migrate dev` applique bien la migration sans toujours régénérer le client de
`src/generated/prisma`, et le client est mis en cache sur `globalThis`, donc il survit à la
régénération et sert des métadonnées périmées. Le symptôme attendu ici est un
`Unknown argument 'participations'` au runtime alors que le typecheck passe.

## Prérequis durs

Deux, et ils ne se contournent pas.

**Le chantier des modèles de plan porteurs de contrôleur**, pour l'étape 7 seule. Tant que
`PlanTemplateStep` ne porte ni `expectedActor` ni `validationBy`, toutes les étapes valent
`OPERATOR` et un participant ouvre un dossier vide (D11). Ce chantier vit dans le lot 6, au même
titre que ce ticket, et c'est lui que #66 appelle à trancher en premier lieu ; #13 ne pose pas ces
colonnes lui-même et ne préempte pas la décision de savoir quelles étapes de quel modèle portent un
contrôleur. Les étapes 1 à 6 de ce plan tiennent seules et se livrent avant : elles donnent une
identification, des droits, un octroi et une révocation démontrables, journalisés et testés.

**L'étape 1 de ce plan**, pour tout le reste. Voir ci-dessous.

## Découpage en étapes

L'ordre n'est pas une commodité de revue, et deux points s'y jouent : l'étape 1 doit précéder
l'étape 4, sans quoi elle ne protège rien pendant la seule fenêtre où elle compte ; et l'étape 7
attend un prérequis qui ne lui appartient pas, sans quoi elle n'a rien à montrer.

### 1. La garde de session en première ligne

**Cette étape est livrée en premier, avant l'étape 4 qui crée les premières sessions de
non-opérateur. Livrée après, elle ne protège rien pendant la seule fenêtre où elle compte.** Une
personne qui suit un lien de participation obtient une session valide ; le proxy laisse passer dès
qu'un cookie existe, sans le valider (`src/proxy.ts:9-13`, commentaire `:5-8`) ; et les onze actions
serveur listées plus haut lisent la base et rendent un message d'erreur distinct **avant** que
`actionTracee` n'appelle `requireOperateur()` (`src/lib/actions.ts:37`). Ce que ça donne : une
énumération du référentiel, fiches, constats, comptes isolés, comptes de service, startups,
éditabilité des fiches, sans écriture et **sans aucune trace**, puisque `actionTracee` n'est jamais
atteint. C'est le point de la Definition of Done que le plan ne vérifiait que sur le dossier.

Toute action serveur exportée pose donc sa garde de session en première ligne, avant la moindre
lecture, sur le modèle de `renommerFiche` (`src/app/personnes/[username]/edition.ts:291-295`). Les
onze actions restent opérateur seul, seule leur garde remonte.

- `src/app/comptes-de-service/actions.ts`, `src/app/comptes-isoles/actions.ts`,
  `src/app/comptes-isoles/creer.ts` (lectures en `:37` et `:63`, aucune importation de
  `requireOperateur` aujourd'hui), `src/app/constats/actions.ts`,
  `src/app/personnes/[username]/actions.ts`, `src/app/personnes/[username]/edition.ts`,
  `src/app/collectes/actions.ts`.

`creer.ts` mérite d'être nommé plutôt que compté : c'est le seul fichier que ce plan ouvre par
ailleurs, l'étape 4 lui demandant le verrou 4 de D14, et ce serait donc le seul qu'on toucherait
sans y remonter la garde.

Une dizaine de lignes, mécanique et sans risque. **Vérification, et elle ne se fait pas sur la liste
ci-dessus, qui se périmera au prochain ajout :** `grep -rln '"use server"' src/` rend treize
fichiers ; chacun doit soit poser sa garde en première ligne de chaque action exportée, soit
n'exporter que des actions qui n'ont rien à lire. Deux seulement relèvent du second cas aujourd'hui,
`src/app/login/actions.ts` et `src/ui/Deconnexion.tsx`. Les quatre autres sont déjà en règle et
servent de modèle : `src/app/dossiers/actions.ts` (`:29`, dans `ouvrir`, les deux exports y
délèguent), `src/app/dossiers/[id]/actions.ts` (`:127`, `:205`, `:409`, `:544`, `:611`, `:710`,
`:800`), `src/app/modeles/actions.ts` (`:104`, `:118`, `:138`, `:157`) et
`src/app/startups/[ghid]/actions.ts` (`:124`, `:198`, `:305`).

### 2. Le droit en base

Poser le modèle, la migration, l'index unique partiel et son commentaire. Livrable seul : rien ne
change de comportement, mais la base sait exprimer le droit.

- `prisma/schema.prisma` : `CaseParticipation`, les deux relations inverses, et le commentaire qui
  documente l'index partiel au-dessus des colonnes d'adresse.
- `prisma/migrations/<horodatage>_participation_a_un_dossier/migration.sql` : table, index, index
  unique partiel.

Vérification : insérer une ligne à la main, supprimer le dossier, constater que la ligne a disparu ;
déclarer la même `communicationEmail` sur deux fiches et constater le refus de PostgreSQL ; et, à
l'inverse, insérer deux participations de deux personnes différentes portant le même `channelEmail`
et constater que la base **accepte**. Ce dernier point n'est pas un oubli qu'on relève, c'est la
forme voulue : le refus vit dans le code et pas dans un index, pour la raison écrite en D9 ter.

### 3. Le cœur pur

Toute la décision vit dans un module sans Prisma, donc testable en gros scénarios.

- `src/core/participation.ts` (nouveau) :
  - `participationVivante(participation, etatDossier, maintenant)`, qui exige `revokedAt` nul,
    `expiresAt` postérieur à maintenant, et `dossierVivant(etatDossier)` (D10) ;
  - `voieDeConnexion(saisie)`, qui rend la voie espace-membre pour un identifiant sans arobase, la
    voie par adresse pour une adresse bien formée, et rien pour une saisie vide, à deux arobases ou
    porteuse d'un guillemet, avant que `defaultNormalizer` ne lève (D3, D5) ;
  - `adresseRecevable(candidats, ligneUser, allowlists, declaresLocaux)`, qui applique les quatre
    refus de D14 bis. Les deux derniers paramètres ne sont pas décoratifs, et une signature plus
    courte ne porterait que la moitié des refus. `candidats` est ce que la résolution de l'adresse
    rend, zéro, un, ou plus d'un : le refus de pluralité est testé en premier, et un `candidat` au
    singulier le rendrait inobservable. Chaque candidat porte sa fiche **et l'origine du canal**, la
    `communicationEmail` de la fiche ou le `channelEmail` d'une participation vivante (D9 ter) :
    `ficheEditable` n'est exigé que sur la première origine, un canal déclaré à l'octroi valant pour
    une fiche collectée. Et la pluralité se compte en **personnes** distinctes, deux participations
    d'une même personne sur deux dossiers portant légitimement le même canal. `declaresLocaux` est
    exigé par `ficheEditable`, dont la signature est `ficheEditable(fiche, declaresLocaux)`
    (`src/core/fiche-manuelle.ts:50-53`) et dont la seconde branche est précisément
    `declaresLocaux.includes(fiche.username)` (`:57`), celle que D2 invoque nommément. La liste se lit
    chez l'appelant et se passe en argument, comme `src/app/personnes/[username]/edition.ts:96` le
    fait déjà avec son helper `:71`, pour que le module reste pur ;
  - `canalMenace(fiche, canal, domainesMenaces)`, l'avertissement de l'octroi. Il ne se calcule pas
    par l'égalité `communicationEmail === primaryEmail` : cette heuristique est plus faible que le
    plan initial ne le croyait, elle rate une secondaire qui est elle aussi une boîte que le départ
    coupe, adresse ADEME comprise, et elle lève une fausse alerte sur une fiche qui n'a qu'une seule
    adresse renseignée. La liste des domaines menacés est une déclaration de politique, pas une
    égalité de colonnes, et elle se passe en argument pour que le module reste pur ;
  - `DUREE_DEFAUT_JOURS` et `DUREE_MAX_JOURS`, les deux constantes de D9 bis, exportées : le
    formulaire préremplit avec la première, l'action refuse au-delà de la seconde, et le test lit les
    deux ;
  - `etapesVisiblesPour(role, etapes)`, la projection sur `expectedActor` (D11). Elle prend un rôle
    et non un nom, **et ce n'est pas un oubli** : `expectedActor` est une énumération de rôles, pas
    une désignation de personne, si bien qu'aucune étape ne dit « ce délégué-ci ». Deux délégués sur
    un même dossier voient donc les mêmes étapes et peuvent les pointer l'un pour l'autre,
    exactement comme deux opérateurs le font aujourd'hui, et c'est la substitution que le lot 5 a
    voulue. Ce qui manquerait pour faire autrement n'est pas un argument de plus à cette fonction
    mais une désignation nominative sur l'étape, que le modèle ne porte pas et que ce ticket
    n'introduit pas. Le noter ici évite qu'on lise le droit par dossier et par personne comme s'il
    filtrait aussi les étapes.
- `src/core/policy.ts` : la liste des domaines de courrier qu'un départ coupe, déclarée dans
  `configSchema` (`:321`) avec un défaut raisonnable, comme `terminalPhases` (`:327-334`) dont la
  description dit déjà pourquoi ce genre de liste n'est pas du code (`:332`), « le vocabulaire de
  beta.gouv évolue, et décider qu'une phase est terminale est un choix métier ». Le commentaire du
  schéma le dit en tête (`:318-320`) : tout y a un défaut, une instance sans fichier de configuration
  fonctionne quand même. Régénérer ensuite `config.schema.json` par `pnpm policy:schema`, et compléter
  `config.exemple.yaml`.
- `src/core/fiche-manuelle.ts` : la fusion apprend à déplacer les participations (D22). Une douzième
  variante `{ type: "deplacer-participations"; ids }` dans `EtapeFusion` (`:217-228`), déclarée
  **avant** `supprimer-fiche` (`:228`) et surtout empilée avant lui dans `etapes`, ce qui est ce qui
  décide vraiment : le commentaire `:208-216` fait de cet ordre sa raison d'être, « supprimer la
  fiche source avant d'avoir tout déplacé fait agir les cascades du schéma à notre place » ; le champ
  correspondant dans `PlanFusion` (`:236-267`), pour que l'inventaire annonce ce qu'il déplacera avant
  de l'écrire ; et la collision d'unicité traitée dans `planifierFusion` (`:291`) sur le modèle de
  `fermer-constats` (`:299-303`), la participation de la source abandonnée et nommée, la plus récente
  conservée.
- `src/core/dossier.ts` : `roleSurDossier` (`:197-206`) gagne un **quatrième fait**, la participation
  vivante sur ce dossier. Ce n'est pas un argument posé par le lot 5, contrairement à ce que le plan
  initial affirmait : il n'existe pas. Trois points à tenir. **L'ordre est porteur, puis opérateur,
  puis délégué**, et pas celui qu'on croit. Le porteur d'abord, `docs/architecture.md:897-903`
  l'impose. Mais l'opérateur avant le délégué : l'inverse ferait rendre `DELEGATE` à un opérateur qui
  détient aussi une participation, et `peutValider` (`:315`) le lui opposerait ensuite pour lui
  refuser une validation qu'il peut faire aujourd'hui. Une participation n'ajoute rien à qui a déjà
  tout. `DELEGATE` ne sort donc que pour qui n'est ni le porteur ni un opérateur. Et le paramètre est
  **optionnel et en quatrième position** : les deux sites de
  production (`src/app/dossiers/[id]/page.tsx:642`, `src/app/dossiers/[id]/actions.ts:79`) et les
  huit appels de `src/core/dossier.test.ts` restent compilables sans retouche, là où un objet
  d'options les casserait tous. Compilables, ce qui n'est pas juste : `page.tsx:642` garde son `true`,
  cette page restant opérateur seul (`:517`), mais `actions.ts:79` est l'intérieur de
  `roleDeLOperateur`, que l'étape 7 doit reprendre pour de bon. L'option achète l'ordre de livraison,
  elle ne dispense de rien. Le commentaire `:193-195` est à réécrire : il dit aujourd'hui que
  `DELEGATE` n'en sort jamais.

Rien à faire sur `peutPointer` ni sur `Declarant` : depuis #67, `Declarant` porte le rôle et
l'appartenance à l'équipe (`src/core/dossier.ts:144-147`), et `:172-177` refuse déjà à un non-opérateur
toute étape qui ne le nomme pas. Un participant se construit `{ role: "DELEGATE", operateur: false }`.
Dupliquer ce contrôle ailleurs donnerait deux règles à maintenir.

### 4. L'identification

- `src/lib/auth.ts` : second provider `Nodemailer` **non enveloppé**, avec `maxAge` à trente minutes
  (D16), à côté du provider espace-membre existant (`:47-51`). Le wrapper accepte les ids `email` et
  `nodemailer` en entrée (`ProviderConfig.js:3-7`) et pose le sien en sortie (`:19`) : un
  `Nodemailer()` nu garde `"nodemailer"`, les deux coexistent. Le callback `signIn` distingue les
  deux cas : sur le provider espace-membre, il accepte un opérateur comme aujourd'hui, ou un membre
  dont la fiche porte une participation vivante ; sur le provider par adresse, il résout l'adresse par
  `adresseRecevable`, en lui donnant les candidats des **deux** sources, la `communicationEmail` des
  fiches locales et le `channelEmail` des participations vivantes (D9 ter), exige une participation
  vivante, et refuse sinon. **Le
  contrôle s'exécute aux deux invocations de `signIn`, à l'envoi et au retour du lien** (D4). Le
  callback `jwt` ne consulte `resolveOperator` que si `account.provider` vaut
  `ESPACE_MEMBRE_PROVIDER_ID` (D14), et pose `token.participantId` et `token.voie` dans les deux cas
  où une fiche a été résolue. Le callback `session` recopie ces deux valeurs, et l'augmentation de
  module (`src/lib/auth.ts:11-24`) déclare les champs correspondants. **Et l'appel `audit` du
  callback `signIn` (`src/lib/auth.ts:56-62`) gagne `after: { voie }`, dans les deux voies et y
  compris sur un refus.** C'est le seul endroit où l'événement de connexion s'écrit : il est posé
  directement dans le callback, hors d'`actionTracee`, donc l'élargissement de l'étape 5 ne
  l'atteindra jamais. Sans lui, D13 décrit un chemin qu'aucune étape ne ferme, et une fiche
  fabriquée nommée comme un opérateur produit la ligne `actorKind: HUMAN, actorUsername:
  "operateur.exemple", action: "auth.signin", targetType: "session"` que rien ne distingue de la
  connexion réelle de cet opérateur. Le type l'accepte tel quel, `AuditInput.after` étant optionnel
  (`src/core/audit.ts:11`).
- `src/lib/session.ts` : création de `Utilisateur`, `utilisateurCourant()` et `requireUtilisateur()`
  sous la forme que `docs/plans/#14_page-perso.md:252-265` décrit, plus deux champs, `personId` et
  `voie`. `operateur` est recalculé depuis l'allowlist à chaque appel et **jamais** sur un username
  issu de la voie par adresse : il y vaut faux par construction (D14, verrou 3). `requireOperateur`
  est réécrit sur `utilisateurCourant` et sépare ses deux refus : pas de session vers `/login`,
  session valide hors allowlist vers `/moi`. Rediriger un participant vers l'écran de connexion lui
  affirmerait à tort que sa connexion a échoué.
- `src/app/personnes/[username]/edition.ts` et `src/app/comptes-isoles/creer.ts` : refus de tout
  identifiant présent dans `OPERATORS` ou `BREAK_GLASS_USERNAMES` (D14, verrou 4), l'allowlist lue
  dans `webEnv` et passée en argument au cœur pur.
- `src/app/login/actions.ts` : `loginAction` route sur `voieDeConnexion` et appelle `signIn` avec le
  bon identifiant de provider, **et avec `redirect: false`** (D5). Les trois branches de message
  disparaissent au profit d'une seule chaîne, temporisation plancher comprise, et le rethrow de
  `isRedirect` (`:47-49`) disparaît avec elles : tant qu'il subsiste, l'acceptation quitte `/login`
  pour `/verify-request` pendant que le refus y reste, et le message unique ne ferme rien.
  `destination()` (`:29-31`) est conservée, mais son rôle se dit désormais explicitement : elle
  alimente `redirectTo`, qui ne joue qu'au retour du lien, jamais la réponse au formulaire.
- `src/app/login/LoginForm.tsx`, `src/app/login/page.tsx` : un seul champ, libellé et texte d'aide
  reformulés pour dire qu'on accepte l'un ou l'autre, et le message neutre affiché après envoi.
- `src/app/moi/page.tsx` (nouveau) : forme minimale, `requireUtilisateur()`, `force-dynamic`, la
  liste des dossiers couverts par un droit vivant. #14 la reprend et l'enrichit (D17 bis).
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/ui/Navigation.tsx` : résoudre l'utilisateur et non
  plus l'opérateur, rendre le bouton de déconnexion dans les deux cas, et réduire les onze liens
  (`Navigation.tsx:8-20`) au seul « Mon espace » pour un non-opérateur. Onze liens qui rejettent tous
  sont une fuite sur la forme de l'outil autant qu'une impasse.

Vérification : un opérateur se connecte comme avant ; un membre non opérateur sans droit est refusé
sans recevoir de courriel ; une adresse inconnue produit le même écran qu'une adresse connue, **à la
même URL** et dans un temps comparable ; et une seconde demande de lien sur l'adresse d'un
participant déjà connu reste recevable, ce qui est le seul test qui distingue la formulation retenue
en D14 bis de sa version naïve.

### 5. Le passage tracé, élargi

- `src/lib/actions.ts` : `ActionTracee<T>` accepte un `Utilisateur` déjà résolu et, pour les actions
  qui n'ont pas besoin du nom en amont, un champ `exige?: "operateur" | { participationSur: string }`
  dont le défaut `"operateur"` garde le comportement actuel (D12). La trace porte le `username` de
  l'utilisateur en `actorUsername` et sa voie dans `after` (D13), et l'ordre trace puis écriture est
  inchangé. Le type du paramètre d'`ecrire` passe de `Operateur` à `Utilisateur`, qui porte les mêmes
  champs plus les siens : tous les appels existants restent compilables sans retouche.
- `src/app/journal/libelles.ts` : libellés de `participation.octroi`, `participation.revocation` et
  `participation.canal-bascule` dans `LIBELLE_ACTION` (`:9`), et entrée `participation` dans
  `LIBELLE_CIBLE` (`:54`). Le troisième est écrit par la collecte et non par un opérateur (D21) : il
  se lit sur la même page que les deux autres, sinon la bascule reste invisible là où on la cherche.
- `src/app/journal/criteres.ts` : élargir le filtre « personne » à `actorUsername` hors des sessions
  (`:141-145`), sans quoi ce qu'un participant fait lui-même n'apparaît pas dans son historique. Le
  changement de sens s'écrit dans le commentaire existant (`:134-139`) : le filtre répond désormais
  « ce qui la concerne ou ce qu'elle a fait ».

### 6. Octroyer et révoquer, côté opérateur

- `src/app/dossiers/[id]/participations.ts` (nouveau) : actions `octroyerParticipation` et
  `revoquerParticipation`, toutes deux par `actionTracee` en mode opérateur, garde en première ligne
  comme l'étape 1 l'impose partout. L'octroi exige une personne cible, un motif, une durée et,
  facultativement, un canal. La durée est préremplie à `DUREE_DEFAUT_JOURS` et refusée au-delà de
  `DUREE_MAX_JOURS` (D9 bis) : le refus vit dans l'action et pas seulement dans le formulaire, une
  action serveur recevant ce qu'on lui envoie et non ce que l'écran proposait. Quatre refus de plus,
  **cinq en tout** : un dossier que `dossierVivant` ne dit pas vivant, un dossier en `WATCH` (D10),
  une fiche dont le `username` figure dans une allowlist, et un canal que les refus de D14 bis
  écartent (D9 ter). Le compte se dit parce qu'il se vérifie, et parce que compter quatre laissait
  chaque fois le même dehors, le dossier clos : c'est le seul des cinq que rien n'exerçait. Les quatre
  refus de D14 bis, eux, sont un autre ensemble, qui porte sur une adresse et non sur un octroi. Le
  ré-octroi repose les cinq champs et efface les trois de révocation, en un `update` conditionné (voir
  « Modèle de données »). La révocation pose `revokedAt`, `revokedBy` et `revokedReason` par un
  `updateMany` conditionné sur `revokedAt: null`, et lève quand il ne touche aucune ligne, sur
  l'idiome de `validerEtape` (`src/app/dossiers/[id]/actions.ts:524-526`). Le perdant d'une double
  soumission n'écrase donc rien. Il laisse en revanche une trace, et c'est voulu plutôt que subi : le
  journal précède l'action, donc l'intention des deux appels y figure de toute façon, et c'est la
  levée qui referme celle du perdant en échec. Ne tracer que le gagnant supposerait de savoir qui
  gagne avant d'écrire, ce que l'ordre trace puis action interdit.
- `src/app/dossiers/[id]/Participations.tsx` (nouveau) : la liste des droits en cours, avec pour
  chacun l'adresse à laquelle le lien partira, la date d'expiration et un bouton de révocation ; le
  formulaire d'octroi, motif, durée et canal ; l'avertissement de `canalMenace` ; et la marque
  « canal mort » sur un droit dont ni le canal d'octroi ni la fiche ne résolvent plus, avec ses deux
  sorties (D21). Les deux origines d'adresse ne se rendent pas de la même façon, et c'est le risque
  « L'adresse de la base n'est pas toujours celle du lien » qui l'impose : un canal déclaré à l'octroi
  s'affiche comme certain, l'outil l'ayant lui-même écrit et le servant tel quel ; une adresse déduite
  de la fiche reste une approximation et se lit comme telle, la base ne sachant pas toujours où le
  lien partira, voir « Ce qui existe aujourd'hui ». Les présenter à l'identique effacerait à l'écran
  la seule chose que le canal achète.
- `src/app/dossiers/[id]/page.tsx` : rendre ce bloc pour un opérateur.
- `src/app/personnes/[username]/edition.ts` : le bras `deplacer-participations` dans le `switch` de
  la transaction de fusion (`:462`), sur le modèle exact de `deplacer-dossiers` (`:495-500`), un
  `updateMany` qui repose `personId`, plus l'abandon nommé de la participation en collision (D22). Il
  s'exécute avant `supprimer-fiche` (`:525-527`), qui est ce qui emporterait tout. Le cœur de la
  décision est à l'étape 3 ; ici il n'y a que l'écriture.
- `src/lib/sync/perimetre.ts` : la ligne de journal `SYSTEM` quand un passage fait basculer vers
  `BETA` une fiche qui porte au moins une participation vivante (D21), sur le modèle de l'appel
  existant en fin de passage (`:438-445`). Elle est en fire-and-forget avec capture d'erreur comme
  tout le journal (`src/lib/audit.ts`) : une collecte ne rate pas un passage parce qu'un signalement
  n'a pas pu s'écrire.

Vérification : octroyer, constater la ligne et l'événement, révoquer, constater l'effet immédiat sur
une session déjà ouverte dans un autre navigateur. Puis les cinq refus, un par un, chacun depuis
une requête forgée et pas seulement depuis le formulaire : une durée de soixante jours, un dossier
`CANCELLED`, un dossier en `WATCH`, un octroi sur la fiche d'un opérateur, un canal dont la partie
locale est un identifiant d'allowlist.

### 7. Ce que voit un participant

**Prérequis dur : le chantier des modèles de plan porteurs de contrôleur** (D11). Sans lui, il n'y a
rien à montrer.

- Une route dédiée au participant (D11 ter), et non un sous-ensemble calculé sur
  `/dossiers/[id]`. Elle résout l'acteur, refuse par `notFound()` plutôt que par une redirection
  quand aucun droit vivant ne couvre ce dossier, porte `force-dynamic`, et projette les étapes par
  `etapesVisiblesPour`. Elle ne rend ni l'en-tête, ni les gestes, ni le pied de page de la page
  opérateur : la seule chose partagée est le composant qui rend une étape nommant le participant, et
  c'est ce composant qui se relit, pas 1123 lignes.
- `src/app/dossiers/[id]/actions.ts` : `pointerEtape` accepte un participant. Il résout déjà
  l'identité en première ligne (`:205`) et dérive déjà le dossier de l'étape relue (`:233-235`), donc le
  travail est de remplacer le `operateur: true` en dur de `:268-271` par la valeur réelle et de
  passer l'`Utilisateur` résolu à `actionTracee` (`:338`). Aucun pré-contrôle à ajouter : `peutPointer`
  (`src/core/dossier.ts:172-177`) refuse déjà ce qui ne nomme pas le déclarant dès que `operateur`
  vaut faux.
- **`roleDeLOperateur` (`src/app/dossiers/[id]/actions.ts:75-80`) est le site qui décide vraiment, et
  il ne se voit pas.** Il code `true` en dur en troisième argument de `roleSurDossier` (`:79`) et
  retombe deux fois sur `OPERATOR`, quand le porteur est inconnu (`:76-78`) et quand le rôle est nul
  (`:79`). Un délégué en ressortirait donc `OPERATOR` : `peutPointer` lui ouvrirait les étapes
  attendues d'un opérateur et lui refuserait les siennes, et `validationApresPointage` y lirait une
  substitution qui n'a pas eu lieu. Ces trois raccourcis n'étaient sûrs que tant que
  `requireOperateur` murait l'action, et son commentaire `:67-74` le dit en toutes lettres, « ce cas
  n'existe pas ici » ; ce ticket retire ce mur, donc le commentaire et le code tombent ensemble. Il
  reçoit la qualité réelle d'opérateur et la participation vivante, et un rôle nul y redevient un
  refus plutôt que le rôle le plus fort. Ses deux appelants, `pointerEtape` (`:262`) et `validerEtape`
  (`:457`), en héritent sans autre retouche.
- **Un participant pose les quatre verdicts sauf `ignoree`.** `POINTAGES` (`actions.ts:43-49`) en
  offre cinq. `fait` et `echec` vont de soi ; `deja-absent` et `deja-present` affirment que quelqu'un
  est passé avant, ils soldent l'étape et lui réclament la même valeur que `fait` (`:298-305`), et un
  délégué qui constate un accès déjà retiré doit pouvoir le dire. L'alternative, `fait` et `echec`
  seuls, est écartée pour cette raison exacte : elle laisse ce délégué sans verdict à poser, donc
  devant le choix de mentir ou d'appeler. Ces quatre-là s'écrivent explicitement plutôt que de tomber
  dans un défaut.
- **`ignoree` reste opérateur seul**, quel que soit le sort de #68. `ignoree` produit `SKIPPED`, qui
  n'est pas dans `critereConstate` (`:302-305`), donc `validation: "NONE"` (`:328-334`), donc l'étape
  se solde sans second regard. Écarter une étape n'est pas déclarer un geste, c'est décider qu'un
  geste prévu n'aura pas lieu, et ce ticket ne délègue pas cette décision.
- **`validerEtape` s'ouvre au délégué** (D11 bis) : son `requireOperateur()`
  (`src/app/dossiers/[id]/actions.ts:409`) devient la résolution de l'utilisateur, comme pour
  `pointerEtape`, et `peutValider` fait le reste sans une ligne de plus, n'opposant `DELEGATE` qu'à
  `validationBy === "OPERATOR"` (`src/core/dossier.ts:315`). Et `validationApresPointage` (`:263-274`)
  cesse du même mouvement d'établir la substitution sur le rôle, avec son site d'appel de production
  (`actions.ts:329-333`) et les huit appels de `src/core/dossier.test.ts`. L'une sans l'autre n'est
  pas livrable : c'est le pointage qui porte le trou, pas le formulaire de validation. Ce changement
  de cœur pur vit ici et non à l'étape 3, malgré sa nature : changer la signature sans changer le
  site d'appel ne compile pas, et l'étape 3 se veut livrable seule.
- `confirmerPlan`, `cloreDossier`, `annulerDossier`, `recalculerPlan` et `lancerExecution` restent
  opérateur seul.
- **`combinaisonValide` n'est pas touché.** La répartition « un délégué contrôle un délégué » reste
  refusée (`src/core/dossier.ts:236-248`), et son commentaire garde sa valeur d'annonce (`:222-227`),
  « elle s'ouvrira le jour où un droit par objet existe ». Ce jour arrive, mais décider quelles étapes
  de quel modèle portent quel contrôleur appartient au chantier des modèles de plan, pas à ce ticket
  qui ne change que qui regarde et qui pointe (D20). Voir « Ce qui reste à ouvrir ailleurs ».
- `src/app/moi/page.tsx` : la section des dossiers gagne le lien vers la route du participant, et
  non vers `/dossiers/[id]`, qui le rejetterait (D11 ter).

### 8. Tests et documentation

Les scénarios ci-dessous, puis `/sync-docs`. Trois propositions de rédaction pour
`docs/architecture.md`, soumises avant écriture et non appliquées sans accord explicite : §6
(`:880-886` et `:910-916`, voir D19) ; `CaseParticipation` dans la liste du décidé (`:376-377`) ; et
la nouvelle clé de politique, les domaines de courrier qu'un départ coupe, dans l'énumération de §3.1
(`:253-268`), qui est exhaustive et deviendrait fausse sans elle. `TODO.md` perd la ligne « liens
publics pour l'onboarding et l'offboarding » (`:20`), que ce ticket remplace. La Definition of Done du
ticket est amendée sur son dernier point (D19).

## Tests

Neuf scénarios. Huit sont purs, répartis entre `src/core/participation.test.ts`,
`src/core/dossier.test.ts` et `src/core/fiche-manuelle.test.ts` : tout ce qui décide vit dans un
module sans Prisma, ce qui est le premier bénéfice de l'étape 3. Le test 8 est le seul à demander un
harnais neuf, et il faut le dire plutôt que de compter sur celui qui existe.

Un seul fichier de test d'action serveur existe dans tout le dépôt,
`src/app/dossiers/[id]/actions.test.ts` ; les deux autres tests sous `src/app` ne testent pas
d'actions. Et son harnais ne convient pas au test 8, pour deux raisons : son `vi.mock("@/lib/session")`
(`:104`) rend toujours un opérateur résolu, c'est-à-dire l'inverse exact de l'absence de session que
le scénario doit prouver, et son `vi.mock("@/lib/db")` (`:133`) ne modélise que le domaine du
dossier, là où le test 8 porte sur six autres domaines. Le test 8 mocke donc `@/lib/session` en
faisant **lever** la redirection, et `@/lib/db` par un proxy qui échoue sur tout accès : la
propriété à prouver étant qu'aucune lecture n'a lieu, le double de base doit rendre le test rouge dès
qu'on le touche. C'est la forme qui prouve la propriété, et elle évite d'avoir à modéliser six
domaines pour ne rien lire.

**1. « Un délégué entre, agit, et son droit s'éteint sous lui ».** Given un dossier de départ de
`personne.exemple`, confirmé, avec une étape attendue du délégué et une étape attendue de
l'opérateur, et un droit vivant accordé à `lead.exemple` par `operateur.exemple`. Then `roleSurDossier`
rend `DELEGATE` pour `lead.exemple`, il ne voit que l'étape qui le concerne, et `peutPointer` accepte
son `Declarant` `{ role: "DELEGATE", operateur: false }`. When le droit est révoqué alors que sa
session est encore valide, Then la même lecture le rend sans rôle, la page comme l'action le
refusent, et le refus ne dépend d'aucune expiration de jeton. Then la ligne de droit subsiste en
base, révoquée et datée.

**2. « Le dossier voisin reste fermé, et l'échéance vaut révocation ».** Given deux dossiers et un
droit sur le premier seulement. Then le titulaire n'a aucun rôle sur le second, ne peut y pointer
aucune étape, et rien de la personne du second dossier n'entre dans ce qu'il voit. Then un droit dont
`expiresAt` est passé se comporte exactement comme un droit révoqué, et un droit vivant sur un
dossier vivant reste le seul cas qui ouvre. Then un droit sur un dossier `CANCELLED` n'ouvre pas plus
que sur un dossier `DONE`, la lecture passant par `dossierVivant` et non par un littéral. Then
l'octroi est refusé sur un dossier `WATCH` alors que la lecture, elle, n'exclut pas cet état : les
deux règles de D10 ne disent pas la même chose et le test les sépare. Then la même lecture est
reprise pour les cinq valeurs de `CaseState`, sans quoi la prochaine valeur ajoutée à l'énum passerait
sans être décidée.

**3. « Deux voies, et jamais le choix entre les deux ».** Given une fiche `BETA` avec sa
`communicationEmail`, une fiche `LOCAL` modifiable avec une adresse déclarée, une fiche `LOCAL`
déclarée dans `scope.local`, et une fiche `LOCAL` sans adresse. Then une saisie sans arobase route
vers la voie espace-membre, une saisie avec arobase vers la voie par adresse, une saisie vide, à deux
arobases ou porteuse d'un guillemet vers rien. Then seule la seconde fiche est recevable par sa
propre adresse. Then la fiche `BETA` le devient dès qu'une participation vivante déclare son adresse
en canal, et par ce chemin seulement (D9 ter) ; la fiche déclarée dans `scope.local` ne le devient
pas davantage par sa propre adresse. Then une adresse qui désigne deux personnes distinctes est
refusée, quelle que soit la source dont chacune vient. Then une adresse ne produit jamais de candidat
username, `candidateUsernames` les écartant toutes (`src/core/identite.ts:14-20`).

**4. « Un identifiant fabriqué ne fait pas un opérateur ».** Given `operateur.exemple` dans
`OPERATORS`. Then le renommage d'une fiche vers `operateur.exemple` est refusé, et sa création aussi
(verrou 4). Then, à supposer la fiche existante, résoudre l'acteur depuis la voie par adresse rend un
`Utilisateur` dont `operateur` vaut faux, quel que soit son `username`. Then la même adresse est
refusée dès lors qu'une ligne `User` **munie d'un `username`** la porte. Then, et c'est la clause qui
distingue la bonne formulation de la mauvaise, **la même adresse reste recevable à la connexion
suivante**, quand la ligne `User` sans `username` que la voie a elle-même fait naître au premier lien
existe déjà. Then la même clause tient sur les deux origines d'adresse, et le cas du canal est celui
qui la casse le plus vite : sur une fiche collectée, la ligne née du premier lien porte le
`channelEmail` et non la `communicationEmail` de la fiche, si bien qu'une règle indexée sur la seule
fiche refuserait dès la deuxième demande la personne que D9 ter existe pour servir. Then seul un
jeton issu du provider espace-membre peut porter un username d'opérateur.

**5. « La boîte qui meurt ne bloque pas le dossier, et l'octroi sait où écrire ».** Given le porteur
d'un dossier dont le lien part sur la boîte que le départ va couper. Then l'avertissement se lève à
l'octroi, sur les domaines déclarés par la politique et non sur une égalité entre deux colonnes de la
fiche : une fiche qui ne porte qu'une seule adresse ne le lève pas, et une secondaire sur un domaine
menacé le lève. When l'octroi déclare un canal, Then c'est lui qui sert, y compris pour une fiche
collectée que l'outil ne peut pas modifier, et le ré-octroi le repose au lieu de conserver l'ancien.
When la fiche locale bascule vers `BETA` sous une participation vivante, Then le droit survit, son
canal d'octroi traverse intact, un canal qui venait de la fiche est marqué mort, et la bascule laisse
une ligne au journal (D21). When la boîte est coupée et que la personne ne peut plus recevoir de lien
du tout, Then son étape reste pointable par un opérateur en substitution, ce qui la fait accepter
d'emblée au sens de `validationApresPointage` (`src/core/dossier.ts:263-274`), le plan atteint
`EXECUTED` et le dossier devient soldable. Le mécanisme dégrade vers l'état antérieur, il ne bloque
jamais.

**6. « Chaque écriture d'un non-opérateur laisse sa trace avant d'écrire ».** Given un participant qui
pointe une étape. Then l'événement porte son identifiant de fiche en acteur, la voie qui a prouvé son
identité, et il est écrit avant l'écriture métier. When son droit meurt entre le rendu de la page et
la soumission du formulaire, Then l'action refuse, et pas seulement la page : le contrôle vit aux
deux endroits. Then une écriture demandée sur un dossier X par quelqu'un qui n'a de droit que sur Y
est refusée, y compris quand `dossierId` est fourni par le formulaire.

**7. « Deux délégués sur un dossier, et aucun ne signe pour lui-même ».** Given une étape « la
personne concernée agit, un délégué contrôle », combinaison que `combinaisonValide` accepte
(`src/core/dossier.ts:236-248`), et deux délégués distincts sur le dossier. Then ni l'un ni l'autre ne
peut pointer cette étape : `peutPointer` refuse un `Declarant` `{ role: "DELEGATE", operateur: false }`
devant un acteur attendu `SUBJECT` (`:172-177`). When un opérateur pointe en substitution, Then
l'étape passe en `AWAITING` et non en `ACCEPTED`, le contrôleur attendu étant le délégué et non
l'opérateur, et le délégué B la signe par `validerEtape` que `peutValider` lui ouvre désormais
(`:315`), pendant que le délégué A se la voit refuser s'il en est le déclarant (`:327`).

Then le cœur du scénario, et il s'écrit en appelant `validationApresPointage` directement, sur un cas
que ses appelants interdisent par ailleurs : un déclarant de rôle `DELEGATE` sur une étape « la
personne concernée agit, un délégué contrôle » rend `AWAITING`, parce que rien n'établit nommément ce
délégué-là comme le contrôleur que l'étape attend. C'est le point du test : la fonction est vraie par
elle-même et non par ce que `peutPointer` et l'ordre de `roleSurDossier` lui épargnent (D11 bis).
Then la voie `OPERATOR` ne bouge pas d'un pouce, un opérateur qui pointe en substitution sur une
étape « la personne concernée agit, un opérateur contrôle » obtenant `ACCEPTED` comme aujourd'hui,
la liste qui le nomme suffisant à l'établir comme le contrôleur attendu. Then `combinaisonValide`
refuse toujours « un délégué contrôle un délégué » (`:222-227`) : ce ticket ne l'ouvre pas.

**8. « Sans session, aucune action ne parle ».** Given aucune session, un `@/lib/session` qui lève la
redirection et un `@/lib/db` qui échoue sur tout accès. Then chacune des onze actions serveur de
l'étape 1 redirige vers `/login` sans avoir touché le double de base, et sans rendre aucun des
messages qui distinguaient un identifiant existant d'un identifiant inconnu, dont les quatre de
`creerFichePourCompte`.

**9. « Fusionner deux fiches ne fait pas disparaître un droit ».** Given deux fiches, chacune portant
une participation, et un dossier commun aux deux. Then `planifierFusion` annonce le déplacement dans
son inventaire avant d'écrire quoi que ce soit, et empile `deplacer-participations` **avant**
`supprimer-fiche` : l'ordre est l'objet du test, puisque c'est lui seul qui empêche la cascade
d'agir à notre place. Then la participation de la source qui entre en collision avec celle de la
cible sur `@@unique([accessCaseId, personId])` est abandonnée, nommée dans le plan comme
`fermer-constats` nomme les siennes, et c'est la plus récente qui survit. Then une fiche source qui
ne porte aucune participation ne produit aucune étape de déplacement, l'inventaire restant lisible
(D22).

## Les trois correctifs ouverts qui touchent ce terrain

**#66, « un opérateur cesse de pouvoir mener son propre départ de bout en bout ».** *Bloquant pour
l'étape 7 seule, indifférent aux étapes 1 à 6.* Son constat est le même que celui de D11 : aucune
origine ne pose de contrôleur, donc toute étape vaut « un opérateur agit, personne ne contrôle ». Sa
première branche, « le lot 6 fait-il poser un contrôleur par les modèles de plan sur les étapes
sensibles », est exactement le prérequis de l'étape 7. Les deux tickets se règlent par le même
mécanisme, et l'ordre naturel les met dans le bon sens : une fois les contrôleurs posés, `peutValider`
referme la composition de #66 sans une ligne de plus, parce qu'il compare sur le username, **et**
l'étape 7 devient démontrable. L'inverse donnerait un participant qui voit un dossier vide et un
opérateur qui signe encore ses propres cases.

**#68, « écarter une étape contrôlée cesse de sauter le second regard ».** *Accompagne, ne bloque
pas.* Le trou est réel et documenté : `SKIPPED` n'est pas dans `critereConstate` (`actions.ts:302-305`),
donc `validation: "NONE"` (`:328-334`), donc l'étape se solde sans second regard. Ce plan met ce
verdict hors de portée d'un participant (étape 7), ce qui le neutralise de notre côté sans le
corriger. Le corriger avant l'étape 7 reste préférable : le jour où quelqu'un jugera que `ignoree`
manque au participant, la trappe s'ouvrirait au premier acteur qui n'est pas de l'équipe, et le
refus de l'étape 7 est ce qui la tient fermée en attendant.

**#65, « une seule fiche illisible cesse de geler indéfiniment les garde-fous du périmètre ».**
*Indifférent au code de #13, mais il mérite une ligne dans les risques.* Le canal d'entrée de la voie
espace-membre est entretenu par une collecte qui peut geler sur une seule fiche illisible : dans ce
cas `Person.communicationEmail` peut se périmer en silence, et le lien partirait sur une adresse que
l'amont a changée depuis. Ce n'est pas un blocage, c'est une ligne à écrire.

## Ce qui reste à ouvrir ailleurs

Deux choses que ce plan a rencontrées, qu'il a délibérément laissées en place, et qui méritent chacune
son ticket plutôt qu'une ligne de plus ici. Les nommer est le prix à payer pour avoir le droit de ne
pas les traiter.

**La substitution par le rôle, pour `OPERATOR`.** D11 bis corrige `validationApresPointage` sur le
seul cas `DELEGATE`. Le même raisonnement vaut pour `OPERATOR`, dont le rôle désigne lui aussi
plusieurs personnes : un opérateur qui pointe en substitution obtient `ACCEPTED` signé de son propre
nom, ce que `peutValider` lui refuserait par le formulaire (`src/core/dossier.ts:327`). #13 ne
l'élargit pas, et pour une raison qui n'est pas la paresse : c'est un comportement voulu, documenté
en toutes lettres (`:253-256`) et testé, et le changer ferait attendre un second opérateur sur un
outil qui en compte un. La question qu'un ticket doit poser est donc celle-là, pas celle du code :
sur quelles étapes veut-on qu'un opérateur seul ne suffise plus. Elle touche `docs/architecture.md`
§6 et probablement la politique.

**La répartition « un délégué contrôle un délégué ».** `combinaisonValide` la refuse
(`src/core/dossier.ts:236-248`) et son commentaire annonce sa levée (`:222-227`), « elle s'ouvrira le
jour où un droit par objet existe ». #13 crée ce droit sans ouvrir la répartition, parce que décider
quelles étapes de quel modèle portent quel contrôleur appartient au chantier des modèles de plan
(D11, prérequis dur) et pas à un ticket qui ne change que qui regarde et qui pointe (D20). L'ouvrir
ne coûte qu'une ligne, comme le commentaire le dit lui-même ; c'est de savoir à quoi elle sert qu'il
faut décider d'abord.

## Risques et pièges

Quatre d'entre eux sont traités dans les décisions ci-dessus et ne sont rappelés ici que pour ce
qu'une décision seule ne dit pas : ce qui les rouvre.

**L'escalade par l'identifiant fabriqué** (D14). Les quatre verrous couvrent le jeton, le callback,
le calcul de la qualité d'opérateur et l'écriture de l'identifiant. Retirer l'un au motif que les
autres suffisent est un refus de revue : seul le quatrième protège un `BREAK_GLASS_USERNAMES` qui n'a
ni ligne `User` ni fiche.

**La ligne `User` adoptée** (D14 bis). C'est un accident ordinaire, pas une attaque, et on n'en sort
que par une intervention en base. Il se rouvre dès que quelqu'un juge « une ligne sans username, donc
un emplacement libre ».

**Le gate posé sur la seule phase d'envoi** (D4). Il se rouvre à la première relecture qui trouve
élégant de tout envelopper dans `if (email?.verificationRequest)`.

**L'oracle d'appartenance, sur quatre canaux** (D5). Un message distinct est très tentant pour
l'ergonomie et se réintroduit à chaque retouche du formulaire ; un plancher de temporisation retiré
« parce qu'il ralentit la connexion » rouvre le canal du temps sans changer une ligne de message.

Les autres sont propres à ce plan.

**Un droit mis en cache est un droit qu'on ne peut plus retirer.** Toute nouvelle route porte
`dynamic = "force-dynamic"` comme ses voisines (`src/app/dossiers/[id]/page.tsx:58`), et aucune
autorisation ne se calcule dans un rendu mémorisé. La révocation immédiate est une exigence de la
Definition of Done, et elle se perd sans bruit.

**La collecte peut couper un lien au milieu d'un dossier.** `champsCollectes`
(`src/lib/sync/perimetre.ts:103-134`, sites d'écriture `:152-161`) réécrit sans condition `source`,
`primaryEmail` et `communicationEmail`, et pose `usernameFabricated: false` (`:108`). Une fiche
locale adoptée par l'espace-membre bascule `BETA`, ses adresses saisies sont écrasées, et une
participation dont le canal venait de la fiche perd son entrée sans qu'aucun geste humain n'ait eu
lieu. D21 le signale et marque le canal, D9 ter le désamorce quand l'octroi porte son propre canal ;
ce qui rouvre le risque est le jour où quelqu'un jugera le signalement bruyant et le retirera, la
bascule redevenant alors silencieuse. Le même passage porte l'autre face du risque : c'est lui qui
peut faire naître la collision d'adresses que l'index de D7 bis refuse, et geler la fiche en
`PARTIAL`.

**L'adresse de la base n'est pas toujours celle du lien.** Voir « Ce qui existe aujourd'hui » :
tout affichage disant « le lien partira sur telle adresse » est une approximation, et doit se lire
comme telle. Et la collecte qui l'entretient peut geler sur une seule fiche illisible (#65), donc
`communicationEmail` peut se périmer en silence. Le canal de D9 ter est le seul cas où l'outil sait
vraiment où le lien part, puisqu'il l'a lui-même écrit : c'est une raison de plus de le préférer à
l'affichage déduit de la fiche, et une raison de ne pas présenter les deux de la même façon à
l'écran.

**Le canal d'octroi est une porte que l'amont ne connaît pas.** Une adresse tapée par un opérateur
ouvre l'outil sur une boîte que ni l'espace-membre ni la collecte n'ont validée. Ce qui la borne :
elle est nominative, journalisée, refusée sur les allowlists, incapable de produire un opérateur, et
elle meurt avec le droit (D9 ter, D15). Ce qui la rouvrirait : un formulaire d'octroi qui accepterait
un canal sans motif, une durée par défaut portée au plafond, ou un ré-octroi qui conserverait
l'ancien canal. Les trois sont fermés par écrit ci-dessus, et c'est là qu'il faut regarder si le
comportement change.

**La fusion de fiches emporte les droits.** `CaseParticipation.personId` cascade sur `Person` :
fusionner sans déplacer les participations les supprimerait avec la fiche source, sans erreur. C'est
du travail de ce ticket, pas de #1 (D22), collision sur `@@unique([accessCaseId, personId])`
comprise. Ce qui le rouvre est une douzième variante ajoutée à `EtapeFusion` sans être empilée avant
`supprimer-fiche` : le typecheck la réclame dans le `switch`, il ne dit rien de l'ordre.

**Une fiche disparue ne retire pas le droit, et c'est voulu.** `Person.vanishedAt` se pose quand la
personne quitte le référentiel amont, c'est-à-dire au moment précis où son dossier de départ est
utile. Gater la participation sur ce champ ferait échouer le mécanisme dans le seul cas où il sert.

**`VerificationToken` sert les deux voies.** Un username normalisé d'un côté, une adresse de
l'autre : deux espaces de noms disjoints tant que personne ne fabrique un username contenant une
arobase, ce que `normaliserIdentifiant` (`src/core/fiche-manuelle.ts:15-22`) interdit par sa
normalisation. Le jour où un troisième canal arriverait, ce raisonnement serait à refaire.

**Le lien de connexion est un porteur.** Transférer le courriel transfère l'accès. Les trente minutes
de D16 bornent le lien, pas la session qu'il ouvre, dont la durée est celle du jeton NextAuth. La
contrepartie est que cette session est liée à une fiche et à des droits relus à chaque requête, donc
le pire cas est la lecture d'un dossier et pas l'accès à l'outil : elle ne tient que si l'étape 1 est
livrée.

**Le volume de courrier vers un tiers.** Seules les adresses des fiches portant un droit vivant sont
joignables, ce qui borne la cible à des personnes qu'un opérateur a nommément décidé d'impliquer. Une
temporisation par adresse reste possible si cela devait mordre ; elle n'est pas livrée ici et ne se
confond pas avec le plancher de D5, qui sert un autre but.

**Élargir le filtre du journal change son sens.** Passer de « ce qui la concerne » à « ce qui la
concerne ou ce qu'elle a fait » est le bon comportement pour une fiche, mais c'est un changement de
définition qui s'écrit dans le commentaire (`criteres.ts:134-139`), sinon la prochaine lecture le
prendra pour un bug.

**Livrer l'étape 7 sans les contrôleurs donne une démonstration, pas une fonctionnalité.** Et ce qui
casserait du côté des voisins sans qu'aucun typecheck ne le lève : deux `/moi`, deux
`requireUtilisateur`, ou une participation oubliée dans le plan de fusion.

**`AUTH_URL` devient critique pour un cas de plus.** C'est lui qui construit les liens
(`src/lib/env.ts:77`, obligatoire en production par la validation conditionnelle `:100-105`), et pour
une fiche locale il n'existe aucune autre porte d'entrée. Une valeur fausse ne se voit qu'au premier
lien mort, et le schéma le dit déjà en toutes lettres.

**Le provider espace-membre dépend encore d'une route dépréciée** (`docs/architecture.md` §7,
`:920`). La voie par adresse n'en dépend pas, ce qui est un gain de robustesse constaté, pas une
raison de la préférer : elle ne s'ouvre que sur une fiche locale modifiable ou sur un canal qu'un
opérateur a nommément déclaré à l'octroi (D9 ter), et elle ne s'élargira pas au-delà sans rouvrir D2.


## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire pour les nouveaux composants
clients. Au-delà :

- Après la migration, `pnpm db:generate` puis redémarrage de `pnpm dev`, sans exception : le
  typecheck passerait pendant que le runtime refuserait `participations`.
- **Avant d'écrire la migration**, et pas après :
  `SELECT "communicationEmail", count(*) FROM "Person" WHERE "communicationEmail" IS NOT NULL AND
  "source" = 'LOCAL' GROUP
  BY 1 HAVING count(*) > 1;` doit rendre zéro ligne. Sinon la migration échoue au déploiement, et
  c'est là que se décide lequel des deux gestes de sortie de D7 bis s'applique.
- L'index unique partiel tient : déclarer la même `communicationEmail` sur deux fiches est refusé par
  PostgreSQL, et une seconde fiche sans adresse ne l'est pas.
- `SELECT DISTINCT "expectedActor", "validationBy" FROM "PlanStep";` avant de commencer l'étape 7 :
  tant que ça ne rend que `OPERATOR` et `NULL`, le prérequis n'est pas levé.
- Parcours complet voie espace-membre : ouvrir un dossier pour un membre non opérateur, lui octroyer
  un droit, se connecter avec son identifiant depuis un autre navigateur, constater qu'il n'atteint
  ni `/`, ni `/personnes`, ni un autre dossier, **ni `/dossiers/[id]` pour le sien** (D11 ter), qu'il
  voit ses seules étapes sur sa propre route, et qu'il peut en pointer une puis, quand une étape le
  nomme comme contrôleur, en valider une.
- Parcours complet voie par adresse : créer une fiche locale depuis un compte isolé, lui déclarer une
  adresse de communication, lui octroyer un droit, recevoir le lien sur mailpit, entrer, pointer,
  sortir, **puis redemander un lien sur la même adresse et entrer une seconde fois**. Ce second
  passage n'est pas une redite : la première connexion a fait naître une ligne `User` sans
  `username`, et c'est lui seul qui montre que le refus de D14 bis ne se retourne pas contre le
  participant.
- Révocation à chaud : pendant que la session du participant est ouverte, révoquer le droit, puis
  recharger la page du dossier et soumettre le formulaire déjà affiché. Les deux doivent être
  refusés, sans déconnexion et sans attendre l'expiration du jeton.
- Révocation entre l'envoi et le retour : demander un lien, révoquer le droit, suivre le lien. Il ne
  doit ouvrir aucune session (D4, seconde invocation).
- Parcours du canal d'octroi : sur une **fiche collectée**, dont l'outil ne peut modifier aucune
  adresse, octroyer un droit en déclarant un canal, recevoir le lien à cette adresse-là dans mailpit,
  entrer et pointer. C'est le seul parcours qui démontre D9 ter, et c'est celui que le ticket décrit
  quand il parle de la boîte qui meurt. Puis **redemander un lien sur ce même canal et entrer une
  seconde fois** : ce second passage est le seul qui montre que le quatrième refus de D14 bis connaît
  les deux origines d'adresse, la première connexion ayant fait naître une ligne `User` qui porte le
  canal et non la `communicationEmail` de la fiche. Puis ré-octroyer avec un autre canal et constater
  que le lien suivant part sur le nouveau, pas sur l'ancien.
- Refus silencieux : une adresse inconnue, l'adresse d'une fiche collectée qu'aucun octroi n'a
  déclarée comme canal, et l'identifiant d'un membre sans droit produisent le même écran, **à la même
  URL** et dans un temps de réponse comparable, et aucun courriel ne part. La barre d'adresse compte
  autant que le texte : tant que l'acceptation part sur `/verify-request` et que le refus reste sur
  `/login`, le message unique ne prouve rien. Vérifier l'absence d'envoi dans mailpit, pas seulement
  l'absence d'erreur.
- Les cinq refus de l'octroi, chacun depuis une requête forgée et pas seulement depuis le
  formulaire, puisque c'est l'action qui fait foi : durée au-delà de `DUREE_MAX_JOURS`, dossier
  `CANCELLED` ou `DONE`, dossier en `WATCH`, fiche dont le `username` est dans une allowlist, canal
  dont la partie locale est un identifiant d'allowlist. Le dossier clos est celui qu'on oublie, D10
  en faisant une règle de lecture autant que d'écriture. Et le pendant positif : la durée proposée
  par le formulaire vaut `DUREE_DEFAUT_JOURS` et non le plafond, sans quoi D9 bis n'a rien
  produit.
- Fusion de deux fiches portant chacune une participation, dont une sur un dossier commun : le plan
  de fusion annonce le déplacement avant de l'exécuter, la participation en collision est nommée, et
  `SELECT count(*) FROM "CaseParticipation" WHERE "personId" = '<source>';` rend zéro après coup sans
  qu'aucun droit n'ait disparu du dossier.
- Bascule d'une fiche locale vers `BETA` sous une participation vivante, en relançant `pnpm sync`
  après avoir renseigné l'identifiant côté amont : la ligne de journal est écrite, la participation
  est toujours là, et son canal est marqué mort à l'écran s'il venait de la fiche.
- Sans session, **chaque fichier `"use server"` de `src/`** redirige sans avoir lu la base. La liste
  se refait par `grep -rln '"use server"' src/` plutôt que de se recopier d'ici, et les onze actions
  de l'étape 1 en sont le cœur. Le plus simple est de les appeler depuis un navigateur sans cookie et
  de constater qu'aucune ne distingue un identifiant existant d'un identifiant inconnu.
- Le journal montre **la connexion**, l'octroi, la révocation et le pointage du participant, chacun
  nominatif, chacun avec sa voie d'identification en charge utile, et l'événement précédant
  l'écriture. La connexion est celle qu'on oublie : elle s'écrit hors d'`actionTracee`
  (`src/lib/auth.ts:56-62`) et ne bénéficie donc d'aucun élargissement.
- `SELECT count(*) FROM "CaseParticipation" p LEFT JOIN "AccessCase" c ON c.id = p."accessCaseId"
  WHERE c.id IS NULL;` rend zéro, avant comme après suppression d'un dossier.
- `ACTIONS_ENABLED` reste à `false` pendant tout le parcours : ni l'octroi, ni la connexion, ni le
  pointage n'invoquent de connecteur. Le seul appel sortant du parcours est l'envoi SMTP du lien,
  qui ne passe par aucun connecteur et n'est donc gouverné par aucun drapeau d'exécution. En
  développement il aboutit dans Mailpit, et c'est ce qu'on vérifie.
- Relecture de la Definition of Done du ticket point par point, en particulier « le contrôle est fait
  dans la page et l'action » : ouvrir `src/proxy.ts` et confirmer qu'il n'a pas bougé. Le dernier
  point est à amender avant d'être coché (D19).
- La proposition d'amendement de `docs/architecture.md` §6 est soumise à l'utilisateur et laissée non
  appliquée si elle n'est pas validée.
