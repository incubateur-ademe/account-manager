# Ce qu'un connecteur sait d'un compte isolé (#28)

> Plan d'implémentation de l'issue #28. Le ticket porte le quoi et le pourquoi, ce document porte
> le comment.

## Ce qui existe aujourd'hui

### Le contrat sait déjà dire une ressource et un accès

**La collecte parle en quatre formes fermées, sans point d'extension.** `ObservedIdentity`
(`src/core/connector.ts:123-130`) porte cinq champs, dont `emails?` et `lastActivityAt?` ;
`ObservedResource` (`:132-136`) en porte trois ; `ObservedGrant` (`:138-143`) quatre ;
`CollectError` (`:145-149`) ferme la liste. Aucune n'accepte de champ libre, et `CollectPayload`
(`:151-156`) n'est même pas exportée.

**Une ressource est ce sur quoi un accès porte, et rien ne dit que c'est un dépôt.**
`ObservedResource` n'a ni type ni nature : un identifiant, un libellé, une adresse. Le connecteur
GitHub ne s'en sert que pour l'organisation elle-même (`src/connectors/github.ts:187-191`), avec le
libellé « Organisation incubateur-ademe » que le ticket cite mot pour mot.

**L'invariant du run est porté par le type, et il est asymétrique.** `CollectResult`
(`src/core/connector.ts:158-162`) : `ok` implique `errors?: undefined`, `partial` porte les erreurs
**et** la charge, `failed` porte les erreurs et pas la charge. Un run en échec n'écrit donc rien
(`src/lib/sync/collecte.ts:280-285`), garantie dont hérite tout champ nouveau d'`ObservedIdentity`.

### Le connecteur GitHub jette des octets qu'il a déjà payés

**Trois séquences paginées, une seule organisation.** `ORGANISATIONS` vaut `["incubateur-ademe"]`
(`src/connectors/github.ts:22`). `lireOrganisation` (`:103-140`) demande
`/orgs/{org}/members?role=admin`, puis `role=member` (`:109`), puis `/orgs/{org}/invitations`
(`:120`), chacune via `lireTout` (`:57-101`) qui pagine à cent et s'arrête au premier lot incomplet.
Au parc réel, quatre-vingt-quinze comptes, chacune tient en une page : **trois requêtes par
collecte**.

**Ce que le code retient d'un membre tient en deux champs, et l'interface le dit.** `MembreApi`
(`:30-33`) ne déclare que `id` et `login`, et la boucle ne pose que `externalId`, `idKind` et
`handle` (`:111-114`). La réponse `simple-user` contient aussi `type`, qui vaut `User` ou `Bot` et
distingue donc un robot d'une personne, plus `site_admin`. Les deux sont jetés sans être lus.

**Une invitation est déjà collectée, et tout ce qui la rend décidable est perdu.** `InvitationApi`
(`:35-40`) déclare `id`, `login`, `email` et `role` ; `lireOrganisation` en fabrique une identité et
un accès `invite:<role>` (`:122-139`). La réponse `organization-invitation` porte, **dans le même
appel et sans coût supplémentaire**, `created_at`, `inviter`, `team_count`, `failed_at` et
`failed_reason` : « invité le 3 mars 2026 par camille.rivet » est déjà téléchargé, et jeté.

**Le rôle d'organisation, lui, est déjà un accès.** La boucle sur `["admin", "member"]` (`:108`)
pose le rôle constaté dans `ObservedGrant.role` (`:114`), qui devient la moitié gauche de « member
sur Organisation incubateur-ademe ». Une organisation illisible remplit `erreurs` (`:192-200`), et
la règle de statut compare `erreurs.length` au nombre d'organisations (`:203`) : à une seule
organisation, la moindre erreur rend `failed` (`:203-205`) et le chemin `partial` (`:214-220`) est
aujourd'hui inatteignable.

### Le socle écrit moins que ce que le contrat porte

**`enregistrerIdentites` persiste deux champs sur cinq, et rien ne le signale.**
`src/lib/sync/collecte.ts:54-59` construit `commun` avec `handle`, `idKind`, `lastSeenAt` et
`vanishedAt`, puis relit et écrit (`:63-76`). **`emails` et `lastActivityAt` sont collectés puis
jetés.** La conséquence est mesurable : `rapprocherIdentites` projette
`{ id, provider, externalId, handle }` (`src/lib/sync/rapprochement.ts:24-27`), donc
`IdentiteObservee.emails` (`src/core/rapprochement.ts:33-38`) est toujours vide et la branche
`EMAIL_EXACT` (`:167-176`) ne travaille que sur le `handle`. C'est exactement la classe de défaut
que ce ticket corrige, et elle existe déjà en un autre exemplaire.

**Un accès sait déjà oublier ce que le connecteur ne dit plus** : `enregistrerAcces` écrit
`lastActivityAt: grant.lastActivityAt ?? null` (`:182`), donc la valeur du jour écrase, l'absence
comprise. Le patron existe, à un seul endroit.

**Les disparitions ne se datent que sur un run `OK`.** `src/lib/sync/collecte.ts:300-326` :
`chuteExcessive` (`src/core/collecte.ts:10-15`) rétrograde en `PARTIAL` sans rien dater, sinon les
identités absentes de la charge reçoivent `vanishedAt` (`:310-313`) et les accès non revus suivent
par `lastSeenAt: { lt: now }` (`:316-323`). Une identité absente d'un run n'est jamais mise à jour :
la boucle d'écriture n'itère que la charge. Un accès qui ne vise rien de précis est raccroché à une
ressource synthétique sous la clé réservée `(systeme)` (`:117`, `:119-131`). Et `tracer`
(`:343-354`) pose le `ResultatCollecte` entier dans `AuditEvent.after` : ce que ce type porte, le
journal le garde pour toujours (`docs/architecture.md:304-306`).

### L'écran des comptes isolés tient en trois lignes

