# Faire participer à un dossier quelqu'un qui n'est pas opérateur (#13)

> Plan d'implémentation de l'issue #13. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.
>
> Reprise du 2026-08-30, sur le code de `985ee29`. Le plan initial avait été écrit avant le lot 5 :
> `DepartureCase` est devenu `AccessCase`, `src/core/depart.ts` est devenu `src/core/dossier.ts`,
> `/departs` est devenu `/dossiers`. Toutes les citations ont été recalculées dans les fichiers.

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
  critère est « une course peut-elle produire une ligne invalide », et il distingue ces cas des
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
qu'au retour du lien. Ce point vaut quelle que soit l'option retenue à la décision ouverte 1 : si
seule la voie par adresse est unifiée, c'est sur elle que la destination doit cesser de trahir.

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

**D8. Le rôle se déduit, il ne se stocke pas.** Le titulaire du droit qui est aussi la personne du
dossier est le porteur, `SUBJECT` au sens du lot 5 ; tout autre titulaire est `DELEGATE`. Stocker le
rôle en plus de `AccessCase.personId` créerait deux vérités pour un même fait, et c'est la seconde
qui se périmerait. Cohérent avec la règle du dépôt : le statut d'une personne est calculé et jamais
stocké (`docs/architecture.md` §4.1, `:509`).

**D9. `expiresAt` et `reason` sont obligatoires, sur le modèle de `Derogation`.** Un droit sans
échéance ne se retire jamais parce que personne ne se souvient qu'il existe, et un droit sans motif
ne se relit pas. La révocation à la main reste possible à tout instant et prime sur l'échéance. Le
plafond de durée reste à trancher (décision ouverte 7), et il ne protège que contre le dossier qui
reste ouvert longtemps, ce qui arrive : un plan partiellement exécuté ne solde pas.

**D10. Le droit meurt avec le dossier par déduction, pas par écriture.** Une participation sur un
dossier qui n'est plus vivant n'ouvre rien, et la ligne reste en base comme trace. Écrire une
révocation au moment de `cloreDossier` ajouterait une écriture qui peut échouer là où une lecture ne
peut pas.

**Quels états ouvrent, en revanche, reste à trancher : c'est la décision ouverte 6.** La
recommandation y est de lire la règle par `dossierVivant` (`src/core/dossier.ts:448`) et jamais par
un littéral, son commentaire `:434-438` disant pourquoi, « un dictionnaire exhaustif fait tomber le
typecheck le jour où une valeur s'ajoute à l'énum, là où un tableau littéral aurait continué de
mentir en silence », et les trois actions du dossier gardant déjà dessus (`actions.ts:148`, `:249`,
`:448`). Écrire `état !== "DONE"` en serait le troisième exemplaire littéral et laisserait un droit
vivant sur un dossier **annulé**, `CaseState` comptant cinq valeurs
(`prisma/schema.prisma:399-405`). Le reste de D10 ne dépend pas de cet arbitrage : quelle que soit
la règle retenue, elle se lit et ne s'écrit pas.

