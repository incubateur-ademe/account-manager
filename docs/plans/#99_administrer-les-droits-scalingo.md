# Administrer les droits Scalingo (#99)

> Plan d'implémentation de l'issue #99. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment. Il couvre les trois besoins du ticket, qui se livrent ensemble : voir qui accède à quoi,
> ajuster un droit hors d'une arrivée ou d'un départ, et émettre un jeton restreint plutôt que de
> partager celui du compte technique.

## Ce qui a été tranché

Ces décisions ne se rediscutent pas dans l'implémentation. Elles sont ici pour qu'une session
neuve n'ait pas à les redécouvrir.

- **Les trois besoins sont retenus et livrés en une seule PR.**
- **« Projets » désigne la notion Projects de Scalingo**, pas un regroupement par startup d'État. Le
  champ `project` est déjà rendu par `GET /v1/apps` sur l'objet application, sous la forme
  `{id, name}`, et le connecteur le jette aujourd'hui faute de l'avoir déclaré.
- **Un projet Scalingo n'a pas de membres propres.** La gestion des utilisateurs reste au niveau de
  l'application. L'écran présente un regroupement, jamais une appartenance.
- **La contenance des ressources est une notion du socle**, portée par une auto-relation
  `Resource.parentId` nullable, sur un seul niveau, en `SetNull`. `ConnectorContract` ne change pas :
  la contenance est une forme du constaté, pas du déclaré. Elle est livrée avec ses deux clients,
  Scalingo qui pose le projet et GitHub qui cesse d'encoder l'organisation dans une chaîne.
- **La contenance n'ouvre ni ne coupe aucun droit.** Elle n'entre dans aucun plan, aucune empreinte,
  aucune étape.
- **Le mécanisme `props` / `propsSchema` est écrit dans l'ADR 0002 mais pas construit**, faute de
  client. La région Scalingo reste dans le libellé, délibérément : les écrans génériques ne lisent
  que `label`, et deux applications homonymes de régions différentes doivent rester distinguables sur
  l'écran qui sert à décider d'une coupure.
- **Le geste hors dossier est un plan `MANUAL_OP` sans dossier**, portant la personne visée et
  l'intention gelée, qui est à son recalcul d'empreinte ce que `AccessCase.profileKey` est à celui
  d'une arrivée.
- **La frontière de la clé d'engagement.** Une étape d'octroi porte une clé si et seulement si ce
  qu'elle ouvre ne reparaîtra pas dans le `CollectResult` du connecteur qui l'a émise. La frontière
  est par action et non par système, et le connecteur seul sait de quel côté elle tombe. Le socle
  transporte la clé sans jamais l'interpréter.
- **Un geste est refusé tant qu'un départ est ouvert sur la personne**, parce qu'il déplacerait
  l'empreinte du départ sous ses pieds.
- **Le `scopeSchema` de Scalingo passe en union discriminée dès ce lot**, et la rupture se livre en
  même temps que le changement du dépôt de configuration.
- **L'émission passe par `POST /api/generate` sur l'instance de l'incubateur.** La génération hors
  ligne est impossible, le sel serveur n'étant pas exposé.
- **Un jeton émis se modélise en `ServiceAccount`.**
- **L'échéance obligatoire est le seul mécanisme de reprise qui existe**, le proxy n'offrant ni
  révocation ni introspection. Elle sort de la règle existante sur les accès à risque élevé.
- **Les blobs couvrent les seuls usages tiers**, pas la collecte de l'outil, qui découvre ses régions
  et ne doit pas se voir figer trois cibles.
- **Les tests mockent au niveau du transport**, par des doubles de `LectureScalingo` et
  `EcritureScalingo`. Le fichier de contrat n'est pas étendu et aucun jeton n'est demandé.
- **Deux ADR séparés**, 0002 sur les trois rangements de ce qu'un connecteur stocke, 0003 sur le
  geste hors dossier et la clé d'engagement.
- **Le garde-fou de chute ne sort du relevé que les contenants**, et rien d'autre. La balance reste
  inexacte sur une équipe GitHub vide, et c'est assumé : les projets Scalingo sont provisoires du
  côté du fournisseur, dont la spécification n'est pas arrêtée. On reprendra le comptage complet
  quand elle le sera, pas avant. L'ADR 0002 ne peut donc pas écrire que la contenance ne pèse sur
  rien : il écrit qu'elle ne pèse plus sur le relevé, et pourquoi le reste attend.
- **Le contrat de connecteur s'étend** : `StepOutcome` et `ResultatDExecution` apprennent qu'une
  étape peut remettre un credential à ranger et une moitié à ne montrer qu'une fois. L'écriture reste
  au socle, aucun connecteur n'importe `@/lib/db` et cela ne change pas.
- **La revue apprend le terme.** `src/core/revue.ts` cesse de réclamer une revue sur un compte
  machine dont l'échéance est passée, et les deux lectures qui comptent les revues en retard suivent
  (`src/lib/inventaire.ts:93`, l'écran des comptes de service). La table de `/systemes/scalingo` gagne
  l'échéance, faute de quoi elle afficherait « à jour » pour un jeton mort.

## Ce qui existe aujourd'hui

### Le connecteur Scalingo lit tout le parc, et sait déjà écrire dans les deux sens

**La collecte ne déclare aucune région, elle les demande.** `lireRegions`
(`src/connectors/scalingo.ts:492-514`) interroge `GET /v1/regions` sur l'hôte d'authentification
(`:26`), et son échec est fatal (`:534-544`) : ne pas savoir où chercher n'autorise pas à conclure
que le parc est ailleurs vide. `lireCompte` (`:471-490`) lit `GET /v1/users/self` avant tout, parce
que c'est l'identifiant du compte porteur du jeton qui décide du périmètre. Puis, région par région,
`lireApplications` (`:277-346`) lit `GET /v1/apps` sur l'hôte régional et ne retient que ce qui n'a
pas d'ascendance (`:323`) et ce que l'incubateur possède (`:328`) : les environnements de revue
sortent du périmètre sur leur seule ascendance, et les applications où le compte n'est que
collaborateur aussi. `lireParc` (`:515-632`) enchaîne ensuite un `GET /v1/apps/:nom/collaborators`
par application (`:565-570`), chacun précédé d'un espacement fixe de 1100 ms (`:66`, `:564`), puis un
`GET /v1/collaborators` par région comme témoin (`:578-579`), que `recouper` (`:420-460`) confronte
au relevé sans jamais le remplacer. Trois surveillances de champ facultatif closent la lecture
(`:601-629`) : la disparition de `is_limited`, de `user_id` ou de `parent_app_name` rendrait le run
vert tout en le faisant mentir, et chacune produit une erreur unitaire.

**Ce que l'assemblage produit est exactement un triplet, et rien de plus.** `assembler`
(`:640-713`) rend une ressource par application, dont le libellé est `` `${application.name},
${region}` `` (`:665`) et l'adresse la page des collaborateurs du tableau de bord (`:31-32`, `:666`) ;
une identité par propriétaire d'application (`:669-674`) et une par collaborateur, clé sur
`user_id ?? id` parce que les deux formes sont disjointes et qu'une invitation qui dort n'a pas
encore de compte (`:688`) ; et un accès par couple, portant l'un des trois rôles du fournisseur,
`owner` déduit de l'application, `collaborator` ou `limited` selon le seul booléen que l'API expose
(`:154-157`, `:676-680`, `:704-708`). Une invitation en attente gagne une ligne de détail
(`:697-699`), et le nom d'usage n'est jamais lu, valant la chaîne littérale « n/a » tant que
l'invitation n'est pas acceptée (`:691-696`).

**Écrire, le connecteur le fait déjà, et les deux sens sont en tier `auto`.** `executerScalingo`
(`:1091-1160`) refuse d'abord la simulation (`:1096-1098`), puis l'absence de jeton (`:1100-1106`),
puis une étape qu'il ne sait pas viser (`:1108-1115`). L'invitation part en `POST` sur les
collaborateurs de l'application avec un `is_limited` toujours explicite (`:1120-1129`), et
`interpreterOctroi` (`:806-825`) tient le 409 pour un succès. Le retrait relit les collaborateurs et
retrouve la ligne par l'adresse en minuscules juste avant de supprimer (`:1136-1152`), délibérément,
l'identifiant de collaboration changeant dès qu'une invitation est retirée puis réémise, et
`interpreterRetrait` (`:774-793`) tient le 404 pour un succès. Le précheck `constaterCollaborateur`
(`:1053-1080`) lit et compare, et `constaterCollaboration` (`:833-857`) sait déjà répondre `STALE`
avec le rôle attendu et le rôle constaté (`:856`). Cette branche ne s'atteint aujourd'hui que pour
solder un écart, jamais pour le corriger : `decider` (`src/core/execution.ts:185-192`) n'exécute rien
sur un `STALE` et laisse l'étape attendre un humain, parce qu'un octroi n'est pas idempotent.

**Le commentaire qui annonce les capacités est périmé, et il l'est deux fois.**
`src/connectors/scalingo.ts:1187-1190` écrit que l'octroi et le retrait sont manuels, alors que les
deux déclarations qui le suivent portent `tier: "auto"` (`:1191-1198`). Il ajoute que le retrait
« attend d'abord que le socle sache dire à un connecteur sur quelles ressources agir », ce qui est
fait depuis : `systemesDeLaPersonne` (`src/lib/dossier.ts:83-124`) remplit `accesParSysteme` avec les
seuls accès dont le rattachement autorise une coupure (`:108-111`), et `planifierDepartScalingo`
(`src/connectors/scalingo.ts:950-1024`) en tire une étape par application constatée (`:978-1002`),
plus une étape de rotation des secrets (`:1005-1022`) qu'aucune API ne sait faire.

**Le jeton est déclaré, facultatif, et absent de la documentation de déploiement.**
`SCALINGO_API_TOKEN` passe par le schéma d'environnement (`src/lib/env.ts:69`) et figure dans
`.env.example:157`, mais le tableau des variables de `docs/deploiement.md:531-532` ne connaît que
`GITHUB_TOKEN` et `NOTION_SCIM_TOKEN`. Sa note de portée dit en clair ce qu'il est
(`src/connectors/scalingo.ts:1174-1183`) : un jeton hérite de tous les droits du compte qui l'a créé,
sur chaque application et chaque base, et le fournisseur ne sait pas le restreindre.

### Ce que les écrans montrent d'un accès Scalingo, c'est-à-dire presque rien

**Un seul écran descend jusqu'à un accès, et ce n'est pas celui d'une personne suivie.** La recherche
est exhaustive : hors code généré et hors tests, `prisma.resource` et `prisma.accessGrant` ne sont
touchés qu'en quatre endroits, `src/lib/inventaire.ts:85-89` qui les agrège en compteurs pour le
tableau de bord, et `src/lib/sync/collecte.ts:184-196`, `:240` et `:432` qui sont la collecte
elle-même. Par la relation, un seul appelant : `src/app/comptes-isoles/page.tsx:97-103`, qui charge
les accès vivants d'un compte isolé et les replie en une chaîne par ligne,
`` `« ${role} » ${provider} (${label})` `` (`:141-143`). Aucun écran ne liste donc les applications
d'un système, aucun ne montre qui détient quoi dessus, et le seul endroit du produit où un accès
Scalingo se lit est la file des comptes que personne ne réclame.

**La fiche d'une personne s'arrête à ses identités.** Le `select` des `identities`
(`src/app/personnes/[username]/page.tsx:112-121`) retient `id`, `provider`, `handle`, `externalId`,
`matchMethod`, `lastSeenAt` et `vanishedAt`, et pas la relation `grants`. La fiche sait donc dire
qu'un compte Scalingo existe ; sur quelles applications il porte, et avec quel rôle, elle n'en sait
rien, et rien ailleurs ne le dit non plus. Le modèle `Reference`, lu et écrit par la fusion de fiches
(`src/app/personnes/[username]/edition.ts:190`, `:554`), ne rend pas ce service : il n'y sert qu'à
compter ce qu'un déplacement emporte.

**`/systemes/scalingo` rend 404.** `aUnePage` (`src/ui/connecteurs/registre.ts:60-66`) exige un
écran, un `configSchema` ou au moins une fonctionnalité. Le registre des écrans ne connaît que
`github` (`:20-22`), `configSchema` n'est déclaré que par `github` (`src/connectors/github.ts:961`),
et aucun connecteur du dépôt ne déclare `features`. La route refuse donc
(`src/app/systemes/[cle]/page.tsx:37-39`), et l'écran des systèmes n'offre pas le lien
(`src/app/systemes/page.tsx:217`). Ce que Scalingo a, c'est une tuile de tableau de bord
(`src/ui/connecteurs/registre.ts:31-34`, `src/ui/connecteurs/scalingo/tuiles.tsx`), qui refait son
propre chemin vers l'API plutôt que d'emprunter celui de la collecte et ne fonde aucune décision de
coupure.

### La contenance existe déjà, écrasée dans des chaînes

**GitHub encode l'organisation dans la clé de l'équipe.** `assemblerOrganisation`
(`src/connectors/github.ts:372-450`) pose l'organisation comme une ressource à part entière (`:378`),
puis chaque équipe sous la clé `` `${org}#${equipe.id}` `` (`:401`), avec un commentaire qui explique
le dièse : il écarte toute collision avec la clé de l'organisation comme avec la ressource
synthétique du socle (`:397-400`). La clé porte donc la contenance, et personne ne la relit jamais :
le dépôt ne contient aucune autre occurrence du séparateur, ni découpage, ni test dessus.

**Scalingo encode la région dans le libellé, et la relit.** Le libellé d'une ressource vaut
`` `${application.name}, ${region}` `` (`src/connectors/scalingo.ts:665`), séparé par une virgule
parce qu'un nom d'application Scalingo n'en contient jamais (`:661-664`), et
`planifierDepartScalingo` le redécoupe pour retrouver l'hôte régional, `application.split(", ")`
(`:983`), avec le commentaire qui l'assume (`:981-982`). C'est un aller-retour complet par une chaîne
d'affichage, et il n'a pas d'autre voie : `ObservedResource` ne porte que `externalId`, `label` et
`url` (`src/core/connector.ts:224-228`), et ce qu'un connecteur reçoit d'un accès constaté au moment
du plan se limite à `resourceExternalId` et `resourceLabel` (`src/lib/dossier.ts:104-111`).

**La table n'a rien où ranger autre chose.** `Resource` porte `provider`, `externalId`, `label`,
`url` et ses deux relations (`prisma/schema.prisma:276-288`), ce que `docs/architecture.md:419-421`
énumère à l'identique. Elle n'a pas de date de disparition et ses lignes ne s'effacent jamais, ce que
la collecte compense en comptant les ressources par les accès qu'elles portent encore
(`src/lib/sync/collecte.ts:225-241`). Une ressource sans aucun accès, ce qu'un projet Scalingo sera,
est donc déjà un cas que le garde-fou de chute sait ne pas compter.

### La machine du plan, et les cinq garde-fous qu'elle oppose

**`executerPlan` est le seul appelant de `execute()` hors tests, et tout ce qu'il vérifie vient du
dossier.** La fonction (`src/lib/execution.ts:226-...`) appelle `systeme.execute(etape, ctx)` en un
seul endroit (`:431`), et son unique appelant de production est `lancerExecution`
(`src/app/dossiers/[id]/actions.ts:934`). Entre les deux, cinq garde-fous, qu'encadrent deux refus
d'existence : le plan ou son dossier introuvable (`:285-287`), et l'absence de l'instant de
confirmation (`:309-313`), sans lequel les tolérances de ce plan ne se rejouent pas.

Le premier garde-fou est l'**état du dossier** : `dossierVivant` (`:288`,
`src/core/dossier.ts:521-524`). Sur un plan sans dossier, `plan.accessCase` est nul et le refus
d'existence tombe avant lui : le geste hors dossier ne franchit pas la première ligne.

Le deuxième est l'**état du plan** : `peutExecuter` (`:292`, `src/core/execution.ts:20-30`), qui
n'ouvre que `EXECUTING` et `PARTIALLY_EXECUTED`. Il ne regarde que le plan, et se tient tel quel sur
une étape unique sans dossier.

Le troisième est la **péremption** : `refusDePeremption` (`:299`, `src/core/execution.ts:44-50`), qui
compare `expiresAt` à maintenant, avant tout calcul. Lui aussi ne lit que le plan, et se tient tel
quel.

Le quatrième est l'**empreinte** : `refusDEcart` (`:328`, `src/core/execution.ts:65-78`) compare
`confirmedDigest` au recalcul. Et c'est là que tout se joue, parce que le recalcul est
`calculerPlan(sens, personId, username, maintenant, profilDeLaPolitique(profileKey), confirmedAt)`
(`:316-326`) : le sens, la personne, le profil et l'instant des tolérances viennent tous du dossier,
et un plan qui n'en a pas n'a aucune de ces entrées. L'empreinte, elle, ne dépend que des étapes
(`src/core/plan.ts:54-79`) : elle est calculable, c'est ce qui la produit qui manque.

Le cinquième est la **masse** : `masseDuPlan` et `refusDeMasse` (`:336-344`,
`src/core/plan.ts:313-334`), qui comptent les étapes exécutables du plan recalculé contre le plafond
de la politique. Sur une seule étape, il ne se déclenche jamais, mais il porte sur `actuel.etapes` et
non sur `plan.steps` : sans recalcul, il n'a rien à compter.

**Une quatrième garde vit plus haut, dans la couche action.** La confirmation écrit par un
`updateMany` conditionné sur ce qui a été lu, `accessCase: { state: { in: [...ETATS_VIVANTS] } }`
(`src/app/dossiers/[id]/actions.ts:232-237`), une clause qui ne rend jamais aucune ligne quand la
relation est nulle : un plan sans dossier ne se confirmerait pas, donc n'atteindrait jamais
`EXECUTING`, donc échouerait aussi au deuxième garde-fou.

### Ce que le socle a déjà prévu pour un plan sans dossier, et ce qui lui manque

**La colonne existe, la relation la protège, et la migration l'a explicitement affranchie.**
`Plan.accessCaseId` est facultatif (`prisma/schema.prisma:552`), la relation est en `SetNull`
(`:564`), et l'index unique partiel qui garantit un seul plan courant par dossier est écrit à la main
dans `20260824161541_un_seul_plan_courant_par_dossier`, sous une clause
`WHERE "accessCaseId" IS NOT NULL`, commentée « Les plans sans dossier restent libres ».
`PlanKind` porte `MANUAL_OP` depuis la migration initiale
(`prisma/migrations/20260808000000_init/migration.sql:26`, `prisma/schema.prisma:535`), et
`modeleDuPlan("MANUAL_OP")` rend déjà `null` (`src/core/modele-plan.ts:41-46`), épinglé par un test
(`src/core/modele-plan.test.ts:493-496`). `PlanStep.justification` attend son premier écrivain
(`prisma/schema.prisma:657-659`), avec un commentaire qui dit pourquoi elle ne se remplit jamais
depuis un profil. Et `lancerExecution` garde déjà sa revalidation derrière un test de nullité,
`if (plan.accessCaseId)` (`src/app/dossiers/[id]/actions.ts:940-942`).

**Ce qui manque, c'est tout le chemin d'écriture, et le chemin de lecture avec.** `enregistrerPlan`
exige un `accessCaseId: string` non nul en premier paramètre (`src/lib/dossier.ts:491`), et le `kind`
qu'il écrit vaut `calcule.sens` (`:526`), dont le type est `SensDossier`, soit `ONBOARDING` ou
`OFFBOARDING` (`src/core/dossier.ts:16`, `src/lib/dossier.ts:170`) : aucun chemin du dépôt ne sait
donc écrire un plan de kind `MANUAL_OP`, et `MANUAL_OP` n'apparaît nulle part ailleurs que dans
l'enum, sa migration, la table des moments et le test qui l'épingle. Le seul écran qui montre un plan
part d'un dossier (`src/app/dossiers/[id]/page.tsx:455`, `:544`), si bien qu'un plan orphelin est
aujourd'hui exactement ce que décrit le commentaire de la fusion de fiches, « vivants mais
introuvables dans les écrans » (`src/app/personnes/[username]/edition.ts:437-441`). Et la
réconciliation l'ignore de propos délibéré : `actionsDeclarees` passe toute étape dont le plan n'a pas
de dossier (`src/lib/sync/constats.ts:504-513`), avec le commentaire « une étape sans dossier n'entre
pas ici » : aucun `OVERDUE_MANUAL_ACTION` ne se lèverait donc sur un geste hors dossier.

**Enfin, une trace décidée ne peut pas vivre dans les tables du constaté.**
`src/lib/sync/collecte.ts:431-440` date en disparu tout `AccessGrant` du fournisseur dont `lastSeenAt`
précède le run. Un accès écrit à la main s'éteindrait donc à la nuit suivante, sortirait de
`systemesDeLaPersonne`, qui ne retient que les accès vivants (`src/lib/dossier.ts:90-93`), et le
départ cesserait de le voir. Le socle a déjà tranché ce cas ailleurs, pour l'échéance d'un octroi :
`PlanStep.grantExpiresAt` vit sur l'étape « et pas sur AccessGrant : cette table est reconstruite par
la collecte, une échéance décidée y serait effacée à la première nuit »
(`prisma/schema.prisma:651-654`).

### fine-grained-proxy n'existe nulle part dans ce dépôt

**Le mot apparaît deux fois dans les sources, et une seule de ces occurrences a un effet.**
`CredentialRef.source` accepte `"env" | "fgp"` (`src/core/connector.ts:19-26`), et la valeur `"fgp"`
n'est déclarée par aucun connecteur : les trois credentials du dépôt portent `source: "env"`
(`src/connectors/scalingo.ts:1177`, `src/connectors/github.ts:928`, `:935`,
`src/connectors/notion.ts:467`). La seule lecture du champ est une phrase d'écran,
`credential.source === "env" ? "l'environnement" : "fine-grained-proxy"`
(`src/app/systemes/[cle]/page.tsx:102`), sur une page que seul `github` atteint. Hors de là, rien :
aucune dépendance du `package.json` ne parle à un proxy, les seules routes du dépôt sont
`src/app/healthz/route.ts` et `src/app/api/auth/[...nextauth]/route.ts`, et aucune variable
d'environnement de `src/lib/env.ts` ne nomme une adresse de proxy. Le `src/proxy.ts` du dépôt est la
barrière de session de Next et n'a rien à voir.

**La règle, elle, est déjà écrite, et elle désigne Scalingo.** `docs/architecture.md:818-825` prescrit
`fgp` « pour tout credential à portée large que le fournisseur ne sait pas cloisonner », en donnant
le triplet OVH pour cas d'école, et réserve `env` aux fournisseurs qui savent émettre des credentials
nativement restreints. La note de portée du jeton Scalingo décrit mot pour mot le premier cas
(`src/connectors/scalingo.ts:1178-1182`) tout en se déclarant `env`. Ce lot est donc la première
occasion où la ligne `fgp` du contrat cesse d'être une intention.

### Deux choses à savoir avant de lire la suite