**C'est le seul endroit du dépôt où un `AccessGrant` est lu pour être affiché.** La requête prend
les accès vivants avec leur rôle et le libellé de leur ressource
(`src/app/comptes-isoles/page.tsx:37-41`), et la mise en forme les réduit à une chaîne :
`` `${acces.role} sur ${acces.resource.label}` `` (`:67`). Ailleurs, `AccessGrant` n'est qu'écrit.

**Le contrat de données entre le serveur et le client est déjà entièrement textuel.**
`LigneCompteIsole` (`src/app/comptes-isoles/FileDesComptesIsoles.tsx:14-22`) ne porte que des
chaînes et un booléen, et le commentaire de la page dit pourquoi (`page.tsx:51-52`) : la même chaîne
traverse jusqu'au client, là où deux `Intl` de fuseaux différents feraient diverger le rendu.

**La modale porte déjà le contexte de décision, en un paragraphe.**
`FileDesComptesIsoles.tsx:126-129` : « Accès constatés : … Observé depuis le …, encore le … ». Le
commentaire du composant (`:26-35`) et le plan du lot (`docs/plans/lot-1.5_interface.md:245-247`)
disent tous deux que c'est en regardant les accès qu'on décide. C'est la ligne qu'enrichit #28.

**La fiche d'une personne montre ses comptes sans lire un seul accès.** La requête prend `id`,
`provider`, `handle`, `matchMethod`, `lastSeenAt` et `vanishedAt`
(`src/app/personnes/[username]/page.tsx:103-113`), et `CompteExterne`
(`src/app/personnes/[username]/SectionComptesExternes.tsx:11-18`) n'a pas de champ pour davantage.

### Les pièges déjà présents dans le code

1. **Une cellule de tableau ne se renvoie pas à la ligne.** `white-space: nowrap` est posé sur
   `.tableBodyRowCol` (`src/ui/TableCustom.module.css:39-45`, la règle est à la ligne 43) et sur
   `.tableHeadCol` (`:17-25`). Un contenu long n'y descend pas d'une ligne : il élargit la table,
   que `.table { overflow: auto }` (`:1-3`) fait défiler horizontalement.
2. **La clé de ligne de `TableCustom` est fragile, et l'écran s'en protège déjà.** `cleDeLigne`
   (`src/ui/TableCustom.tsx:90-96`) ne lit que les cellules dont les `children` sont du texte et
   retombe sinon sur le rang, faisant suivre l'état des composants montés au rang plutôt qu'à la
   donnée. `FileDesComptesIsoles` passe `key: ligne.id` (`FileDesComptesIsoles.tsx:56`), et cette clé
   se conserve.
3. **Aucun test ne touche ce chemin.** `src/core/connector.test.ts` fait quatre-vingt-trois lignes
   et ne teste que `resolveCapability`. Il n'existe aucun `src/connectors/*.test.ts`, aucun test de
   `executerCollecte`, et `vitest.config.ts:11-15` fixe `environment: "node"` avec
   `include: ["src/**/*.test.ts"]`, ce qui exclut jusqu'aux fichiers `.tsx`.

## Décisions de conception

**D1. Ce qui est un accès reste un accès : une équipe est une ressource, son appartenance est un
accès.** Le ticket demande « l'appartenance à un groupe, une équipe ou un projet », et c'est ce que
le contrat sait déjà dire. Une équipe a un identifiant, un libellé et une adresse : c'est
`ObservedResource` (`src/core/connector.ts:132-136`). Y appartenir a un titulaire, une cible et un
rôle : c'est `ObservedGrant` (`:138-143`). Les remonter ainsi fait apparaître
« member sur Équipe produit-alpha » à côté de « member sur Organisation incubateur-ademe », dans le
champ qui existe déjà (`src/app/comptes-isoles/page.tsx:67`), sans une colonne de base ni une ligne
de contrat. Le ranger en métadonnée libre en ferait une donnée que rien ne réconcilie, que
`vanishedAt` n'atteint pas et qu'aucun plan ne lira jamais ; `docs/architecture.md:273-275` dit la
même chose par l'autre bout, les métadonnées vivent sur la ressource et pas sur l'accès. Découper le
ticket, garder ici la colonne et les métadonnées et renvoyer les équipes à un ticket suivant, est
examiné et refusé : l'objectif du ticket dit que c'est l'appartenance à une équipe qui départage, et
sur le seul connecteur implémenté, ce qui reste, un type de robot et une date d'invitation, ne
départage rien. #28 livré sans les équipes tiendrait sa lettre et manquerait sa raison. Le coût de
collecte qui en découle est chiffré en D5 et la règle de statut qu'il oblige à rouvrir est écrite à
l'étape 4, plutôt que laissée à un ticket qui n'existe pas.

**D2. Les métadonnées ne portent que ce qu'aucune ressource et aucun accès ne dit.** Il reste trois
candidats, et deux seulement laissent une métadonnée. Le type de compte, utilisateur ou robot, ne
porte sur rien et n'a pas de rôle : c'est une métadonnée, et `type` arrive déjà dans la réponse, jeté
par une interface qui ne le déclare pas (`src/connectors/github.ts:30-33`). L'invitation en attente
est déjà un accès, `invite:<role>` (`:137`) ; ce qui manque sont les circonstances que cet accès ne
dit pas, sa date, son auteur, le nombre d'équipes qu'elle vise et son échec s'il y en a un, tous
arrivés dans les mêmes octets. L'administration de l'organisation, en revanche, **n'en est pas
une** : le rôle de l'accès la porte déjà (`:108`, `:114`), et `site_admin` désigne le personnel de
GitHub, pas elle (R7 du lot 1.5).

**D3. Une liste ordonnée de couples libellé et valeur, rédigée par le connecteur.** La forme est
`readonly { label: string; value: string }[]`, dans l'ordre où le connecteur veut qu'on la lise,
valeurs déjà mises en forme pour un humain. Le ticket exige que l'outil ne prétende pas les
interpréter : un `Record<string, unknown>` ferait l'inverse, puisque le socle devrait choisir
l'ordre des clés, traduire chaque clé en libellé et décider du rendu de chaque valeur.
L'alternative de la charge brute rendue par `DetailJson` (`src/app/journal/DetailJson.tsx:15-43`)
est écartée : ce composant rend un `JSON.stringify` indenté dans un `<pre>` (`:29-40`), soit des
clés en anglais, des dates ISO et des objets imbriqués. « Affiché tel quel » veut dire tel que le
connecteur l'a écrit, pas tel que l'API l'a sérialisé ; il reste le bon outil sur le journal, où
l'on inspecte et ne décide rien.