**D11. Ce qu'un participant voit découle de `expectedActor`, et de rien d'autre.** C'est la
formulation même du ticket. Elle impose un prérequis dur pour l'étape 7 : tant qu'aucune origine ne
pose `expectedActor` ni `validationBy`, toutes les étapes valent `OPERATOR` et un participant verrait
un dossier vide. La colonne existe depuis le lot 5, le prérequis a donc changé de porteur et pas de
nature : c'est **le chantier des modèles de plan porteurs de contrôleur** qui le lève, celui que #66
appelle à trancher en premier lieu et qui vit dans le même lot 6 que ce ticket. Vérification qui
coûte une seconde avant d'y toucher : `SELECT DISTINCT "expectedActor" FROM "PlanStep";` ne doit
rendre que `OPERATOR`.

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
l'étape relue (`:233`), et ce plan l'écrit noir sur blanc plutôt que de compter dessus.

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
qu'elle a elle-même créée.** Elle refuse toute adresse portée par plus d'une fiche, cas que l'index
de D7 bis rend impossible en base mais que le code refuse quand même et teste en premier ; toute
adresse déclarée sur une fiche que `ficheEditable` ne dit pas modifiable ; toute adresse dont la
partie locale correspond à un identifiant d'allowlist ; et toute adresse portée par une ligne `User`
**qui n'est pas celle de cette fiche**.

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
exactement la `communicationEmail` de la fiche résolue et dont le `username` est nul. C'est
suffisant, et pour une raison précise : toute ligne née de la voie espace-membre porte un `username`
(`Adapter.js:14-24` le pose depuis l'API), donc une ligne sans `username` sur une adresse que l'index
de D7 bis rend unique ne peut appartenir qu'au titulaire de cette fiche. Une variante plus lourde
mais plus explicite existe, rattacher la ligne `User` à la `Person` dès sa création et faire porter
le refus sur « une ligne dont le rattachement désigne une autre fiche » ; elle coûte une colonne et
n'apporte rien tant que l'index tient.

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
}
```

Deux relations inverses à ajouter : `participations CaseParticipation[]` sur `AccessCase`
(`prisma/schema.prisma:407-461`) et sur `Person` (`:92-151`).

`onDelete: Cascade` est déclaré sur les deux relations, et il faut le déclarer : la cascade du
dossier n'est pas uniforme, `Plan.accessCase` étant en `SetNull` (`:497`). Poser `SetNull` ici par
symétrie produirait des droits orphelins pointant vers rien.

Aucun enum de rôle : il se déduit de la comparaison entre `personId` et `accessCase.personId` (D8).
Aucune colonne d'adresse : l'adresse se lit sur la fiche à l'affichage (D7), comme un libellé de
constat se recalcule plutôt que de se figer (`docs/architecture.md` §3.3, `:374`).

**L'unicité sur le couple est voulue, et elle a une conséquence à traiter.** Ré-octroyer après
révocation réécrit la même ligne. Mais `grantedAt @default(now())` date alors le **premier** octroi
et non celui qui court, ce qui rend l'échéance illisible et l'audit trompeur. Le ré-octroi repose
donc explicitement `grantedAt`, `grantedBy`, `reason` et `expiresAt`, et remet `revokedAt`,
`revokedBy` et `revokedReason` à nul, en un seul `update` conditionné. L'historique des octrois vit
dans le journal, qui est déjà la voie de reconstruction de tout ce qu'un opérateur attribue
(`docs/architecture.md` §3.5, `:474-486`).

**Index unique partiel sur l'adresse d'identification**, à coller à la main dans le fichier généré
après `prisma migrate dev --create-only` (D7 bis) :

```sql
-- Prisma ne sait pas exprimer un index partiel, d'ou l'ecriture a la main ; il n'y voit
-- pas de derive et le laisse en place. La clause WHERE ne sert pas a autoriser plusieurs
-- lignes nulles, PostgreSQL les autorise deja sous un index unique ordinaire : elle sert
-- a ne pas indexer la tres grande majorite des fiches, qui n'ont pas d'adresse de
-- communication.
CREATE UNIQUE INDEX "Person_communicationEmail_unique"
  ON "Person" ("communicationEmail")
  WHERE "communicationEmail" IS NOT NULL;
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

**Pas de contrainte `CHECK` sur `expiresAt > grantedAt`**, sauf décision contraire (décision ouverte
8). Le critère du lot 5 est écrit noir sur blanc
(`prisma/migrations/20260827090000_acteur_attendu_et_validation/migration.sql:21-27`) : « une course
peut-elle produire une ligne invalide ». Ici non, `expiresAt` se calcule depuis `grantedAt` et une
constante de module. Le vrai défaut de datation est celui du ré-octroi ci-dessus, et une `CHECK` ne
le verrait pas.

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
déclarer la même `communicationEmail` sur deux fiches et constater le refus de PostgreSQL.

### 3. Le cœur pur

Toute la décision vit dans un module sans Prisma, donc testable en gros scénarios.

- `src/core/participation.ts` (nouveau) :
  - `participationVivante(participation, etatDossier, maintenant)`, qui exige `revokedAt` nul,
    `expiresAt` postérieur à maintenant, et `dossierVivant(etatDossier)` (D10) ;
  - `voieDeConnexion(saisie)`, qui rend la voie espace-membre pour un identifiant sans arobase, la
    voie par adresse pour une adresse bien formée, et rien pour une saisie vide, à deux arobases ou
    porteuse d'un guillemet, avant que `defaultNormalizer` ne lève (D3, D5) ;
  - `adresseRecevable(fiches, ligneUser, allowlists, declaresLocaux)`, qui applique les quatre refus
    de D14 bis. Les deux derniers paramètres ne sont pas décoratifs, et une signature plus courte ne
    porterait que la moitié des refus. `fiches` est la liste rendue par la résolution de l'adresse,
    zéro, une, ou plus d'une : le refus de pluralité est testé en premier, et un `fiche` au singulier
    le rendrait inobservable. `declaresLocaux` est exigé par `ficheEditable`, dont la signature est
    `ficheEditable(fiche, declaresLocaux)` (`src/core/fiche-manuelle.ts:50-53`) et dont la seconde
    branche est précisément `declaresLocaux.includes(fiche.username)` (`:57`), celle que D2 invoque
    nommément. La liste se lit chez l'appelant et se passe en argument, comme
    `src/app/personnes/[username]/edition.ts:96` le fait déjà avec son helper `:71`, pour que le
    module reste pur ;
  - `canalMenace(fiche)`, l'avertissement de l'octroi, à reformuler selon la décision ouverte 5 ;
  - `etapesVisiblesPour(role, etapes)`, la projection sur `expectedActor` (D11).
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
  d'options les casserait tous. Le commentaire `:193-195` est à réécrire : il dit aujourd'hui que
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
  dont la fiche porte une participation vivante ; sur le provider par adresse, il résout l'adresse
  vers une fiche par `adresseRecevable`, exige une participation vivante, et refuse sinon. **Le
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
- `src/app/journal/libelles.ts` : libellés de `participation.octroi` et `participation.revocation`
  dans `LIBELLE_ACTION` (`:9`), et entrée `participation` dans `LIBELLE_CIBLE` (`:54`).
