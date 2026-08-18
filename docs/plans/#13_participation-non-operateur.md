# Faire participer à un dossier quelqu'un qui n'est pas opérateur (#13)

> Plan d'implémentation de l'issue #13. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

**Une seule porte, et elle ne s'ouvre qu'aux opérateurs.** Le rappel de connexion passe par le
provider `espace-membre-beta-gouv-email` (`src/app/login/actions.ts:45`), et le callback `signIn`
rend `match !== null` où `match` vient de `resolveOperator` (`src/lib/auth.ts:52-65`). Quiconque
n'est ni dans `OPERATORS` ni dans `BREAK_GLASS_USERNAMES` (`src/lib/env.ts:28-29`) est refusé avant
même de recevoir un lien. Il n'existe aucun second rôle, aucun second provider.

**L'allowlist est relue à chaque requête, et c'est le modèle à imiter.** `requireOperateur`
(`src/lib/session.ts:23-36`) revérifie `estOperateur` à chaque passage plutôt que de faire confiance
au jeton, avec le commentaire qui l'explique (`src/lib/session.ts:18-21`). La session est en
stratégie `jwt` (`src/lib/auth.ts:41`) : elle porte un username signé pour des semaines, donc tout
droit stocké dedans serait un droit que rien ne sait retirer.

**Le proxy ne valide rien et ne doit pas commencer.** `proxy()` constate la présence d'un cookie et
redirige sinon (`src/proxy.ts:9-22`), son matcher couvre déjà `/departs/*` (`src/proxy.ts:28`). Il
n'a ni base de données ni session validée : un contrôle par dossier y serait un décor.

**Le passage tracé exige un opérateur, en dur.** `actionTracee` appelle `requireOperateur()` en
première ligne (`src/lib/actions.ts:30-31`), écrit le journal avant l'action (`:43`), puis écrit, et
repose sa trace en échec si l'écriture lève (`:51-55`). Toute écriture humaine passe par là, et
c'est exactement ce qui rend l'invariant tenable. Tel quel, aucun non-opérateur ne peut écrire quoi
que ce soit sans sortir du seul chemin qui journalise.

**Le username beta.gouv et l'adresse ne se confondent jamais.** `candidateUsernames` écarte toute
valeur contenant une arobase (`src/core/identite.ts:14-20`), le provider force l'identifiant en
minuscules et le passe à l'API espace-membre, et l'adaptateur du paquet route sur la présence d'une
arobase : `createUser` et `getUserByEmail` délèguent à l'adaptateur Prisma dès que la valeur en
contient une, et n'appellent l'espace-membre que sinon
(`node_modules/@incubateur-ademe/next-auth-espace-membre-provider/dist/Adapter.js`). Le wrapper de
callbacks, lui, ne déclenche sa résolution que quand `account.provider` vaut son propre identifiant
(`dist/Callbacks.js`), et délègue au nôtre dans tous les autres cas. Un second provider par adresse
se greffe donc sans toucher ni à l'adaptateur ni au wrapper.

**L'adresse à laquelle part le lien est déjà connue en base.** Le provider envoie sur
`primary_email` ou `secondary_email` selon la préférence `communication_email` de la fiche
(`dist/ProviderConfig.js`), ce que la collecte recopie à l'identique via `emailDeContact`
(`src/core/membre.ts:134-138`, `src/lib/sync/perimetre.ts:154-155`). `Person.communicationEmail`
porte donc la même adresse que celle du lien, et `Person.primaryEmail` l'adresse beta.gouv.

**Une fiche créée à la main n'a aucune adresse.** `creerFichePourCompte` pose `username`,
`fullname`, `attachment: "LOCAL"` et `source: "LOCAL"` et rien d'autre
(`src/app/comptes-isoles/creer.ts:92-103`) ; l'identifiant est fabriqué par `identifiantDepuis`
(`creer.ts:14`). C'est l'issue #1 qui ouvre l'édition de ces champs, adresses comprises, et qui rend
cet identifiant renommable.

**Le dossier de départ suppose un opérateur du premier au dernier pixel.** `DepartPage` appelle
`requireOperateur()` (`src/app/departs/[id]/page.tsx:44`), affiche toutes les étapes sans filtre, et
nomme en bas de page l'auteur et le confirmateur du plan (`:249-254`). Les trois actions du dossier
passent par `actionTracee` (`src/app/departs/[id]/actions.ts:68`, `:145`, `:213`).

**L'accueil et la navigation ne connaissent que deux états.** `AccueilPage` appelle
`requireOperateur()` (`src/app/page.tsx:16`), donc un non-opérateur connecté serait renvoyé vers
`/login` alors qu'il a une session valide. Le layout résout `operateurCourant()`
(`src/app/layout.tsx:17`) et ne rend le bouton de déconnexion que s'il répond
(`src/app/layout.tsx:28`), tandis que le menu complet s'affiche dès qu'on n'est pas sur `/login`
(`src/ui/Navigation.tsx:24`). Un participant verrait donc huit liens qui le rejettent tous, et
aucun moyen de se déconnecter.