**D4. Les métadonnées vivent sur l'identité, jamais sur l'accès ni sur la ressource.**
`docs/architecture.md:273-275` est invoqué en D1 dans l'autre sens, et la nuance tient en une
incise : la règle y vise les métadonnées d'une ressource, pas celles d'un compte. Son argument de
non-duplication vise une ressource partagée par N personnes, dont le titre ne se recopie pas N
fois ; une métadonnée de compte, elle, est propre au compte. Sur
`AccessGrant`, elle serait recopiée autant de fois que le compte a d'accès, le cas que la règle
interdit.

**D5. Le coût de la collecte suit le nombre d'équipes, jamais celui des comptes.** Aujourd'hui trois
requêtes (`src/connectors/github.ts:109`, `:120`). Les équipes coûtent une séquence pour
`/orgs/{org}/teams`, puis une par équipe : à dix-neuf startups d'État, **vingt-trois requêtes au lieu
de trois**, et ce nombre monte avec les équipes, jamais avec les comptes. Les chemins qui coûteraient
une requête par compte sont refusés en bloc : `/users/{login}`, `/orgs/{org}/memberships/{username}`,
`/orgs/{org}/teams/{slug}/memberships/{username}`. À quatre-vingt-quinze comptes ils tiendraient sous
le plafond horaire d'un jeton, et c'est précisément pourquoi la règle s'écrit avant qu'un connecteur
suivant s'y engouffre. Le rôle en équipe est renoncé pour la même raison : il double les
séquences par équipe pour une nuance que le ticket ne demande pas. GraphQL rendrait tout en une
requête, mais réécrire `lireTout` (`:57-101`) ferait porter à une amélioration d'affichage le risque
d'une refonte de la pagination du connecteur entier.

**D6. Une colonne `Json` nullable sur `ExternalIdentity`, sur le patron de `PlanStep.manual`.** Le
dépôt compte six colonnes `Json`, toutes en `JSONB` : `SyncRun.error` (`prisma/schema.prisma:323`),
`PlanStep.params` (`:458`), `expectedState` (`:460`), `manual` (`:466`), `AuditEvent.before` et
`after` (`:557-558`). Le précédent le plus proche est `manual`, ajouté par une migration d'une seule
ligne (`prisma/migrations/20260818161504_marche_a_suivre_figee/migration.sql:2`) et commenté comme
une donnée dénormalisée que le socle rend sans la relire (`prisma/schema.prisma:462-466`).
L'alternative d'une table dédiée, indexable et historisée comme le reste du constaté, est rejetée :
une métadonnée n'est pas un objet sur lequel on agit, donc elle n'a ni apparition ni disparition à
dater ; l'historiser ajouterait un quatrième objet à réconcilier dans `executerCollecte`
(`src/lib/sync/collecte.ts:287-326`) ; et son seul lecteur lit par identité, jamais par valeur.

**D7. Le socle écrit ce que le contrat porte, et ce plan nomme ce qu'il continue de jeter.** Ajouter
un champ au contrat sans l'ajouter à l'objet écrit par `enregistrerIdentites`
(`src/lib/sync/collecte.ts:54-59`) reproduirait le défaut d'`emails` et de `lastActivityAt`. Ce plan
ne répare pourtant ni l'un ni l'autre, et le dit : persister `emails` demande une seconde colonne
**et** change l'issue du rapprochement, puisqu'un compte isolé qu'il traiterait désormais atterrirait
en `EMAIL_EXACT` au lieu de `HEURISTIC`, donc révocable (`src/core/rapprochement.ts:23-31`). Le stock
déjà rattaché, lui, ne bouge pas : la sélection ne reprend que `matchMethod: "NONE"`
(`src/lib/sync/rapprochement.ts:25`), et c'est ce qui rend le changement discret : il ne porte que
sur les comptes à venir, et aucun test ne le couvre. `lastActivityAt` n'a, lui, aucun lecteur. Ce que ce
plan ajoute est le garde-fou qui manquait : les champs constatés deviennent purs et testés, et leur
commentaire énumère ce qui n'est délibérément pas persisté. Un oubli silencieux devient un oubli
écrit.

**D8. Le dernier état constaté écrase, et un run qui n'a rien vu ne fait rien disparaître.** Ce que
le connecteur dit d'un compte qu'il vient de rendre est l'état du jour : si les métadonnées ont
changé, elles écrasent ; si elles ont disparu, elles s'effacent, comme
`lastActivityAt: grant.lastActivityAt ?? null` (`src/lib/sync/collecte.ts:182`). Conserver l'ancienne
valeur ferait afficher « invité le 3 mars 2026 par camille.rivet » le jour où GitHub renomme
`inviter` ou bien où une version du connecteur cesse de l'écrire, soit un mensonge daté au milieu
d'un écran de décision. Sur GitHub, le seul jeu des comptes n'en donne pas encore d'exemplaire : une
invitation acceptée n'est pas la même identité que le membre qu'elle devient, `invite-<id>` d'un côté
(`src/connectors/github.ts:123-125`) et l'identifiant du membre de l'autre (`:112`), donc elle
disparaît au lieu de revenir muette. La règle s'écrit avant son premier cas, seul moment où elle
coûte une ligne. L'invariant de `docs/architecture.md:516-519` reste tenu : un run `failed` n'écrit
rien (`src/lib/sync/collecte.ts:280-285`) et un run `partial` n'itère que sa charge, donc un compte
qu'il n'a pas vu garde tout ce qu'il avait.