- `src/app/journal/criteres.ts` : élargir le filtre « personne » à `actorUsername` hors des sessions
  (`:141-145`), sans quoi ce qu'un participant fait lui-même n'apparaît pas dans son historique. Le
  changement de sens s'écrit dans le commentaire existant (`:134-139`) : le filtre répond désormais
  « ce qui la concerne ou ce qu'elle a fait ».

### 6. Octroyer et révoquer, côté opérateur

- `src/app/dossiers/[id]/participations.ts` (nouveau) : actions `octroyerParticipation` et
  `revoquerParticipation`, toutes deux par `actionTracee` en mode opérateur, garde en première ligne
  comme l'étape 1 l'impose partout. L'octroi exige une personne cible, un motif et une durée,
  plafonnée par une constante du module (décision ouverte 7). Les états qu'il accepte suivent la
  décision ouverte 6, dont la recommandation est de refuser un dossier que `dossierVivant` ne dit pas
  vivant et de refuser séparément l'état `WATCH` : un départ soupçonné mais pas décidé, y octroyer un
  droit revient à dire à quelqu'un « on soupçonne le départ de X » avant que quiconque l'ait tranché,
  ce qui est une divulgation et pas un accès. Le ré-octroi repose les
  cinq champs et efface les trois de révocation, en un `update` conditionné (voir « Modèle de
  données »). La révocation pose `revokedAt`, `revokedBy` et `revokedReason` par un `updateMany`
  conditionné sur `revokedAt: null`, pour qu'une double soumission ne produise ni double trace ni
  écrasement.
- `src/app/dossiers/[id]/Participations.tsx` (nouveau) : la liste des droits en cours, avec pour
  chacun l'adresse à laquelle le lien partira, la date d'expiration et un bouton de révocation ; le
  formulaire d'octroi ; et l'avertissement de `canalMenace`.
- `src/app/dossiers/[id]/page.tsx` : rendre ce bloc pour un opérateur.

Vérification : octroyer, constater la ligne et l'événement, révoquer, constater l'effet immédiat sur
une session déjà ouverte dans un autre navigateur.

### 7. Ce que voit un participant

**Prérequis dur : le chantier des modèles de plan porteurs de contrôleur** (D11). Sans lui, il n'y a
rien à montrer.

- La vue du participant, sous la forme que tranchera la décision ouverte 4. Dans les deux cas :
  résoudre l'acteur, refuser par `notFound()` plutôt que par une redirection quand aucun droit vivant
  ne couvre ce dossier, `force-dynamic`, et projeter les étapes par `etapesVisiblesPour`.
- `src/app/dossiers/[id]/actions.ts` : `pointerEtape` accepte un participant. Il résout déjà
  l'identité en première ligne (`:205`) et dérive déjà le dossier de l'étape relue (`:233`), donc le
  travail est de remplacer le `operateur: true` en dur de `:268-271` par la valeur réelle et de
  passer l'`Utilisateur` résolu à `actionTracee` (`:338`). Aucun pré-contrôle à ajouter : `peutPointer`
  (`src/core/dossier.ts:172-177`) refuse déjà ce qui ne nomme pas le déclarant dès que `operateur`
  vaut faux.
- **`ignoree` reste opérateur seul**, quel que soit le sort de #68. `POINTAGES` (`actions.ts:43-49`)
  offre cinq verdicts, et `ignoree` produit `SKIPPED`, qui n'est pas dans `critereConstate`
  (`:302-305`), donc `validation: "NONE"` (`:328-334`), donc l'étape se solde sans second regard.
  Écarter une étape n'est pas déclarer un geste, c'est décider qu'un geste prévu n'aura pas lieu, et
  ce ticket ne délègue pas cette décision. Le sort des quatre autres verdicts est la décision ouverte
  9.