**Le filtre « personne » du journal ne regarde l'acteur que sur les sessions.**
`src/app/journal/criteres.ts:65-74` cherche `targetId` exact, le suffixe `:<username>`, et
`actorUsername` uniquement quand `targetType` vaut `session`. Ce que quelqu'un fait lui-même sur une
étape n'apparaîtrait pas dans son historique.

**Pièges relevés dans le code existant.**

- `User.email` et `User.username` sont uniques (`prisma/schema.prisma:19`, `:23`). Deux voies
  d'authentification qui atterrissent sur la même ligne `User` héritent l'une des attributs de
  l'autre.
- `VerificationToken` est unique sur `(identifier, token)` (`prisma/schema.prisma:64-69`) et sert
  les deux providers. Le premier y range un username normalisé, le second y rangerait une adresse :
  deux espaces de noms disjoints, mais rien dans le schéma ne le garantit.
- Supprimer une `DepartureCase` casse en cascade tout ce qui y pend (`prisma/schema.prisma:308`), et
  l'issue #1 déplace les `departureCases` d'une fiche à l'autre lors d'une fusion.
- `Derogation` (`prisma/schema.prisma:448-461`) est le précédent exact de ce qu'il faut construire :
  une raison obligatoire, un auteur, un `expiresAt` obligatoire. C'est la discipline anti
  pourrissement décrite en `docs/architecture.md:96`.
- `docs/architecture.md:541-559`, « Qui agit, et comment on valide », affirme que seule l'équipe
  transverse agit et annonce le point de greffe de la délégation (`:557`). Ce ticket délivre une
  délégation, mais pas celle que la phrase décrit.
- Les tests ne touchent jamais la base : `vitest.config.ts` tourne en `environment: "node"` et tout
  ce qui est testé est pur. Ce plan n'introduit aucun harnais Prisma.

**Deux plans voisins mordent sur celui-ci, et il faut s'y caler plutôt que les doubler.** #14 pose la
route `/moi`, la fonction `requireUtilisateur()` de `src/lib/session.ts`, la séparation des deux
refus de `requireOperateur` et la réduction de la navigation pour un non-opérateur, en annonçant que
tout cela reste inerte tant que #13 n'a créé aucune session de non-opérateur. #8 renomme
`DepartureCase` en `AccessCase`, table comprise. Ce plan reprend les noms de #14 et n'invente ni
route ni fonction concurrente ; il nomme la clé étrangère d'après le modèle du moment et laisse #8
l'emporter dans son propre renommage.

## Décisions de conception

**D1. Rien dans le jeton ne dit ce qu'on a le droit de faire.** Le jeton porte qui est là, la base
dit ce qu'il peut. C'est la seule façon de tenir « un droit révoqué prend effet immédiatement, sans
attendre l'expiration d'une session » avec une stratégie `jwt`. Chaque page et chaque action relisent
le droit, exactement comme `requireOperateur` relit l'allowlist (`src/lib/session.ts:18-21`).

**D2. Deux voies d'identification, disjointes par construction.** Qui existe dans l'espace-membre
entre par le provider actuel, sans rien changer à son fonctionnement : c'est l'espace-membre qui
décide où part le lien, et le username beta.gouv reste le pivot. Qui n'a qu'une fiche locale entre
par un second provider nodemailer, sur une adresse déclarée sur sa fiche. Une même personne n'a
jamais le choix entre les deux : `source = BETA` impose la première, `source = LOCAL` impose la
seconde. Deux portes de force inégale vers la même personne reviendrait à ne garder que la plus
faible.

**D3. Le formulaire de connexion reste à un seul champ.** L'arobase route vers la bonne voie, comme
elle route déjà dans l'adaptateur du paquet et dans `candidateUsernames`
(`src/core/identite.ts:18`). Demander à quelqu'un de choisir sa voie, c'est lui demander de savoir
comment l'outil est construit.

**D4. Le gate se pose avant l'envoi, jamais après.** NextAuth appelle `signIn` une première fois avec
`email.verificationRequest` à vrai, avant `sendVerificationRequest`. Un refus posé plus tard ferait
de cet outil un relais qui envoie du courrier à n'importe quelle adresse saisie par n'importe qui.

**D5. La réponse de l'écran de connexion est la même dans tous les cas.** « Si cette adresse est
rattachée à un dossier en cours, un lien vient de partir. » Distinguer l'adresse connue de l'adresse
inconnue transformerait cet écran en oracle d'appartenance, ouvert sans authentification. Le
diagnostic vit dans le journal, que seuls les opérateurs lisent.

**D6. Aucune adresse saisie par un visiteur anonyme n'entre au journal.** Le journal est en écriture
seule et à rétention indéfinie (`docs/architecture.md`, section 3.3) : y déverser des adresses
tapées par n'importe qui construirait un second fichier de personnel, ce que la section 3.2 refuse
explicitement pour les fiches. Une tentative résolue journalise le `username` de la fiche atteinte ;
une tentative non résolue journalise un refus sans cible.