**D9. Les métadonnées vont dans la modale, jamais dans une colonne du tableau.** La raison technique
se vérifie : `white-space: nowrap` sur `.tableBodyRowCol` (`src/ui/TableCustom.module.css:43`) fait
qu'un bloc de plusieurs lignes n'y descend pas, il élargit la table et la met à défiler. La raison de
conception est écrite ailleurs : la modale porte le contexte sur lequel on tranche
(`docs/plans/lot-1.5_interface.md:245-247`), et R5 veut qu'une explication se dise une fois par
écran. Elles rejoignent donc le paragraphe existant (`FileDesComptesIsoles.tsx:126-129`), en DSFR
strict et sans CSS (R8).

**D10. La cellule des accès en dit un et compte les autres, dans un ordre qui ne bouge pas.**
Conséquence directe de D1 : un compte membre de trois équipes verrait sa cellule tripler sur une
colonne qui ne se renvoie pas à la ligne. Elle affiche donc le premier accès et « et N autres », la
modale les liste tous. Encore faut-il que « le premier » désigne quelque chose : la requête n'ordonne
pas les accès (`src/app/comptes-isoles/page.tsx:37-41`), donc Postgres les rend dans l'ordre qu'il
veut et la cellule change d'un jour à l'autre sans qu'un octet ait bougé. Le tri se pose côté
serveur, sur l'`externalId` de la ressource puis sur le rôle : il est déterministe, et sur GitHub il
met l'organisation devant ses équipes, dont la clé la préfixe. Un compte sans aucun accès continue
d'afficher « aucun » (`src/app/comptes-isoles/FileDesComptesIsoles.tsx:77`, `:127`) : la chaîne
existe déjà et ne se remplace pas par du vide. Le décompte, lui, ne distingue pas une équipe d'une
organisation : le socle ne sait pas ce qu'est une équipe, et le lui faire deviner serait
l'interprétation que le ticket refuse.

**D11. Les chaînes sont fabriquées côté serveur, le client ne reçoit que du texte.**
`LigneCompteIsole` (`src/app/comptes-isoles/FileDesComptesIsoles.tsx:14-22`) gagne
`metadonnees: readonly { libelle: string; valeur: string }[]`, et rien d'autre : la convention est
explicite dans le code (`src/app/comptes-isoles/page.tsx:51-52`). Corollaire : c'est le connecteur
qui formate ses dates, avec son propre `Intl`, comme chaque écran déclare le sien. Sa sortie est
persistée mais refaite à chaque collecte, donc elle ne vieillit pas comme le libellé figé d'une étape
de plan (`prisma/schema.prisma:454-456`).

**D12. La fiche d'une personne ne reçoit rien.** Le ticket ne parle que de la modale des comptes
isolés, et la question qu'il pose, « à qui appartient ce compte », y est déjà tranchée : la fiche
montre des comptes rattachés. `SectionComptesExternes` ne lit aujourd'hui aucun accès
(`src/app/personnes/[username]/SectionComptesExternes.tsx:11-18`), et lui en donner ferait entrer
une donnée dont R1 demanderait aussitôt quel geste elle appelle.

**D13. Rien à toucher côté environnement, côté journal ni côté systèmes cibles.** Aucune variable
nouvelle : `GITHUB_TOKEN` existe, il est facultatif et son commentaire dit pourquoi
(`src/lib/env.ts:31-36`). Aucun appel écrivant n'est ajouté, `RunContext.dryRun` conserve sa valeur
`!env.ACTIONS_ENABLED` (`src/lib/sync/collecte.ts:255-262`) et `ACTIONS_ENABLED` reste à `false` :
il ne faut pas profiter de ce chemin pour y glisser un geste qui toucherait un fournisseur, il
contournerait le drapeau. Aucune action serveur nouvelle non plus, et `ResultatCollecte` ne gagne
rien : le porter au journal recopierait les métadonnées chaque nuit dans `AuditEvent.after`
(`:343-354`), à rétention indéfinie, dans un registre qui n'a pas à devenir un fichier du personnel.

**D14. Tension avec `docs/architecture.md` : réelle, sur un point que le document ne prévoit pas.**
La section 3.2 pose « On persiste le minimum nécessaire au calcul : ce qui sert de clé, ce qui sert
au rapprochement, ce qui déclenche », avec un filtrage à l'ingestion non négociable (`:251-255`).
Une métadonnée d'affichage ne sert **aucun** de ces trois usages : elle sert une décision humaine,
quatrième catégorie que le document ne nomme pas. La porte de la section 5.3 (`:466-474`) n'est pas
la bonne : sa règle est « si une fonctionnalité oblige à assouplir une règle du socle pour exister,
c'est qu'elle relève de cette section », or ce qui est ajouté ici passe par `ExternalIdentity` et
par le contrat commun, sans écran propre et sans rien assouplir. La proposition est donc d'amender
la section 3.2 en deux phrases : ce qui sert à décider
d'un compte se persiste au même titre que ce qui sert à le calculer, à trois conditions, être rendu
tel quel sans interprétation, n'être lu par aucun calcul, et ne jamais contenir une donnée
personnelle que le filtrage à l'ingestion écarterait. La section gagne aussi la ligne du champ dans
l'énumération d'`ExternalIdentity` (`:260-262`), aujourd'hui exhaustive. La modification est
**proposée à l'étape 7 et appliquée seulement après validation explicite**.

## Modèle de données

**Une seule migration, une seule colonne nullable, aucune reprise de données.**

```prisma
model ExternalIdentity {
  // le reste inchange

  // Ce que le connecteur sait du compte et qu'aucune ressource ni aucun acces ne
  // dit : type de compte, invitation en attente et son auteur. Une liste ordonnee
  // de couples libelle et valeur, deja redigee pour etre lue par un humain, rendue
  // telle quelle et jamais interpretee. Nulle quand il n'a rien a en dire.
  details Json?
}
```

`pnpm db:migrate --name metadonnees_de_compte` produit :

```sql
ALTER TABLE "ExternalIdentity" ADD COLUMN     "details" JSONB;
```