**Le socle connaît déjà un connecteur par son nom.** `rapprochement` branche sur
`identite.provider === "github"` pour rapprocher par login (`src/core/rapprochement.ts:147-154`) et
produit la valeur d'enum `GITHUB_LOGIN`, gravée dans `prisma/schema.prisma:234` et citée par
`METHODES_REVOCABLES` (`src/core/rapprochement.ts:23-27`). Ce n'est pas à corriger ici, mais c'est le
précédent qu'on ne veut pas répéter avec la contenance.

**Une identité rattachée par ressemblance ne produit jamais de révocation.**
`autoriseUneRevocation` (`src/core/rapprochement.ts:29-31`) n'admet que `DECLARED`, `GITHUB_LOGIN` et
`EMAIL_EXACT`, et `systemesDeLaPersonne` l'applique avant de transmettre le moindre accès à un
connecteur (`src/lib/dossier.ts:107-110`). Tout ce que ce plan ajoute passe sous cette règle sans la
toucher.

## La contenance des ressources

Un projet Scalingo regroupe des applications, une organisation GitHub regroupe des équipes, et rien
dans le socle ne sait dire ce regroupement aujourd'hui. `Resource` est une table plate
(`prisma/schema.prisma:276-288`) et `ObservedResource` un enregistrement plat de trois champs
(`src/core/connector.ts:224-228`). Les deux connecteurs qui en auraient besoin s'en sont sortis
chacun à sa façon : GitHub encode l'organisation dans la clé de l'équipe, `${org}#${equipe.id}`
(`src/connectors/github.ts:401`), Scalingo n'a rien à encoder puisqu'il ignore les projets. Ce lot
pose la contenance une fois, dans le socle, et la fait servir aux deux.

**Ce que la contenance est, et ce qu'elle n'est pas.** Elle est une forme du constaté : le
connecteur la relève comme il relève un libellé, le socle l'écrit et la rend, personne ne la décide.
Elle n'ouvre ni ne coupe aucun droit, n'entre dans aucun plan, aucune empreinte, aucune étape.
Scalingo ne sait retirer quelqu'un que d'une application, jamais d'un projet, et un projet ne porte
aucun accès par construction puisqu'un projet Scalingo n'a pas de membres. Un contenant reste une
ressource ordinaire : il peut porter ses propres accès, comme l'organisation GitHub qui en porte un
par membre (`src/connectors/github.ts:392`), ou n'en porter aucun, comme un projet Scalingo. La
seule chose qui le distingue est que d'autres ressources le désignent.

**`ConnectorContract` ne change pas.** La contenance est une forme du constaté, pas du déclaré : elle
n'a rien à faire dans un `scopeSchema` ni dans un `configSchema`, et aucun profil de politique ne
l'écrit. Ce qui change est le relevé, `ObservedResource`, et la table qui le reçoit.

### Le modèle

`Resource` gagne une auto-relation nommée, un seul niveau, avec son index.

```prisma
model Resource {
  id String @id @default(cuid())

  provider   String
  externalId String
  label      String
  url        String?

  // Nul est le cas normal : la plupart des ressources ne sont contenues par rien, et un
  // connecteur qui ignore la notion n'a rien à remplir.
  parentId String?

  // SetNull et non Cascade : supprimer un contenant emporterait ses contenues, et avec
  // elles leurs accès, que `AccessGrant` supprime en cascade (voir plus bas). L'histoire
  // de qui détenait quoi disparaîtrait pour la suppression d'un regroupement qui n'ouvre
  // aucun droit.
  parent   Resource?  @relation("Contenance", fields: [parentId], references: [id], onDelete: SetNull)
  contenus Resource[] @relation("Contenance")

  grants     AccessGrant[]
  references Reference[]

  @@unique([provider, externalId])
  @@index([parentId])
}
```

Le commentaire de `SetNull` porte un fait vérifiable : `AccessGrant.resource` est en
`onDelete: Cascade` (`prisma/schema.prisma:303`), et `Reference.resource` aussi
(`prisma/schema.prisma:325`). Une cascade sur la contenance ferait donc d'une suppression de projet
la suppression silencieuse de tous les accès de toutes ses applications. Aucun code du dépôt ne
supprime une ressource aujourd'hui, ce qui rend le choix gratuit à poser et coûteux à ne pas poser :
c'est la première suppression écrite un jour qui découvrirait la cascade.

**Un seul niveau, et c'est le socle qui le tient, pas la colonne.** Une auto-relation accepte une
chaîne de profondeur quelconque et n'interdit aucun cycle, PostgreSQL ne vérifiant rien de tel sur
une clé étrangère vers la même table. La règle du socle refuse à l'entrée toute contenance dont le
contenant est lui-même contenu, si bien qu'aucun lecteur n'a jamais à parcourir une chaîne ni à se
garder d'une boucle. C'est ce qui évite d'écrire une requête récursive, que Prisma n'exprime pas sans
SQL brut, pour afficher un regroupement.

L'index sur `parentId` sert la seule lecture qui vient : tout ce qu'un contenant contient. Il sert
aussi le regroupement, que `groupBy({ by: ["parentId"] })` sait maintenant exprimer : avant cette
colonne, `ResourceScalarFieldEnum` n'énumérait que `id`, `provider`, `externalId`, `label` et `url`
(`src/generated/prisma/internal/prismaNamespace.ts:2456-2462`), et un axe de regroupement rangé dans
une colonne `Json` n'y serait pas entré davantage.

La migration est purement additive, sans reprise de données, et se produit par
`pnpm prisma migrate dev --name ressource_contenue_par_une_autre` :

```sql
ALTER TABLE "Resource" ADD COLUMN "parentId" TEXT;

CREATE INDEX "Resource_parentId_idx" ON "Resource"("parentId");

ALTER TABLE "Resource" ADD CONSTRAINT "Resource_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Le commentaire d'en-tête du fichier de migration s'écrit au moment où le dossier est créé et pas
après : une migration appliquée est figée, et retoucher son texte casse son empreinte. Ensuite,
`pnpm db:generate` puis redémarrage de `pnpm dev`, le client généré étant mis en cache sur
`globalThis` et servant sinon des métadonnées périmées. Pour l'étage d'intégration,
`pnpm db:deploy:test` avant de lancer les scénarios.

### Ce que le contrat relève

```ts
export interface ObservedResource {
  externalId: string;
  label: string;
  url?: string;
  /** La clé du contenant, relevée dans le même passage. Un seul niveau : le socle refuse le reste. */
  parentExternalId?: string;
}
```

**La contenance se déclare par la contenue, et par une clé.** Deux choix, deux raisons.

Par la contenue, parce que c'est la forme de la colonne : une clé étrangère nullable sur la ligne
contenue, et rien d'autre. Un contenant qui énumérerait ses contenues dirait la même relation dans
l'autre sens, obligerait le socle à réconcilier deux déclarations possibles du même fait, et rendrait
ambiguë la sortie d'une ressource de son contenant, qui se lit aujourd'hui comme l'absence de champ
sur la contenue et se lirait là comme l'absence d'une entrée dans une liste qu'un relevé tronqué
produit tout seul.

Par une clé et non par un objet imbriqué, parce que la clé est déjà la monnaie du contrat :
`ObservedGrant.resourceExternalId` (`src/core/connector.ts:232`) nomme une ressource par sa clé et le
socle la résout dans le relevé du même passage (`src/lib/sync/collecte.ts:161-174`). Une seconde
manière de désigner une ressource serait une seconde manière de se tromper. Un objet imbriqué
dupliquerait de surcroît le libellé du contenant sur chacune de ses contenues, ce que
`docs/architecture.md:419-421` refuse déjà pour la ressource elle-même, et il rendrait la
contradiction inobservable : un relevé imbriqué est cohérent avec lui-même par construction, le socle
n'aurait plus rien à vérifier et devrait à la place décider s'il crée un contenant que le connecteur
n'a émis nulle part ailleurs.

### La règle du socle

Trois contradictions se refusent avant toute écriture : un contenant absent du relevé, une ressource
qui se contient elle-même, une contenance à plus d'un niveau. Chacune écarte **la contenance** et
garde **la ressource**, et chacune rend le run partiel.

```ts
export interface ContenancesVerifiees {
  ressources: readonly ObservedResource[];
  erreurs: readonly CollectError[];
}

function refusDeContenance(
  ressource: ObservedResource,
  parent: string,
  declarees: ReadonlyMap<string, string | undefined>,
): string | null {
  if (parent === ressource.externalId) {
    return "se contient elle-même";
  }
  if (!declarees.has(parent)) {
    return `contenue par une ressource absente de la collecte : ${parent}`;
  }
  if (declarees.get(parent) !== undefined) {
    return `contenue par une ressource qui l'est déjà : ${parent}`;
  }
  return null;
}

/**
 * Les trois refus se jugent sur ce que le connecteur a déclaré, jamais sur ce qui survit
 * aux deux autres : sans cela, une contenance écartée ferait passer pour valide celle qui
 * s'appuyait dessus, et la contradiction du connecteur sortirait du relevé sans un mot.
 */
export function verifierContenances(ressources: readonly ObservedResource[]): ContenancesVerifiees {
  const declarees = new Map<string, string | undefined>();
  for (const ressource of ressources) {
    declarees.set(ressource.externalId, ressource.parentExternalId);
  }

  const erreurs: CollectError[] = [];
  const retenues = ressources.map((ressource) => {
    const parent = ressource.parentExternalId;
    if (parent === undefined) {
      return ressource;
    }

    const refus = refusDeContenance(ressource, parent, declarees);
    if (refus === null) {
      return ressource;
    }

    erreurs.push({ scope: "ressources", itemRef: ressource.externalId, message: refus });
    return {
      externalId: ressource.externalId,
      label: ressource.label,
      ...(ressource.url === undefined ? {} : { url: ressource.url }),
    };
  });

  return { ressources: retenues, erreurs };
}
```

Pure, sans base, sans réseau : elle vit dans `src/core/collecte.ts`, aux côtés de `chuteExcessive`
(`:56-61`) et de `champsConstates` (`:37-54`), et se teste à l'étage unitaire. La table des
déclarations garde la dernière déclaration d'une clé répétée, exactement comme la boucle d'upsert
garde la dernière écriture.

**Pourquoi la ressource survit à sa contenance.** Parce que la contenance est un accessoire et que la
ressource porte ce pour quoi cet outil existe. La jeter la sortirait de la table de résolution, si
bien que chacun de ses accès tomberait dans « accès sur une ressource absente de la collecte »
(`src/lib/sync/collecte.ts:166-173`), c'est-à-dire une erreur par accès et un accès qui cesse d'être
rafraîchi. La ligne, elle, ne disparaîtrait pas pour autant : aucune suppression de ressource
n'existe dans le dépôt, et le socle le dit déjà (`src/lib/sync/collecte.ts:234-237`). Le résultat
serait une ressource en base dont plus rien ne rafraîchit les accès, un run partiel à chaque passage
tant que le connecteur répète sa contradiction, et le jour où il cesse enfin d'émettre la ressource
sur un relevé par ailleurs propre, la datation du soir (`src/lib/sync/collecte.ts:431-441`) coupe
tout d'un coup. Écarter une contenance ne coûte rien, puisqu'elle n'ouvre aucun droit ; écarter une
ressource coûte ses accès.

**Un cycle de deux n'a pas besoin d'une règle à lui.** Si `A` déclare `B` et `B` déclare `A`, chacune
est contenue par une ressource qui l'est déjà, et les deux contenances tombent sous le troisième
refus. La profondeur maximale d'un et l'absence de cycle sont la même règle.

Le branchement dans `executerCollecte` se fait juste avant l'écriture, à l'endroit où le relevé est
lu et pas encore posé :

```ts
const enPhrase = (erreur: CollectError): string =>
  erreur.itemRef
    ? `${erreur.scope} (${erreur.itemRef}) : ${erreur.message}`
    : `${erreur.scope} : ${erreur.message}`;

const erreurs = (lu.errors ?? []).map(enPhrase);

// ...

const contenances = verifierContenances(lu.resources);
const identites = await enregistrerIdentites(provider, lu.identities, now);
const ressources = await enregistrerRessources(provider, contenances.ressources);
const acces = await enregistrerAcces(provider, lu.grants, ressources, now);
erreurs.push(...contenances.erreurs.map(enPhrase), ...acces.erreurs);

let status: SyncStatus = STATUT[lu.status];
if ((contenances.erreurs.length > 0 || acces.erreurs.length > 0) && status === "OK") {
  status = "PARTIAL";
}
```

La lambda de mise en phrase (`src/lib/sync/collecte.ts:340-344`) devient une fonction nommée parce
qu'elle sert désormais deux fois : la trace d'un passage se lit de la même façon, que la ligne vienne
du connecteur ou du socle, et l'`itemRef` existe précisément pour nommer l'élément fautif
(`src/core/connector.ts:240`). La promotion en `PARTIAL` reprend mot pour mot celle des erreurs
d'accès (`src/lib/sync/collecte.ts:359-361`), et la conséquence est la même : le bloc de datation est
gardé par `status === "OK"` (`:367`), donc un connecteur qui se contredit sur la contenance ne fait
plus disparaître personne cette nuit-là.

**Une ressource écrite par un run partiel voit quand même sa contenance mise à jour, effacement
compris**, parce que le relevé suit le dernier état constaté, absence comprise, comme les métadonnées
d'un compte (`src/lib/sync/collecte.ts:34-35`). Ce n'est pas une datation et ça n'en prend pas le
risque : la contenance n'ouvre ni ne coupe rien, et le pire qu'un effacement produise est un écran
qui cesse de regrouper pendant une nuit.

### Ce que Scalingo émet

Le champ entre dans le schéma d'application, facultatif et tolérant :

```ts
const projetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const applicationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: proprietaireSchema,
  parent_app_name: z.string().nullish(),
  // Nullish parce que la documentation le dit toujours présent sans dire s'il peut être
  // nul, et `catch` parce qu'un projet de forme neuve ferait sinon écarter l'application
  // entière, donc dater comme disparus les accès qu'elle porte.
  //
  // Le repli vaut `undefined` et non `null`. Écrit à l'implémentation, contre ce que ce
  // plan prescrivait d'abord : `null` est une application sans projet, cas ordinaire d'un
  // parc où la notion n'est pas employée, quand `undefined` est une clé disparue ou
  // devenue illisible. Se replier sur `null` rendrait la surveillance aveugle au
  // changement de forme, et la surveiller sur `null` rendrait partiel tout run d'un parc
  // sans projets, donc gèlerait la datation pour un regroupement d'écran.
  project: projetSchema.nullish().catch(undefined),
});
```

C'est la règle que le fichier se donne déjà : sont requis les seuls champs sans lesquels une
application n'existe pas (`src/connectors/scalingo.ts:86-93`). Un projet n'en est pas.

La surveillance de champ facultatif rejoint les trois existantes, dans la même boucle
(`src/connectors/scalingo.ts:592-629`) :

```ts
{
  assez: applications.length > 0,
  scope: "applications",
  // `=== undefined` et non `== null`, contrairement à `is_limited` : un parc entier sans
  // projet est un état légitime, et le signaler figerait la datation chaque nuit pour un
  // regroupement qui n'ouvre aucun droit. Seule la clé disparue ou illisible se signale.
  absent: applications.every(({ application }) => application.project === undefined),
  quoi: `le projet : aucune des ${applications.length} applications retenues ne porte project, et le regroupement disparaîtrait de l'écran sans que rien ne le dise`,
}
```

Le `scope` devient un champ de chaque entrée au lieu d'être la constante `"collaborateurs"` du
`push` (`src/connectors/scalingo.ts:624-627`) : la troisième entrée porte déjà sur les applications
et non sur les collaborateurs, la quatrième aussi, et une trace qui range deux constats
d'applications sous les collaborateurs envoie relire la mauvaise route. Les deux entrées de
collaboration gardent `"collaborateurs"`, les deux d'application prennent `"applications"`. Aucun
test n'assied d'assertion sur le `scope` : les quatre existantes portent sur le message
(`src/connectors/scalingo.test.ts:296`, `:327`, `:340-342`).

L'assemblage émet le projet comme ressource contenante, une fois par projet et non une fois par
application, et pose la contenance sur l'application :

```ts
const projets = new Map<string, ObservedResource>();

for (const { application, region } of applications) {
  const projet = application.project;
  if (projet) {
    // La région entre dans le libellé pour la même raison que sur une application : deux
    // régions peuvent servir le même nom.
    projets.set(projet.id, { externalId: projet.id, label: `${projet.name}, ${region}` });
  }

  ressources.push({
    externalId: application.id,
    label: `${application.name}, ${region}`,
    url: pageDesCollaborateurs(region, application.name),
    ...(projet ? { parentExternalId: projet.id } : {}),
  });

  // ... propriétaire et collaborations, inchangés
}

return { identites: [...identites.values()], ressources: [...projets.values(), ...ressources], acces };
```

Trois points qui se décident ici plutôt que de se découvrir à la relecture. Le contenant n'a pas
d'`url` : l'adresse d'un projet sur le tableau de bord Scalingo n'est établie nulle part dans ce
dépôt, et un lien mort sur l'écran qui sert à décider d'une coupure est pire que pas de lien, le
libellé et le regroupement suffisant à ce qu'un contenant doit faire. La clé est l'identifiant du
projet tel quel, sans préfixe de région, exactement comme l'identifiant d'application
(`src/connectors/scalingo.ts:660`) : c'est le même pari, et le tenir différemment d'une ligne à
l'autre serait la vraie faute. Et le projet ne peut jamais être orphelin, puisqu'il est lu sur la
charge utile de l'application qui le désigne et émis dans le même relevé qu'elle.

### Ce que GitHub change

Une seule ligne : l'équipe déclare l'organisation qui la contient.

```ts
ressources.push({
  externalId: cle,
  label: `Équipe ${equipe.name}`,
  url: `https://github.com/orgs/${org}/teams/${equipe.slug}`,
  parentExternalId: org,
});
```

**La clé `${org}#${equipe.id}` ne bouge pas**, et le commentaire qui la justifie
(`src/connectors/github.ts:396-400`) non plus. Elle a été choisie sur l'identifiant pour survivre à
un renommage, et elle est déjà épinglée par une assertion littérale
(`src/connectors/github.test.ts:131`). Ce que la décision retire est l'obligation d'y lire
l'organisation, pas la clé.

J'ai vérifié que la changer serait destructeur, et le mécanisme est pire que la perte d'historique
qu'on attend. `Resource` est unique sur `(provider, externalId)` (`prisma/schema.prisma:287`), donc
un upsert sous une clé neuve crée une ligne neuve (`src/lib/sync/collecte.ts:94-105`) au lieu de
renommer l'ancienne, qu'aucun code ne supprime. Les accès de l'ancienne ligne ne sont pas rafraîchis,
ceux de la neuve naissent avec un `firstSeenAt` du jour. Trois conséquences se suivent. La datation
du soir vise tout accès du système dont la dernière vue précède le passage
(`src/lib/sync/collecte.ts:431-441`), donc l'ancienne ligne perd tous ses accès d'un coup, et
`systemesDeLaPersonne` ne lit que les accès vivants (`src/lib/dossier.ts:93-96`). La référence du
garde-fou des ressources est comptée après les écritures et avant la datation
(`src/lib/sync/collecte.ts:369` appelé après `:355`, corps en `:239-243`), donc elle compte l'ancienne
ligne et la neuve, c'est-à-dire à peu près le double de ce que le relevé rend : le garde-fou se
déclenche, le run passe en `PARTIAL` et la datation n'a même pas lieu. Et comme un passage partiel ne
nettoie rien, la même chute retombe chaque nuit jusqu'à ce qu'une décision nominative la lève
(`src/lib/sync/gardefou.ts:258-274`). Une clé de ressource ne se change pas.

L'organisation est déjà émise comme ressource, inconditionnellement, par la fonction même qui émet
les équipes (`src/connectors/github.ts:378-380` et `:402-406`), et elle porte ses propres accès
(`:392`). La contenance GitHub ne peut donc pas être orpheline, pas plus que celle de Scalingo. Le
refus du contenant absent ne protège aujourd'hui d'aucun connecteur existant : il protège le suivant,
et c'est pour ça qu'il se teste à l'étage pur plutôt qu'à travers un connecteur.

### L'écriture en base

Elle se fait dans `enregistrerRessources` (`src/lib/sync/collecte.ts:87-109`), en deux passages.

```ts
async function enregistrerRessources(
  provider: string,
  ressources: readonly ObservedResource[],
): Promise<Map<string, string>> {
  const ecrites = new Map<string, { id: string; parentId: string | null }>();

  for (const ressource of ressources) {
    const enregistree = await prisma.resource.upsert({
      where: { provider_externalId: { provider, externalId: ressource.externalId } },
      update: { label: ressource.label, url: ressource.url ?? null },
      create: {
        provider,
        externalId: ressource.externalId,
        label: ressource.label,
        url: ressource.url ?? null,
      },
      select: { id: true, parentId: true },
    });
    ecrites.set(ressource.externalId, enregistree);
  }

  // Le contrat ne dit rien de l'ordre du relevé, et il n'a pas à le dire : un contenant
  // peut arriver après ce qu'il contient, et sa ligne n'existe qu'une fois tout le relevé
  // écrit.
  for (const ressource of ressources) {
    const ecrite = ecrites.get(ressource.externalId);
    const voulu =
      ressource.parentExternalId === undefined
        ? null
        : (ecrites.get(ressource.parentExternalId)?.id ?? null);

    if (!ecrite || ecrite.parentId === voulu) {
      continue;
    }
    await prisma.resource.update({ where: { id: ecrite.id }, data: { parentId: voulu } });
  }

  const parExternalId = new Map<string, string>();
  for (const [externalId, { id }] of ecrites) {
    parExternalId.set(externalId, id);
  }
  return parExternalId;
}
```

Le second passage ne réécrit que ce qui diffère de l'état trouvé, ce que le `select` du premier
passage rend possible pour rien : une nuit ordinaire, où aucune contenance ne bouge, n'écrit pas une
ligne de plus qu'aujourd'hui. Il pose `null` quand le relevé ne déclare plus de contenant, ce qui est
la sortie d'une ressource de son contenant et la seule façon de l'exprimer. Et il ne résout un
contenant que dans la table du passage courant, celle d'un seul `provider` : une contenance entre
deux systèmes est inécrivable, sans qu'aucune garde n'ait à le dire.

La signature ne change pas, `enregistrerAcces` continue de recevoir la même table de résolution
(`src/lib/sync/collecte.ts:137-141`).

### Le garde-fou de chute

**Oui, la contenance le dilue, et il faut le resserrer dans ce lot.** Le garde-fou compare deux
nombres qui ne comptent pas la même population. La référence, `ressourcesTenuesPourVivantes`
(`src/lib/sync/collecte.ts:239-243`), compte les ressources qui portent encore un accès vivant, et
son commentaire dit pourquoi (`:234-237`) : les compter toutes ferait grossir la référence à chaque
équipe supprimée. Le relevé, lui, est compté par `lu.resources.length`
(`src/lib/sync/collecte.ts:375-381`), c'est-à-dire tout ce que le connecteur émet, accès ou pas.