- `confirmerPlan`, `cloreDossier`, `annulerDossier`, `recalculerPlan` et `lancerExecution` restent
  opérateur seul. `validerEtape` est la décision ouverte 2.
- `src/app/moi/page.tsx` : la section des dossiers gagne le lien vers `/dossiers/[id]` pour un
  participant.

### 8. Tests et documentation

Les scénarios ci-dessous, puis `/sync-docs` : proposition de rédaction pour `docs/architecture.md`
§6 (`:880-886` et `:910-916`, voir D19) et ajout de `CaseParticipation` à la liste du décidé
(`:376-377`), soumises avant écriture et non appliquées sans accord explicite. `TODO.md` perd la
ligne « liens publics pour l'onboarding et l'offboarding » (`:20`), que ce ticket remplace. La
Definition of Done du ticket est amendée sur son dernier point (D19).

## Tests

Huit scénarios. Sept dans `src/core/participation.test.ts` et `src/core/dossier.test.ts` : tout ce
qui décide y est pur, ce qui est le premier bénéfice de l'étape 3. Le huitième demande un harnais
neuf, et il faut le dire plutôt que de compter sur celui qui existe.

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
dossier vivant reste le seul cas qui ouvre. Le sort des états `CANCELLED` et `WATCH` suit la décision
ouverte 6 : sous sa recommandation, un droit sur un dossier `CANCELLED` n'ouvre pas plus que sur un
dossier `DONE`, et un octroi sur un dossier `WATCH` est refusé. Ce scénario est le test de cet
arbitrage et sa formulation exacte suit l'option retenue.

**3. « Deux voies, et jamais le choix entre les deux ».** Given une fiche `BETA` avec sa
`communicationEmail`, une fiche `LOCAL` modifiable avec une adresse déclarée, une fiche `LOCAL`
déclarée dans `scope.local`, et une fiche `LOCAL` sans adresse. Then une saisie sans arobase route
vers la voie espace-membre, une saisie avec arobase vers la voie par adresse, une saisie vide, à deux
arobases ou porteuse d'un guillemet vers rien. Then seule la seconde fiche est recevable par la voie
par adresse. Then une adresse ne produit jamais de candidat username, `candidateUsernames` les
écartant toutes (`src/core/identite.ts:14-20`).

**4. « Un identifiant fabriqué ne fait pas un opérateur ».** Given `operateur.exemple` dans
`OPERATORS`. Then le renommage d'une fiche vers `operateur.exemple` est refusé, et sa création aussi
(verrou 4). Then, à supposer la fiche existante, résoudre l'acteur depuis la voie par adresse rend un
`Utilisateur` dont `operateur` vaut faux, quel que soit son `username`. Then la même adresse est
refusée dès lors qu'une ligne `User` **munie d'un `username`** la porte. Then, et c'est la clause qui
distingue la bonne formulation de la mauvaise, **la même adresse reste recevable à la connexion
suivante**, quand la ligne `User` sans `username` que la voie a elle-même fait naître au premier lien
existe déjà. Then seul un jeton issu du provider espace-membre peut porter un username d'opérateur.

**5. « La boîte qui meurt ne bloque pas le dossier ».** Given le porteur d'un dossier dont le lien
part sur la boîte que le départ va couper. Then l'avertissement se lève à l'octroi. When la boîte est
coupée et qu'il ne peut plus recevoir de lien, Then son étape reste pointable par un opérateur en
substitution, ce qui la fait accepter d'emblée au sens de `validationApresPointage`
(`src/core/dossier.ts:263-274`), le plan atteint `EXECUTED` et le dossier devient soldable. Le
mécanisme dégrade vers l'état antérieur, il ne bloque jamais.

**6. « Chaque écriture d'un non-opérateur laisse sa trace avant d'écrire ».** Given un participant qui
pointe une étape. Then l'événement porte son identifiant de fiche en acteur, la voie qui a prouvé son
identité, et il est écrit avant l'écriture métier. When son droit meurt entre le rendu de la page et
la soumission du formulaire, Then l'action refuse, et pas seulement la page : le contrôle vit aux
deux endroits. Then une écriture demandée sur un dossier X par quelqu'un qui n'a de droit que sur Y
est refusée, y compris quand `dossierId` est fourni par le formulaire.