**Aucun index.** Rien ne lit cette colonne autrement que par la ligne qui la porte, et l'écran des
comptes isolés la ramène par la requête qui existe déjà (`src/app/comptes-isoles/page.tsx:21-42`).
Un index sur du `JSONB` qu'aucune clause `where` ne vise serait une écriture de plus par collecte.

**Aucun backfill, et c'est le sens même du constaté.** La colonne naît nulle sur les lignes
existantes et se remplit à la première collecte qui suit. L'écrire en migration fabriquerait un état
que personne n'a observé.

**Aucune autre modification de schéma.** Pas de table dédiée, pas de colonne sur `AccessGrant`, pas
de champ pour `emails` ni pour `lastActivityAt` : ces deux derniers relèvent de D7 et de leur propre
ticket, et les ajouter ici créerait deux colonnes que personne n'écrit encore.

**Piège de type, et ce n'est pas celui qu'on attend.** Le `readonly` du contrat passe sans qu'on
copie quoi que ce soit : `InputJsonArray extends ReadonlyArray<InputJsonValue | null>`
(`node_modules/@prisma/client/runtime/client.d.ts:1434`). Ce qui ne passe pas, c'est `null`. Le type
d'entrée d'une colonne `Json?` est `Prisma.NullableJsonNullValueInput | InputJsonValue`
(`src/generated/prisma/models/SyncRun.ts:304`), et lui affecter `null` rend
`Type 'null' is not assignable to type 'InputJsonValue | NullableJsonNullValueInput'`. Effacer une
métadonnée s'écrit donc `?? Prisma.DbNull`, qui pose un `NULL` SQL, et non `Prisma.JsonNull`, qui
écrirait le `null` JSON. Les deux seuls écrivains de `Json?` du dépôt contournent le problème par
omission, `error: … : undefined` (`src/lib/sync/collecte.ts:403`) et
`...(etape.manual ? { manual: etape.manual as object } : {})` (`src/lib/depart.ts:183`), et **aucun
des deux ne convient ici** : une clé omise sur un `update` conserve l'ancienne valeur, exactement ce
que D8 interdit.

**Rappel de discipline.** Toute modification du schéma exige `pnpm db:generate` puis un redémarrage
de `pnpm dev`. Le client généré et le client mis en cache sur `globalThis` servent sinon des
métadonnées périmées, et le symptôme attendu est littéralement `Unknown argument 'details'` au
premier enregistrement, pendant que le typecheck passe.

**Aucune modification de la politique.** Rien de ce qui est ajouté n'est déclaré : les organisations
visées vivent dans le connecteur et non dans le YAML, avec leur raison
(`src/connectors/github.ts:13-22`). `config/config.exemple.yaml` et `config/config.schema.json` ne
sont pas touchés, et `pnpm policy:schema` n'a pas à tourner.

## Découpage en étapes

### 1. Le contrat, en pur

Fichier : `src/core/connector.ts`.

```ts
export interface ObservedDetail {
  label: string;
  value: string;
}

// Seul champ nouveau d'ObservedIdentity, avec son commentaire :
/** Rendu tel quel, dans cet ordre, jamais interprété. Ce qui est un accès n'entre pas ici. */
details?: readonly ObservedDetail[];
```

`CollectPayload` (`:151-156`) et `CollectResult` (`:158-162`) sont inchangés : l'asymétrie du statut
`failed` couvre gratuitement le nouveau champ. Livrable vérifiable : `pnpm typecheck` passe et rien
dans l'application n'a changé de comportement.

### 2. Le schéma et la migration

Fichiers : `prisma/schema.prisma`,
`prisma/migrations/<horodatage>_metadonnees_de_compte/migration.sql` (nouveau).

Ajouter `details Json?` avec son commentaire, générer et appliquer la migration, relancer
`pnpm db:generate`, redémarrer `pnpm dev`. Relire le SQL produit : un seul `ALTER TABLE` avec un
seul `ADD COLUMN`, et **aucun `DROP`**. Livrable vérifiable : la colonne est en `jsonb` nullable, et
un `update` de contrôle avec `details` ne rend pas `Unknown argument 'details'`.

### 3. Le socle qui écrit, et le défaut qu'il nomme

Fichiers : `src/core/collecte.ts`, `src/core/collecte.test.ts`, `src/lib/sync/collecte.ts`.

La fabrication des champs constatés sort de `enregistrerIdentites`
(`src/lib/sync/collecte.ts:54-59`) et devient pure, à côté de `chuteExcessive`
(`src/core/collecte.ts:10-15`). La conversion `KIND` (`src/lib/sync/collecte.ts:39-43`) la suit :
`src/core` importe déjà des types d'énum générés ailleurs (`src/core/audit.ts:1`).

```ts
export function champsConstates(
  identite: ObservedIdentity,
  now: Date,
): { handle: string; idKind: IdKind; details: readonly ObservedDetail[] | null;
     lastSeenAt: Date; vanishedAt: null };
```

- `details` vaut `identite.details ?? null` : le dernier état constaté écrase, l'absence comprise
  (D8), sur le patron de `enregistrerAcces` (`src/lib/sync/collecte.ts:182`).
- Le commentaire de la fonction énumère ce qui n'est **pas** persisté, `emails` et `lastActivityAt`,
  avec la raison (D7). C'est le seul endroit du dépôt où cette liste existe.
- `enregistrerIdentites` l'appelle, et c'est là, au site d'écriture, que le `null` devient
  `Prisma.DbNull`. Nulle part ailleurs : `src/core` ne prend de Prisma que des types, comme
  `src/core/audit.ts:1`, et un import de valeur d'exécution y annulerait la pureté que cette étape
  achète.

Livrable vérifiable : le scénario 3 est vert, et une collecte relancée écrit les mêmes identités
qu'avant, `details` restant nul faute de connecteur qui en produise.

### 4. Les équipes, en ressources et en accès

Fichiers : `src/connectors/github.ts`, `src/connectors/github.test.ts` (nouveau).