Un contenant Scalingo n'a aucun accès, donc il n'entre jamais dans la référence, mais il entre dans
le relevé. Il gonfle un seul des deux côtés. Avec le seuil par défaut de deux dixièmes
(`config/config.exemple.yaml:54`), vingt applications toutes pourvues d'un accès donnent une
référence de vingt et un plancher à seize. Une nuit où le relevé ne rend plus que douze applications,
sur un run par ailleurs vert, déclenche le garde-fou aujourd'hui. Demain, avec six projets émis dans
le même relevé, elle en compterait dix-huit et ne le déclencherait plus : la datation du soir
passerait, et les accès des huit applications manquantes seraient datés disparus.

Le resserrement compte le relevé sur la même population que la référence, c'est-à-dire par les accès :

```ts
/**
 * Le relevé compté comme la base : par les accès portés, et non par les ressources émises.
 * Une ressource qu'aucun accès ne vise n'entre pas dans la référence, et la compter dans le
 * relevé masquerait la chute qu'elle est censée révéler. `null` tient la ressource
 * synthétique du système, que le socle substitue à un accès sans ressource et qui porte
 * donc, elle, des accès.
 */
export function ressourcesVisees(acces: readonly ObservedGrant[]): number {
  const cibles = new Set<string | null>();
  for (const grant of acces) {
    cibles.add(grant.resourceExternalId ?? null);
  }
  return cibles.size;
}
```

Au site d'appel, `lu.resources.length` devient `ressourcesVisees(lu.grants)`
(`src/lib/sync/collecte.ts:375-381`), et le nombre publié dans le refus et dans la phrase de trace
suit. Le `null` du jeu correspond à la ressource `(systeme)` que le socle crée pour un accès sans
ressource (`src/lib/sync/collecte.ts:111-135`) : elle porte des accès, donc elle est dans la
référence, donc elle doit être dans le relevé.

C'est un resserrement et pas seulement une compensation : il corrige aussi ce que la contenance ne
crée pas. Une équipe GitHub vide est émise comme ressource sans porter d'accès, elle gonfle déjà le
relevé sans être dans la référence. Le garde-fou devient strictement plus sensible sur GitHub, sans
faux positif possible puisque les deux côtés excluent désormais la même chose. Notion n'émet aucune
ressource et pose tous ses accès sur la ressource synthétique (`src/connectors/notion.ts:335`) : son
relevé passe de zéro à un, sa référence vaut un, et le garde-fou ne se déclenchait pas et ne se
déclenchera pas davantage, le plancher d'une référence de un valant zéro.

J'ai vérifié à la main que les deux assertions chiffrées existantes ne bougent pas. À l'étage
d'intégration, la première nuit rend quatre ressources et deux accès sur une référence de trois :
quatre ou deux, les deux passent le plancher de deux, et le refus ne nomme que les identités
(`src/lib/sync/collecte.integration.test.ts:209`). La seconde nuit rend une ressource et un accès
dessus : le nombre publié reste un, et l'assertion `{ famille: "ressources", observe: 1, reference: 3 }`
(`:256`) tient telle quelle. Les quatre scénarios de l'étage unitaire émettent tous
`resources: []` et `grants: []` (`src/lib/sync/collecte.test.ts:312`, `:345`, `:388`, `:461`) : zéro
des deux côtés, rien ne bouge.

### Les tests

Cinq scénarios, aucun petit. Les jeux d'essai empruntent aux noms déjà en usage dans le dépôt,
`produit-alpha` et `produit-beta` pour les équipes, `service-annuaire` et `service-paie` pour les
applications.

**1. La règle elle-même, à l'étage unitaire**, dans `src/core/collecte.test.ts`, qui porte déjà les
règles pures de la collecte. « Ce qu'un connecteur déclare de la contenance, et ce que le socle
refuse d'en écrire ». Given un relevé d'une dizaine de ressources où une contenance est valide, une
désigne un contenant que le relevé n'émet pas, une se désigne elle-même, une désigne un contenant
lui-même contenu, et deux se désignent mutuellement. Then les ressources sortent toutes, au complet
et dans l'ordre, la seule contenance valide est conservée, les cinq autres sont effacées sans que
leur ressource le soit, il sort exactement cinq erreurs, chacune portant en `itemRef` la clé de la
ressource dont la contenance est refusée et nommant le contenant en cause dans son message. When le
contenant intermédiaire voit sa propre contenance refusée, Then celle de sa contenue est refusée
aussi, le jugement portant sur ce que le connecteur a déclaré et non sur ce qui a survécu. Les
mutations que ce scénario doit faire mordre : rendre `ressources: []` pour une contenance refusée, ce
que la première assertion attrape ; juger le niveau sur la carte réparée, ce que seule la dernière
attrape ; oublier de pousser l'erreur, ce que le compte de cinq attrape ; traiter l'auto-contenance
par la seule présence dans la carte, où une ressource se trouve toujours elle-même.

**2. Le branchement, à l'étage unitaire**, dans `src/lib/sync/collecte.test.ts`, où la base est
doublée. « Une contradiction sur la contenance gèle la nuit sans rien effacer ». Given un système qui
tient un parc connu et un connecteur qui rend `ok` avec une ressource dont le contenant est absent du
relevé. Then le run sort en `PARTIAL`, la phrase du refus nomme la ressource fautive sous la forme
`ressources (clé) : ...`, aucune datation n'a eu lieu ni sur les comptes ni sur les accès, et les
accès portés par la ressource fautive ont bien été écrits, aucune erreur ne disant qu'une ressource
manquait. When le même relevé arrive sans aucune contenance fautive, Then le run est `OK` et la
datation reprend. Le même scénario porte le resserrement du garde-fou : Given une référence de vingt
ressources portant un accès et une nuit qui rend douze applications accompagnées de six projets sans
accès, Then le refus sort en `{ famille: "ressources", observe: 12, reference: 20 }` et rien n'est
daté. La mutation à faire mordre est le retour à `lu.resources.length`, qui compterait dix-huit,
passerait le plancher de seize et daterait les accès des huit applications absentes. Ce fichier
double `prisma.resource` avec un `upsert` qui ne rend que `{ id }` et sans `update`
(`src/lib/sync/collecte.test.ts:174-178`) : le double gagne `parentId: null` dans ce que l'`upsert`
rend, et un `update`. Les quatre scénarios existants n'en dépendent pas, leurs relevés étant vides de
ressources.

**3. La relation, à l'étage d'intégration**, dans `src/lib/sync/collecte.integration.test.ts`. C'est
la seule garantie qui ne se tient pas plus bas : un double écrit à la main qui prétendrait poser une
clé étrangère vers sa propre table vérifierait sa propre implémentation. « Un contenant et ce qu'il
contient arrivent dans le même relevé, dans n'importe quel ordre ». Given une collecte qui émet une
application avant le projet qui la contient, Then la ligne de l'application pointe vers celle du
projet. When un second relevé émet le projet en premier, Then rien n'a changé en base, et aucune
écriture n'a eu lieu. When un troisième relevé cesse de déclarer la contenance, Then la colonne
revient à nul et la ressource, son libellé et ses accès sont intacts. Then le contenant, qui ne porte
aucun accès, n'entre dans aucune des deux mesures du garde-fou. La mutation à faire mordre est
l'écriture en un seul passage, qui résoudrait le contenant dans une table en cours de construction et
laisserait la colonne à nul dès que le contenant arrive en dernier.

**4. Scalingo, à l'étage unitaire**, dans `src/connectors/scalingo.test.ts`, contre les doubles de
transport déjà en place. « Le projet regroupe, et il ne porte rien ». Given un parc de deux régions où
deux applications partagent un projet, une troisième en a un autre, et une quatrième n'en a pas. Then
il sort trois ressources d'application et deux de projet, pas quatre, les deux applications du même
projet portent la même clé de contenant, celle sans projet n'en porte aucune, aucun accès ne vise un
projet, et le libellé d'un projet porte sa région. When une application rend un projet de forme neuve,
par exemple un identifiant nu à la place de l'objet, Then l'application sort quand même, avec ses
accès et sans contenance. When plus aucune application du parc ne porte de projet, Then le run est
partiel, le message nomme `project`, et les accès sortent tous. Les mutations à faire mordre :
émettre un contenant par application plutôt qu'un par projet, que l'assertion de dénombrement
attrape ; émettre le projet sans poser la contenance sur l'application, que l'assertion de clé
attrape ; rendre le schéma du projet strict, que le scénario de la forme neuve attrape en voyant
disparaître les accès de l'application.

**5. GitHub, à l'étage unitaire**, dans `src/connectors/github.test.ts`, en étendant le scénario
existant « fait d'une équipe une ressource et de son appartenance un accès » (`:111-149`). Son
`toEqual` est exact (`:124-135`) : il faut y ajouter `parentExternalId: "incubateur-ademe"` sur
l'équipe, et l'exactitude de la comparaison épingle du même coup que l'organisation, elle, n'en porte
aucun. La clé de l'équipe est déjà épinglée littéralement (`:131` et `:140`), si bien que la mutation
qui compte le plus, changer la clé pour y retirer l'organisation devenue redondante, mord sur une
assertion qui existe déjà. Aucun scénario nouveau n'est nécessaire ici, et c'est le bon résultat :
GitHub gagne une contenance et ne change rien d'autre.

## Le geste hors dossier et la clé d'engagement

C'est la section la plus délicate du lot, parce qu'elle desserre quatre gardes qui protègent
aujourd'hui exactement la même chose : qu'on n'exécute jamais autre chose que ce qui a été approuvé.
Chacune se desserre au lieu de se supprimer, et la démonstration que la garde d'écart mord encore sur
un plan d'une seule étape est la pièce maîtresse du lot.

### Ce qu'un geste hors dossier n'est pas

Il n'ouvre aucune voie de coupure. `docs/architecture.md:290-291` tient que « Ce qui coupe des accès
reste le dossier de départ, avec son plan, sa confirmation et son journal » : un geste hors dossier
n'émet que des étapes d'octroi, et rien de ce qui suit ne produit une `capability: "revoke"`. Il ne
touche pas davantage les tables du constaté. `src/lib/sync/collecte.ts:431-441` date en disparu tout
`AccessGrant` du fournisseur dont le `lastSeenAt` précède le passage : une trace décidée écrite là
serait éteinte à la nuit suivante. Ce qu'un geste laisse derrière lui vit sur son étape de plan, que
rien ne balaie, et c'est la raison de forme de tout le reste de cette section.

### Les deux champs de `Plan`

`Plan.accessCaseId` est déjà nullable (`prisma/schema.prisma:552`) et sa relation déjà en `SetNull`
(`:565`), si bien qu'un plan sans dossier est une forme que la base accepte depuis toujours. Ce qui
manque est de quoi le recalculer : la personne visée, et l'intention.

```prisma
model Plan {
  id String @id @default(cuid())

  accessCaseId String?

  /// La personne que vise un plan qui n'a pas de dossier. Nulle sur un plan de dossier,
  /// dont le sujet est celui de son dossier : un plan porte un ancrage, et un seul.
  ///
  /// Restrict et non Cascade, a la difference de tout le reste de ce schema. Cette ligne
  /// est la seule trace d'un acces qu'aucune collecte ne rendra jamais : une cascade
  /// l'effacerait avec la fiche pendant que l'acces, lui, court jusqu'a son echeance.
  /// SetNull ne vaut pas mieux, un geste sans sujet ne se recalculant plus et sortant de
  /// la requete du depart. Supprimer une fiche qui en porte un est donc refuse par la
  /// base, et la fusion doit les deplacer avant.
  subjectId String?

  /// L'intention gelee d'un geste hors dossier : le systeme vise, le scope, le terme et
  /// la justification. Elle est a son recalcul ce que AccessCase.profileKey est a celui
  /// d'une arrivee, c'est-a-dire la seule entree dont son empreinte redecoule. Nulle sur
  /// un plan de dossier.
  intent Json?

  kind  PlanKind
  state PlanState @default(DRAFT)

  planDigest      String
  confirmedDigest String?

  createdBy   String
  confirmedBy String?
  confirmedAt DateTime?
  createdAt   DateTime  @default(now())
  expiresAt   DateTime

  accessCase AccessCase? @relation(fields: [accessCaseId], references: [id], onDelete: SetNull)
  subject    Person?     @relation(fields: [subjectId], references: [id], onDelete: Restrict)
  steps      PlanStep[]

  @@index([state])
  @@index([accessCaseId])
  @@index([subjectId])
}
```

`Person` gagne la contrepartie, à côté de `accessCases` (`prisma/schema.prisma:149`) :

```prisma
  gestes Plan[]
```

**Pourquoi `Restrict` et non `Cascade`.** Partout ailleurs, la suppression d'une fiche emporte ce qui
n'a plus de sens sans elle : `AccessCase.person` est en `Cascade` (`prisma/schema.prisma:466`),
`CaseParticipation` l'est sur ses deux relations (`:519-520`). Un geste hors dossier n'entre pas dans
cette famille. Ce qu'il porte n'est pas une conséquence de la fiche, c'est un accès ouvert sur un
système tiers, que rien ne referme du côté de l'outil et que la collecte ne rendra pas. L'effacer
avec la fiche laisserait l'accès ouvert et l'outil muet sur son existence, ce qui est précisément la
panne que ce produit existe pour éviter. `SetNull` produirait pire : un plan vivant, introuvable par
sujet, et dont le recalcul ne saurait plus de qui il parle, soit exactement la pathologie que
`src/core/fiche-manuelle.ts:255-262` nomme déjà pour les plans laissés avec un `accessCaseId` nul.

**Conséquence dure sur la fusion, et elle est dans ce lot.** `src/app/personnes/[username]/edition.ts:563`
supprime la fiche source en fin de transaction, et `src/core/fiche-manuelle.ts:263-281` énumère un à
un les déplacements qui doivent la précéder. Sans étape nouvelle, fusionner une fiche portant un
geste hors dossier lèverait une violation de clé étrangère au milieu de la transaction et annulerait
toute la fusion, sans que rien dans l'aperçu ne l'ait annoncé. `EtapeFusion` gagne donc
`{ type: "deplacer-gestes"; ids: readonly string[] }`, placée avant `supprimer-fiche` (`:281`,
poussée en `:545`), avec son `case` dans `edition.ts` qui repointe `subjectId` vers la cible. Le
garde-fou d'exhaustivité de `edition.ts:565-572` fait tomber le typecheck si l'étape est ajoutée à
l'union sans son traitement, ce qui est le comportement voulu.

### L'intention gelée

Dans `src/core/geste.ts`, nouveau module pur :

```ts
import { z } from "zod";

/**
 * Ce qu'un opérateur a demandé, tel qu'il l'a demandé, figé à l'ouverture du geste.
 *
 * Elle est à son recalcul ce que `AccessCase.profileKey` est à celui d'une arrivée
 * (`prisma/schema.prisma:435-447`) : la seule entrée dont l'empreinte redécoule, et la
 * raison pour laquelle elle se fige plutôt que de se relire. Un geste recalculé sur ce
 * que l'opérateur voudrait aujourd'hui comparerait une empreinte à elle-même, et la
 * garde d'écart ne garderait plus rien.
 *
 * Elle porte les trois champs d'un accès de profil, sous les mêmes noms, plus la
 * justification qu'un profil n'a pas à porter : le profil est sa propre justification,
 * un geste n'en a aucun.
 */
export const intentionDUnGeste = z.strictObject({
  systeme: z.string().min(1),
  scope: z.unknown(),
  expiresInDays: z.number().int().positive().optional(),
  justification: z.string().min(1),
});

export type IntentionDUnGeste = z.infer<typeof intentionDUnGeste>;
```

Le schéma est relu à chaque lecture de la colonne : `intent` est un `Json`, donc `unknown` côté
client généré, et le faire passer par `intentionDUnGeste.parse` au lieu d'un cast est la seule chose
qui distingue une intention d'un objet quelconque écrit là par une migration ratée. Le refus est
brutal et c'est voulu : un geste dont l'intention ne se relit pas n'a plus de recalcul possible, et
l'exécuter serait exécuter à l'aveugle.

La longueur minimale de la justification se refuse dans l'action et non dans le schéma, sur le modèle
de la clôture d'un constat qui refuse une raison de moins de trois caractères
(`src/app/constats/actions.ts:33`). Le schéma dit la forme, l'action dit la règle de saisie.

**Pourquoi elle est l'équivalent de `profileKey`.** Le commentaire de `AccessCase.profileKey`
(`prisma/schema.prisma:435-443`) dit exactement ce que cette colonne fait ici : « c'est lui qui rend
le recalcul reproductible, un plan recalculé sans savoir quel profil l'a produit ne retrouverait
aucune de ses étapes d'octroi et se déclarerait obsolète tout seul ». La seule différence est le
degré de gel. `profileKey` est une clé, et le profil qu'elle désigne vit dans le fichier de politique,
donc peut changer sous elle. `intent` est la valeur elle-même, et ne peut pas changer. Un geste est
donc strictement plus reproductible qu'une arrivée, ce qui n'est pas un luxe : il n'a aucun dossier
où quelqu'un irait constater que la politique a bougé.

### Le calcul d'un geste

`octroisDUnProfil` (`src/lib/arrivee.ts:166-171`) prend un `Profil` par valeur, un `personId`, un
`username` et un instant, et rend `{ etapes, refus }`. Rien dans cette signature n'exige que le
profil vienne de la politique : `profilDeLaPolitique` (`src/lib/arrivee.ts:105-110`) est un appelant
parmi d'autres, et `calculerPlan` le reçoit lui aussi par paramètre pour cette raison exactement
(`src/lib/dossier.ts:281-284`, dont le commentaire de `calculerPlan` dit « lire la politique au fond
de cette fonction ferait dépendre l'empreinte d'un fichier plutôt que du dossier »). **Aucune
modification de signature n'est nécessaire.** `Profil` est le type inféré de `profileSchema`
(`src/core/policy.ts:134`), dont `accesses` porte `{ system, scope, expiresInDays? }`
(`src/core/policy.ts:100-138`), et un objet littéral en TypeScript le satisfait.

```ts
import { CLE_INCUBATEUR } from "@/core/modele-plan";

/** Un profil d'une seule ligne, qui n'existe que le temps d'un calcul. */
export function profilDUnGeste(intention: IntentionDUnGeste): Profil {
  return {
    key: CLE_GESTE,
    label: "Geste hors dossier",
    accesses: [
      {
        system: intention.systeme,
        scope: intention.scope,
        ...(intention.expiresInDays === undefined
          ? {}
          : { expiresInDays: intention.expiresInDays }),
      },
    ],
  };
}
```

`CLE_GESTE` vaut `"*geste"`, sur le modèle de `CLE_INCUBATEUR = "*incubateur"`
(`src/core/modele-plan.ts:14`) : l'étoile est la marque réservée du dépôt pour ce qui n'est pas une
clé de la politique. Ni `key` ni `label` n'entrent dans l'empreinte, `empreinteDuPlan`
(`src/core/plan.ts:54-75`) ne hachant que `systemKey`, `capability`, `action`, `idempotencyKey`,
l'acteur, le contrôleur et les paramètres canoniques. Ils ne servent qu'à rédiger un refus lisible
par `messageDeRefus` (`src/lib/dossier.ts:472-480`).

Ce que ce choix fait gagner gratuitement, et qui est la raison de le préférer à un second chemin
d'octroi :

- **le scope est validé par le `scopeSchema` du connecteur**, par le même `verdictDAcces` que la
  politique (`src/core/octroi.ts:172-222`), avec les mêmes messages français. Un scope saisi à
  l'écran et un scope écrit dans un profil ne peuvent pas être jugés différemment, ce que le
  commentaire de cette fonction exige déjà de ses deux appelants ;
- **la règle du terme obligatoire s'applique sans qu'on l'écrive**. `verdictDAcces` refuse un scope
  à risque élevé sans `expiresInDays` (`src/core/octroi.ts:215-219`), et `assemblerOctrois` refait la
  vérification sur l'étape émise pour qu'un connecteur qui relève le risque de la sienne ne la
  contourne pas (`src/core/octroi.ts:605-619`). C'est la décision 14 rendue mécanique : l'échéance
  d'un jeton est le seul mécanisme de reprise, et elle est exigée par du code qui existe déjà ;
- **`justification` reste vide sur l'étape calculée.** `assemblerOctrois` ne la remplit jamais
  (`src/core/octroi.ts:563-565`), et ce lot ne l'y met pas : elle se pose à l'enregistrement, depuis
  l'ancrage, jamais depuis la `PlannedStep`. La règle « le profil est la justification, et la déduire
  de lui ferait naître la file des accès à justifier déjà pleine de faux » tient donc entière, un
  geste n'ayant pas de profil d'où la déduire ;
- **le refus en bloc** (`src/core/octroi.ts:631-634`) : un geste dont l'accès ne s'applique pas
  n'enregistre rien du tout.

Un geste **n'appelle pas `calculerPlan`**, et c'est la seconde moitié de la décision. `calculerPlan`
interroge tous les connecteurs qui savent donner (`src/lib/dossier.ts:263-279`) pour y ajouter « ce
qu'une arrivée exige quel que soit le profil », puis les étapes déclarées des modèles
(`src/lib/dossier.ts:290`). Un geste n'est pas une arrivée : il ouvre un accès et un seul, et lui
faire traverser ce chemin lui collerait la signature de la charte et les étapes de startup. Du côté
des modèles, la question n'a d'ailleurs pas de réponse : `modeleDuPlan("MANUAL_OP")` rend `null`
(`src/core/modele-plan.ts:41-46`), épinglé par `src/core/modele-plan.test.ts:495`.

`src/lib/geste.ts` porte donc :

```ts
export async function calculerGeste(
  intention: IntentionDUnGeste,
  personId: string,
  username: string,
  maintenant: Date,
): Promise<PlanCalcule> {
  const { etapes, refus } = await octroisDUnProfil(
    profilDUnGeste(intention),
    personId,
    username,
    maintenant,
  );

  const assemblage = assembler({ origines: [{ origine: "connecteur", etapes }] });

  return {
    sens: "ONBOARDING",
    etapes: assemblage.etapes,
    ecartees: assemblage.ecartees,
    empreinte: empreinteDuPlan(assemblage.etapes.map(({ etape }) => etape)),
    systemes: [intention.systeme],
    sansConnecteur: [],
    nonConfirmes: [],
    refus,
  };
}
```

`sens` reste `"ONBOARDING"` parce que c'est le sens du calcul, un geste étant un octroi, et parce que
`PlanCalcule.sens` ne sert qu'à décrire ce qui a été calculé. Ce qui s'écrit en base sous `kind` est
`MANUAL_OP`, et il vient de l'ancrage, pas du calcul. La distinction est celle du lot : le sens dit
ce qu'on fait, l'ancrage dit d'où on le fait.

### Les quatre gardes, une par une

**Première garde, `src/lib/execution.ts:285-287`.** `if (!plan?.accessCase) return refuser("Ce plan
n'existe plus.")` confond deux situations, un plan disparu et un plan sans dossier, et rend le même
message pour les deux. Elle se scinde :

```ts
  if (!plan) {
    return refuser("Ce plan n'existe plus.");
  }
```