**7. « Deux délégués sur un dossier, et aucun ne signe pour lui-même ».** Given une étape « la
personne concernée agit, un délégué contrôle » et deux délégués distincts. Then le délégué A qui
pointe en substitution n'obtient pas `ACCEPTED` de plein droit, `validationApresPointage` comparant
aujourd'hui sur le **rôle** (`src/core/dossier.ts:271-273`) là où `peutValider` compare sur le nom
(`:327`). Ce scénario dépend de la décision ouverte 3 : il est le test de sa correction, et sa
formulation exacte suit l'option retenue. `combinaisonValide` a vu venir ce cas et l'a fermé par
prudence (`:222-227`), « elle s'ouvrira le jour où un droit par objet existe » ; ce ticket est ce
jour.

**8. « Sans session, aucune action ne parle ».** Given aucune session, un `@/lib/session` qui lève la
redirection et un `@/lib/db` qui échoue sur tout accès. Then chacune des onze actions serveur de
l'étape 1 redirige vers `/login` sans avoir touché le double de base, et sans rendre aucun des
messages qui distinguaient un identifiant existant d'un identifiant inconnu, dont les quatre de
`creerFichePourCompte`.

## Décisions qui restent à trancher

Dix questions, dans l'ordre où elles bloquent, plus un addendum de périmètre. Chacune porte ses
options, ce qu'elles coûtent, et une recommandation. Les neuf premières et l'addendum sont les
décisions restées ouvertes après arbitrage ; la dixième vient d'ailleurs, d'un point de calendrier
soulevé en marge, et elle est signalée comme telle.

Trois autres ont déjà été tranchées et sont écrites au présent dans le corps du plan : l'étape 7
attend le chantier des modèles de plan (D11), la garde de session vit dans ce ticket en étape 1, et
l'identification par adresse se fait sur `communicationEmail` seule avec un index unique partiel
(D7 bis). **Aucune autre ne l'est.** En particulier, ce que D10 et l'étape 6 disent des états de
dossier est la recommandation de la question 6 ci-dessous, pas un acquis.

**1. Le message unique de `loginAction` : on unifie les trois branches existantes, ou seulement la
voie nouvelle ?**
A. Unification totale. Les branches `:39`, `:51` et `:53-54` disparaissent, un opérateur qui se
trompe d'identifiant perd son diagnostic à l'écran, et l'oracle d'annuaire beta.gouv qui existe
aujourd'hui se ferme.
B. Message neutre sur la seule voie par adresse. L'oracle actuel survit, et il porte sur l'annuaire
beta.gouv entier, pas seulement sur les fiches de cet outil.
*Recommandation : A*, en assumant le coût dans D5, le diagnostic partant au `console.error` et au
journal. Et avec la temporisation plancher, faute de quoi l'oracle survit au message par le canal du
temps.

**2. `validerEtape` s'ouvre-t-il au délégué ?**
A. Oui. La répartition « un délégué contrôle le porteur », prévue par le lot 5 et documentée en
`src/core/dossier.ts:246-247`, devient atteignable. `peutValider` l'accepte déjà, il ne refuse
`DELEGATE` que face à `validationBy === "OPERATOR"` (`:315`).
B. Non, opérateur seul. Cette répartition reste morte, et la moitié de ce que le chantier des modèles
va poser ne sert à rien.
*Recommandation : A*, mais uniquement couplée à la décision 3. Ouvrir sans corriger
`validationApresPointage` donne le trou décrit ci-dessous.

**3. `validationApresPointage` doit-il comparer les noms quand `validationBy` vaut `DELEGATE` ?**
Aujourd'hui elle compare sur le rôle (`src/core/dossier.ts:271-273`). C'est sain tant que `SUBJECT`
désigne une personne unique et que `OPERATOR` sort d'une liste nommée. `DELEGATE` sera le premier
rôle qui désigne plusieurs personnes que rien ne distingue au niveau du rôle : sur une étape « la
personne concernée agit, un délégué contrôle », le délégué A qui pointe en substitution obtient
`ACCEPTED`, signé de son propre nom, ce que `peutValider` lui refuserait par le formulaire.
A. Elle reçoit le username du déclarant et ne rend `ACCEPTED` que sur substitution nominative.
Signature à trois arguments qui devient quatre, un site d'appel (`actions.ts:329-333`), un test.
B. Elle ne rend jamais `ACCEPTED` quand `validationBy === "DELEGATE"`. Plus conservateur, mais un
délégué qui contrôle le porteur ne peut jamais solder par substitution même quand c'est légitime.
C. Rien. Un délégué signe sa propre déclaration.
*Recommandation : A*, et c'est indépendant de la décision 2 : le trou passe par le pointage, pas par
le formulaire de validation. Sans ça, `docs/architecture.md:900-901` (« comparée sur le nom et non
sur le rôle ») devient faux le jour où un modèle pose un contrôleur délégué.