La lecture se sépare de l'assemblage, et le statut cesse de se calculer sur un décompte
d'organisations. `lireOrganisation` (`:103-140`) reçoit son lecteur en paramètre, ce qui rend le coût
observable en test sans réseau, l'assemblage devient pur, et une troisième fonction porte le statut :
`Connector.list` ne reçoit que le `RunContext` (`src/core/connector.ts:223`) et n'offre aucune
couture, donc c'est `collecter` que les tests appellent.

```ts
type Lecteur = <T>(chemin: string) => Promise<T[]>;

// Ce qu'une organisation a rendu : membres avec leur rôle, équipes avec leurs
// membres, invitations, et les erreurs unitaires rencontrées en chemin. Fatale
// vaut vrai quand les membres ou les invitations n'ont pas pu être lus, donc
// quand l'organisation ne rend rien du tout.
export interface LectureOrganisation { /* … */ }

export async function lireOrganisation(org: string, lire: Lecteur): Promise<LectureOrganisation>;

export function assemblerOrganisation(
  org: string,
  lecture: LectureOrganisation,
): { identites: ObservedIdentity[]; ressources: ObservedResource[]; acces: ObservedGrant[] };

export async function collecter(lire: Lecteur): Promise<CollectResult>;
```

`list` se réduit à `(): Promise<CollectResult> => collecter(lireTout)`, et rien d'autre.

- **La règle de statut change, et c'est le point à relire deux fois.** Aujourd'hui
  `erreurs.length === ORGANISATIONS.length` (`github.ts:203`) sur une seule organisation
  (`github.ts:22`) : la moindre erreur rend `failed`, et le chemin `partial` n'est jamais pris.
  `collecter` compte donc les organisations qui n'ont rien rendu, pas les erreurs : `failed` quand
  toutes sont fatales, `partial` dès qu'il reste une charge et au moins une erreur, `ok` sans erreur.
  L'invariant du type (`src/core/connector.ts:158-162`) est tenu dans les trois cas. Sans ce
  changement, ajouter des équipes revient à multiplier les façons de perdre une nuit entière.
- `/orgs/{org}/teams` puis `/orgs/{org}/teams/{slug}/members`, une séquence chacune, jamais une
  requête par compte (D5). Une équipe illisible remplit `erreurs` et n'interrompt pas les autres.
- Une équipe devient une ressource d'`externalId` `` `${org}/${slug}` ``, de libellé `Équipe <nom>`
  et d'adresse `https://github.com/orgs/<org>/teams/<slug>`. Ni un slug ni un nom d'organisation ne
  contient de barre oblique : la clé ne peut collisionner ni avec celle de l'organisation
  (`github.ts:188`) ni avec la clé réservée `(systeme)` (`src/lib/sync/collecte.ts:117`).
- Chaque membre d'équipe produit un `ObservedGrant` de rôle `member` vers cette ressource, et son
  identité est adoptée au passage. `/orgs/{org}/teams/{slug}/members` rend des `simple-user`, donc un
  `id` et un `login`, exactement la matière d'une `ObservedIdentity`. Un membre d'équipe absent des
  membres de l'organisation n'est pas une contradiction du fournisseur : c'est quelqu'un ajouté entre
  les deux lectures, qui sont deux appels successifs. L'écarter poserait une erreur et achèterait un
  `partial` pour une course de quelques secondes, alors que le socle écarte déjà de lui-même un accès
  dont l'identité manque (`src/lib/sync/collecte.ts:149-154`).
- `itemsSeen` reste le nombre d'identités (`github.ts:208`). En régime normal les équipes n'en créent
  aucune, la clé étant déjà posée par les membres ; dans le cas de course ci-dessus il monte d'une
  unité, ce qui va dans le sens du garde-fou de chute (`src/core/collecte.ts:10-15`) et jamais contre
  lui.

Livrable vérifiable : les scénarios 1, 4 et 5 sont verts, et sur une base de développement une
collecte crée les ressources d'équipe et leurs accès sans qu'aucun compte soit apparu ni disparu.

### 5. Les métadonnées, ce que les octets portent déjà

Fichiers : `src/connectors/github.ts`, `src/connectors/github.test.ts`.

- `MembreApi` (`:30-33`) reçoit `type`, et un membre dont `type` vaut `Bot` porte
  `{ label: "Type de compte", value: "robot" }`. Un compte d'utilisateur ne porte rien : une
  métadonnée qui vaudrait « utilisateur » sur toutes les lignes ne dirait plus rien (R4).
- `InvitationApi` (`:35-40`) reçoit `created_at`, `inviter`, `team_count`, `failed_at` et
  `failed_reason` : l'invitation porte sa date, son auteur, le nombre d'équipes visées s'il n'est
  pas nul, et son échec s'il y en a un.
- Le connecteur formate ses dates avec son propre `Intl`, en français long (D11). Ni le rôle
  d'organisation ni `site_admin` n'entrent dans les métadonnées (D2).

Livrable vérifiable : le scénario 2 est vert, et une collecte remplit `details` sur les seules
identités concernées, les autres restant nulles.

### 6. L'écran des comptes isolés

Fichiers : `src/app/comptes-isoles/page.tsx`, `src/app/comptes-isoles/FileDesComptesIsoles.tsx`.

- La requête sélectionne `details` et ordonne les accès, `orderBy` sur l'`externalId` de la ressource
  puis sur le rôle (`page.tsx:30-41`), sans quoi « le premier accès » de D10 change d'un jour à
  l'autre. La mise en forme lit `details` défensivement, comme `messages` lit `SyncRun.error`
  (`src/app/collectes/page.tsx:41-47`) : un tableau d'objets à deux chaînes, tout le reste écarté
  sans erreur, sans quoi une donnée écrite par une version antérieure du connecteur ferait tomber la
  page.
- `LigneCompteIsole` (`FileDesComptesIsoles.tsx:14-22`) gagne
  `metadonnees: readonly { libelle: string; valeur: string }[]`.
- La cellule des accès (`:74-80`) affiche le premier accès et « et N autres » au-delà (D10), et garde
  « aucun » quand il n'y en a pas (`:77`). La clé de ligne reste `ligne.id` (`:56`).