**D7. Le droit est une ligne par couple dossier et personne, et il est ancré sur la fiche, pas sur
l'adresse.** L'adresse est un moyen de preuve, l'identité est une `Person`. Ancrer le droit sur une
adresse le ferait survivre à une correction de fiche et le rendrait intransférable au moment où la
personne change de boîte.

**D8. Le rôle se déduit, il ne se stocke pas.** Le titulaire du droit qui est aussi la personne du
dossier est le porteur, `SUBJECT` au sens de #10 ; tout autre titulaire est `DELEGATE`. Stocker le
rôle en plus de `DepartureCase.personId` créerait deux vérités pour un même fait, et c'est la
seconde qui se périmerait. Cohérent avec la règle du dépôt : le statut d'une personne est calculé et
jamais stocké (`docs/architecture.md`, section 4.1).

**D9. `expiresAt` et `reason` sont obligatoires, sur le modèle de `Derogation`.** Un droit sans
échéance ne se retire jamais parce que personne ne se souvient qu'il existe, et un droit sans motif
ne se relit pas. La révocation à la main reste possible à tout instant et prime sur l'échéance.

**D10. Le droit meurt avec le dossier par déduction, pas par écriture.** Une participation sur un
dossier `DONE` n'ouvre rien, et la ligne reste en base comme trace. Écrire une révocation au moment
de `cloreDossier` ajouterait une écriture qui peut échouer là où une lecture ne peut pas.

**D11. Ce qu'un participant voit découle de `expectedActor`, et de rien d'autre.** C'est la
formulation même du ticket. Elle impose #10 comme prérequis dur pour l'étape 6 : sans la colonne
`expectedActor`, toutes les étapes valent `OPERATOR` et un participant verrait un dossier vide.
Livrer #13 avant #10 donne une identification et des droits utilisables, mais aucune vue utile : les
étapes 1 à 5 tiennent seules, l'étape 6 attend.

**D12. `actionTracee` s'élargit, il ne se double pas.** Un second chemin d'écriture pour les
non-opérateurs perdrait sa trace le jour où quelqu'un l'oublierait. `actionTracee` reçoit donc un
champ `exige`, dont la valeur par défaut garde le comportement actuel : tous les appels existants
restent opérateur seul sans être touchés, et seul un appel qui demande explicitement une
participation l'accepte.

**D13. La voie d'identification figure dans la charge utile de chaque écriture d'un non-opérateur.**
`actorUsername` dit qui, `after.voie` dit comment son identité a été prouvée. Sans ça, un identifiant
fabriqué et un username beta.gouv se lisent pareil dans le journal, alors qu'ils n'ont pas la même
force de preuve.

**D14. Un identifiant fabriqué ne doit jamais pouvoir devenir un username d'opérateur.**
`Person.username` est fabriqué par `identifiantDepuis` (`src/app/comptes-isoles/creer.ts:14`) et
devient renommable avec #1. Trois verrous, et ils sont tous nécessaires. Le jeton porte
`Person.id`, un cuid que rien n'édite, pas le username. Le callback `jwt` ne consulte
`resolveOperator` que lorsque `account.provider` vaut l'identifiant du provider espace-membre. Et la
voie par adresse refuse toute adresse déjà portée par une ligne `User` munie d'un `username`, ou
déclarée sur une fiche dont la `source` n'est pas `LOCAL`. Sans ces trois verrous, nommer une fiche
locale comme un opérateur suffirait à devenir opérateur, silencieusement.

**D15. Il n'y a pas de compte, il y a un dossier ouvert.** La voie par adresse n'est ouverte que
tant qu'une participation vivante existe sur cette fiche. Le canal d'entrée naît avec le droit et
meurt avec lui, il n'y a donc jamais de compte dormant à retirer.

**D16. Le lien de la voie par adresse est valable trente minutes.** Il existe pour être suivi tout de
suite, et un lien de connexion transféré est un accès transféré. La voie espace-membre n'est pas
touchée : c'est le chemin des opérateurs et le modifier sortirait du périmètre.

**D17. Rien ici n'écrit sur un système cible.** Octroyer, révoquer, se connecter, pointer : ce sont
des écritures locales et des déclarations. `ACTIONS_ENABLED` reste hors sujet et à `false`, aucun
`dryRun` n'est à câbler, aucun connecteur n'est invoqué. Corollaire à tenir : ce chemin ne doit
jamais servir à glisser un geste qui toucherait un fournisseur.

**D17 bis. On se cale sur `/moi` et sur `requireUtilisateur`, on n'ouvre pas de seconde porte.** #14
pose la route et la fonction, et les décrit lui-même comme inertes tant que #13 n'existe pas. Une
seconde page d'atterrissage et un second résolveur de session obligeraient à savoir laquelle fait
foi, et la réponse changerait avec l'ordre de livraison. Si #13 passe le premier, il crée la forme
minimale de `/moi` et de `requireUtilisateur`, que #14 reprend et enrichit ; si #14 passe le premier,
#13 n'y touche que pour y faire entrer une session de non-opérateur.