`planEnBase` (`src/lib/execution.ts:99-136`) gagne `subjectId`, `intent`, et
`subject: { select: { id: true, username: true } }` dans son `select`. L'ancrage se lit ensuite une
fois, et le reste de la fonction s'en sert plutôt que de retester `accessCase` à chaque endroit.

**Deuxième garde, `src/lib/execution.ts:288-290.** `if (!dossierVivant(plan.accessCase.state))` ne
dit rien d'un plan sans dossier. Elle ne se supprime pas : elle reçoit son pendant, qui est la
décision 10 posée au second moment. Pour un plan de dossier, la garde ne bouge pas d'un caractère.
Pour un geste, ce qui doit être vrai au démarrage de l'exécution est qu'aucun départ ne soit ouvert
sur le sujet, pour la raison qui suit.

**Troisième garde, `src/lib/dossier.ts:491-492`.** `enregistrerPlan(accessCaseId: string, ...)` :
c'est le type lui-même qui interdit un plan sans dossier, et `kind: calcule.sens`
(`src/lib/dossier.ts:525`) qui interdit d'écrire `MANUAL_OP`. Le premier paramètre devient l'ancrage,
qui porte les trois à la fois :

```ts
export type AncrageDuPlan =
  | { kind: "ONBOARDING" | "OFFBOARDING"; accessCaseId: string }
  | { kind: "MANUAL_OP"; subjectId: string; intention: IntentionDUnGeste };
```

et le `create` (`src/lib/dossier.ts:520-545`) écrit `kind: ancrage.kind`, puis l'un ou l'autre jeu de
colonnes selon le bras, la `justification` de l'intention se posant sur l'unique étape du bras
`MANUAL_OP`. C'est une union discriminée et non trois paramètres facultatifs pour une raison
mécanique : trois facultatifs laissent écrire un plan `MANUAL_OP` avec un `accessCaseId`, et le
typecheck n'aurait rien à dire. Les trois appelants existants
(`src/app/dossiers/actions.ts:115`, `src/app/startups/[ghid]/actions.ts:275`,
`src/app/dossiers/[id]/actions.ts:894`) passent `{ kind: sens, accessCaseId: dossierId }` et rien
d'autre ne change chez eux.

**Quatrième garde, `src/app/dossiers/[id]/actions.ts:232-244`.** Le `updateMany` de `confirmerPlan`
filtre sur `accessCase: { state: { in: [...ETATS_VIVANTS] } }`, qui ne s'évalue jamais à vrai quand
la relation est nulle : un geste confirmé rendrait `count === 0` et lèverait « Ce plan ou son dossier
a changé d'état pendant la confirmation », sans qu'aucun état n'ait changé. La condition se choisit
sur l'ancrage lu, et elle garde sa nature : une condition d'écriture, pas une garde de lecture
répétée.

```ts
      const conditionDAncrage =
        plan.accessCaseId === null
          ? {
              accessCaseId: null,
              subject: {
                accessCases: {
                  none: { kind: "OFFBOARDING" as const, state: { in: [...ETATS_VIVANTS] } },
                },
              },
            }
          : { accessCase: { state: { in: [...ETATS_VIVANTS] } } };
```

Elle est exactement aussi forte que celle qu'elle remplace, et pour la même raison : le commentaire
de `:229-231` dit que la garde seule laisse passer une annulation arrivée entre la lecture et
l'écriture. Ici, ce qui peut arriver entre les deux est l'ouverture d'un départ, et `Person.accessCases`
(`prisma/schema.prisma:149`) permet de l'exprimer dans le même `where`, donc dans la même écriture
atomique. Sans elle, deux onglets suffiraient à confirmer un geste pendant qu'un départ s'ouvre.

**Une cinquième garde reste fermée, délibérément.** `recalculerPlan`
(`src/app/dossiers/[id]/actions.ts:833-835`) refuse tout plan sans `accessCase`, et ce lot ne la
touche pas : le recalcul est un chemin qui relit la politique et les modèles, dont un geste n'a que
faire, et l'ouvrir doublerait la surface pour un cas qui a une issue plus simple. Un brouillon de
geste devenu obsolète ne se recalcule donc pas, il se repose : l'action d'ouverture passe tout
brouillon de geste du même sujet à `STALE` dans la transaction qui écrit le nouveau, sur le modèle du
remplacement de `:881-894`. C'est le code qui tient cette unicité et non la base, l'index unique
partiel de la migration `20260824161541` disant en toutes lettres « Les plans sans dossier restent
libres ».

### Le recalcul d'empreinte d'un plan d'une étape

C'est le cœur, et la question à laquelle il faut répondre est celle-ci : une garde qui compare une
empreinte recalculée à une empreinte confirmée ne vaut que si le recalcul peut rendre autre chose. Si
toutes ses entrées sont gelées, elle hache une constante et la compare à elle-même.

`executerPlan` recalcule aujourd'hui par `calculerPlan(sens, personId, username, maintenant,
profilDeLaPolitique(profileKey), confirmedAt)` (`src/lib/execution.ts:315-326`), puis refuse par
`refusDEcart` (`:328-331`, défini en `src/core/execution.ts:65-77`). Pour un geste, le recalcul
devient :

```ts
  const actuel =
    plan.accessCase && plan.accessCaseId !== null
      ? await calculerPlan(/* inchangé */)
      : await calculerGeste(
          intentionDUnGeste.parse(plan.intent),
          plan.subject.id,
          plan.subject.username,
          maintenant,
        );
```

Ce que ce recalcul rejoue exactement, et d'où chaque morceau vient :

- **gelé, et ne peut donc pas bouger** : la clé du système, le scope et le terme, tous trois lus dans
  `plan.intent` ;
- **relu en base à chaque calcul** : l'adresse dont le socle répond, `communicationEmail` puis
  `primaryEmail` (`src/lib/arrivee.ts:178-184`), et les identifiants sûrs de la personne, que
  `identifiantsSurs` lit sur `ExternalIdentity` non disparues (`src/lib/arrivee.ts:86-103`) avant que
  `handlesSurs` (`src/core/octroi.ts:379-413`) n'écarte tout ce qui vient d'une ressemblance et ne
  laisse tomber une clé dès que deux valeurs sûres se contredisent (`:405-410`) ;
- **résolu au jour le jour mais hors de l'empreinte** : le tier, que `resolveCapability` calcule
  contre les credentials (`src/lib/arrivee.ts:61-66`). `empreinteDuPlan` ne le hache pas
  (`src/core/plan.ts:54-75`), ce qui est voulu : un secret indisponible une heure ne doit pas déclarer
  obsolète un plan confirmé ;
- **hors de l'empreinte également** : `grantExpiresAt`, absolu et compté depuis l'instant du calcul,
  et dont `src/core/connector.ts:342-345` explique que l'y faire entrer rendrait tout plan obsolète à
  la seconde suivante.

**La garde mord donc, et voici sur quoi.** Prenons le geste de la nature « collaborateur
d'application ». `planifierOctroiScalingo` (`src/connectors/scalingo.ts:894-929`) pose
`params: { region, application, beneficiaire, role }` (`:912-917`), où `beneficiaire` vaut
`sujet.email ?? qui` (`:902`, `:915`). Les trois premiers sortent de l'intention gelée, le quatrième
sort de la base. Une collecte passée entre la confirmation et l'exécution qui change l'adresse de
communication de la personne, ou qui fait apparaître sur Scalingo une seconde identité sûre au point
que `handlesSurs` abandonne la clé, déplace `params`, donc les paramètres canoniques, donc
l'empreinte, et `refusDEcart` refuse en nommant que « les accès observés ont changé depuis la
confirmation ». C'est la même mécanique que pour une arrivée, appliquée à une étape au lieu de vingt.

**Et voici la limite qu'il faut écrire au lieu de la taire.** Pour la nature « jeton restreint », la
cible du blob, ses scopes et son terme viennent tous de l'intention, et rien de ce que le connecteur
met dans `params` ne vient de la base. L'empreinte recalculée est alors, par construction, égale à
l'empreinte confirmée : la garde est tautologique. Elle n'est pas fausse, elle ne dit simplement
rien, et il ne faut pas se raconter qu'elle protège. Ce qui protège ce geste-là est ailleurs, et
c'est deux choses : le refus pendant un départ ouvert, qui est la garde de la deuxième moitié, et
l'échéance obligatoire, que `src/core/octroi.ts:605-619` exige d'une étape à risque élevé. Un plan
d'une étape est un objet où l'on voit à l'œil nu ce qu'une garde couvre et ce qu'elle ne couvre pas,
et c'est une raison de plus de passer par le plan plutôt que d'inventer un chemin direct.

L'instant du recalcul ne change pas de statut. `executerPlan` passe `plan.confirmedAt` comme instant
de jugement (`src/lib/execution.ts:309-326`), et `calculerPlan` s'en sert pour rejouer les tolérances
de la confirmation (`src/lib/dossier.ts:232`, `:302-306`). `calculerGeste` n'a aucune tolérance à
rejouer, une tolérance portant sur un compte observé au départ, et n'a donc pas besoin de ce
paramètre.

### La clé d'engagement

`PlannedStep` (`src/core/connector.ts:323-365`) gagne un champ facultatif :

```ts
  /**
   * Ce que cette étape ouvre et qu'aucune collecte ne rendra jamais, sous la forme que
   * le connecteur émetteur a choisie. Le socle la transporte, la stocke et la compare à
   * elle-même : il ne l'interprète jamais, ce qu'elle désigne n'ayant de sens que pour
   * le connecteur qui l'a écrite.
   *
   * Présente si et seulement si ce que l'étape ouvre ne reparaîtra pas dans le
   * `CollectResult` de ce connecteur. Une clé de trop fait proposer deux fois la même
   * coupure au départ, une clé qui manque laisse un accès que plus rien ne nomme.
   */
  engagementKey?: string;
```

et `PlanStep` la colonne qui la reçoit, après `grantExpiresAt` (`prisma/schema.prisma:651-654`) dont
elle partage la raison d'être :

```prisma
  /// La cle d'un engagement, telle que le connecteur emetteur l'a ecrite. Elle vit ici et
  /// pas sur AccessGrant, pour la meme raison que l'echeance juste au-dessus : cette
  /// table-la est reconstruite par la collecte, et ce que cette colonne designe est
  /// justement ce qu'aucune collecte ne rend.
  engagementKey String?
```

avec `@@index([engagementKey])` à côté de `@@index([grantExpiresAt])` (`:702`).

`enregistrerPlan` la recopie comme il recopie déjà `grantExpiresAt` (`src/lib/dossier.ts:543`), et
`rapprocher` la relit comme il relit `idempotencyKey` (`src/lib/execution.ts:182-186`). Elle n'entre
pas dans l'empreinte : elle ne dit rien de plus que l'`idempotencyKey` de l'étape qui la porte, et
l'y mettre ferait déclarer obsolète tout plan en vol le jour où un connecteur reformule ses clés.

**La règle du « si et seulement si », et ses deux fautes symétriques.**

La *clé de trop* est la faute sur une action dont la collecte relit le résultat. Un jour, quelqu'un
posera une `engagementKey` sur l'invitation de collaborateur Scalingo, par symétrie avec le jeton.
Ce que fait alors le départ : le connecteur émet sa coupure depuis l'accès observé, sous
`scalingo:${region}:${nom}:revoke:${username}` (`src/connectors/scalingo.ts:994`), et le chemin de
l'engagement en émet une seconde pour la même application, sous une clé que son émetteur a écrite
autrement. Le dédoublonnage ne les rapproche pas : `assembler` (`src/core/plan.ts:212-226`) ne
compare que les `idempotencyKey`, une seule règle pour les trois origines, et deux clés différentes
sont deux gestes différents. L'opérateur voit deux lignes qui demandent la même chose, en coche une,
et la seconde reste ouverte pour toujours puisque plus rien ne la rapprochera.

La *clé qui manque* est la faute inverse, sur une action dont aucune API ne rend le résultat. Le
jeton est émis, l'étape est soldée, et il n'existe nulle part d'`AccessGrant` qui le porte. Le
départ ne le voit pas, l'écran de la personne ne le voit pas, le plan de départ se solde entier, le
dossier se clôt, et l'accès court jusqu'à son échéance sans que rien dans l'outil ne l'ait jamais
nommé. C'est un trou muet, et il est pire que le doublon, qui lui se voit.

**Le socle ne peut pas tenir cette règle, et prétendre le contraire serait pire que de le dire.**
Savoir si une action reparaîtra dans un `CollectResult` est une propriété du connecteur et d'aucune
autre couche. La règle vit donc dans le contrat, en prose, et se tient par les tests du connecteur,
plus un test d'intégration qui prouve que le départ n'émet pas deux coupures pour la même
application.

### Ce qu'un départ retrouve

Une clé d'engagement n'est pas une valeur qu'on additionne : elle est ouverte ou fermée, et un accès
ouvert, repris, puis rouvert est ouvert. Un ensemble de clés fermées soustrait à un ensemble de clés
ouvertes dirait le contraire, et c'est la faute à ne pas commettre.

La lecture vit dans `src/lib/geste.ts` :

```ts
const SOLDEES: readonly StepState[] = ["SUCCEEDED", "ALREADY_PRESENT", "ALREADY_ABSENT"];

export async function engagementsOuverts(
  personId: string,
  maintenant: Date,
): Promise<readonly EngagementOuvert[]> {
  const lignes = await prisma.planStep.findMany({
    where: {
      engagementKey: { not: null },
      state: { in: [...SOLDEES] },
      validation: { notIn: ["AWAITING", "REFUSED"] },
      executedAt: { not: null },
      plan: {
        OR: [{ subjectId: personId }, { accessCase: { personId } }],
      },
    },
    select: {
      engagementKey: true,
      capability: true,
      systemKey: true,
      label: true,
      params: true,
      grantExpiresAt: true,
      executedAt: true,
    },
    // Décroissant sur la date, et `nulls: "last"` écrit plutôt que laissé au défaut :
    // PostgreSQL range les nuls en dernier sur un ordre croissant, mais en premier sur
    // un décroissant. Une étape jamais exécutée se retrouverait en tête.
    orderBy: [{ executedAt: { sort: "desc", nulls: "last" } }, { capability: "asc" }],
  });

  return dernierGesteSolde(lignes, maintenant);
}
```

Trois choses méritent d'être dites sur cette requête :

**L'`OR` sur deux ancrages n'est pas une redondance.** Un engagement peut naître d'un geste hors
dossier, dont le plan porte `subjectId`, ou d'une arrivée dont le profil ouvrait un jeton, dont le
plan porte `accessCaseId`. `subjectId` n'existe que là où il est nécessaire, et le prix de ce choix
est cet `OR`. L'alternative, poser `subjectId` sur tous les plans, demanderait de remplir la colonne
pour l'historique entier et ferait porter deux ancrages à chaque plan de dossier, ce que le
commentaire de la colonne interdit.

**Le filtre reproduit `estSoldee`** (`src/core/dossier.ts:426-431`) plutôt que de l'appeler, parce
qu'il doit se dire en SQL : les trois états qui soldent, et un contrôle qui n'est ni en attente ni
refusé. Une étape pointée mais dont la validation est `AWAITING` n'a rien ouvert ni rien fermé, et la
compter ferait dire au départ qu'un jeton est vivant avant que quiconque ait relu qu'il l'est.

**Le pli se fait en TypeScript et non par un `distinct`.** La règle « le dernier geste soldé gagne »
est une règle métier ; l'écrire en option de requête la cacherait dans une sémantique de moteur, et
le volume, une centaine de personnes, ne demande rien d'autre.

```ts
/**
 * Le dernier geste soldé de chaque clé gagne, et rien d'autre ne décide.
 *
 * Les lignes arrivent de la plus récente à la plus ancienne : la première rencontrée
 * pour une clé est celle qui dit son état, et les suivantes sont son passé.
 *
 * À égalité exacte de date, l'octroi l'emporte sur la coupure : deux étapes du même
 * passage d'exécution qui touchent la même clé signent la faute de la clé de trop, et
 * conclure « encore ouvert » fait apparaître une ligne de plus au départ, là où conclure
 * « fermé » ferait disparaître un accès sans bruit.
 */
export function dernierGesteSolde(
  lignes: readonly LigneDEngagement[],
  maintenant: Date,
): readonly EngagementOuvert[] {
  const vues = new Map<string, LigneDEngagement>();

  for (const ligne of lignes) {
    if (ligne.engagementKey !== null && !vues.has(ligne.engagementKey)) {
      vues.set(ligne.engagementKey, ligne);
    }
  }

  return [...vues.values()]
    .filter((ligne) => ligne.capability === "grant")
    .filter((ligne) => ligne.grantExpiresAt === null || ligne.grantExpiresAt > maintenant)
    .map(/* ... */);
}
```

Le filtre sur l'échéance est la décision 14 rendue mécanique : un jeton dont le terme est passé est
repris, puisque c'est la seule reprise qui existe, et le départ n'a plus rien à en dire. Il fait
dépendre le plan de départ de l'horloge, et il faut le savoir : un départ confirmé la veille de
l'expiration d'un engagement voit son empreinte bouger le lendemain, et `refusDEcart` le refuse. Ce
n'est pas un défaut, c'est le plan qui a réellement changé, et la sortie est celle que le dépôt
connaît déjà, recalculer puis reconfirmer. L'instant comparé est celui que `calculerPlan` reçoit,
c'est-à-dire `maintenant` à la confirmation et `plan.confirmedAt` à l'exécution
(`src/lib/execution.ts:309-326`) : gelé de la même façon et pour la même raison que les tolérances,
faute de quoi un plan confirmé deviendrait inexécutable sans issue, le recalcul n'étant ouvert qu'à
un brouillon (`src/lib/dossier.ts:224-232`).

**Comment l'engagement entre dans le plan de départ.** Le socle ne sait pas rédiger l'étape qui
solde un engagement, puisqu'il n'en interprète pas la clé. Il la passe donc à son émetteur, par le
sujet, exactement comme il lui passe déjà les accès observés :

```ts
      /**
       * Les engagements ouverts sur ce système, tels que le socle les a retrouvés sur les
       * étapes qui les ont ouverts. Ils n'existent dans aucun `CollectResult`, et c'est
       * leur définition : sans eux, le départ se tairait sur ce que personne ne peut plus
       * observer.
       */
      engagements?: readonly OpenEngagement[];