- La modale (`:126-129`) liste les accès un par ligne, « aucun » compris (`:127`), puis les
  métadonnées sous la forme « Libellé : valeur », en `fr-text--sm`. Le bloc des métadonnées ne
  s'affiche pas quand il n'y a rien à dire (R4).

Livrable vérifiable : le build Next passe, la modale d'un compte robot montre son type et ses
équipes, celle d'une invitation sa date et son auteur, et celle d'un compte ordinaire est inchangée.

### 7. Documentation

Fichier : `docs/architecture.md`, section 3.2.

Deux phrases sur la quatrième catégorie de donnée persistée, ce qui sert à décider et non à
calculer, avec ses trois conditions, plus la ligne du champ dans l'énumération d'`ExternalIdentity`
(`:260-262`). La rédaction est celle de D14. **Le document ne se modifie pas sans validation
explicite** : elle est proposée, et attend l'accord avant d'être appliquée.

## Tests

Cinq scénarios, dans `src/connectors/github.test.ts` (nouveau) pour quatre d'entre eux et
`src/core/collecte.test.ts` pour le troisième. Aucun n'a besoin de base ni de réseau : le contrat
est pur, l'assemblage du connecteur le devient à l'étape 4 et la fabrication des champs constatés à
l'étape 3. Les jeux d'essai portent des identifiants inventés du type `camille.rivet` et
`alex.dupuis`, sur les startups `produit-alpha` et `produit-beta`.

**1. « Une équipe est un accès, jamais une métadonnée ».** Given une organisation rendant deux
membres, `camille.rivet` et `alex.dupuis`, une équipe `produit-alpha` dont `camille.rivet` est
membre, et aucune invitation. When on assemble la lecture. Then il y a deux identités et deux
ressources, l'organisation et l'équipe, celle-ci portant le libellé `Équipe produit-alpha` et une
adresse. Then il y a trois accès : les deux appartenances à l'organisation, et `member` de
`camille.rivet` vers l'équipe. Then aucune métadonnée ne contient le mot équipe, le nom de
l'organisation ni un rôle, et `alex.dupuis` n'a qu'un accès.

**2. « Les métadonnées disent ce qu'aucun accès ne dit, dans l'ordre où le connecteur les a
écrites ».** Given un membre robot, un membre ordinaire administrateur de l'organisation, et une
invitation en attente pour `quelquun@exemple.org`, créée le 3 mars 2026 par `camille.rivet` et
visant deux équipes. When on assemble. Then le robot porte une seule métadonnée disant son type, le
membre ordinaire n'en porte aucune, et l'administration de l'organisation ne se lit que dans le rôle
de son accès. Then l'invitation porte sa date, son auteur et le nombre d'équipes visées, dans cet
ordre, toutes valeurs étant des chaînes rédigées en français, sans date ISO ni booléen. Then son
accès reste `invite:direct_member`, inchangé.

**3. « Le socle écrit ce que le contrat porte, et efface ce qu'il ne porte plus ».** Given une
identité observée portant deux métadonnées, des adresses de courriel et une date de dernière
activité. When on fabrique ses champs constatés. Then les métadonnées y sont, dans l'ordre, et
`lastSeenAt` vaut l'instant du run avec `vanishedAt` à nul. Then ni les adresses ni la date de
dernière activité n'y figurent, ce qui est le comportement voulu et documenté, pas un oubli. When la
même identité revient sans métadonnée, Then le champ vaut `null` et non l'ancienne valeur, de sorte
qu'une métadonnée que le connecteur ne sait plus écrire ne survit pas à la collecte qui l'a tue.
Emplacement : `src/core/collecte.test.ts`.

**4. « Une équipe illisible dégrade, et ne fait disparaître personne ».** Given une organisation dont
les membres et les invitations se lisent, dont l'équipe `produit-alpha` se lit et dont `produit-beta`
échoue. When on appelle `collecter` avec ce lecteur. Then le statut est `partial`, l'erreur nomme
`produit-beta`, et la charge porte toutes les identités, toutes les invitations et les accès de
`produit-alpha`. Then aucun accès n'est produit vers `produit-beta`, donc rien n'affirme que ses
membres n'y sont plus. When la liste des équipes elle-même échoue, Then le résultat reste `partial`
avec les seuls accès d'organisation. When les membres de l'organisation ne se lisent pas non plus,
Then il est `failed` et ne porte aucune charge.

**5. « Le coût suit le nombre d'équipes, jamais le nombre de comptes ».** Given un lecteur factice
qui enregistre les chemins demandés, une organisation de quatre-vingt-quinze membres et dix-neuf
équipes. When on lit l'organisation. Then il y a exactement vingt-trois lectures : deux pour les
membres, une pour les invitations, une pour la liste des équipes et dix-neuf pour leurs membres.
Then aucun chemin demandé ne contient un identifiant de compte. When le nombre de membres double,
Then le nombre de lectures ne change pas. When une vingtième équipe apparaît, Then il y en a
vingt-quatre.

## Risques et pièges

**Confondre une appartenance avec une métadonnée est le risque principal, et il est irréversible en
pratique.** Une équipe rangée dans le champ libre serait invisible au calcul, jamais réconciliée,
jamais datée par `vanishedAt`, et le jour où quelqu'un voudrait la traiter il faudrait défaire des
mois de collecte. C'est la raison d'être de D1, et la revue de l'étape 4 doit vérifier que rien de
ce qui porte un titulaire et une cible n'a fini dans `details`.

**Le double cache Prisma.** Le typecheck passera pendant que le runtime refusera `details`.
`pnpm db:generate` puis redémarrage, sans exception. Le symptôme est `Unknown argument 'details'`
sur la première identité écrite, au milieu d'une collecte qui laisse alors un `SyncRun` en échec.

**Le silence du socle est le défaut que ce ticket corrige, et il peut se reproduire dans le même
geste.** Un champ ajouté au contrat sans être ajouté aux champs constatés se collecte, se paye en
requêtes et n'arrive nulle part, comme `emails` aujourd'hui (`src/lib/sync/collecte.ts:54-59`). Le
scénario 3 est le seul garde-fou, et le commentaire de `champsConstates` le seul endroit où la liste
de ce qu'on ne persiste pas existe.