**D18. Aucune variable d'environnement nouvelle.** Les opérateurs vivent dans l'environnement parce
qu'ils changent sans livraison et concernent l'outil entier. Une participation porte sur un objet,
change tous les jours et se révoque en un clic : elle relève du décidé, donc de PostgreSQL
(`docs/architecture.md`, section 1.4). `src/lib/env.ts` n'est pas modifié.

**D19. Tension avec `docs/architecture.md` section 6, et ce qu'on en fait.** Le document dit
qu'il n'y a pas de délégation aux leads dans cette version (`:549-551`) et annonce le point de greffe
sous la forme « un plan créé par un lead naîtra en attente au lieu de naître confirmable » (`:557`).
Ce ticket livre bien la délégation, mais pas celle-là : un participant ne crée aucun plan et n'en
confirme aucun, il pointe des étapes d'un plan qu'un opérateur a confirmé. La confirmation et le
plafond de masse restent entièrement à l'équipe transverse, donc le garde-fou du document tient sans
changement. Le ticket demande explicitement la mise à jour de cette section dans sa Definition of
Done : la rédaction est proposée à l'étape 7 et n'est pas appliquée sans accord explicite.

**D20. Aucun assouplissement de la règle d'identité.** Une identité dont `matchMethod` vaut
`HEURISTIC` ou `NONE` ne produit toujours aucune étape de révocation. Ce ticket ne change ni la
source des étapes ni leur calcul, seulement qui a le droit de les regarder et de les pointer.

## Modèle de données

Une migration, additive, sans reprise de données : le modèle est nouveau et vide.

```prisma
model CaseParticipation {
  id String @id @default(cuid())

  departureCaseId String
  personId        String

  /// Motif obligatoire, comme sur une dérogation : un droit dont personne ne sait
  /// plus pourquoi il a été posé ne se retire jamais.
  reason String

  grantedBy String
  grantedAt DateTime @default(now())
  expiresAt DateTime

  revokedAt     DateTime?
  revokedBy     String?
  revokedReason String?

  departureCase DepartureCase @relation(fields: [departureCaseId], references: [id], onDelete: Cascade)
  person        Person        @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([departureCaseId, personId])
  @@index([personId, revokedAt])
  @@index([expiresAt])
}
```

Deux relations inverses à ajouter : `participations CaseParticipation[]` sur `DepartureCase`
(`prisma/schema.prisma:299-313`) et sur `Person` (`prisma/schema.prisma:89-119`).

Le nom du modèle est déjà neutre : #8 renomme `DepartureCase` en `AccessCase`, et `CaseParticipation`
traverse ce renommage sans y perdre son sens. Seuls le champ `departureCaseId` et la relation sont à
faire suivre. Si #8 passe le premier, les deux naissent sous `accessCaseId` ; sinon, ils entrent dans
sa migration de renommage au même titre que les index de `prisma/schema.prisma:311-312`.

Aucun enum de rôle : il se déduit de la comparaison entre `personId` et `departureCase.personId`
(D8). Aucune colonne d'adresse : l'adresse se lit sur la fiche à l'affichage (D7), comme un libellé
de constat se recalcule plutôt que de se figer (`docs/architecture.md`, section 3.3).

L'unicité sur le couple est voulue : ré-octroyer après révocation réécrit la même ligne, avec un
nouvel auteur et une nouvelle échéance, et `revokedAt` remis à nul. L'historique des octrois vit dans
le journal, qui est déjà la voie de reconstruction de tout ce qu'un opérateur attribue
(`docs/architecture.md`, section 3.4).

Contrainte à coller à la main dans le fichier généré, après `prisma migrate dev --create-only` :

```sql
ALTER TABLE "CaseParticipation"
  ADD CONSTRAINT "CaseParticipation_echeance_posterieure"
  CHECK ("expiresAt" > "grantedAt");
```

Prisma ne la connaîtra pas, PostgreSQL la fera respecter : un droit mort-né écrit à la main serait
invisible à l'écran et incompréhensible à la relecture.

Nom de migration proposé : `participation_a_un_dossier`, dans la lignée de
`20260818161504_marche_a_suivre_figee`.

**Après cette migration, `pnpm db:generate` puis redémarrage de `pnpm dev`.** Les deux caches se
cumulent : `prisma migrate dev` applique bien la migration sans toujours régénérer le client de
`src/generated/prisma`, et le client est mis en cache sur `globalThis`, donc il survit à la
régénération et sert des métadonnées périmées. Le symptôme attendu ici est un
`Unknown argument 'participations'` au runtime alors que le typecheck passe.

## Découpage en étapes

### 1. Le droit en base

Poser le modèle, la migration et la contrainte. Livrable seul : rien ne change de comportement, mais
la base sait exprimer le droit.