```

sur le bras `person` de `SubjectRef` (`src/core/connector.ts:274-301`). `ConnectorContract` ne bouge
pas, conformément à la décision 4 : ce qui change est ce qu'un sujet porte, pas ce qu'un connecteur
déclare.

Une conséquence qu'il ne faut pas manquer : `interroge` (`src/lib/dossier.ts:158-167`) n'interroge,
au départ, que les connecteurs où la personne est **observée** avec un rattachement sûr. Quelqu'un
qui détiendrait un jeton Scalingo sans être collaborateur d'aucune application ne serait observé sur
aucun système Scalingo, le connecteur ne serait pas interrogé, et l'engagement retomberait dans le
trou muet que la clé existe pour boucher. La condition devient donc, pour un départ,
`presente.has(cle) || engages.has(cle)`, et le commentaire de la fonction gagne la phrase qui le
justifie.

### Le refus pendant un départ ouvert

Il se pose deux fois, et les deux fois au même endroit logique : juste avant l'écriture, sur ce qui a
été lu, et dans la condition de l'écriture elle-même.

À l'ouverture du geste, dans l'action, avant tout appel à `actionTracee` : lire l'existence d'un
départ vivant sur la personne, par `prisma.accessCase.findFirst({ where: { personId, kind:
"OFFBOARDING", state: { in: [...ETATS_VIVANTS] } }, select: { id: true } })`, qui est la requête
qu'`ouvrirDossier` fait déjà pour son propre invariant (`src/lib/dossier.ts:375-378`). Puis, dans le
`where` de l'écriture, la condition de la quatrième garde ci-dessus, qui referme la fenêtre entre la
lecture et l'écriture.

Le message, mot pour mot :

> Un départ est ouvert sur cette personne. Ouvrir un accès maintenant déplacerait l'empreinte de son
> plan, et un plan de départ déjà confirmé n'a plus de recalcul pour rattraper cet écart. Soldez ce
> départ, ou annulez-le, puis reprenez ce geste.

Il ne porte pas d'adresse, et c'est délibéré : `EtatAction` ne transporte qu'une chaîne
(`src/app/dossiers/[id]/actions.ts:34-44`), et la fiche affiche déjà en tête de son bloc le motif
`depart-en-cours` avec son lien « Ouvrir le dossier »
(`src/app/personnes/[username]/motifs.ts:155-162`). Écrire une adresse en clair dans un message
d'erreur mettrait deux chemins vers le même dossier à trois centimètres l'un de l'autre, dont un qui
ne se clique pas.

Le raisonnement est celui que le dépôt tient déjà pour les tolérances
(`src/lib/dossier.ts:224-231`) : un plan confirmé dont l'empreinte bouge devient inexécutable sans
issue, parce que `peutRecalculer` n'ouvre le recalcul qu'à un brouillon. Ouvrir un accès pendant
qu'un départ est en cours est exactement la manière de faire bouger cette empreinte sous les pieds de
quelqu'un qui n'a rien demandé.

### Le contrôle d'accès : rien à écrire

Vérifié, et la réponse est qu'il n'y a **rien à ajouter**, sur les deux fronts.

`actionTracee` résout `requireOperateur()` quand l'appelant ne lui passe pas d'utilisateur déjà
résolu (`src/lib/actions.ts:66`). L'action d'ouverture d'un geste n'a aucune raison d'en passer un :
elle ne relit pas de droit avant d'écrire, contrairement à `pointerEtape` et `validerEtape`, les deux
seuls appelants qui fournissent leur utilisateur (`src/app/dossiers/[id]/actions.ts:441`, `:613`).
Un non-opérateur est donc redirigé vers `/moi` par `requireOperateur`
(`src/lib/session.ts:92-103`), sans qu'une ligne soit écrite pour cela.

La participation, elle, ne peut pas atteindre un geste, et c'est structurel.
`CaseParticipation.accessCaseId` est une colonne non nullable (`prisma/schema.prisma:492`) portant
une relation obligatoire vers `AccessCase` (`:519`) : un droit de participation sans dossier ne
s'écrit pas. Le code s'aligne déjà sans qu'on l'ait demandé. `pointerEtape` ne consulte
`droitDeParticiper` que lorsque `etape.plan.accessCaseId` n'est pas nul
(`src/app/dossiers/[id]/actions.ts:322-324`), et `roleDuDeclarant` traite explicitement le cas d'un
plan sans porteur : `if (porteur === null) return utilisateur.operateur ? "OPERATOR" : null;`
(`:119-120`). Son commentaire l'écrit déjà pour un plan dont le dossier a disparu (`:107-109`), et un
plan qui n'en a jamais eu tombe sur la même branche. Un participant qui posterait l'identifiant d'une
étape de geste reçoit `REFUS_HORS_DOSSIER` (`:327-329`), qui est la bonne phrase.

Reste un détail de trace. `actionTracee` journalise **avant** d'écrire (`src/lib/actions.ts:79-82`),
alors que l'identifiant du plan est tiré à l'intérieur d'`enregistrerPlan`
(`src/lib/dossier.ts:516-518`). La trace ne peut donc pas viser le plan : elle vise la personne,
`targetType: "person"`, `targetId: personId`, et porte l'intention gelée dans son `after`. Viser un
plan qui n'existe pas encore poserait au journal, à rétention indéfinie, une ligne pointant vers
rien. Le verbe est `"geste.ouverture"`, ajouté à `LIBELLE_ACTION`
(`src/app/journal/libelles.ts:9-36`) sous « Ouverture d'un geste hors dossier ». La confirmation et
l'exécution réutilisent `"dossier.confirmation"` et `"plan.execution"` sans rien ajouter : ces verbes
nomment l'action, pas l'ancrage, et les dédoubler obligerait à tenir deux vocabulaires en parallèle
pour un même code.

### Les tests

Quatre scénarios, et pas un de plus. Chacun tient une garantie au plus bas étage qui sache la tenir,
et chacun porte la mutation qu'il doit faire mordre.

**1. « Une intention gelée se rejoue à l'identique, et sa justification n'engage rien »**, unitaire,
`src/core/geste.test.ts`. Given une intention portant un système, un scope complet, un terme et une
justification. When on construit le profil d'une ligne, qu'on l'assemble deux fois contre un double
de connecteur octroyeur et qu'on hache les deux résultats. Then les deux empreintes sont égales, et
l'unique étape porte le scope de l'intention dans ses paramètres. When on change un caractère du nom
d'application dans le scope, Then l'empreinte change. When on ne change **que** la justification,
Then l'empreinte ne change pas, et la justification n'apparaît dans aucun paramètre de l'étape.
*Mutation qu'il doit faire mordre* : écrire la justification dans `params` au lieu de la poser à
l'enregistrement. Elle ferait déclarer obsolète un geste confirmé parce que quelqu'un a reformulé une
phrase, et c'est précisément le genre de faute qu'un typecheck ne voit pas. Une mutation plus
grossière, changer le système, ne prouverait rien qu'on ne sache déjà.

**2. « Le dernier geste soldé gagne »**, unitaire, `src/core/geste.test.ts` également, le pli étant
une fonction pure. Given une suite de lignes pour trois clés : la première ouverte, fermée, puis
rouverte, toutes trois soldées et datées dans cet ordre ; la deuxième ouverte puis fermée ; la
troisième ouverte avec un terme déjà passé. Plus une ligne en attente de validation sur la première
clé, datée après toutes les autres. When on plie à un instant donné. Then seule la première clé
ressort, la deuxième est absente parce qu'elle est fermée, la troisième parce que son terme est
passé, et la ligne en attente n'a rien changé. *Mutation qu'il doit faire mordre* : remplacer le pli
par une différence d'ensembles, les clés jamais fermées moins les clés fermées. La première clé
sortirait alors fermée alors qu'elle est ouverte, ce qui est exactement la panne que la règle existe
pour éviter. La mutation voisine, inverser l'ordre de tri, doit également faire échouer le scénario.

**3. « Un geste s'ouvre, se confirme et s'exécute sans dossier, et la garde d'écart mord »**,
intégration, `src/lib/geste-hors-dossier.integration.test.ts`, sur le modèle exact de
`src/lib/gel-des-tolerances.integration.test.ts`, qui sème sa fiche et ses identités plutôt que de
doubler quoi que ce soit. Given une fiche sans dossier, `ACTIONS_ENABLED` à faux. When on calcule et
enregistre un geste avec l'ancrage `MANUAL_OP`. Then la ligne `Plan` porte `kind` `MANUAL_OP`, un
`accessCaseId` nul, le `subjectId` de la fiche, l'intention relisible par son schéma, et son unique
étape porte la justification saisie ; et un second geste sur la même personne s'écrit sans que
l'index unique partiel s'y oppose. When on confirme. Then `confirmedDigest` et `confirmedAt` sont
posés, ce qui est la démonstration directe que la quatrième garde est desserrée : avant le
changement, le `updateMany` rendait zéro et l'action levait. When on exécute. Then rien n'est refusé
et l'empreinte recalculée est celle qui a été confirmée. When on change l'adresse de communication de
la fiche entre la confirmation et l'exécution, puis qu'on exécute. Then l'exécution refuse avec le
message d'écart, et aucune étape n'a changé d'état. *Mutation qu'il doit faire mordre* : faire lire à
`calculerGeste` l'intention courante d'un formulaire plutôt que celle qui est gelée en base. La
dernière assertion tomberait, et c'est la seule qui prouve que le recalcul n'est pas une tautologie
là où il ne doit pas l'être.

**4. « Un engagement se retrouve au départ, une fois et une seule »**, intégration, même fichier.
Given une fiche observée sur Scalingo avec un accès de collaborateur, et un geste soldé portant une
clé d'engagement dont le terme est à venir. When on calcule le plan de départ. Then il porte deux
étapes sous deux clés d'idempotence distinctes, la coupure de collaborateur venue de l'accès observé
et l'étape qui solde l'engagement, et cette dernière nomme le terme. When l'étape d'invitation de
collaborateur porte elle aussi une clé d'engagement. Then le plan de départ porte trois étapes pour
deux accès, ce que le scénario affirme explicitement comme la faute à ne pas commettre plutôt que
comme un comportement attendu. When le terme de l'engagement est passé. Then l'étape qui le solde est
absente. When la fiche n'est observée sur aucun système Scalingo mais détient l'engagement. Then
l'étape est tout de même là. *Mutation qu'il doit faire mordre* : laisser `interroge`
(`src/lib/dossier.ts:163-165`) inchangé. La dernière assertion tombe, et c'est le seul endroit où le
trou muet se voit.

Rien n'est ajouté à `src/connectors/scalingo.contrat.test.ts`, conformément à la décision 17 : tout
ce qui précède se prouve contre des doubles de transport ou contre la base dédiée, et aucun jeton
n'est requis.

### Ce que ce découpage laisse ouvert

Deux choses, et elles se disent plutôt qu'elles ne s'enterrent.

La garde d'écart est tautologique sur un geste dont aucun paramètre ne vient de la base, ce qui est
le cas de l'émission d'un jeton. Ce geste-là est protégé par le refus pendant un départ ouvert et par
l'échéance obligatoire, pas par l'empreinte.

Un brouillon de geste n'a ni recalcul ni annulation : `recalculerPlan` reste fermé
(`src/app/dossiers/[id]/actions.ts:833-835`) et aucune action n'annule un plan seul, l'annulation
passant par `annulerDossier`. La seule sortie d'un brouillon obsolète est de reposer le geste, qui
passe le précédent à `STALE`. C'est suffisant pour ce lot, et ça cessera de l'être le jour où un
geste portera plus d'une étape.

## L'émission de jetons restreints

Trois faits du proxy décident de tout ce qui suit, et aucun ne se contourne. La génération d'un
jeton n'existe pas hors ligne, le sel du serveur n'étant exposé par aucune route : il faut appeler
`POST /api/generate`. Cette route n'est protégée par rien, elle rend un couple dont une moitié ne
repasse jamais, et il n'existe ni route de révocation ni route d'introspection
(`fine-grained-proxy/src/routes/ui.tsx:530-560`, où les seules réponses déclarées sont 200, 400, 413,
415 et 500). Un jeton émis ne se reprend donc pas, ne se relit pas, et ne se liste nulle part
ailleurs qu'ici. C'est ce qui rend l'échéance obligatoire, et c'est aussi ce qui fait de la base de
cet outil le seul registre au monde de ce qui a été émis.

### Le client du proxy

**Il vit dans `src/lib/fgp.ts`, à côté de `src/lib/espace-membre.ts`, et pas dans le connecteur.**
`docs/architecture.md:816-822` pose `fgp` comme la réponse à tout credential à portée large que le
fournisseur ne sait pas cloisonner, et nomme le triplet OVH comme cas d'école : le second client de
ce module est déjà identifié, et l'enfermer dans `src/connectors/scalingo.ts` obligerait à l'en
extraire au connecteur suivant. Il suit la forme de l'autre client HTTP du dépôt
(`src/lib/espace-membre.ts:7-39`) : une classe d'erreur qui porte le statut, un délai explicite parce
que `fetch` n'en a aucun, et un schéma Zod sur la réponse.

L'adresse du proxy passe par le schéma de `src/lib/env.ts`, qui fait foi sur la liste attendue. Elle
réutilise `jetonFacultatif` (`src/lib/env.ts:19-26`), qui traite « déclarée mais vide » comme
absente, et la fait ensuite valider comme URL :

```ts
  /**
   * Facultative, et pour la raison qui rend `SCALINGO_API_TOKEN` facultatif : son absence
   * dégrade l'émission de jetons en manuel, elle n'empêche ni le démarrage ni la collecte.
   *
   * Sans valeur par défaut, contrairement à `ESPACE_MEMBRE_URL` : une adresse de production
   * posée par le schéma est exactement ce que `vitest.config.ts:11-13` décrit comme le piège
   * qui fait sortir un appel réel d'un test ayant oublié de doubler son transport.
   */
  FGP_URL: jetonFacultatif.pipe(z.url().optional()),
```

Le client lui-même tient en une fonction, et son traitement d'erreur porte une distinction qui
n'existe nulle part ailleurs dans le dépôt : savoir si le refus exclut qu'un blob ait été créé. Un
400 ou un 415 l'excluent, le proxy ayant refusé le corps avant de chiffrer quoi que ce soit. Une
coupure réseau ou un délai dépassé ne l'excluent pas, et faute de route d'introspection, personne ne
pourra jamais lever le doute.

```ts
export class ErreurFgp extends Error {
  constructor(
    readonly statut: number | null,
    /** Vrai quand le refus exclut qu'un blob ait été créé là-bas. */
    readonly aucunBlob: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ErreurFgp";
  }
}

export interface DemandeDeJeton {
  jeton: string;
  cible: string;
  scopes: NonEmptyArray<string>;
  secondes: number;
  /** Ce que le blob portera pour se nommer lui-même une fois décodé. */
  nom: string;
}

export interface JetonEmis {
  blob: string;
  cle: string;
}

const reponseSchema = z.object({ blob: z.string().min(1), key: z.string().min(1) });

const DELAI_MS = 15_000;

export type EmissionDeJeton = (demande: DemandeDeJeton) => Promise<JetonEmis>;