**4. La page du participant : sous-ensemble calculé sur `/dossiers/[id]`, ou route dédiée ?**
La page fait 1123 lignes et affiche des noms d'opérateur en six endroits, pas un : la note libre
`etape.lastError` écrite par un opérateur pour un opérateur (`:454-456`), `etape.declaredBy`
(`:462`), `etape.validatedBy` et `etape.validationNote` (`:474-476`, `:480-482`), `runbook` et
`deeplink` (`:415-421`), le bloc technique `systemKey` / `capability` / `idempotencyKey` /
`riskLevel` / `lastError` / `grantExpiresAt` (`:553-573`), et le pied de page `createdBy` /
`confirmedBy` (`:1112-1114`). Plus `planDigest` (`:538`), la clé de profil (`:749-750`), le plafond de
masse et les écarts de modèle (`:1007-1082`).
A. Modèle de vue censuré sur la route existante, testé par sérialisation, sur le modèle du D5 de
`docs/plans/#14_page-perso.md:155`, « la censure est un calcul testé, pas une omission de `select` ».
Coût : un audit permanent de 1123 lignes à chaque ajout de champ, et rédacter par soustraction laisse
passer tout ce qui sera ajouté demain.
B. Route dédiée pour le participant. Coût : un écran de plus. Gain : la classe entière de fuites
disparaît, et l'écran se relit en une minute.
*Recommandation : B.* Le participant ne partage avec l'opérateur ni les gestes, ni l'en-tête, ni le
pied de page, ni les six blocs. Ce qui reste commun, la liste des étapes qui le nomment, se rend
depuis un composant partagé.

**5. Le canal de destination : champ à l'octroi, ou dégradation assumée ?**
Le ticket en fait un point d'attention dur. Un fait que le plan initial ne disait nulle part : **pour
une fiche collectée, cet outil ne peut pas changer l'adresse de destination.** `ficheEditable` rend
`{ editable: false, raison: "COLLECTEE" }` dès que `source !== "LOCAL"`
(`src/core/fiche-manuelle.ts:54-56`), `modifierFiche` refuse en conséquence (`edition.ts:96-98`), et
la destination est décidée par l'espace-membre seul (`ProviderConfig.js:24-28`). D7 interdit par
ailleurs d'ancrer le droit sur une adresse.
A. L'octroi porte, en plus du motif et de l'échéance, l'adresse à laquelle le lien partira, choisie
parmi celles de la fiche ou saisie à cet endroit-là seulement. Le droit reste la ligne, l'adresse
n'est que le moyen de preuve du canal, révocable sans toucher au droit.
B. Dégradation assumée. L'opérateur repointe à la main, et la case du ticket n'est pas cochée.
*Recommandation : A.* Sans ce champ, l'outil n'a aucun geste à offrir pour la personne dont la boîte
meurt, c'est-à-dire quand le mécanisme sert le plus. Et dans les deux cas, `canalMenace` est à
reformuler : l'égalité `communicationEmail === primaryEmail` est une heuristique plus faible que le
plan ne le croyait, elle rate une secondaire qui est elle aussi une boîte que le départ coupe,
adresse ADEME comprise. La liste des domaines menacés vient de la politique, pas d'une égalité de
colonnes.

**6. Quels états de dossier ouvrent une participation, et sur lesquels l'octroi se saisit-il ?**
`CaseState` compte cinq valeurs (`prisma/schema.prisma:399-405`). La règle du plan initial, « un
dossier dont l'état n'est pas `DONE` », laisse un droit vivant sur un dossier **annulé**.
A. `dossierVivant` pour la lecture, et refus de l'octroi sur `WATCH`. `dossierVivant` existe déjà
(`src/core/dossier.ts:448`, dictionnaire `:440-446`) et son commentaire `:434-438` dit pourquoi ne
pas réécrire la règle : « un dictionnaire exhaustif fait tomber le typecheck le jour où une valeur
s'ajoute à l'énum, là où un tableau littéral aurait continué de mentir en silence ». Les trois
actions du dossier gardent déjà dessus (`actions.ts:148`, `:249`, `:448`).
B. `état !== "DONE"` comme écrit à l'origine. Troisième exemplaire littéral de la règle, et un droit
vivant sur un dossier annulé.
*Recommandation : A.* Le refus sur `WATCH` mérite sa phrase : un départ soupçonné mais pas décidé, y
octroyer un droit revient à dire à quelqu'un « on soupçonne le départ de X » avant que quiconque
l'ait tranché. C'est une divulgation, pas un accès. D10, l'étape 6 et le test 2 sont écrits sous
cette recommandation et se reformulent si elle tombe.