- `prisma/schema.prisma` : `CaseParticipation` et les deux relations inverses.
- `prisma/migrations/<horodatage>_participation_a_un_dossier/migration.sql` : table, index,
  contrainte.

Vérification : insérer une ligne à la main, supprimer le dossier, constater que la ligne a disparu ;
tenter une ligne dont `expiresAt` précède `grantedAt` et constater le refus de PostgreSQL.

### 2. Le cœur pur

Toute la décision vit dans un module sans Prisma, donc testable en gros scénarios.

- `src/core/participation.ts` (nouveau) :
  - `participationVivante(participation, dossier, maintenant): boolean`, qui exige `revokedAt` nul,
    `expiresAt` postérieur à maintenant, et un dossier dont l'état n'est pas `DONE` (D10) ;
  - `voieDeConnexion(saisie)`, qui rend la voie espace-membre pour un identifiant sans arobase, la
    voie par adresse pour une adresse, et rien pour une saisie vide ou malformée (D3) ;
  - `adresseRecevable(fiche, deja)`, qui refuse une fiche dont `source` n'est pas `LOCAL`, une fiche
    sans adresse déclarée, et une adresse déjà portée par un `User` muni d'un `username` (D14) ;
  - `canalMenace(fiche)`, vrai quand `communicationEmail` égale `primaryEmail`, c'est-à-dire quand le
    lien part sur la boîte beta.gouv que le départ va couper ;
  - `etapesVisiblesPour(role, etapes)`, la projection sur `expectedActor` (D11).
- `src/core/depart.ts` : brancher l'argument `participe` de `roleSurDossier`, posé par #10. Si #13
  est livré en premier, cette fonction est créée ici dans sa forme minimale et #10 la reprend.

### 3. L'identification

- `src/lib/auth.ts` : second provider `Nodemailer` non enveloppé, avec `maxAge` à trente minutes
  (D16), à côté du provider espace-membre existant. Le callback `signIn` distingue les deux cas :
  sur le provider espace-membre, il accepte un opérateur comme aujourd'hui, ou un membre dont la
  fiche porte une participation vivante ; sur le provider par adresse, il résout l'adresse vers une
  fiche `LOCAL` par `adresseRecevable`, exige une participation vivante, et refuse sinon. Le refus
  intervient pendant la phase `verificationRequest` (D4). Le callback `jwt` ne consulte
  `resolveOperator` que si `account.provider` vaut `ESPACE_MEMBRE_PROVIDER_ID` (D14), et pose
  `token.participantId` et `token.voie` dans les deux cas où une fiche a été résolue. Le callback
  `session` recopie ces deux valeurs, et l'augmentation de module (`src/lib/auth.ts:11-24`) déclare
  les champs correspondants.
- `src/lib/session.ts` : l'`Utilisateur` de #14 gagne deux champs, `personId` et `voie`, et son
  `username` se résout depuis la fiche pour un participant au lieu de l'être depuis le jeton.
  `utilisateurCourant()` et `requireUtilisateur()` restent les seules portes, `operateur` continue
  d'être recalculé depuis l'allowlist à chaque appel et jamais lu dans le jeton. Si #14 n'est pas
  encore livré, ces deux fonctions sont créées ici dans leur forme minimale, avec la séparation des
  deux refus de `requireOperateur` que #14 décrit : pas de session vers `/login`, session valide hors
  allowlist vers `/moi`. Rediriger un participant vers l'écran de connexion lui affirmerait à tort
  que sa connexion a échoué.
- `src/app/login/actions.ts` : `loginAction` route sur `voieDeConnexion` et appelle `signIn` avec le
  bon identifiant de provider. `destination()` (`:29-31`) est conservée telle quelle. Le message de
  retour est identique dans tous les cas (D5).
- `src/app/login/LoginForm.tsx`, `src/app/login/page.tsx` : un seul champ, libellé et texte d'aide
  reformulés pour dire qu'on accepte l'un ou l'autre, et le message neutre affiché après envoi.

Vérification : un opérateur se connecte comme avant ; un membre non opérateur sans droit est refusé
sans recevoir de courriel ; une adresse inconnue produit le même écran qu'une adresse connue.

### 4. Le passage tracé, élargi

- `src/lib/actions.ts` : `ActionTracee<T>` gagne `exige?: "operateur" | { participationSur: string }`,
  par défaut `"operateur"` (D12). Le résolveur rend un `Utilisateur`, la trace porte son `username`
  en `actorUsername` et sa voie dans `after` (D13), et l'ordre trace puis écriture est inchangé. Le
  type du paramètre de `ecrire` passe de `Operateur` à `Utilisateur`, qui porte les mêmes champs plus
  les siens : tous les appels existants restent compilables sans retouche.
- `src/app/journal/libelles.ts` : libellés de `participation.octroi`, `participation.revocation`, et
  entrée `participation` dans la table des cibles.
- `src/app/journal/criteres.ts` : élargir le filtre « personne » à `actorUsername` hors des sessions
  (`:65-74`), sans quoi ce qu'un participant fait lui-même n'apparaît pas dans son historique.
  Changement de sens à assumer et à écrire dans le commentaire existant : le filtre répond désormais
  « ce qui la concerne ou ce qu'elle a fait ».