export const emettreUnJeton: EmissionDeJeton = async (demande) => {
  const base = env.FGP_URL;
  if (base === undefined) {
    throw new ErreurFgp(null, true, "FGP_URL absent de l'environnement");
  }
  // Le proxy traite 0 comme « pas d'expiration » (`fine-grained-proxy/docs/specs.md:453`), et
  // rien ne saurait reprendre un jeton qui n'expire pas : le refus est ici et pas seulement
  // chez l'appelant, pour qu'aucun appelant n'ait à s'en souvenir.
  if (!Number.isInteger(demande.secondes) || demande.secondes < 1) {
    throw new ErreurFgp(null, true, "un jeton sans terme ne se reprend par aucun moyen");
  }

  let reponse: Response;
  try {
    reponse = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        token: demande.jeton,
        target: demande.cible,
        auth: "scalingo-exchange",
        scopes: demande.scopes,
        ttl: demande.secondes,
        name: demande.nom,
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (cause: unknown) {
    throw new ErreurFgp(null, false, cause instanceof Error ? cause.message : String(cause));
  }

  if (!reponse.ok) {
    throw new ErreurFgp(
      reponse.status,
      reponse.status < 500,
      `${reponse.status} ${reponse.statusText}`,
    );
  }

  const lu = reponseSchema.safeParse(await reponse.json().catch(() => undefined));
  if (!lu.success) {
    throw new ErreurFgp(reponse.status, false, "la réponse ne porte ni blob ni clé");
  }

  return { blob: lu.data.blob, cle: lu.data.key };
};
```

Aucune reprise automatique, à la différence de la lecture Scalingo (`src/connectors/scalingo.ts:199`)
: retenter une émission dont on ignore si elle a abouti, c'est émettre un second jeton que rien ne
listera et que rien ne révoquera. Le mode d'authentification est `scalingo-exchange`, qui fait faire
l'échange au proxy et met le porteur en cache cinquante-cinq minutes
(`fine-grained-proxy/src/auth/cache.ts:1`) : l'échange n'est donc jamais un scope à demander, et le
porteur du blob n'a aucun échange à faire lui-même.

### Ce que le connecteur appelle vraiment, et ce qu'un blob en découpe

Le catalogue ne s'invente pas, il se lit dans le connecteur. Neuf appels, dont un seul n'est pas une
route d'API au sens du proxy.

| Appel | Où | Ce qu'il sert |
|---|---|---|
| `POST /v1/tokens/exchange` | `auth.scalingo.com` (`:1216`) | l'échange, que le proxy fait lui-même |
| `GET /v1/users/self` | `auth.scalingo.com` (`:476`) | le compte qui décide du périmètre |
| `GET /v1/regions` | `auth.scalingo.com` (`:497`) | les régions, demandées et non déclarées |
| `GET /v1/apps` | `api.<région>.scalingo.com` (`:291`) | les applications d'une région |
| `GET /v1/apps/:app/collaborators` | idem (`:567`) | le relevé par application |
| `GET /v1/collaborators` | idem (`:579`) | la vue consolidée, qui recoupe le relevé |
| `POST /v1/apps/:app/collaborators` | idem (`:1122-1131`) | l'invitation |
| `DELETE /v1/apps/:app/collaborators/:id` | idem (`:1156`) | le retrait |
| `PATCH /v1/apps/:app/collaborators/:id` | idem, ce lot | le changement de rôle |

Les chemins sont les mêmes partout, l'hôte change. `hoteDe` (`src/connectors/scalingo.ts:1040`) le
construit par région, et `HOTE_AUTH` (`:25`) est l'hôte global. Un blob ne portant qu'une cible, il
n'existe aucun jeton qui fasse à la fois le catalogue des régions et la lecture d'une région : ce
sont deux émissions, deux comptes machine, deux termes. C'est la couture visible de la décision de ne
pas figer les cibles, et il vaut mieux qu'elle se voie dans le catalogue que dans un blob qui rate
une région ajoutée l'an prochain.

Le second piège est le joker. `GET:/v1/apps/*` ne vaut pas « les sous-ressources que j'appelle » : le
motif matche tout chemin qui commence par le préfixe (`fine-grained-proxy/docs/specs.md:178`), donc
tout ce qui pend sous une application, y compris ce que ce connecteur n'appelle jamais, à commencer
par ce qui sert les variables d'environnement. Un jeton « en lecture » écrit avec ce joker rendrait
au porteur exactement ce que le rôle limité ne voit pas, c'est-à-dire la distinction sur laquelle
repose `risqueDuRole` (`src/connectors/scalingo.ts:885-892`). Le catalogue n'emploie donc aucun joker
de préfixe sur `/v1/apps`, et se paie de ne pas savoir tout dire : l'usage d'inventaire ne demande
que les deux listes plates, et laisse le relevé par application à qui nomme son application.

Trois usages, et leurs scopes exacts :

```ts
/**
 * Un usage est un besoin nommé, pas une liste de chemins. Le profil nomme le besoin, le
 * connecteur tient les chemins : l'inverse mettrait une règle de pare-feu dans un fichier de
 * politique que personne ne relit chemin par chemin, et le refus d'octroi n'aurait plus rien
 * d'intelligible à dire.
 */
const USAGES_DE_JETON = [
  "inventaire-d-une-region",
  "collaborateurs-d-une-application",
  "catalogue-des-regions",
] as const;

type CleDUsage = (typeof USAGES_DE_JETON)[number];

interface UsageDeJeton {
  libelle: string;
  /** L'hôte unique que le blob autorise. Un blob n'en porte qu'un. */
  hote: "region" | "authentification";
  /** Vrai quand les chemins nomment une application, donc quand le scope doit la porter. */
  viseUneApplication: boolean;
  chemins: (application: string) => NonEmptyArray<string>;
}

const CATALOGUE: Readonly<Record<CleDUsage, UsageDeJeton>> = {
  "inventaire-d-une-region": {
    libelle: "lire les applications d'une région et la vue consolidée de ses collaborateurs",
    hote: "region",
    viseUneApplication: false,
    // Les deux listes plates et rien d'autre : le relevé par application n'a pas de motif
    // qui le désigne sans désigner du même coup tout ce qui pend sous une application.
    chemins: () => ["GET:/v1/apps", "GET:/v1/collaborators"],
  },
  "collaborateurs-d-une-application": {
    libelle: "tenir les collaborateurs d'une seule application",
    hote: "region",
    viseUneApplication: true,
    chemins: (application) => [
      `GET:/v1/apps/${application}/collaborators`,
      `POST:/v1/apps/${application}/collaborators`,
      `PATCH:/v1/apps/${application}/collaborators/*`,
      `DELETE:/v1/apps/${application}/collaborators/*`,
    ],
  },
  "catalogue-des-regions": {
    libelle: "découvrir les régions et le compte qui porte le jeton",
    hote: "authentification",
    viseUneApplication: false,
    chemins: () => ["GET:/v1/regions", "GET:/v1/users/self"],
  },
};
```

Le joker de `PATCH` et `DELETE` porte sur l'identifiant de collaboration, qui n'est connu de personne
au moment d'émettre, et qui change dès qu'une invitation est retirée puis réémise : c'est déjà la
raison pour laquelle le retrait relit la liste au lieu de viser l'identifiant stocké
(`src/connectors/scalingo.ts:1149-1158`). Il reste borné au segment sous `collaborators` de
l'application nommée, ce qui est la portée voulue.

### Le scope Scalingo en union discriminée

```ts
const NATURE_COLLABORATION = "collaboration";
const NATURE_JETON = "jeton";

const NATURE = {
  description:
    "Ce que cet accès ouvre : « collaboration » invite quelqu'un sur une application, « jeton » fait émettre un jeton restreint devant l'API.",
};

const collaboration = z.strictObject({
  nature: z.literal(NATURE_COLLABORATION).meta({ ...NATURE, examples: [NATURE_COLLABORATION] }),
  region: /* inchangé */,
  application: /* inchangé */,
  role: /* inchangé */,
});

const jeton = z.strictObject({
  nature: z.literal(NATURE_JETON).meta({ ...NATURE, examples: [NATURE_JETON] }),
  usage: z.enum(USAGES_DE_JETON).meta({
    description:
      "Le besoin que ce jeton sert. Les chemins qu'il ouvre appartiennent au connecteur et ne s'écrivent pas ici.",
    examples: ["inventaire-d-une-region"],
  }),
  region: z
    .string()
    .min(1)
    .optional()
    .meta({
      description:
        "La région dont l'API est la cible. Absente pour un usage qui vise le service d'authentification : un blob ne porte qu'une cible.",
      examples: ["osc-fr1"],
    }),
  application: z
    .string()
    .min(1)
    .optional()
    .meta({
      description: "L'application visée, pour les seuls usages dont les chemins la nomment.",
      examples: ["mon-application"],
    }),
});

const SCOPE = z.discriminatedUnion("nature", [collaboration, jeton]);

export type ScopeScalingo = z.infer<typeof SCOPE>;
```

Ce que `SCOPE` ne peut pas dire de lui-même passe par `examinerScope`, qui n'existait pas encore pour
ce système (`src/connectors/index.ts:26-30` ne porte que `github`) : un usage régional sans région, un
usage global qui en porte une, un usage qui nomme une application sans qu'elle soit là. Il pose aussi
`risque: "high"` pour toute la nature `jeton`, quel que soit l'usage, et c'est la section suivante qui
dit pourquoi. Sa `cible` vaut `jeton:<usage>:<région ou global>`, sans l'application, sur le modèle
de `github` (`src/connectors/github.ts:145-150`) : deux profils qui demanderaient le même jeton pour
la même personne demandent la même chose, et le second resterait en écart pour toujours.

**Ce que la rupture casse, et où ça se voit.** Trois choses, dont une qui ment si on l'oublie.

D'abord, tout accès Scalingo déclaré dans un profil doit gagner `nature: collaboration`. Le refus est
déjà rédigé sans rien changer : l'anomalie sort en `invalid_union` avec `path: ["nature"]`, la valeur
reçue est absente, et `motifDeScope` tombe dans sa branche `recu === undefined`
(`src/core/octroi.ts:133-137`) pour rendre « scope.nature : ce champ est obligatoire, et ce profil ne
le porte pas. »

Ensuite, et c'est le point à ne pas laisser passer, l'écran des systèmes se mettrait à dire faux.
`z.toJSONSchema` rend un `oneOf` sans `properties`, `required` ni `additionalProperties` à la racine,
or `objetLu` donne un défaut à chacun de ces trois champs
(`src/ui/connecteurs/scope-attendu.ts:24-28`) : la lecture réussit, la liste des champs est vide, et
`src/app/systemes/page.tsx:130-135` affiche « Aucun champ de scope : sur ce système, un accès ne se
découpe pas, et un profil y laisse `scope` vide. » Le garde-fou existe et il mord déjà :
`src/ui/connecteurs/scope-attendu.test.ts:9-21` exige, pour chaque connecteur du registre,
`etat === "lu"` **et** `clesInconnuesRefusees === true`, et le second échoue dès que la racine n'est
plus un objet strict. `scopeAttendu` doit donc apprendre à lire un `oneOf` et à rendre une variante
par branche, en lisant aussi `const` et non le seul `enum` (`:16-22`), faute de quoi le discriminant
s'afficherait comme « texte » au lieu de sa valeur. C'est la seule pièce d'interface que cette
décision impose, et elle n'est pas facultative : un écran qui décrit le scope attendu est le seul
endroit où l'auteur d'un profil lit la forme, `scopeSchema` n'entrant pas dans le schéma JSON publié
au dépôt de configuration (`src/cli/schema-politique.ts:36-61` ne compose que les `configSchema`).

**Constaté à l'implémentation, et cela allège tout ce paragraphe : il n'existe aucun profil.** Le
`config.yaml` du dépôt de configuration ne porte aucune clé `profiles` (88 lignes, dernier état au
16 septembre 2026), et la table des surcharges est vide. Aucun accès Scalingo n'est donc déclaré
nulle part, et la rupture ne casse rien : elle rendrait inutilisable un profil qui n'existe pas. Les
deux dépôts n'ont pas à se livrer ensemble, et la seule réserve qui subsiste est qu'une surcharge
posée en production depuis l'écran de configuration ne se lit pas d'ici. Le raisonnement qui suit
garde toute sa valeur pour le jour où un profil visera ce système.

Enfin, la rupture se livre avec le changement du dépôt de configuration et pas après, parce que les
profils y vivent. La politique se résout à trois niveaux, fichier compris
(`src/lib/policy.ts:103-113`), et le fichier `config.yaml` du dépôt de configuration porte les
`profiles`. Livrer le code d'abord laisse entre les deux une fenêtre où tout profil visant Scalingo
est refusé ; livrer le fichier d'abord laisse une fenêtre où `nature` est une clé inconnue, que
`strictObject` refuse tout aussi sûrement. Les deux dépôts se poussent ensemble, et
`pnpm policy:check` (`src/cli/verifier-politique.ts:26-38`), qui est la seule commande qui tourne
dans le dépôt de configuration, est ce qui le prouve avant la mise en service.

### L'échéance, qui ne se demande pas

Elle sort de la règle existante, sans une ligne de règle nouvelle, et elle sort deux fois.

La première sortie est au niveau du scope : `verdictDAcces` refuse un accès dont l'examen rend un
risque élevé et dont le profil ne porte pas `expiresInDays` (`src/core/octroi.ts:215-219`). Dès que
`examinerScope` rend `risque: "high"` pour la nature `jeton`, un profil qui demande un jeton sans
terme est refusé, avec un message qui nomme ce qu'il refuse.

La seconde sortie est au niveau de l'étape, et c'est celle qui ne se contourne pas :
`assemblerOctrois` refait le même refus sur les étapes émises, en filtrant `riskLevel === "high"`
quand l'échéance est nulle (`src/core/octroi.ts:604-618`), précisément pour qu'un connecteur qui
relève le risque de sa propre étape ne puisse pas passer à côté. L'étape d'émission porte
`riskLevel: "high"` sans condition, là où l'invitation d'un collaborateur pèse son rôle
(`src/connectors/scalingo.ts:918`) : un jeton ne se révoque pas, donc même le plus étroit des usages
ouvre quelque chose qu'on ne saura pas refermer.

L'échéance elle-même reste posée par le socle et jamais par le connecteur
(`src/core/connector.ts:337-346`), et elle arrive jusqu'à l'exécution : `grantExpiresAt` est
sélectionné en base et recollé sur l'étape avant l'appel (`src/lib/execution.ts:131`, `:182-186`).
Le connecteur en tire ses secondes, et refuse en dernier ressort :

```ts
  const terme = step.grantExpiresAt;
  if (terme === undefined) {
    return {
      state: "FAILED",
      error:
        "Cette étape émet un jeton que rien ne saura reprendre, et elle ne porte aucun terme. Rien n'a été émis.",
      retryable: false,
    };
  }
```

Ce refus n'est pas une ceinture de trop. Le geste hors dossier ne passe pas par `assemblerOctrois` :
c'est un plan `MANUAL_OP` dont le terme vient de son intention gelée, et la garde du socle doit y être
rejouée, ce que la section du geste hors dossier porte. Tant que deux chemins peuvent naître, le seul
endroit qui les voit tous les deux est celui qui écrit.

### Le compte machine émis

**Migration additive, cinq colonnes, toutes nullables.** `ServiceAccount`
(`prisma/schema.prisma:191-220`) porte déjà ce qui fait d'un accès non humain un objet gouvernable :
`key`, `label`, `purpose`, `ownerUsername`, `provider`, `reviewEveryDays`, `lastReviewedAt`. Il lui
manque ce qu'une émission décide.

```prisma
  /// Le blob chiffre remis par le proxy. Inerte seul : sa cle de dechiffrement se derive
  /// du sel du serveur et d'une cle client que rien n'ecrit ici. Garde parce que le proxy
  /// n'offre aucune route d'introspection : cette ligne est le seul registre de ce qui a
  /// ete emis.
  fgpBlob String?

  /// L'hote unique que ce blob autorise. Un blob n'en porte qu'un, d'ou une colonne et non
  /// une liste.
  fgpTarget String?

  /// Les scopes demandes, sous la forme METHOD:PATH, tels qu'ils ont ete envoyes.
  fgpScopes String[]

  /// Le terme. Le proxy n'ayant aucune revocation, c'est le seul mecanisme de reprise, et
  /// c'est aussi ce qui sort ce compte de la file des revues quand il est passe.
  expiresAt DateTime?

  /// L'operateur qui a lance l'emission, nominatif comme tout ce qui decide. Distinct de
  /// ownerUsername, qui est la personne qui detient le jeton.
  issuedBy String?
```

Plus un index sur `expiresAt`, sur le modèle de celui de `lastReviewedAt` (`:218`).

**Ce qui ne s'ajoute pas.** Pas le jeton de compte Scalingo, qui reste en environnement
(`src/lib/env.ts:69`). Pas l'URL rendue par le proxy, qui n'est que le blob dans un chemin. Pas de
relation vers `Person` : `ownerUsername` est déjà la forme que ce modèle emploie, et `identities`
existe pour ce qu'une collecte constate, or aucune collecte ne constatera jamais un blob. Et surtout
pas la clé client.

**La clé client se montre une fois et ne s'écrit nulle part.** Le blob et la clé valent ensemble
l'accès, séparément rien : le proxy dérive sa clé de chiffrement du sel serveur et de la clé client,
et l'exige à chaque requête. Les garder tous les deux ici, c'est faire de cette base le coffre des
credentials du parc, ce que l'ADR-0001 a refusé en toutes lettres, et c'est perdre l'invariant qu'elle
nomme dans la foulée : un dump de production se restaure aujourd'hui en développement sans exposer un
seul jeton. Le proxy, lui, ne stocke rien : garder le couple reviendrait à rendre cette base plus
dangereuse que le service qu'elle appelle. Et rien ici n'a d'usage de cette clé, puisque ces blobs ne
servent qu'à des tiers et jamais à la collecte, laquelle emploie le jeton de compte directement.

Garder le blob seul n'est pas une demi-mesure. Il est inerte, et il est la seule trace au monde de ce
qui a été émis, aucune route ne sachant lister ce qui vit. Le prix est réel et s'assume : une clé
perdue par son détenteur ne se retrouve pas, le jeton devient inutilisable sans cesser d'exister, et
il faut réémettre en laissant le premier mourir à son terme.

**Le chemin de la remise, et pourquoi il traverse le socle.** Aucun connecteur n'accède à la base, et
c'est vérifiable : aucun fichier de `src/connectors/` n'importe `@/lib/db`. Le connecteur ne peut donc
pas écrire le compte machine lui-même, et il ne le doit pas. `StepOutcome` gagne un champ sur sa seule
branche de succès (`src/core/connector.ts:377-381`) :

```ts
/**
 * Ce qu'une étape remet et que le socle doit ranger : un credential émis pour quelqu'un,
 * dont une moitié se garde et l'autre se rend une seule fois.
 */
export interface CredentialRemis {
  key: string;
  label: string;
  purpose: string;
  provider: string;
  /** Qui le détient et qui en répond : la personne que l'étape vise. */
  ownerUsername: string;
  blob: string;
  target: string;
  scopes: NonEmptyArray<string>;
  expiresAt: Date;
  /** Ce qui ne se garde pas : rendu une fois à l'écran, jamais écrit, jamais journalisé. */
  aRemettre: string;
}
```

Le socle écrit le compte machine dans la boucle d'exécution, puis fait remonter la seule moitié
périssable jusqu'à l'écran : `ResultatDExecution` gagne une liste de remises, et
`EtatAction.execution` la porte déjà jusqu'au composant
(`src/app/dossiers/[id]/actions.ts:34-44`, dont le commentaire dit exactement pourquoi ce retour
existe). Deux interdits accompagnent ce chemin. La clé n'entre pas dans `evidence`, qui devient le
motif journalisé de l'étape (`src/core/execution.ts:213-220`) dans un journal en écriture seule à
rétention indéfinie. Et elle n'entre dans aucune valeur de formulaire que la revalidation rejouerait :
elle se lit, elle se recopie, elle disparaît au rechargement.

La clé du compte machine se dérive de la clé d'idempotence stockée, laquelle porte déjà l'identifiant
du plan et est unique en base (`src/lib/dossier.ts:541`, `prisma/schema.prisma:697`). Une réémission
après un échec ambigu produit donc une seconde ligne plutôt que d'écraser la première, et c'est
voulu : deux blobs peuvent vivre là-bas, le registre doit les montrer tous les deux, puisque ni l'un
ni l'autre ne se révoque et que tous deux mourront d'eux-mêmes.

**La revue et le terme ne disent pas la même chose.** `revueDe` ne connaît que la périodicité et la
date de déclaration (`src/core/revue.ts:42-56`) : un jeton mort resterait éternellement « revue en
retard » dans la file, c'est-à-dire un signal rouge qui ne s'éteint jamais, exactement ce que
`src/app/comptes-de-service/actions.ts:12-17` décrit comme la panne à éviter. Deux gestes suffisent :
la périodicité d'un jeton émis vaut la durée de son terme en jours arrondie au supérieur, si bien
qu'aucune revue ne tombe avant qu'il ne meure, et les écrans qui lisent ces comptes
(`src/lib/inventaire.ts:93`, `src/app/comptes-de-service/page.tsx:39-40`) sortent de la file ceux dont
`expiresAt` est passé, en les montrant éteints plutôt qu'en retard.

### La clé d'engagement, et la reprise au départ

Cette action est le cas d'école de la frontière : ce qu'elle ouvre ne reparaîtra dans aucun
`CollectResult`, parce qu'aucune API de Scalingo ne liste les blobs d'un proxy qui n'en garde aucun.
L'étape d'émission porte donc une clé d'engagement, que le connecteur fabrique et qu'il est le seul à
relire :

```ts
      commitmentKey: `scalingo:jeton:${scope.usage}:${cible}:${qui}`,
```

Au départ, le socle rend au connecteur les engagements encore vivants comme il lui rend déjà les accès
constatés (`src/core/connector.ts:284-289`), et le connecteur émet une étape de reprise par
engagement, comme il émet déjà une coupure par application
(`src/connectors/scalingo.ts:976-1000`). Elle est manuelle, et son critère de complétion ne peut être
que celui-ci :

> Le terme du jeton est passé, et aucune émission nouvelle n'a été faite sous cet engagement depuis.
> Rien d'autre ne se constate : le proxy n'offre ni révocation ni introspection, et son registre est
> la fiche du compte machine, pas une API.

Son runbook porte l'interdiction, et elle est explicite parce que c'est le premier réflexe de qui
découvre qu'un jeton ne se révoque pas : **ne pas faire tourner le jeton de compte Scalingo.** Il est
à portée compte entier (`src/connectors/scalingo.ts:1177-1180`), il est ce que chaque blob transporte
chiffré, et il est celui de la collecte. Le faire tourner ne reprend pas un jeton à une personne, il
éteint d'un coup tous les blobs vivants du parc, toutes les écritures et la lecture nocturne, jusqu'à
ce que la nouvelle valeur soit posée et l'application redémarrée. Ce n'est pas une étape de départ,
c'est un incident, et cela se décide ailleurs que dans un dossier.

La conséquence se dit une fois, franchement : un départ survenu avant le terme ne se solde pas avant
ce terme. C'est la raison de fond pour tenir ces termes courts, en jours et non en mois, et c'est ce
que la politique doit inscrire dans les `expiresInDays` des profils qui demandent un jeton.

### La seconde entrée de credential

```ts
const CREDENTIAL_FGP = "scalingo:fgp";
```

```ts
    {
      id: CREDENTIAL_FGP,
      source: "fgp",
      scopeNote:
        "Adresse du proxy à jetons restreints, par lequel passe l'émission de jetons pour des tiers. Ce qu'un blob rétrécit : ce que peut faire son porteur, qui ne pourra appeler que les méthodes et les chemins listés à l'émission, sur une seule cible, et jusqu'à un terme. Ce qu'il ne rétrécit pas : ce que peut faire l'instance. Le jeton de compte Scalingo, à portée compte entier, voyage en clair jusqu'au proxy à l'émission et vit chiffré à l'intérieur du blob, si bien que l'instance le manipule en clair à chaque requête qu'elle relaie. Aucune révocation n'existe côté proxy : un jeton émis se reprend en attendant son terme, et par rien d'autre.",
      // Ni nominatif ni personnel : c'est une adresse de service, et l'absence de jeton sur
      // la route de génération est un fait du proxy, pas un oubli de configuration.
      nominative: false,
    },
```

La sonde suit la forme existante (`src/connectors/scalingo.ts:1300-1312`) et rend
`available: Boolean(env.FGP_URL)`, avec pour raison d'absence « FGP_URL absent de l'environnement ».
L'écran d'un système sait déjà rendre cette source sans rien apprendre : il écrit « depuis
fine-grained-proxy » là où il écrit « depuis l'environnement » pour les autres
(`src/app/systemes/[cle]/page.tsx:98-104`), et c'est la première fois que cette branche, écrite
d'avance, sert vraiment.

La voie déclarée sous `capabilities.grant` ne bouge pas : `resolveCapability` choisit la première
entrée dont les credentials sont tous présents (`src/core/connector.ts:131-155`), et la résolution est
par capacité, pas par action. C'est le connecteur qui dégrade son étape d'émission, comme il dégrade
déjà l'invitation quand l'adresse manque (`src/connectors/scalingo.ts:900-903`) : `credential: boolean`
devient `credentials: { api: boolean; fgp: boolean }`, et sans l'adresse du proxy, l'étape sort en
`manual` avec un runbook qui dit quoi générer et où, plus la mention que la fiche du compte machine se
saisit ensuite à la main depuis l'écran des comptes de service.

### Tests

Trois scénarios, tous à l'étage unitaire, aucun jeton, aucune base, aucune API distante.
`scalingo.contrat.test.ts` ne bouge pas : le contrat existe pour voir une réponse de Scalingo changer
de forme sans annonce, et rien ici n'interroge Scalingo. Les doubles se posent au transport, comme le
fichier le fait déjà, un lecteur par table d'URL (`src/connectors/scalingo.test.ts:39-60`) et un
écrivain qui enregistre ses appels (`:841-852`), auxquels s'ajoute un émetteur de la même famille.

Une ligne de garde d'abord, dans `vitest.config.ts:30-43` : `FGP_URL: ""` rejoint les adresses mortes,
à côté de `SCALINGO_API_TOKEN`. Le commentaire du fichier (`:11-13`) décrit exactement ce qu'on
éviterait ainsi, un test qui oublie de doubler son transport et sort pour de vrai, et l'oubli coûterait
ici une émission réelle que rien ne saurait révoquer.

**1. « Un jeton ne s'émet que borné, et ce qui est émis se range en deux moitiés. »** Dans
`src/connectors/scalingo.test.ts`. Given une étape d'émission pour l'usage
`collaborateurs-d-une-application` sur `mon-application` en `osc-fr1`, un terme à sept jours porté par
`grantExpiresAt`, un émetteur doublé qui rend un blob et une clé. When on exécute, Then l'émetteur a
reçu une seule demande, sa cible est `https://api.osc-fr1.scalingo.com` et pas l'hôte
d'authentification, ses scopes sont exactement les quatre chemins de l'usage, tous préfixés de
`/v1/apps/mon-application/collaborators`, aucun ne porte de joker de préfixe sur `/v1/apps`, son `ttl`
vaut le nombre de secondes jusqu'au terme et n'est jamais nul. Then l'issue est `SUCCEEDED`, elle porte
un credential remis dont le blob, la cible, les scopes et le terme sont ceux de la demande, et dont la
moitié à remettre est la clé rendue par le proxy. Then ni l'`evidence` ni aucun champ destiné au
journal ne contient cette clé, la recherche portant sur la valeur elle-même. When la même étape ne
porte aucun terme, Then rien n'est émis, l'émetteur n'a reçu aucune demande, et l'issue est `FAILED`
non reprenable.

**2. « Ce qui ne peut pas s'émettre se dit sans jamais réessayer. »** Même fichier. Given un émetteur
qui refuse par un 400. When on exécute, Then l'issue est `FAILED`, non reprenable, et son message
affirme que rien n'a été émis. When l'émetteur expire au lieu de répondre, Then l'issue est `FAILED`
et son message dit qu'un jeton a pu naître, que rien ne le liste et que rien ne le révoque. When
`ACTIONS_ENABLED` vaut faux, Then l'exécution lève avant de regarder ce que l'étape demande, comme
pour les deux autres actions (`src/connectors/scalingo.ts:1097-1099`), et l'émetteur n'a rien reçu.
When aucune adresse de proxy n'est configurée, Then la planification rend une étape `manual` dont le
critère de complétion nomme le blob à rapporter, et l'exécution refuse sans appeler personne.

**3. « Le scope à deux natures se déclare, se refuse et se lit. »** Réparti sur deux fichiers, chacun
au plus bas étage qui sache tenir sa part. Dans `src/core/octroi.test.ts` : Given un profil dont
l'accès Scalingo est écrit comme avant la rupture, sans `nature`. When on vérifie les profils, Then il
est refusé, et le motif est « scope.nature : ce champ est obligatoire, et ce profil ne le porte pas. »,
mot pour mot. When le profil demande la nature `jeton` sans `expiresInDays`, Then il est refusé deux
fois plutôt qu'une, une fois sur l'examen du scope et une fois sur l'étape émise, et les deux motifs
nomment `expiresInDays`. When il demande un usage régional sans région, Then le refus le dit sans
parler de terme. Dans `src/ui/connecteurs/scope-attendu.test.ts`, qui porte déjà la garde du registre
entier (`:9-21`) : Then le scope de Scalingo se lit toujours, ses clés inconnues sont toujours
refusées sur chacune de ses deux natures, et la liste des champs n'est pas vide. C'est une phrase
d'écran, elle s'épingle sans base ni navigateur.

### Ce qui reste ouvert

Une émission interrompue entre l'envoi et la réponse laisse un blob que rien ne liste, que rien ne
révoque, et dont la clé n'a atteint personne. Il est inutilisable faute de clé, et il meurt à son
terme : c'est le seul recours, et c'est une raison de plus de tenir les termes courts. L'étape le dit
à l'opérateur au lieu de réessayer.

Le registre des jetons émis est déclaratif de bout en bout. Aucune collecte ne le confirmera jamais,
et une ligne effacée en base est un jeton qui vit sans que personne ne le sache. C'est la première
chose du système qu'aucune relecture ni aucun rejeu ne reconstruit, le journal ne portant pas le blob
et le proxy n'en gardant aucune trace.

## L'écran, et l'ordre de travail

### Comment l'écran se déclare, et pourquoi la route existe enfin

**`/systemes/scalingo` rend 404 aujourd'hui, et rien dans le contrat ne le corrige.** `aUnePage`
(`src/ui/connecteurs/registre.ts:60-66`) exige l'une de trois choses : un écran enregistré, un
`configSchema`, ou au moins une fonctionnalité déclarée. `CONTRAT_SCALINGO`
(`src/connectors/scalingo.ts:1163-1201`) n'a aucune des trois : ni `configSchema`, ni `features`, et
`ECRANS` (`registre.ts:20-22`) ne connaît que `github`. La page refuse donc l'adresse
(`src/app/systemes/[cle]/page.tsx:37-39`) et l'écran Systèmes ne pose aucun lien
(`src/app/systemes/page.tsx:217`, `:333`), alors que le connecteur est en tier `auto` sur ses trois
capacités. Une seule ligne ouvre la route :

```ts
const ECRANS: Readonly<Record<string, ChargeurEcran>> = {
  github: () => import("./github/Ecran"),
  scalingo: () => import("./scalingo/Ecran"),
};
```

Le registre garde son indirection par chargeur pour la raison qu'il écrit lui-même (`:15-19`) : la
collecte en ligne de commande ne doit jamais charger un composant, et
`src/cli/frontiere.test.ts:348-361` tient la propriété dans les deux sens. Le sens qui compte ici
est le second : le parcours part de `src/connectors/index.ts` et vérifie qu'aucun fichier de
`src/ui/` ni de `src/app/` n'est atteint. Un écran qui lit la base ne le met pas en danger, l'import
n'allant que de l'interface vers les connecteurs.

**Le fichier vit dans `src/ui/connecteurs/scalingo/`, à côté de ses tuiles.** Le répertoire existe
déjà (`src/ui/connecteurs/scalingo/tuiles.tsx`), et `github` donne la forme complète, `Ecran.tsx`
plus `tuiles.tsx`. La différence avec `EcranGithub` (`src/ui/connecteurs/github/Ecran.tsx:7-16`) est
qu'il ne se contente pas de rendre sa configuration : Scalingo n'en a pas, et ce que l'écran montre
est ce que la collecte a écrit. Il est donc **asynchrone et lit la base lui-même**. Les propriétés
que le socle passe (`ProprietesEcran`, `registre.ts:7-12`) ne portent que le contrat et la
configuration résolue, aucune donnée, et le point de montage les lui donne tels quels
(`src/app/systemes/[cle]/page.tsx:68-69`, `:200`). Cela typecheck sans rien assouplir : `ReactNode`
inclut `Promise<AwaitedReactNode>` depuis React 19 (`node_modules/@types/react/index.d.ts:436-449`),
donc un composant asynchrone satisfait `ComponentType<ProprietesEcran>`. La page est en
`dynamic = "force-dynamic"` (`src/app/systemes/[cle]/page.tsx:17`), rien n'est à mettre en cache.

### Ce qu'il montre, dans les deux sens

Le parc Scalingo ne se lit pas dans un seul sens, et c'est ce qui justifie un écran plutôt qu'une
ligne de plus sur la fiche d'une personne. Quand on décide d'une coupure, on part d'une personne et
on veut savoir où elle entre. Quand on revoit une application, on part de l'application et on veut
savoir qui y entre. Les deux se rendent sur le même écran, l'un sous l'autre, et sortent des deux
mêmes lectures.

**Le parc, projet par projet.** Un groupe par projet, chacun un `Accordion`, et sous chaque projet
les applications qu'il contient. Sur la ligne d'une application : son libellé tel que la collecte
l'a écrit, donc nom et région séparés par une virgule (`src/connectors/scalingo.ts:659-667`), le lien
vers sa page de collaborateurs que la ressource porte déjà (`:666`), puis les accès vivants, un par
détenteur, avec le rôle en français, la date du dernier constat, et le rattachement de l'identité.
Une application dont la contenance n'a rien dit tombe dans un groupe « Sans projet », qui n'est ni
une anomalie ni un projet, seulement le reste.

**Qui détient un accès, et où.** Un compte Scalingo par ligne, la personne qu'il désigne quand il en
désigne une, et les applications où la dernière collecte l'a vu, regroupées par projet. C'est le sens
que le départ utilise déjà en interne (`src/lib/dossier.ts:84-120`), rendu lisible : la différence
est qu'ici les identités rapprochées par ressemblance **figurent**, alors que `systemesDeLaPersonne`
les écarte avant de transmettre quoi que ce soit à un connecteur (`:109-113`). Un écran qui les
cacherait laisserait croire qu'un compte n'existe pas, quand il existe et n'est simplement pas
coupable d'être à quelqu'un.

**Deux choses que l'écran n'a pas le droit de taire.** La première est l'invitation en attente : le
connecteur pose un accès de rôle plein ou limité dès l'invitation émise, et range l'état
« invitation en attente » dans les métadonnées de l'identité (`src/connectors/scalingo.ts:698-701`),
non dans le rôle. Un écran qui ne lirait que `role` présenterait donc une invitation dormante
exactement comme une collaboration acceptée. La seconde est la date : tout ce qui s'affiche vient de
la dernière collecte, et l'écran le dit en toutes lettres plutôt que de laisser croire à une lecture
de l'instant. Ce n'est pas une tuile : les tuiles interrogent le système en direct et ne peuvent
fonder aucune décision (`src/ui/connecteurs/contrat.ts:3-10`, `docs/architecture.md:784-791`), cet
écran lit le constaté, qui est précisément ce sur quoi une coupure se décide.

### Les deux lectures, et ce qu'elles coûtent

Deux lectures, une par sens, dans un seul `Promise.all`. La contenance entre par `parentId`, et
c'est tout ce que l'écran a besoin d'en savoir.

```ts
const [ressources, comptes] = await Promise.all([
  prisma.resource.findMany({
    where: { provider: "scalingo" },
    select: {
      id: true,
      externalId: true,
      label: true,
      url: true,
      parentId: true,
      // L'identité doit être vivante elle aussi, et pas seulement l'accès : les deux
      // datations sont découplées, et un garde-fou peut refuser de dater les accès d'un
      // système en laissant dater ses identités.
      grants: {
        where: { vanishedAt: null, externalIdentity: { vanishedAt: null } },
        select: { role: true, lastSeenAt: true, externalIdentityId: true },
      },
    },
    orderBy: { label: "asc" },
  }),
  prisma.externalIdentity.findMany({
    where: { provider: "scalingo", vanishedAt: null },
    select: {
      id: true,
      handle: true,
      matchMethod: true,
      details: true,
      person: { select: { username: true, fullname: true } },
    },
    orderBy: { handle: "asc" },
  }),
]);
```

**Quatre ordres SQL pour deux lectures écrites, et aucun N plus 1.** Prisma traduit chaque relation
sélectionnée par un ordre supplémentaire dont la clause `IN` reprend un paramètre par ligne parente,
doublons compris, ce que `src/lib/inventaire.ts:76-84` a déjà payé et documenté. C'est un ordre de
plus **par relation**, jamais un par ligne : `grants` en coûte un, `person` en coûte un, et les deux
clauses sont bornées par le parc et par la population de comptes, pas par le nombre d'accès. La règle
que l'inventaire en a tirée est respectée là où elle compte : les accès portent `externalIdentityId`
et **pas** la relation `externalIdentity`, sans quoi la clause de la troisième requête répéterait un
paramètre par accès, une personne présente sur dix applications y figurant dix fois.

Le recollage est en mémoire, et il n'a besoin d'aucune connaissance de Scalingo :

```ts
const contenants = new Set(
  ressources.flatMap((une) => (une.parentId === null ? [] : [une.parentId])),
);
const projets = ressources.filter((une) => contenants.has(une.id));
const applications = ressources.filter((une) => !contenants.has(une.id));
const parCompte = new Map(comptes.map((compte) => [compte.id, compte]));
```

Un contenant est une ressource que l'on désigne, pas une ressource qui se déclare : l'écran ne
regarde jamais si le connecteur s'appelle Scalingo, il regarde qui est parent de qui. Conséquence
assumée et lisible : un projet qui ne contient rien de ce que la collecte a vu n'est le parent de
personne, donc il se range parmi les applications sans accès. C'est le rendu honnête d'un projet
vide, et le corriger demanderait une colonne qui dirait « ceci est un contenant », c'est-à-dire
exactement le rangement que l'ADR 0002 refuse de construire pour aujourd'hui.

Le même recollage sert les deux sens : l'écran ne relit rien pour retourner la lecture, il retourne
la `Map`. Et il ne lit **pas** les départs en cours, ce qui aurait été une troisième requête pour
masquer un bouton : la garde du départ ouvert vit dans l'action, seul endroit où elle se tienne sans
course entre l'affichage et l'écriture.

### Ce qu'il dit, et ce qu'il ne dira jamais

Un projet Scalingo n'a pas de membres. La gestion des utilisateurs reste au niveau de l'application,
`docs/architecture.md:900-902` le dit déjà, et l'API n'expose rien d'autre. L'écran présente donc un
**regroupement** et jamais une **appartenance** : il n'existe aucune phrase, aucun bouton, aucune
colonne qui laisse penser qu'on entre dans un projet ou qu'on en sort. C'est la promesse la plus
facile à trahir de tout ce lot, parce qu'un titre de groupe suivi d'une liste de personnes ressemble
trait pour trait à une liste de membres, et parce que la personne qui lit cet écran est celle qui
décide d'une coupure.

Les phrases sortent donc de l'écran et vivent dans une table, sur le modèle exact de
`src/app/dossiers/[id]/redaction-execution.ts:3-13` et de `src/app/collectes/redaction.ts`. Le
fichier est `src/ui/connecteurs/scalingo/redaction.ts`.

```ts
export const MOTS_DE_SCALINGO = {
  parc: {
    titre: "Le parc, projet par projet",
    regroupement:
      "Un projet Scalingo ne fait que regrouper des applications. Il n'a pas de membres : personne n'y détient d'accès, et rien ne s'y retire. Ce qui s'ouvre et ce qui se coupe se lit sur la ligne d'une application.",
    horsProjet:
      "Sans projet. Ces applications se lisent comme les autres, et leurs accès aussi.",
    vide: "Aucune application constatée sur ce système. La liste est vide faute de collecte, ce qui ne dit rien du parc réel.",
    datation:
      "Tout ce qui suit vient de la dernière collecte, et non d'une lecture faite à l'instant. Une date est celle du dernier constat.",
  },
  comptes: {
    titre: "Qui détient un accès, et où",
    isole:
      "Ce compte n'est rattaché à personne. Il se traite dans la file des comptes isolés.",
    invitation: "Invitation en attente",
  },
  role: {
    bouton: "Changer son rôle",
    plein:
      "Un collaborateur plein lit les variables d'environnement de l'application, donc les secrets qu'elles portent et les identifiants de ses bases.",
    limite:
      "Un collaborateur limité voit les journaux, les métriques et le redéploiement, et rien des variables d'environnement.",
    proprietaire:
      "Le propriétaire d'une application ne se change pas ici. Il ne figure dans aucune liste de collaborateurs, et Scalingo ne sait pas l'en retirer.",
    ressemblance:
      "Ce compte est rattaché sur une ressemblance de nom. Aucun geste ne part d'ici tant que personne ne l'a confirmé : baisser un rôle retire ce que la personne pouvait lire, donc coupe une partie de son accès, et une coupure ne se décide jamais sur une ressemblance. Le rattachement se tranche dans la file des comptes isolés.",
    departOuvert:
      "Un départ est ouvert sur cette personne. Son rôle ne se change pas tant que ce dossier vit : ouvrir ou réduire un accès maintenant déplacerait l'empreinte du plan qu'il porte.",
  },
} as const;
```

Les trois rôles se disent en français dans une table dont la clé est l'union elle-même, comme
`src/ui/severites.ts:5-12` le fait pour les énumérations de la base et pour la raison qu'il écrit en
tête : sous `@tsconfig/strictest`, une union de littéraux n'est pas une signature d'index, si bien
qu'un rôle ajouté casse le typecheck au lieu de tomber dans un repli qui afficherait `limited` à qui
décide d'une coupure.

```ts
export const LIBELLE_ROLE_SCALINGO: Record<RoleScalingo, string> = {
  owner: "Propriétaire",
  collaborator: "Collaborateur",
  limited: "Collaborateur limité",
};

export function libelleDuRole(role: string): string {
  // `Object.hasOwn` et non un accès direct, pour la raison de `registre.ts:45-48` : un
  // rôle nommé « constructor » rendrait un membre du prototype.
  return Object.hasOwn(LIBELLE_ROLE_SCALINGO, role)
    ? LIBELLE_ROLE_SCALINGO[role as RoleScalingo]
    : role;
}
```

Les trois constantes ne sont pas exportables en l'état : `ROLE_PROPRIETAIRE`, `ROLE_PLEIN` et
`ROLE_LIMITE` sont privées (`src/connectors/scalingo.ts:155-157`) et ce sont pourtant elles que
`assembler` écrit en base (`:679`, `:707`). Elles déménagent donc dans un module de données pures,
`src/connectors/scalingo-roles.ts`, que le connecteur et la table de rédaction importent tous les
deux. Trois chaînes et une union : rien de ce qui fait le poids d'un connecteur, ni `fetch`, ni Zod,
ne suit dans le paquet d'interface.

**Cela s'épingle sans base et sans navigateur**, dans
`src/ui/connecteurs/scalingo/redaction.test.ts`, étage unitaire (`vitest.config.ts:84-91`), un
seul scénario qui porte toutes ses assertions.

**« Un projet regroupe, il n'accueille personne ».** Given la table de rédaction entière, aplatie en
phrases comme `redaction-execution.test.ts:15-25` le fait déjà. When on relit celles qui nomment un
projet, Then aucune ne parle de membre, d'appartenance, d'adhésion, d'ajout ni de retrait, la phrase
de regroupement porte ses deux moitiés, ce qu'un projet fait et où le geste se lit, et le libellé du
bouton de rôle n'apparaît dans aucune phrase du bloc `parc`. When on compare les trois clés de
`LIBELLE_ROLE_SCALINGO` aux trois rôles que `assembler` sait écrire, Then elles coïncident exactement
et aucun mot français n'est égal à sa clé, ce qui est la seule chose qui empêche `limited` d'arriver
tel quel sous les yeux d'un opérateur. When on lit les deux phrases de rôle, Then une seule des deux
nomme les variables d'environnement : c'est la différence unique que `risqueDuRole`
(`src/connectors/scalingo.ts:885-892`) transforme en cran de risque, et deux phrases qui la
gommeraient rendraient le risque inexplicable. When on lit le refus opposé à une ressemblance, Then
il donne la raison et l'endroit où trancher, sans jamais proposer de geste.

La garantie qui traverse les répertoires, elle, monte d'un cran : `src/mots-de-l-interface.test.ts`
existe déjà à la racine de `src/` pour exactement cela, « aucune valeur de la base n'arrive telle
quelle sous les yeux d'un opérateur » (`:89-116`), avec ses six tables d'énumération (`:48-79`). Un
rôle n'est pas une énumération de la base, c'est une chaîne libre que le connecteur choisit
(`docs/architecture.md:427-436`), donc il ne rentre pas dans `TABLES` ; le garde-fou reste au plus
bas, dans la table de rédaction, où le typecheck le tient sans qu'aucun test ne soit nécessaire.

### Le seul geste offert, et à qui il ne l'est pas

Le déclencheur est un `Button` sur la ligne d'un accès, en priorité tertiaire et en taille réduite
comme les gestes de file (`src/app/comptes-isoles/FileDesComptesIsoles.tsx:121-132`). Il n'ouvre rien
sur Scalingo : il ouvre la modale du geste hors dossier, qui appelle l'action posée par la section
précédente, laquelle crée le plan `MANUAL_OP` et redirige vers l'écran où il se confirme. L'écran
Scalingo ne sait rien de ce qui suit, et c'est voulu : il n'y a pas deux chemins vers l'exécution.

**Il y a une seule étape, et c'est son précheck qui décide entre inviter et corriger.** La
planification ne lit aucun système par construction, et le connecteur sait déjà distinguer les deux
cas : `constaterCollaboration` (`src/connectors/scalingo.ts:833-857`) retrouve la collaboration par
l'adresse en minuscules, rend `ALREADY_PRESENT` quand le rôle constaté est celui attendu (`:852-853`)
et nomme l'écart quand il diffère (`:856`). C'est cette branche que la section sur l'écriture
transforme en correction par `PATCH`. La modale rappelle donc ce que chaque rôle ouvre, et rien de
plus : elle ne promet pas de savoir, à l'affichage, si le geste sera une invitation ou une
rectification.

**Trois cas sur quatre ne portent aucun bouton, et chacun dit pourquoi.**

Le propriétaire n'en porte pas. Il ne figure dans aucune liste de collaborateurs et se lit sur
l'application elle-même (`src/connectors/scalingo.ts:633-639`), si bien que le chemin d'écriture, qui
relit les collaborateurs et retrouve la ligne par l'adresse juste avant d'agir (`:1136-1158`), ne le
trouverait jamais. Un bouton qui échoue toujours est pire qu'un bouton absent.

Un compte que personne ne réclame n'en porte pas non plus : `personId` nul est la définition même du
compte isolé (`prisma/schema.prisma:248-250`), il n'y a aucune personne à viser, et la file des
comptes isolés est l'écran qui existe pour cela (`src/app/comptes-isoles/page.tsx:157`).

**Et une identité rapprochée par ressemblance n'en porte pas, ce qui est la règle la plus importante
de cet écran.** `METHODES_REVOCABLES` (`src/core/rapprochement.ts:23-27`) ne retient que `DECLARED`,
`GITHUB_LOGIN` et `EMAIL_EXACT`, et `autoriseUneRevocation` (`:29-31`) refuse tout le reste ; le
départ applique déjà ce filtre avant de transmettre le moindre accès à un connecteur
(`src/lib/dossier.ts:109-113`). Le raisonnement tient en une phrase : baisser un rôle de
`collaborator` à `limited` retire l'accès aux variables d'environnement, donc **coupe une partie de
l'accès**, et couper sur une ressemblance de nom c'est couper l'accès d'un homonyme. Que la capacité
en jeu s'appelle `grant` ne change rien à ce que le geste fait. La ligne affiche donc le badge
« Ressemblance de nom » que `RATTACHEMENT_IDENTITE` (`src/ui/severites.ts:35-41`) fournit déjà, la
phrase de refus, et le chemin vers la file où le rattachement se tranche.

Reste le quatrième cas, celui qui porte le bouton, et pour lequel le refus arrive après le clic :
quand un départ est ouvert sur la personne, l'action refuse et la modale rend la phrase
`role.departOuvert` avec le lien vers le dossier. L'écran ne le devine pas, il le reçoit.

### Les composants, et le piège du badge

Un `Accordion` par projet, `titleAs="h3"`, comme la fiche d'une personne le fait déjà pour ses
constats fermés (`src/app/personnes/[username]/page.tsx:512-516`) et ses startups
(`SectionStartups.tsx:179`). Un `TableCustom` (`src/ui/TableCustom.tsx`) pour les accès d'une
application, et non le `Table` du système de design : les lignes ont besoin d'une clé stable et les
cellules portent des nœuds, badge et bouton, ce que `SectionComptesExternes.tsx:45-94` fait déjà
exactement ainsi. Un `Alert` de fin de section pour la phrase de datation, comme `EcranGithub` le
fait pour son avertissement (`src/ui/connecteurs/github/Ecran.tsx:31-36`). Un `Button` par geste. Une
seule modale, déclarée **hors composant** dans le fichier client, sous l'identifiant
`changer-role-scalingo` : les treize appels à `createModal` du dépôt sont tous au niveau du module et
tous d'identifiant distinct, deux modules qui enregistreraient le même produiraient deux `<dialog>`
de même `id`.

L'écran se scinde donc en deux fichiers, ce que la modale impose : `Ecran.tsx` reste serveur et lit
la base, `ChangerLeRole.tsx` porte `"use client"`, la modale et le formulaire. Le second ne reçoit
que des chaînes et des dates, rien qui ne traverse pas la frontière.

**Le `Badge` rend lui-même un paragraphe.** Sa propriété `as` vaut `"p"` par défaut
(`node_modules/@codegouvfr/react-dsfr/Badge.d.ts:10-11`), et l'imbriquer dans un autre `p` produit du
HTML invalide que React refuse d'hydrater : l'écran se rend côté serveur puis meurt au réveil, ce qui
ne se voit pas en relisant le composant. Le dépôt s'est déjà fait prendre et l'a documenté
(`src/app/comptes-isoles/FileDesComptesIsoles.tsx:142-145`), où le contournement est un `div`. Le
contournement direct existe pourtant et sert déjà une fois : `as="span"`
(`src/app/journal/page.tsx:39`). Règle pour cet écran : dans une cellule de tableau le défaut
convient, un `p` y étant valide ; dans toute phrase de la modale ou d'une `Alert`, le badge prend
`as="span"`.

### L'ordre d'écriture

Tout part en une seule livraison, mais l'ordre n'est pas libre : chaque étage rend le suivant
typecheckable, et deux d'entre eux ne se séparent pas sans rendre faux ce qu'un ADR affirme.

**1. Les deux ADR.** Ils ne dépendent de rien, ils coûtent une heure, et ils sont le vocabulaire que
tout le reste cite. `docs/adr/0002` acte les trois rangements et porte les deux réfutations déjà
vérifiées ; c'est aussi lui qui écrit pourquoi `props` et `propsSchema` ne se construisent pas
aujourd'hui, décision qu'il vaut mieux avoir écrite avant d'écrire la colonne voisine que trois mois
après. `docs/adr/0003` acte le geste hors dossier et la clé d'engagement. Le répertoire existe et sa
forme est posée (`docs/adr/0001-configuration-a-trois-niveaux.md`).

**2. La contenance dans le socle.** `Resource.parentId`, nullable, auto-relation d'un seul niveau, en
`onDelete: SetNull`, avec son index ; `ObservedResource` gagne `parentExternalId` facultatif
(`src/core/connector.ts:224-228`) ; l'écriture des ressources le résout
(`src/lib/sync/collecte.ts:87-105`). `ConnectorContract` ne bouge pas. Enchaîner `pnpm db:generate`
puis **redémarrer `pnpm dev`** : le client généré est mis en cache sur `globalThis`, et sans le
redémarrage le typecheck passe pendant que le runtime refuse le champ.

**3. Les deux clients, dans le même passage.** Scalingo pose le projet et rattache ses applications ;
GitHub déclare l'organisation qui contient chaque équipe. Les séparer serait livrer une colonne qui
ne sert qu'un connecteur, c'est-à-dire exactement l'affirmation que l'ADR 0002 ne pourrait plus
faire.

**La clé `${org}#${equipe.id}` ne bouge pas** (`src/connectors/github.ts:401`), et il ne faut pas
lire « GitHub cesse d'encoder l'organisation dans sa clé » comme une invitation à la changer. Ce que
la contenance retire, c'est l'obligation de relire l'organisation dans cette chaîne, pas la chaîne
elle-même. La section « Ce que GitHub change » démontre qu'une clé de ressource ne se change pas :
la collecte créerait une ligne neuve sans supprimer l'ancienne, les accès de l'ancienne seraient
datés disparus au passage du soir, et le garde-fou des ressources, qui compte après les écritures et
avant la datation, verrait à peu près le double du relevé, passerait le run en `PARTIAL` et
empêcherait même la datation d'avoir lieu, chaque nuit, jusqu'à une levée nominative. La seule ligne
qui change est l'ajout de `parentExternalId: org`.

**4. Le `scopeSchema` en union discriminée, et le dépôt de configuration.** Ensemble, jamais l'un
après l'autre : c'est une rupture visible, tout accès Scalingo déclaré dans un profil doit gagner son
champ de nature, et l'outil refuse au démarrage sinon. Livrer le schéma avant la politique fait
tomber un environnement qui n'a rien demandé.

**5. L'écriture Scalingo.** `EcritureScalingo` passe de `POST|DELETE` à `POST|PATCH|DELETE`,
`ecrireTout` étant déjà générique sur la méthode, et le précheck
(`src/connectors/scalingo.ts:833-857`) cesse de refuser un rôle différent pour le corriger.

**6. Le geste hors dossier.** `Plan.subjectId` en relation `Restrict`, `Plan.intent` en `Json`, la
garde du départ ouvert, et la clé d'engagement facultative sur `PlannedStep`, que le socle transporte
sans jamais l'interpréter. C'est l'étape la plus risquée du lot, et pour une raison mécanique : les
quatre gardes qui refusent aujourd'hui un plan sans dossier (`src/lib/execution.ts:285-290`,
`src/app/dossiers/[id]/actions.ts:232-244`, `src/lib/dossier.ts:491`) partent toutes du principe
qu'un plan en a un, et l'une d'elles ne refuse même pas, elle ne matche simplement jamais. Seconde
migration, donc second `pnpm db:generate` et second redémarrage.