**7. Le plafond de durée d'un droit.**
`VALIDITE_JOURS = 7` (`src/lib/dossier.ts:36`, constante non exportée) est une péremption de constat,
pas la bonne échelle. Les autres repères du dépôt : `graceDays` 7, `soonDays` 30, `staleDays` 180
(`src/core/policy.ts:341-371`).
A. 7 jours. Ré-octroi hebdomadaire, donc exactement le geste que D9 existe pour empêcher, mettre le
maximum pour ne plus y penser.
B. 30 jours de plafond, 14 par défaut, deux constantes distinctes. 30 est l'horizon que l'outil
appelle lui-même « proche » pour une fin de mission, donc un droit ne survit jamais à la fenêtre
pendant laquelle il qualifie le départ d'imminent. Sans **lire** `thresholds.soonDays` pour autant :
coupler ferait qu'un réglage de politique déplacerait une règle d'autorisation, ce que
`docs/architecture.md:880-884` interdit.
C. 180 jours. Un accès permanent, qui contredit D15 mot pour mot.
*Recommandation : B.* Un plafond qui est aussi le défaut n'est pas un plafond.

**8. La contrainte `CHECK` sur `expiresAt > grantedAt`.**
A. On la retire. Le critère du lot 5 est « une course peut-elle produire une ligne invalide », et ici
non : `expiresAt` se calcule depuis `grantedAt` et une constante de module.
B. On la garde, et il faut alors la documenter dans `schema.prisma` comme l'index partiel
d'`AccessCase`, sans quoi la garde est invisible à qui lit le fichier.
*Recommandation : A*, en la remplaçant par le vrai défaut de datation qu'une `CHECK` ne verrait pas,
le ré-octroi qui laisse `grantedAt` sur le premier octroi. C'est ce que le modèle de données écrit
déjà.

**9. Quels pointages un participant peut-il poser ?**
`fait`, `deja-absent`, `deja-present`, `ignoree`, `echec` (`actions.ts:43-49`). `ignoree` est déjà
exclu (étape 7).
A. Tous sauf `ignoree`. `deja-absent` et `deja-present` affirment que quelqu'un est passé avant, ils
soldent et réclament la même valeur que `fait` (`:298-305`) : défendables pour un délégué.
B. `fait` et `echec` seuls. Plus étroit, mais un délégué qui constate un accès déjà retiré n'a aucun
verdict à poser et devra mentir ou appeler.
*Recommandation : A*, à écrire explicitement plutôt qu'à laisser tomber dans un défaut.

**10. Que fait la bascule d'une fiche locale vers `BETA` au milieu d'un dossier ?** *Celle-ci ne
vient pas de la liste des décisions ouvertes mais d'un point de calendrier relevé en marge ; elle
mérite sa place, et il faut savoir d'où elle sort.*
`champsCollectes` (`src/lib/sync/perimetre.ts:103-134`) réécrit **sans condition** `source`,
`primaryEmail` et `communicationEmail`, et pose `usernameFabricated: false` (`:108`). Ses deux sites
d'écriture sont `prisma.person.update` (`:152`) et `prisma.person.create` (`:159`). Une fiche `LOCAL`
dont l'identifiant finit par correspondre à un membre de l'espace-membre passe donc `BETA` du jour au
lendemain, ses adresses saisies sont écrasées, et `adresseRecevable` la refuse au `signIn` suivant.
Un lien déjà envoyé cesse de fonctionner au milieu d'un dossier, sans que personne n'ait rien fait.
A. La bascule se signale : un constat, ou une ligne au journal, et la participation reste mais son
canal est marqué mort.
B. La participation survit et l'entrée bascule d'elle-même sur la voie espace-membre, la fiche étant
désormais un membre.
C. Rien, et le cas se découvre au premier lien mort.
*Recommandation : B si l'adresse résolue par le provider est atteignable, A sinon.* Cette condition
n'a pas été levée : ce que l'espace-membre rend pour une fiche fraîchement adoptée n'a pas été
observé. Dans les trois cas, le fait doit figurer dans les risques, il n'y figurait pas.

**Et une décision de périmètre à valider en même temps : la fusion de fiches.** #1 est livré,
`EtapeFusion` est une union fermée de onze variantes (`src/core/fiche-manuelle.ts:217-228`), exécutée
par un `switch` (`edition.ts:462`). #13 doit y ajouter `{ type: "deplacer-participations"; ids }`,
son bras de `switch`, son champ dans `PlanFusion` (`:236-267`) et son inventaire dans
`planifierFusion` (`:291`). Sinon `supprimer-fiche` cascade sur `Person` et emporte les droits en
silence. Le plan initial disait « à écrire dans le plan de fusion de #1 » : c'est du travail de #13
sur du code existant. Et un cas que ni #1 ni le plan ne voyaient : `@@unique([accessCaseId, personId])`
collisionne si les deux fiches portent une participation sur le même dossier. Le motif existe déjà
pour `Finding.dedupKey` (`src/core/fiche-manuelle.ts:299-303`), traité par `fermer-constats` : même
traitement ici, la participation de la source est abandonnée, nommée dans le journal, la plus récente
gagne.

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
corriger. Le corriger avant l'étape 7 reste préférable : si la décision ouverte 9 devait un jour
s'élargir, la trappe s'ouvrirait au premier acteur qui n'est pas de l'équipe.