### 5. Octroyer et révoquer, côté opérateur

- `src/app/departs/[id]/participations.ts` (nouveau) : actions `octroyerParticipation` et
  `revoquerParticipation`, toutes deux par `actionTracee` en mode opérateur. L'octroi exige une
  personne cible, un motif et une durée, plafonnée par une constante du module sur le modèle de
  `VALIDITE_JOURS` (`src/lib/depart.ts:15`). La révocation pose `revokedAt`, `revokedBy` et
  `revokedReason`, par un `updateMany` conditionné sur `revokedAt: null` pour qu'une double
  soumission ne produise ni double trace ni écrasement.
- `src/app/departs/[id]/Participations.tsx` (nouveau) : la liste des droits en cours, avec pour
  chacun l'adresse à laquelle le lien partira, la date d'expiration et un bouton de révocation ; le
  formulaire d'octroi ; et l'avertissement de `canalMenace` quand le lien partirait sur la boîte que
  le départ va couper.
- `src/app/departs/[id]/page.tsx` : rendre ce bloc pour un opérateur.

Vérification : octroyer, constater la ligne et l'événement, révoquer, constater l'effet immédiat sur
une session déjà ouverte dans un autre navigateur.

### 6. Ce que voit un participant

Prérequis dur : #10, pour `expectedActor` (D11).

- `src/app/departs/[id]/page.tsx` : résoudre l'acteur, refuser par `notFound()` plutôt que par une
  redirection quand aucun droit vivant ne couvre ce dossier, projeter les étapes par
  `etapesVisiblesPour`, et masquer pour un participant le pied de page nommant l'auteur et le
  confirmateur du plan (`:249-254`).
- `src/app/departs/[id]/actions.ts` : `pointerEtape` passe en `exige: { participationSur: ... }` et
  refuse une étape dont le participant n'est pas l'acteur attendu, avant même `peutPointer`
  (`:129`). Les deux autres actions restent opérateur seul : confirmer un plan et clore un dossier ne
  se délèguent pas (D19).
- `src/app/moi/page.tsx` : la section des dossiers gagne le lien vers `/departs/[id]` pour un
  participant, que #14 réservait à l'opérateur faute de droit par objet. Si #14 n'est pas encore
  livré, cette route naît ici dans sa forme minimale, la liste des dossiers couverts par un droit
  vivant, en `force-dynamic` comme ses voisines.
- `src/app/layout.tsx`, `src/ui/Navigation.tsx` : résoudre l'utilisateur et non plus l'opérateur,
  rendre le bouton de déconnexion dans les deux cas, et réduire le menu au seul « Mon espace » pour
  un non-opérateur. Un menu de huit liens qui rejettent tous est une fuite sur la forme de l'outil
  autant qu'une impasse. Rien à faire ici si #14 a déjà livré cette réduction.

### 7. Tests et documentation

Les scénarios ci-dessous, puis `/sync-docs` : proposition de rédaction pour `docs/architecture.md`
section 6 et ajout de `CaseParticipation` à la liste du décidé en section 3.3, soumises avant
écriture. `TODO.md` perd la ligne « liens publics pour l'onboarding et l'offboarding », que ce ticket
remplace.

## Tests

Six scénarios, dans `src/core/participation.test.ts` et `src/core/identite.test.ts`. Aucun n'a besoin
de base : tout ce qui décide est pur, ce qui est le premier bénéfice de l'étape 2.

**1. « Un délégué entre, agit, et son droit s'éteint sous lui ».** Given un dossier de départ de
`personne.exemple`, confirmé, avec une étape attendue du délégué et une étape attendue de
l'opérateur, et un droit vivant accordé à `lead.exemple` par `operateur.exemple`. Then `lead.exemple`
est vu comme délégué, ne voit que l'étape qui le concerne, et peut la pointer. When le droit est
révoqué alors que sa session est encore valide, Then la même lecture le rend sans rôle, la page
comme l'action le refusent, et le refus ne dépend d'aucune expiration de jeton. Then la ligne de
droit subsiste en base, révoquée et datée.

**2. « Le dossier voisin reste fermé, et l'échéance vaut révocation ».** Given deux dossiers et un
droit sur le premier seulement. Then le titulaire n'a aucun rôle sur le second, ne peut y pointer
aucune étape, et rien de la personne du second dossier n'entre dans ce qu'il voit. Then un droit dont
`expiresAt` est passé se comporte exactement comme un droit révoqué, un droit sur un dossier `DONE`
n'ouvre rien, et un droit vivant sur un dossier vivant reste le seul cas qui ouvre.