**7. L'émission de jetons.** Le proxy, la modélisation en `ServiceAccount`, et l'échéance obligatoire
qui sort gratuitement de la règle existante sur un accès à risque élevé. Après 6, parce qu'un jeton
s'émet par une étape de plan, et que c'est la première étape à porter une clé d'engagement. Troisième
migration.

**8. L'écran, en dernier.** Il ne fait que lire ce que les étapes 2 à 7 ont écrit, et il est le seul
livrable dont l'absence ne casse rien : une PR qui déborde s'arrête ici sans rien laisser
d'incohérent derrière elle. L'ordre interne est celui des dépendances de type : la table de rédaction
et son test d'abord, sans lesquels le composant écrit ses phrases en dur ; le module des rôles
ensuite ; `Ecran.tsx` et ses deux lectures ; `ChangerLeRole.tsx` en dernier, parce qu'il est le seul
qui appelle l'action de l'étape 6.

**9. Les finitions et les propositions documentaires.** Le parcours complet est joué avant d'écrire
une ligne de documentation, et les amendements à `docs/architecture.md` sont **soumis**, jamais
appliqués.

### Les finitions à embarquer

Trois corrections vérifiées, plus une quatrième qui n'en est pas tout à fait une. Toutes petites, et
toutes rendues visibles par ce lot.

**Le commentaire des capacités de Scalingo ment depuis le lot précédent.** Il annonce « Manuel, alors
que l'API sait inviter et retirer : le premier lot couvre le système sans jamais écrire dessus »
(`src/connectors/scalingo.ts:1187-1190`), alors que les deux déclarations qui le suivent
immédiatement portent `tier: "auto"` en tête de liste (`:1191-1198`). Il annonce aussi que le retrait
« attend d'abord que le socle sache dire à un connecteur sur quelles ressources agir », ce que
`SubjectRef` fait désormais (`docs/architecture.md:950-958`). Le commentaire se réécrit sur ce qui
reste vrai : les deux voies coexistent, l'automatique quand le credential est là, la manuelle sinon.

**`SCALINGO_API_TOKEN` manque au tableau des variables de déploiement.** Le schéma le connaît
(`src/lib/env.ts:69`), `.env.example` le porte (`:157`), et le tableau de
`docs/deploiement.md:520-532` ne liste que `GITHUB_TOKEN` et `NOTION_SCIM_TOKEN`. Ce lot le rend
portant : sans lui, l'écran affiche le parc, qui vient de la base, et pas un geste ne part.
`GITHUB_ADMIN_TOKEN` manque au même tableau, et ne figure que dans `.env.example:124` ; la même ligne
le répare. Tant qu'on y est, la liste de `CLAUDE.md:151-154` se dit « fait foi sur la liste
attendue » en nommant onze variables et en oubliant les quatre jetons de connecteur.

**La version de Prisma annoncée par `CLAUDE.md` est fausse.** La ligne dit 7.9.1 (`CLAUDE.md:27`),
`package.json` porte `^7.10.0` (`:37`, `:38`, `:62`) et l'arbre installé résout en 7.10.0
(`node_modules/prisma/package.json`). Ce lot ajoute trois migrations, donc trois occasions de relire
cette ligne en la croyant.

**Une quatrième, facultative mais peu coûteuse.** L'écran a besoin de relire les métadonnées d'une
identité pour rendre l'invitation en attente, et la fonction qui les relit sans confiance existe
déjà, privée à un autre fichier (`src/app/comptes-isoles/page.tsx:25-43`). Elle monte dans
`src/ui/metadonnees.ts` et ses deux appelants l'importent, plutôt que d'en avoir deux copies dont une
seule sera corrigée le jour où la forme changera.