**#65, « une seule fiche illisible cesse de geler indéfiniment les garde-fous du périmètre ».**
*Indifférent au code de #13, mais il mérite une ligne dans les risques.* Le canal d'entrée de la voie
espace-membre est entretenu par une collecte qui peut geler sur une seule fiche illisible : dans ce
cas `Person.communicationEmail` peut se périmer en silence, et le lien partirait sur une adresse que
l'amont a changée depuis. Ce n'est pas un blocage, c'est une ligne à écrire.

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
participation en cours perd son canal d'entrée sans qu'aucun geste humain n'ait eu lieu. Décision
ouverte 10. Le même passage porte l'autre face du risque : c'est lui qui peut faire naître la
collision d'adresses que l'index de D7 bis refuse, et geler la fiche en `PARTIAL`.

**L'adresse de la base n'est pas toujours celle du lien.** Voir « Ce qui existe aujourd'hui » :
tout affichage disant « le lien partira sur telle adresse » est une approximation, et doit se lire
comme telle. Et la collecte qui l'entretient peut geler sur une seule fiche illisible (#65), donc
`communicationEmail` peut se périmer en silence.

**La fusion de fiches emporte les droits.** `CaseParticipation.personId` cascade sur `Person` :
fusionner sans déplacer les participations les supprimerait avec la fiche source, sans erreur. C'est
du travail de ce ticket, pas de #1, collision sur `@@unique([accessCaseId, personId])` comprise.

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
raison de la préférer : elle n'est ouverte qu'aux fiches locales et le restera.


## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire pour les nouveaux composants
clients. Au-delà :

- Après la migration, `pnpm db:generate` puis redémarrage de `pnpm dev`, sans exception : le
  typecheck passerait pendant que le runtime refuserait `participations`.
- **Avant d'écrire la migration**, et pas après :
  `SELECT "communicationEmail", count(*) FROM "Person" WHERE "communicationEmail" IS NOT NULL GROUP
  BY 1 HAVING count(*) > 1;` doit rendre zéro ligne. Sinon la migration échoue au déploiement, et
  c'est là que se décide lequel des deux gestes de sortie de D7 bis s'applique.
- L'index unique partiel tient : déclarer la même `communicationEmail` sur deux fiches est refusé par
  PostgreSQL, et une seconde fiche sans adresse ne l'est pas.
- `SELECT DISTINCT "expectedActor", "validationBy" FROM "PlanStep";` avant de commencer l'étape 7 :
  tant que ça ne rend que `OPERATOR` et `NULL`, le prérequis n'est pas levé.
- Parcours complet voie espace-membre : ouvrir un dossier pour un membre non opérateur, lui octroyer
  un droit, se connecter avec son identifiant depuis un autre navigateur, constater qu'il n'atteint
  ni `/`, ni `/personnes`, ni un autre dossier, qu'il voit ses seules étapes, et qu'il peut en
  pointer une.
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
- Refus silencieux : une adresse inconnue, une adresse d'une fiche collectée, et l'identifiant d'un
  membre sans droit produisent le même écran, **à la même URL** et dans un temps de réponse
  comparable, et aucun courriel ne part. La barre d'adresse compte autant que le texte : tant que
  l'acceptation part sur `/verify-request` et que le refus reste sur `/login`, le message unique ne
  prouve rien. Vérifier l'absence d'envoi dans mailpit, pas seulement l'absence d'erreur.
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
- `ACTIONS_ENABLED` reste à `false` pendant tout le parcours, et aucun appel sortant n'a lieu : ni
  l'octroi, ni la connexion, ni le pointage n'invoquent de connecteur.
- Relecture de la Definition of Done du ticket point par point, en particulier « le contrôle est fait
  dans la page et l'action » : ouvrir `src/proxy.ts` et confirmer qu'il n'a pas bougé. Le dernier
  point est à amender avant d'être coché (D19).
- La proposition d'amendement de `docs/architecture.md` §6 est soumise à l'utilisateur et laissée non
  appliquée si elle n'est pas validée.