**3. « Deux voies, et jamais le choix entre les deux ».** Given une fiche `BETA` avec sa
`communicationEmail`, une fiche `LOCAL` avec une adresse déclarée, et une fiche `LOCAL` sans adresse.
Then une saisie sans arobase route vers la voie espace-membre, une saisie avec arobase vers la voie
par adresse, une saisie vide vers rien. Then l'adresse de la fiche `BETA` est refusée par la voie par
adresse, la fiche `LOCAL` sans adresse aussi, et seule la troisième est recevable. Then une adresse
ne produit jamais de candidat username, `candidateUsernames` les écartant toutes
(`src/core/identite.ts:14-20`).

**4. « Un identifiant fabriqué ne fait pas un opérateur ».** Given `operateur.exemple` dans
`OPERATORS`, et une fiche locale que quelqu'un a renommée en `operateur.exemple`. Then résoudre
l'acteur depuis la voie par adresse rend un participant ancré sur l'identifiant de fiche et jamais un
opérateur. Then la même adresse est refusée dès lors qu'une ligne `User` munie d'un `username` la
porte déjà. Then seul un jeton issu du provider espace-membre peut porter un username d'opérateur,
et un jeton issu de la voie par adresse n'en porte jamais.

**5. « La boîte qui meurt ne bloque pas le dossier ».** Given le porteur d'un dossier dont la fiche
espace-membre a `communicationEmail` égale à `primaryEmail`, donc dont le lien part sur la boîte que
le départ va couper. Then l'avertissement se lève à l'octroi. When la boîte est coupée et qu'il ne
peut plus recevoir de lien, Then son étape reste pointable par un opérateur en substitution, ce qui
la fait accepter d'emblée au sens de #10, le plan atteint `EXECUTED` et le dossier devient soldable.
Le mécanisme dégrade vers l'état antérieur, il ne bloque jamais.

**6. « Chaque écriture d'un non-opérateur laisse sa trace avant d'écrire ».** Given un participant
qui pointe une étape. Then l'événement porte son identifiant de fiche en acteur, la voie qui a prouvé
son identité, et il est écrit avant l'écriture métier. When son droit meurt entre le rendu de la page
et la soumission du formulaire, Then l'action refuse, et pas seulement la page : le contrôle vit aux
deux endroits. Then une écriture demandée sans participation sur ce dossier précis est refusée même
si le demandeur a un droit vivant sur un autre.

## Risques et pièges

**L'escalade par l'identifiant fabriqué est le vrai danger de ce ticket.** Elle est silencieuse, elle
ne lève aucune erreur, et elle transforme une correction de fiche en octroi de droits d'opérateur.
Les trois verrous de D14 ne sont pas redondants : ils couvrent respectivement le jeton, le callback
et la ligne `User`. Retirer l'un d'eux au motif que les deux autres suffisent est un refus de revue.

**La ligne `User` partagée entre les deux voies.** `User.email` est unique
(`prisma/schema.prisma:19`) et l'adaptateur du paquet retrouve une ligne existante par son adresse.
Une adresse déclarée sur une fiche locale et déjà portée par une ligne née du provider espace-membre
donnerait une session héritant du `username` de l'autre. C'est le verrou d'adresse de D14, et il se
teste.

**Un gate posé après l'envoi fait de l'outil un relais de courrier.** L'ordre des callbacks NextAuth
n'est pas une intuition, il se vérifie une fois pour toutes en observant qu'un refus pendant la phase
`verificationRequest` empêche bien l'envoi. Si ce n'était pas le cas, la voie par adresse ne serait
pas livrable en l'état.

**L'oracle d'appartenance.** Un message différent selon que l'adresse est connue ou non répond
« cette personne est suivie par l'incubateur » à un visiteur anonyme. Le piège est qu'un message
distinct est très tentant pour l'ergonomie, et qu'il se réintroduit à chaque retouche du formulaire.

**Un droit mis en cache est un droit qu'on ne peut plus retirer.** Toute nouvelle route doit porter
`dynamic = "force-dynamic"` comme ses voisines (`src/app/departs/[id]/page.tsx:14`), et aucune
autorisation ne doit être calculée dans un rendu mémorisé. La révocation immédiate est une exigence
de la Definition of Done, et elle se perd sans bruit.

**La fusion de fiches de l'issue #1 déplace les dossiers, donc les droits qui y pendent.**
`CaseParticipation.personId` cascade sur `Person` : fusionner sans remapper ce champ supprimerait les
droits en même temps que la fiche source, sans erreur. À écrire dans le plan de fusion de #1, dans la
même transaction que les autres déplacements.

**La cascade sur le dossier fait exactement ce qu'on veut, et il ne faut pas la contourner.**
Supprimer un dossier emporte ses participations (`prisma/schema.prisma:308`), ce qui est la
traduction littérale de « le droit meurt avec le dossier ». Poser `SetNull` par prudence produirait
des droits orphelins pointant vers rien.

**Une fiche disparue ne retire pas le droit, et c'est voulu.** `Person.vanishedAt` se pose quand la
personne quitte le référentiel amont, c'est-à-dire au moment précis où son dossier de départ est
utile. Gater la participation sur ce champ ferait échouer le mécanisme dans le seul cas où il sert.