## Ce que ce plan ne fait pas

**Il ne rattache aucune application à une startup.** `Resource` ne porte rien qui désigne une startup
(`prisma/schema.prisma:276-288`), et la contenance que ce lot ajoute regroupe une ressource sous une
autre ressource du même système, jamais sous un objet du périmètre. L'écran groupe donc par projet
Scalingo et par rien d'autre : la question « quelles applications appartiennent à telle startup »
reste sans réponse ici, et y répondre demanderait un axe de rattachement que personne n'a encore
décidé de constater ni de déclarer. Le dire ici évite qu'on lise le groupement par projet comme s'il
y répondait.

**Il ne couvre pas les autres porteurs d'accès d'une application.** Retirer un collaborateur ne
change ni les variables d'environnement, ni les identifiants des bases, ni les clés SSH, et le mot de
passe de l'utilisateur par défaut d'une base passe par le support du fournisseur ;
`docs/architecture.md:960-966` l'a déjà acté, et c'est pourquoi le connecteur émet deux étapes au
départ, la coupure et la rotation des secrets. Ce lot ne change rien de ce côté : l'écran montre les
collaborations, pas ce qu'un ancien collaborateur a pu emporter. Une ligne sans accès n'est pas une
application sans risque.

**Il ne réveille pas `onOffboard`.** Le champ existe sur `Reference` (`prisma/schema.prisma:322`)
avec ses trois valeurs, `docs/architecture.md:437-439` lui donne un sens, et **rien ne le lit ni ne
l'écrit hors du code généré**, vérifié sur l'ensemble de `src/`. Le modèle `Reference`, lui, est bien
vivant (`src/app/personnes/[username]/edition.ts:190`, `:554`). Scalingo ne produit aucune
`Reference` et ce lot n'en produira pas davantage : la colonne morte reste morte, et elle est nommée
ici pour qu'on ne la découvre pas en croyant qu'elle décidait quelque chose.

**Il ne corrige pas le fait que le socle connaît déjà un connecteur par son nom.**
`src/core/rapprochement.ts:147` branche sur `identite.provider === "github"` pour tenter le
rapprochement par login, et la méthode qui en sort est gravée dans l'énumération de la base
(`prisma/schema.prisma:234`). C'est une entorse à la règle qui veut qu'un connecteur se déclare et
que le socle ne le connaisse pas, elle est antérieure à ce lot, et rien ici ne l'aggrave : Scalingo
ne rend jamais qu'une adresse (`src/connectors/scalingo.ts:1168-1173`) et se rapproche par
`EMAIL_EXACT`, sans branche nominale. La corriger demanderait de déplacer la méthode de rapprochement
dans le contrat, donc une migration d'énumération, donc sa propre décision.

**Il ne montre pas l'échéance d'un jeton sur la page du système.** Un jeton émis est un
`ServiceAccount` de `provider` `scalingo`, donc il apparaîtra sans aucun travail d'écran dans la
section « Comptes de service » de `src/app/systemes/[cle]/page.tsx:50-61`, qui filtre exactement
là-dessus. Mais la colonne que cette table rend est la **revue**, calculée sur `reviewEveryDays` et
`lastReviewedAt` (`:172-197`), et non l'échéance, qui est le seul mécanisme de reprise dont ce lot
dispose. Tel quel, la page afficherait « à jour » d'un jeton expiré. Rendre l'échéance dans cette
table appartient à la section sur l'émission de jetons ; si elle ne le fait pas, l'écart doit être
nommé avant la livraison plutôt que découvert dessus.

**Il ne rend pas l'écran configurable.** Scalingo n'a pas de `configSchema` et ce lot ne lui en donne
pas : la région n'est pas un réglage, elle se découvre par `GET /v1/regions`, et figer des cibles
serait une régression silencieuse à la prochaine région. La page de connecteur affichera donc
« Ce connecteur ne se règle pas » (`src/app/systemes/[cle]/page.tsx:109-110`) au-dessus d'un écran
bien rempli, ce qui est exact et mérite de ne pas être pris pour un défaut.

## Les amendements à docs/architecture.md

Le document est la source de vérité et ne se modifie pas sans validation explicite. Chacun de
ces amendements est une proposition, à valider une par une avant toute édition.

- **§3.2 Constate (docs/architecture.md:419-421)** : L'entree Resource y enumere quatre colonnes, provider, externalId, label, url. La contenance en ajoute une cinquieme, parentId facultative et auto-referente, et ObservedResource gagne parentExternalId. Le paragraphe doit dire qu'un contenant est une ressource ordinaire, qui peut porter ses propres acces comme n'en porter aucun, et que la contenance n'ouvre ni ne coupe aucun droit.
- **§3.4 Le dossier et le plan (docs/architecture.md:464-556)** : Le texte fait du dossier l'unique entree d'un plan. Il doit nommer le geste hors dossier : un plan MANUAL_OP sans accessCaseId, portant subjectId (relation Restrict) et intent (l'intention gelee : systeme, scope, terme, justification), qui est a son recalcul d'empreinte ce que AccessCase.profileKey est a une arrivee. Et dire qu'un tel geste est refuse tant qu'un depart est ouvert sur la personne.
- **§5.6 Invariants, sous « Execution » (docs/architecture.md:840-847)** : Ajouter la cle d'engagement : une etape d'octroi en porte une si et seulement si ce qu'elle ouvre ne reparaitra pas dans le CollectResult du connecteur qui l'a emise. Sans cle, le depart retrouve l'acces par la collecte ; avec cle, par l'etape qui l'a ouvert. La frontiere est par action et non par systeme. Le socle transporte la cle sans jamais l'interpreter.
- **§5.4 Interface d'execution (docs/architecture.md:793-815)** : PlannedStep gagne la cle d'engagement, chaine facultative que le connecteur remplit. A poser la, aupres du reste du contrat, et non dans la section du plan.
- **§5.5 Ou vivent les credentials (docs/architecture.md:816-830)** : La regle y prescrit deja fgp pour un credential a portee large non cloisonnable, ce qui decrit le jeton Scalingo, declare env. La section doit nommer fine-grained-proxy comme dispositif reellement employe, dire ce que l'emission d'un jeton restreint produit (url, cle client affichee une fois, blob), et acter qu'aucune revocation ni introspection n'existe cote proxy, d'ou l'echeance obligatoire comme seul mecanisme de reprise.
- **§5.9 Premiers connecteurs implementes, entree scalingo (docs/architecture.md:945)** : « sur les deux regions » fige un nombre que le code ne fige pas : lireRegions les demande (scalingo.ts:492-514). A reformuler en « sur toutes les regions que le fournisseur annonce », d'autant que la decision de ne pas figer trois cibles de blob s'appuie sur ce comportement.
- **§3.2 Constate, entree ServiceAccount (docs/architecture.md, section 3.2)** : Un jeton emis par le proxy se modelise en ServiceAccount, ce qui lui ajoute le blob, la cible, les scopes, l'echeance et l'operateur emetteur. Le document doit dire pourquoi cette table plutot qu'une nouvelle, et que la cle client ne s'y stocke jamais.
- **§3.2 Constaté (PostgreSQL), paragraphe Resource (docs/architecture.md:419-421)** : Ajouter que Resource porte desormais sa contenance : une ressource peut en contenir d'autres, sur un seul niveau, par une cle etrangere nullable vers la meme table, en SetNull parce que la cascade emporterait les acces des contenues. Dire que nul est le cas normal, qu'un contenant est une ressource ordinaire qui peut porter ses propres acces (l'organisation GitHub) ou n'en porter aucun (un projet Scalingo), et que la contenance n'ouvre ni ne coupe aucun droit : elle n'entre dans aucun plan, aucune empreinte, aucune etape.
- **§5.6 Invariants, paragraphe Collecte (docs/architecture.md:833-838)** : Ajouter la regle du socle sur la contenance : un contenant absent du releve, une ressource qui se contient elle-meme ou une contenance a plus d'un niveau ecartent la contenance sans ecarter la ressource, et rendent le run non ok. Jeter la ressource ferait tomber chacun de ses acces dans « acces sur une ressource absente de la collecte », donc perdrait ce que l'outil existe pour savoir, la ou une contenance perdue ne coute rien puisqu'elle n'ouvre aucun droit. Preciser que les trois refus se jugent sur ce que le connecteur a declare et non sur ce qui survit aux deux autres.
- **§2.2 Une collecte en un appel, apres le paragraphe sur les deux declencheurs du plancher (docs/architecture.md:159-173)** : Une phrase sur le plancher applique aux ressources : il compte les deux cotes par les acces portes, ce que la base tient pour vivant comme ce que le releve rend, de sorte qu'une ressource qu'aucun acces ne vise (un contenant, une equipe vide) ne pese sur aucun des deux et ne puisse pas masquer une chute reelle.
- **§5 Contrat de connecteur, la ou ObservedResource serait decrit (le document ne le decrit nulle part aujourd'hui)** : Si l'ADR 0002 ne suffit pas, poser en une phrase que le releve declare la contenance par la contenue et par une cle, jamais par un objet imbrique ni par un contenant qui enumererait ses contenues : la cle est deja la monnaie du contrat pour designer une ressource depuis un acces, et une seconde maniere de la designer serait une seconde maniere de se tromper.
- **§3.4 Le dossier et le plan, apres le paragraphe sur les etapes figees (docs/architecture.md:496-500)** : Introduire la cle d'engagement : une etape d'octroi la porte si et seulement si ce qu'elle ouvre ne reparaitra dans aucun CollectResult du connecteur qui l'a emise. Dire que le socle la transporte sans jamais l'interpreter, que la regle est une regle de connecteur qu'aucune couche generique ne peut tenir, et nommer les deux fautes symetriques : la cle de trop fait deux etapes de coupure sous deux cles d'idempotence que le dedoublonnage ne rapproche pas, la cle qui manque laisse un acces que plus rien ne nomme.
- **§3.4, sur le calcul d'un plan de depart** : Ecrire que le depart lit deux sources et non une : les acces constates, et les engagements ouverts retrouves sur les etapes qui les ont ouverts. Poser la regle « le dernier geste solde gagne » plutot qu'un ensemble de cles fermees, et dire qu'un engagement dont le terme est passe est repris, l'echeance etant le seul mecanisme de reprise quand le systeme emetteur n'offre aucune revocation.
- **§2.3, apres « Ce qui coupe des acces reste le dossier de depart » (docs/architecture.md:290-291)** : Ajouter la phrase symetrique, pour que le geste hors dossier ne se lise pas comme une breche : ce qui ouvre un acces hors d'un dossier reste un plan, avec sa justification nominative, son empreinte, sa confirmation et son journal, et il est refuse tant qu'un depart est ouvert sur la personne.
- **§3.3 Decide (docs/architecture.md:445-463)** : Dire pourquoi Plan.subject est en Restrict la ou tout le reste du schema cascade : une etape de geste est la seule trace d'un acces qu'aucune collecte ne rendra, et l'effacer avec la fiche laisserait l'acces ouvert et l'outil muet. Mentionner la consequence : la fusion de fiches doit deplacer ces plans avant de supprimer la source.
- **§5.x Contrat de connecteur, la ou SubjectRef est decrit** : Acter que le bras person de SubjectRef porte, pour un depart, les engagements ouverts sur le systeme interroge, et que ConnectorContract ne change pas : c'est ce qu'un sujet porte qui s'elargit, pas ce qu'un connecteur declare. Preciser que la liste des connecteurs interroges au depart ne se limite plus aux systemes ou la personne est observee, un engagement pouvant exister sans aucun compte constate.
- **§2.4 Comptes non humains** : Le paragraphe pose ServiceAccount comme un modele « avec une revue periodique au lieu d'une echeance ». Un jeton emis derriere le proxy porte les deux : une revue, et un terme qui le tue tout seul, parce que rien ne sait le revoquer. Amender pour dire qu'un compte machine peut naitre d'une decision et mourir de lui-meme, et que sa fiche porte alors ce qu'il faut pour le reconnaitre plus tard : le blob inerte, la cible unique, les scopes, le terme et l'operateur emetteur.
- **§3.5 Reconstructibilite** : Le perimetre de sauvegarde critique compte quatre familles, et chacune se rattrape par le journal ou par un depot. Un blob emis n'entre dans aucune : la collecte ne le redevinera pas, le journal ne doit pas le porter (il vaudrait credential), le proxy n'en garde aucune trace, et il ne se reemet pas puisque l'ancien ne se revoque pas. C'est la premiere chose du systeme qu'un dump perdu detruit sans recours. A acter explicitement, ou a arbitrer autrement.
- **§5.9 Premiers connecteurs implementes** : Le paragraphe scalingo decrit un connecteur qui n'ecrit que des collaborateurs. Il gagne une capacite d'une autre nature, qui a demande au socle une troisieme chose qu'aucun connecteur n'avait exigee : qu'une etape puisse remettre un credential a ranger et une moitie a montrer une seule fois, et qu'une etape d'octroi puisse declarer que ce qu'elle ouvre ne reparaitra dans aucune collecte.
- **§5.3 Fonctionnalités propres à un connecteur, sous-partie « Où cela vit » (docs/architecture.md:765-769)** : Preciser qu'un ecran de connecteur n'est pas reserve a une fonctionnalite hors socle : il peut exister sans `configSchema` et sans `ConnectorFeature`, pour rendre lisible ce que la collecte a ecrit sur ce systeme. C'est la troisieme branche de `aUnePage`, et c'est celle par laquelle Scalingo obtient sa page. Preciser aussi qu'un tel ecran lit le constate, ce qui le distingue d'une tuile, dont §5.3 dit deja que rien de ce qu'elle affiche ne peut fonder une decision de coupure.
- **§5.8 Catalogue, ligne `scalingo` du tableau et paragraphe qui la commente (docs/architecture.md:891, :900-905)** : Remplacer « une liste plate de collaborations » par une formulation qui tient apres la contenance : les collaborations restent au niveau de l'application, et les applications se regroupent par projet sans qu'un projet ait de membres. Completer l'objet de la ligne du tableau, qui ne dit que « collaborateurs par application, sur les deux régions », par le changement de role et l'emission de jetons.
- **§3.5 Reconstructibilité, l'affirmation de sauvegarde elle-même** : Le paragraphe ne dit pas seulement que le périmètre critique compte quatre familles, il affirme que tout le reste se reconstruit en rejouant les connecteurs. Un blob émis en fait une cinquième, et cette affirmation devient fausse : aucune collecte ne le rend, aucun rejeu ne le refabrique, le proxy n'a pas de route d'introspection, et il ne se réémet pas puisque l'ancien ne se révoque pas. Ce n'est pas une omission dans une liste, c'est une phrase de sauvegarde qui ne tient plus : à amender comme telle, ou à arbitrer en décidant que le blob ne vit pas ici.
- **§5.5 Où vivent les credentials, la phrase sur fine-grained-proxy** : La section affirme que derrière `fgp` « l'application ne détient jamais le jeton amont ». Vrai du cas OVH, qui est celui qu'elle décrit, et faux de l'usage Scalingo introduit ici : l'instance détient le jeton de compte entier, s'en sert pour la collecte, et l'envoie en clair au proxy à chaque émission. La note de portée du credential `scalingo:fgp` dit déjà l'inverse dans le même dépôt (`src/connectors/scalingo.ts`), et deux phrases contradictoires sur ce que le dispositif protège valent moins qu'une seule qui distingue les deux emplois. À amender pour dire que `fgp` rétrécit ce que peut faire le porteur d'un blob, jamais ce que peut faire l'instance qui l'a émis, et que l'affirmation d'origine ne vaut que là où le jeton amont n'est pas déjà celui de la collecte.
- **§5.9 Premiers connecteurs implémentés, paragraphe `scalingo` (docs/architecture.md:946-975)** : Ajouter ce que ce lot apprend au socle par ce connecteur : la contenance comme forme du constate, et la frontiere de la cle d'engagement, qui separe ce qu'une collecte relira de ce qu'aucune API ne listera jamais. Scalingo est le premier systeme a tomber des deux cotes de cette frontiere, un collaborateur invite se relisant, un jeton emis non.
- **§5.4 Interface d'exécution (docs/architecture.md:793-815)** : La section montre `execute` rendant un `StepOutcome` et ne dit rien de ce qu'une étape peut remettre. Sa branche de succès porte désormais un credential émis, parce qu'aucun fichier de `src/connectors/` n'accède à la base et qu'il ne le doit pas : c'est le socle qui écrit le compte machine, et le connecteur qui le lui remet. À dire aussi, parce que c'est la seule règle de ce lot qu'aucun type ne tient : la moitié périssable ne descend pas là où l'autre se range, elle remonte jusqu'à l'écran par le résultat d'exécution, et elle n'entre ni dans `evidence`, qui devient le motif journalisé de l'étape dans un journal à rétention indéfinie, ni dans aucune valeur de formulaire que la revalidation rejouerait. L'écran qui la rend est le dernier endroit au monde où elle existe, et le journal de l'émission ne porte que ce qui se reconnaît plus tard : le système, le détenteur, la cible, les scopes et le terme.

## Ce que la rédaction a fait remonter

Huit points sont sortis de la rédaction et dépassaient ce qui avait été décidé. Trois ont été
arbitrés depuis et figurent en tête de document, sous « Ce qui a été tranché » : le comptage du
garde-fou, l'extension du contrat de connecteur, et le terme appris à la revue. Les cinq autres sont
des conséquences sans alternative raisonnable, appliquées telles quelles. Le détail de chacun reste
ici, parce que c'est lui qui explique pourquoi.

**Le garde-fou de chute est dégradé par la contenance, sauf resserrement.** Un contenant Scalingo ne
porte aucun accès, donc il n'entre jamais dans la référence de `ressourcesTenuesPourVivantes`
(`src/lib/sync/collecte.ts:239-243`), mais il entre bien dans le relevé, compté par
`lu.resources.length` (`:375-381`). Il gonfle un seul des deux côtés, donc il masque une chute
réelle. Avec le seuil par défaut de deux dixièmes : vingt applications toutes pourvues d'un accès
posent un plancher à seize, une nuit à douze applications déclenche aujourd'hui, et ne déclencherait
plus avec six projets émis à côté. La décision « la contenance ne pèse sur aucun droit » est donc
fausse en l'état. Le plan propose de compter les deux côtés par les accès portés plutôt que par les
ressources émises. C'est un resserrement : il fera mordre le garde-fou dans des cas où il ne mordait
pas, ce qui ressemblera à une régression pour qui ne sait pas pourquoi.

**Un `.catch(null)` sur le champ `project`, au-delà de ce qui a été décidé.** Déclaré seulement
facultatif et nullish, un `project` présent mais de forme neuve (un identifiant nu à la place de
l'objet) ferait échouer le parse de l'application entière, donc sortirait l'application du relevé,
donc daterait tous ses accès comme disparus. C'est exactement ce que le commentaire du schéma refuse
(`src/connectors/scalingo.ts:86-93`). Avec le repli, un projet illisible se lit comme un projet
absent, et c'est la surveillance de champ facultatif qui le rapporte.

**`Plan.subjectId` en `Restrict` casse la fusion de fiches.**
`src/app/personnes/[username]/edition.ts:563` supprime la fiche source en fin de fusion, et
`src/core/fiche-manuelle.ts:263-281` n'a aucune étape pour déplacer un plan hors dossier. Fusionner
une fiche portant un geste lèverait une violation de clé étrangère au milieu de la transaction, sans
aucun avertissement dans l'aperçu. L'union `EtapeFusion` doit donc gagner un déplacement des gestes
dans ce lot, sinon `Restrict` casse la fusion.

**Une personne peut détenir un jeton sans être collaboratrice d'aucune application.** `interroge`
(`src/lib/dossier.ts:158-167`) n'interroge, pour un départ, que les connecteurs où la personne est
observée avec un rattachement sûr. Une telle personne ne serait interrogée sur aucun système, et
l'engagement retomberait dans le trou muet que la clé existe pour boucher. La condition doit devenir
« présente ou engagée ».

**La garde d'empreinte est tautologique sur un jeton restreint.** Ses paramètres viennent tous de
l'intention gelée, donc l'empreinte recalculée est égale à l'empreinte confirmée par construction.
Elle mord bien sur un accès de collaborateur, dont le bénéficiaire vient de la base
(`src/connectors/scalingo.ts:902`, `:915`), pas sur celui-là. Le plan l'écrit plutôt que de laisser
croire que la garde protège les deux.

**L'union discriminée casse un test et ferait mentir un écran.**
`src/ui/connecteurs/scope-attendu.test.ts:9-21` exige pour chaque connecteur du registre que les
clés inconnues soient refusées, or `z.toJSONSchema` d'une union discriminée rend un `oneOf` sans
`additionalProperties` à la racine. Sans correction de `src/ui/connecteurs/scope-attendu.ts`, l'écran
des systèmes afficherait « Aucun champ de scope » pour Scalingo. La correction n'est pas optionnelle.
Au passage, la formulation « l'outil refuse au démarrage » était fausse : le refus tombe à la
vérification de la politique, au choix d'un profil et à l'ouverture d'un dossier, pas au démarrage.

**Une échéance sur un `ServiceAccount` entre en conflit avec la revue.** `src/core/revue.ts:42-56`
ne connaît aucun terme, si bien qu'un jeton mort resterait indéfiniment « revue en retard »,
c'est-à-dire le signal qui ne s'éteint jamais. Deux lectures doivent changer dans le même lot
(`src/lib/inventaire.ts:93`, `src/app/comptes-de-service/page.tsx:39-40`). Et un jeton expiré
apparaîtrait « à jour » sur `/systemes/scalingo`, dont la table ne rend que la revue
(`src/app/systemes/[cle]/page.tsx:172-197`).

**Aucun connecteur n'accède à la base, et l'émission doit y écrire.** Vérifié : aucun fichier de
`src/connectors` n'importe `@/lib/db`. Lui en ouvrir l'accès ferait du contrat de connecteur une
façade. L'écriture revient donc au socle, ce qui impose d'étendre `StepOutcome` et
`ResultatDExecution` pour qu'une étape puisse remettre un credential à ranger et une moitié à
montrer une seule fois. C'est une modification du contrat de connecteur, pas seulement une migration
additive, et c'est le poste que la décision d'origine ne prévoyait pas.

**Deux corrections factuelles.** Le changement de rôle ne se réduit pas à élargir la méthode HTTP :
le précheck rend `STALE` quand le rôle diffère (`src/connectors/scalingo.ts:856`) et le socle ne
reprend jamais une étape `STALE` en l'exécutant (`src/lib/execution.ts:33-39`), donc
`constaterCollaboration` doit changer. Et une garde a été oubliée dans le décompte :
`recalculerPlan` (`src/app/dossiers/[id]/actions.ts:833-835`) refuse tout plan sans dossier, ce qui
laisse un brouillon de geste obsolète sans autre issue que de reposer le geste. Elle reste fermée
dans ce lot, mais c'est un trou du découpage à acter.