**Un run `partial` de plus est un run qui ne date plus rien.** Ajouter vingt requêtes, c'est ajouter
vingt occasions de dégrader le statut, et un statut non `OK` interdit toute écriture de `vanishedAt`
(`src/lib/sync/collecte.ts:300-326`). La règle de l'étape 4 les fait tomber en `partial` plutôt qu'en
`failed`, ce qui sauve les écritures de la nuit mais pas les datations. Une collecte GitHub qui
passerait de temps en temps en `partial` à cause d'une équipe cesserait de fermer les comptes partis,
sans que rien ne le dise ailleurs que sur `/collectes`. C'est le coût réel de D1, et il se surveille
là.

**Le plafond de pagination devient atteignable, et il emporte tout quand il tombe.** `lireTout` lève
au-delà de cinquante pages (`src/connectors/github.ts:96-100`). L'exception ne remonte pas jusqu'au
socle : le `catch` par organisation l'attrape (`:192-200`), et comme il n'y a qu'une organisation,
c'est `list` elle-même qui rend `failed` (`:203-205`). Le résultat est le même, une équipe qui
paginerait anormalement fait échouer la collecte entière du système. C'est précisément ce que la
règle de statut de l'étape 4 rouvre : une équipe illisible doit remplir `erreurs` sans rendre son
organisation fatale.

**La base réagit mal à deux gestes qui ont l'air anodins.** Le rôle fait partie de la clé d'unicité
d'un accès, `@@unique([externalIdentityId, resourceId, role])` (`prisma/schema.prisma:260`) :
reformuler le rôle `member` des équipes par confort d'affichage créerait une ligne neuve et
laisserait l'ancienne mourir en `vanishedAt`, pour tout le parc en une collecte. Et `Resource` n'a
pas de `vanishedAt` (`:231-243`) : une équipe supprimée laisse sa ligne en base, ses accès seuls
étant datés (`src/lib/sync/collecte.ts:316-323`). Le second point est le comportement actuel, mais
il devient perceptible dès qu'un connecteur crée des ressources par dizaines.

**Une métadonnée est une donnée personnelle en puissance.** `docs/architecture.md:251-255` jette
`bio`, `competences` et `legal_status` à l'ingestion, et la raison vaut ici mot pour mot. Le champ
`details` ne reçoit jamais le nom réel, la société, l'adresse publique ni la biographie d'un compte,
et le fait qu'ils soient parfois gratuits dans la réponse ne change rien. La condition figure dans
la proposition d'amendement de D14 pour que la règle existe avant le prochain connecteur.

**Le journal garde tout, pour toujours.** Faire porter les métadonnées à `ResultatCollecte` les
recopierait chaque nuit dans `AuditEvent.after` (`src/lib/sync/collecte.ts:343-354`), à rétention
indéfinie. C'est la panne la plus discrète de ce lot : elle ne se voit pas à l'écran, seulement dans
la taille de la table.

**Les tests ne couvrent pas l'écran, et la forme distante n'est vérifiée nulle part.**
`vitest.config.ts:11-15` fixe `environment: "node"` et n'inclut que les `.ts` : un `pnpm verify`
vert ne dit rien de la modale, seul le build Next dit que cela compile. Et le test de contrat
quotidien de `docs/architecture.md:531-535` n'existe toujours pas : le jour où GitHub renomme
`inviter`, la métadonnée disparaît sans erreur et rien ne le signale.

**`ACTIONS_ENABLED` ne bouge pas.** Rien ici n'écrit sur un système cible, donc aucun `dryRun` n'est
à câbler et le drapeau reste à `false`. Le corollaire est qu'il ne faut pas profiter de l'ouverture
du connecteur pour y glisser un appel qui modifierait une équipe : il contournerait le drapeau, et
une collecte est le dernier endroit où l'on regarderait.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire dès que la modale est touchée à
l'étape 6. Au-delà, sept constats à faire soi-même.

1. La migration s'applique, `pnpm db:generate` et le redémarrage sont faits, et une collecte écrit
   `details` du premier coup plutôt que de rendre `Unknown argument 'details'`.
2. `node --import tsx src/cli/sync.ts` sur une base de développement : le compte rendu affiche le
   même nombre de comptes qu'avant, plus d'accès, et le statut `OK`. Un `PARTIAL` inattendu se lit
   sur `/collectes`, avec sa raison.
3. Les ressources créées se comptent à la main : autant que d'équipes plus une, aucune clé ne
   commençant par une parenthèse hormis celle du système :

```sql
SELECT "externalId", label FROM "Resource" WHERE provider = 'github' ORDER BY "externalId";
```

4. Aucun compte n'a disparu ni n'est apparu du fait de ce lot :

```sql
SELECT count(*) FROM "ExternalIdentity" WHERE provider = 'github' AND "vanishedAt" IS NULL;
```

   Le compte doit valoir ce qu'il valait avant la collecte, à l'adoption près d'un membre d'équipe
   pris en course (étape 4). Une baisse signe un `vanishedAt` posé à tort.
5. Sur `/comptes-isoles`, un compte robot montre dans sa modale son type et ses équipes, chacune sur
   sa ligne, et sa ligne de tableau tient sur une seule ligne sans faire défiler la table. Une
   invitation montre sa date et qui a invité, en français, et garde l'accès qu'elle avait.
6. Un compte ordinaire sans rien à dire n'affiche aucun bloc de métadonnées, ni titre vide, ni
   phrase expliquant qu'il n'y a rien à voir.
7. La fiche d'une personne est inchangée, et le détail d'un `sync.github` déplié sur `/journal` porte
   les mêmes compteurs qu'avant, sans une seule métadonnée.

`ACTIONS_ENABLED` reste à `false` du début à la fin, et aucun appel sortant autre que les lectures
de l'étape 4 n'a lieu.