**`VerificationToken` sert les deux voies.** L'identifiant rangé par la voie espace-membre est un
username normalisé, celui de la voie par adresse est une adresse : deux espaces de noms disjoints
tant que personne ne fabrique un username contenant une arobase, ce que `identifiantDepuis`
(`src/app/comptes-isoles/creer.ts:14`) interdit déjà par sa normalisation. Le jour où un troisième
canal arriverait, ce raisonnement serait à refaire.

**Le lien de connexion est un porteur.** Transférer le courriel transfère l'accès, pour la durée du
jeton. Les trente minutes de D16 bornent la fenêtre, elles ne suppriment pas la propriété. La
contrepartie est que la session obtenue est liée à une fiche et à des droits par objet relus à chaque
requête, donc le pire cas est la lecture d'un dossier, pas l'accès à l'outil.

**Le volume de courrier vers un tiers.** Seules les adresses des fiches portant un droit vivant sont
joignables, ce qui borne la cible à des personnes qu'un opérateur a nommément décidé d'impliquer. Une
temporisation par adresse reste possible si cela devait mordre, elle n'est pas livrée ici.

**Élargir le filtre du journal change son sens.** Passer de « ce qui la concerne » à « ce qui la
concerne ou ce qu'elle a fait » est le bon comportement pour une fiche, mais c'est un changement de
définition qui doit être écrit dans le commentaire, sinon la prochaine lecture le prendra pour un
bug.

**Livrer avant #10 donne une démonstration, pas une fonctionnalité.** Sans `expectedActor`, un
participant voit un dossier vide ou, pire, le dossier entier en lecture seule. L'ordre est #10 puis
#13 pour l'étape 6. Les deux autres voisins sont sans danger dans les deux sens, à condition de
suivre D17 bis et la note du modèle : avec #14, une seule route et un seul résolveur de session ;
avec #8, la clé étrangère suit le renommage du dossier. Ce qui casserait, c'est deux `/moi`, deux
`requireUtilisateur`, ou une `CaseParticipation` oubliée dans la migration de renommage, et aucun des
trois ne lèverait d'erreur au typecheck.

**`AUTH_URL` devient critique pour un cas de plus.** C'est lui qui construit les liens
(`src/lib/env.ts:47-53`), et pour une fiche locale il n'existe aucune autre porte d'entrée. Une
valeur fausse ne se voit qu'au premier lien mort.

**Le provider espace-membre dépend encore d'une route dépréciée** (`docs/architecture.md`, section
7). La voie par adresse n'en dépend pas, ce qui est un gain de robustesse constaté, pas une raison de
la préférer : elle n'est ouverte qu'aux fiches locales et le restera.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire pour les nouveaux composants
clients. Au-delà :

- Après la migration, `pnpm db:generate` puis redémarrage de `pnpm dev`, sans exception : le
  typecheck passerait pendant que le runtime refuserait `participations`.
- La contrainte tient : un `INSERT` posant `expiresAt` avant `grantedAt` est refusé par PostgreSQL.
- Parcours complet voie espace-membre : ouvrir un dossier pour un membre non opérateur, lui octroyer
  un droit, se connecter avec son identifiant depuis un autre navigateur, constater qu'il n'atteint
  ni `/`, ni `/personnes`, ni un autre dossier, qu'il voit ses seules étapes, et qu'il peut en
  pointer une.
- Parcours complet voie par adresse : créer une fiche locale depuis un compte isolé, lui déclarer une
  adresse, lui octroyer un droit, recevoir le lien sur mailpit, entrer, pointer, sortir.
- Révocation à chaud : pendant que la session du participant est ouverte, révoquer le droit, puis
  recharger la page du dossier et soumettre le formulaire déjà affiché. Les deux doivent être
  refusés, sans déconnexion et sans attendre l'expiration du jeton.
- Refus silencieux : une adresse inconnue, une adresse d'une fiche `BETA`, et l'identifiant d'un
  membre sans droit produisent le même écran, et aucun courriel ne part. Vérifier l'absence d'envoi
  dans mailpit, pas seulement l'absence d'erreur.
- Le journal montre l'octroi, la révocation et le pointage du participant, chacun nominatif, avec la
  voie d'identification en charge utile, et l'événement précédant l'écriture.
- `SELECT count(*) FROM "CaseParticipation" WHERE "departureCaseId" NOT IN (SELECT id FROM
  "DepartureCase");` rend zéro, avant comme après suppression d'un dossier.
- `ACTIONS_ENABLED` reste à `false` pendant tout le parcours, et aucun appel sortant n'a lieu : ni
  l'octroi, ni la connexion, ni le pointage n'invoquent de connecteur.
- Relecture de la Definition of Done du ticket point par point, en particulier « le contrôle est fait
  dans la page et l'action » : ouvrir `src/proxy.ts` et confirmer qu'il n'a pas bougé.
- La proposition d'amendement de `docs/architecture.md` section 6 est soumise à l'utilisateur et
  laissée non appliquée si elle n'est pas validée.
