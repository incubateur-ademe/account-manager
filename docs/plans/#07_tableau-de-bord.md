# Tableau de bord : zone d'inventaire et tuiles de connecteur (#7)

> Plan d'implémentation de l'issue #7. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### Le tableau de bord actuel

`src/app/page.tsx` tient en 150 lignes et fait déjà cinq requêtes dans un seul `Promise.all`
(`src/app/page.tsx:21-39`) :

- toutes les personnes, avec `missionEnd` et `vanishedAt` seulement (`src/app/page.tsx:23-25`), qui
  sont ensuite repliées en statuts par `statutDePersonne` (`src/app/page.tsx:41-50`) ;
- le dernier `SyncRun` du référentiel `espace-membre` (`src/app/page.tsx:26-30`) ;
- deux `count` sur `Finding` (`src/app/page.tsx:31-32`) ;
- le dernier relevé de chaque système cible, `capability: "list"`, hors `espace-membre`
  (`src/app/page.tsx:33-38`).

Ces cinq résultats alimentent la bannière de fraîcheur (`src/app/page.tsx:65-76`), la bannière des
systèmes muets (`src/app/page.tsx:78-108`), la ligne de dernière collecte (`src/app/page.tsx:110-120`)
et les trois files de travail (`src/app/page.tsx:122-147`). Il n'y a aucun inventaire.

Point important pour la suite : **les données de la zone d'inventaire sont déjà à moitié chargées.**
Le tableau des systèmes muets vient de `systemesMuets` (`src/core/collecte.ts:71-106`), qui rend déjà
par système la raison du silence, et la liste des personnes est déjà entièrement en mémoire. Ajouter
des `count` séparés pour les personnes serait une requête de plus pour un chiffre déjà là.

### Ce qui existe ailleurs, et qu'il ne faut pas réinventer

**La clause des comptes isolés** est écrite en dur dans l'écran, avec son commentaire
(`src/app/comptes-isoles/page.tsx:24-30`) :

```ts
where: {
  vanishedAt: null,
  OR: [{ personId: null, serviceAccountId: null }, { matchMethod: "HEURISTIC" }],
}
```

Le ticket demande explicitement de la reprendre et non de la réécrire. Elle est aujourd'hui
inaccessible depuis le tableau de bord : elle vit dans un fichier de page.

**Le détail des collectes** vit à deux endroits : `src/app/collectes/page.tsx:54-67` (les soixante
derniers runs, tous providers, toutes capabilities) et `src/app/systemes/page.tsx:50-54` (un
`findFirst` par connecteur, dans une boucle `Promise.all`). Le ticket demande de trancher le doublon
avant d'en créer un troisième.

**Les invitations en attente** ne sont pas un objet du modèle. Le connecteur GitHub les remonte comme
des accès dont le rôle porte un préfixe qu'il invente lui-même, `invite:${invitation.role}`
(`src/connectors/github.ts:134-138`), avec un commentaire qui dit exactement pourquoi elles comptent
(`src/connectors/github.ts:118-119`). C'est un piège développé plus bas.

### Ce qui manque entièrement

Il n'existe **aucun registre d'interface de connecteur**. `CONNECTEURS`
(`src/connectors/index.ts:10`) est la seule liste, et elle est chargée par la collecte en ligne de
commande : `src/cli/sync.ts:6` importe `executerSync`, qui importe `CONNECTEURS`
(`src/lib/sync/executer.ts:1`). Tout ce qui serait accroché à ce module partirait dans le binaire de
collecte. `ConnectorFeature` et `ConnectorContract.features` (`src/core/connector.ts:49-54` et
`src/core/connector.ts:68`) existent mais ne sont lus nulle part : c'est le crochet mort de
`docs/architecture.md` §5.3, et ce n'est pas le bon crochet pour une tuile, qui est un chiffre et non
une fonctionnalité.

### Les pièges déjà présents dans le code

1. **`src/app/error.tsx` est une frontière d'erreur de segment de route.** Une exception non
   rattrapée pendant le rendu du tableau de bord remplace la page entière par l'écran technique
   (`src/app/error.tsx:8-17`). Sans isolation par tuile, une tuile qui lève efface les files de
   travail, ce que la DoD interdit noir sur blanc.
2. **Le journal est écrit sans attente** (`src/lib/audit.ts:16-37`). Un compteur qui en sort est
   approximatif par construction, et le ticket exige que l'écran ne laisse pas croire l'inverse.
3. **`distinct: ["provider"]` sur `SyncRun`** (`src/app/page.tsx:35`) est appliqué après lecture :
   la requête parcourt la table des runs `list`. Elle grossit d'une ligne par système et par nuit.
   C'est tenable aujourd'hui, c'est à mesurer, et surtout c'est un patron à ne pas multiplier.
4. **Le patron par connecteur de `src/app/systemes/page.tsx:33-57`** fait une requête par système
   dans une boucle. À dix connecteurs, la zone d'inventaire ferait dix requêtes pour un chiffre.
5. **Un run non `ok` ne date aucune disparition** (`docs/architecture.md` §5.6, mis en oeuvre dans
   `src/lib/sync/collecte.ts`). Les comptes comptés vivants sur un système en échec sont donc le
   dernier état constaté et non l'état du jour : un inventaire qui affiche un nombre sans son état de
   collecte ment poliment.

## Décisions de conception

### D1. Le doublon avec Collectes et Systèmes est tranché par la nature du chiffre

La zone d'inventaire ne montre **aucun détail de run** : ni durée, ni message d'erreur, ni historique.
Elle montre une seule ligne de santé, dérivée de ce que la page calcule déjà avec `systemesMuets`
(`src/core/collecte.ts:71-106`) : combien de systèmes attendus ont été lus dans les délais, combien
sont muets, et depuis quand. Le détail reste sur `/collectes`, la capacité par système reste sur
`/systemes`, et la ligne de santé y renvoie.

Corollaire : **aucune requête nouvelle sur `SyncRun`.** Les deux requêtes existantes
(`src/app/page.tsx:26-38`) suffisent, et la date qui horodate l'inventaire est celle qui est déjà
affichée (`src/app/page.tsx:112`).

### D2. Chaque chiffre du socle est rattaché à une décision, sinon il ne s'affiche pas

C'est le point de Definition of Ready. La liste est arrêtée ainsi :

| Chiffre | Ce qu'il éclaire | Où l'on va ensuite |
|---|---|---|
| Personnes suivies, dont sans échéance | La plausibilité du périmètre : un effondrement se voit ici avant de se voir en constats | `/personnes` |
| Comptes vivants par système, dont administrateurs et membres | Le siège payé pour personne, et la concentration des droits d'administration | `/systemes` |
| Invitations en attente, et âge de la plus ancienne | Une porte ouverte que rien ne referme d'elle-même | `/comptes-isoles` |
| Comptes non révocables, scindés en sans détenteur et ressemblance à confirmer | Ce qu'il faut rattacher ou couper, et ce qui ne pourra jamais fonder une coupure | `/comptes-isoles` |
| Comptes de service, dont revues en retard | La seule échéance que ces comptes savent émettre | `/comptes-de-service` |
| Startups suivies, dont en phase terminale | Une startup finie ne justifie plus aucun accès | rien tant que #6 n'est pas livré |
| Opérations tracées sur trente jours | Rien. C'est une preuve d'usage, pas une donnée de service | `/journal` |
| Systèmes lus dans les délais sur systèmes attendus | Si l'inventaire ci-dessus vaut quelque chose | `/collectes` |

Un chiffre dont la colonne du milieu serait vide ne va pas dans cette zone.

### D3. Le comptage des comptes non révocables reprend la clause existante, et la scinde sans la trahir

La clause de `src/app/comptes-isoles/page.tsx:27-30` est extraite dans un module partagé et devient la
**seule** définition. Le total affiché au tableau de bord est donc, par construction, celui de l'écran.

La scission en deux sous-chiffres est le vrai piège : une identité peut être à la fois sans détenteur
et rattachée par ressemblance, auquel cas la naïveté compterait la même ligne deux fois. Les deux
sous-ensembles sont donc rendus disjoints :

- **sans détenteur** : `personId: null` et `serviceAccountId: null`, quel que soit `matchMethod` ;
- **ressemblance à confirmer** : `matchMethod: "HEURISTIC"` et un détenteur non nul.

Leur somme est le total, et cette égalité est ce qu'un test vérifie.

### D4. Une tuile de connecteur rend un noeud, le socle ne regarde jamais dedans

Le contrat, côté web uniquement :

```ts
export interface ContexteTuile {
  maintenant: Date;
  signal: AbortSignal;
}

export interface TuileDeConnecteur {
  cle: string;
  titre: string;
  /** Ce que la tuile a lu pour répondre. Affiché sous la valeur, parce que ça change ce qu'on peut en conclure. */
  provenance: "base" | "systeme";
  charger: (ctx: ContexteTuile) => Promise<ReactNode>;
}
```

Le socle passe une date et un signal d'abandon, reçoit un noeud, l'encadre d'un titre et d'une mention
de provenance, et n'en sait rien de plus.

Ce que le contexte **ne contient pas** est aussi délibéré que ce qu'il contient : ni `audit`, ni
`runId`, ni `dryRun`. Une tuile n'a donc pas de quoi écrire une trace même par inadvertance, ce qui
porte par le type la décision actée du ticket, plutôt que par la discipline de chaque connecteur.
C'est le même raisonnement que `CollectResult` (`src/core/connector.ts:158-162`).

### D5. L'isolement d'une tuile tient sur trois filets, et chacun couvre un échec différent

1. **Un helper `rendreTuile` qui ne jette jamais.** Il enveloppe `charger` dans un `Promise.race`
   avec une échéance, abandonne le signal au passage, et rend
   `{ etat: "ok"; contenu } | { etat: "echec"; message }`. Il couvre le rejet **et** la tuile qui
   n'aboutit pas, qui est le pire des deux cas : sans échéance, la réponse en flux ne se termine
   jamais, le navigateur tourne, et aucune erreur n'apparaît nulle part.
2. **Un `<Suspense>` par tuile.** Une tuile lente ne retient pas le reste de la page, qui est servie
   d'abord ; la tuile arrive après.
3. **Une petite frontière d'erreur client par tuile.** Elle attrape ce que le helper ne peut pas
   voir : un noeud rendu par la tuile qui lève pendant son propre rendu. Sans elle, on retombe sur
   `src/app/error.tsx` et la page entière disparaît.

L'échéance est une constante du socle, pas un réglage de politique : il n'y a aucune décision métier
là-dedans, seulement le refus de laisser une page ouverte indéfiniment. Trois secondes.

### D6. Le message d'erreur d'une tuile est normalisé avant affichage

Une tuile qui appelle son système peut lever une erreur contenant une URL avec un jeton en paramètre,
ou une réponse d'API entière. Le socle affiche un message court et sans détail technique, et laisse le
reste dans les journaux du serveur, exactement comme `src/app/error.tsx:39-49` le fait déjà avec sa
référence.

### D7. Tension avec `docs/architecture.md`, à valider avant d'écrire

Deux points appellent une modification du document de référence, qui ne se modifie pas sans validation
explicite.

**a. Le statut d'une tuile.** La DoD l'exige : §5.3 doit dire qu'une tuile de connecteur est
indicative, qu'elle n'écrit ni `SyncRun` ni événement d'audit, qu'elle n'est pas rejouable et que rien
de ce qu'elle affiche ne peut fonder une décision de coupure. Sans cette phrase, une tuile ressemble à
une collecte au rabais, et quelqu'un finira par en tirer un constat.

**b. Le préfixe `invite:`.** Le ticket range les invitations parmi les chiffres disponibles sans
toucher aux connecteurs. Or ce préfixe est aujourd'hui une invention du connecteur GitHub
(`src/connectors/github.ts:137`). Si le socle le lit, il devient une convention du socle, et §3.2
doit dire que sur `AccessGrant.role`, le préfixe `invite:` est réservé et signifie un accès en attente
d'acceptation. C'est défendable : la notion est transverse, un espace Notion a ses invités comme une
organisation GitHub a ses invitations. Ce n'est pas gratuit : tout connecteur devra s'y conformer,
sous peine de rendre le chiffre faux sans bruit.

**Repli si la validation est refusée :** les invitations sortent des agrégats du socle et deviennent
une tuile du connecteur GitHub. Le reste du plan ne bouge pas.

### D8. Ce que les invariants imposent ici, et qui ne se discute pas

- **Le journal précède l'action** : sans objet, une tuile ne fait aucune action. Aucun appel à
  `actionTracee` n'est ajouté par ce ticket. Réciproquement, aucune tuile n'écrit dans le journal.
- **`ACTIONS_ENABLED`** ne protège rien ici, puisqu'aucun chemin d'exécution n'est emprunté. C'est
  précisément pourquoi la règle est écrite dans le document : une tuile ne doit jamais appeler un
  point d'écriture, même d'apparence anodine, car rien ne l'arrêterait.
- **Aucun secret en dur** : une tuile qui appelle son système passe par le `probe()` de son connecteur
  et par `src/lib/env.ts`, jamais par un jeton en clair. La tuile GitHub de l'étape 6 le montre.
- **`matchMethod` `HEURISTIC` ou `NONE`** : la zone d'inventaire les compte et les nomme non
  révocables, elle n'ouvre aucune action dessus.
- **Un run non `ok`** ne pose aucun `vanishedAt`, donc l'inventaire d'un système en échec est le
  dernier état constaté. Chaque ligne par système porte l'état de son dernier relevé, et un système
  muet affiche « non observé » et non « 0 compte ».

## Modèle de données

**Aucune migration Prisma.** Tout ce que la zone d'inventaire compte existe déjà :
`Person` (`prisma/schema.prisma:89-119`), `ExternalIdentity` (`prisma/schema.prisma:159-187`),
`AccessGrant` (`prisma/schema.prisma:203-221`), `ServiceAccount` (`prisma/schema.prisma:121-139`),
`Startup` (`prisma/schema.prisma:244-259`), `SyncRun` (`prisma/schema.prisma:272-285`),
`Finding` (`prisma/schema.prisma:420-446`), `AuditEvent` (`prisma/schema.prisma:472-490`).

Aucun index n'est ajouté non plus, par décision et non par oubli :

- le comptage par système s'appuie sur `@@index([provider, vanishedAt])` de `ExternalIdentity`
  (`prisma/schema.prisma:186`) ;
- le comptage des accès vivants s'appuie sur `@@index([vanishedAt])` de `AccessGrant`
  (`prisma/schema.prisma:219`) ;
- le comptage du journal sur trente jours s'appuie sur `@@index([at])`
  (`prisma/schema.prisma:486`) ;
- le filtre `role: { startsWith: "invite:" }` n'a **pas** d'index. C'est assumé sur un parc de
  quelques milliers d'accès, et c'est un des points à mesurer à l'étape 7. Si la mesure dit le
  contraire, un index sur `AccessGrant(role)` sera ajouté dans un ticket dédié, avec sa migration.

Rappel valable si une décision de mesure conduit malgré tout à toucher le schéma : **toute
modification de `prisma/schema.prisma` exige `pnpm db:generate` puis un redémarrage de `pnpm dev`.**
Deux caches se cumulent, le client généré et l'instance mise en cache sur `globalThis`
(`src/lib/db.ts:6-17`), et le symptôme typique est un typecheck qui passe pendant que le runtime
refuse le champ.

## Découpage en étapes

### Étape 1. Sortir la clause des comptes isolés de son écran

Aucun changement visible. La clause de `src/app/comptes-isoles/page.tsx:27-30` déménage, avec son
commentaire, et l'écran s'en sert.

- `src/lib/comptes-isoles.ts` (nouveau) : `OU_NON_REVOCABLE`, la clause partagée, plus les deux
  clauses disjointes `OU_SANS_DETENTEUR` et `OU_RESSEMBLANCE_A_CONFIRMER`.
- `src/core/comptes-isoles.ts` (nouveau) : `categorieDIsolement(identite)`, prédicat pur miroir des
  clauses, qui rend `"sans-detenteur" | "ressemblance" | null`. Il existe pour être testé sans base.
- `src/app/comptes-isoles/page.tsx` : importe la clause au lieu de la porter.

Vérifiable : l'écran des comptes isolés affiche exactement la même liste qu'avant.

### Étape 2. Le pliage pur de l'inventaire

- `src/core/inventaire.ts` (nouveau). Fonctions pures, aucune dépendance à Prisma :
  `inventaireParSysteme(comptesParProvider, accesParRessource, ressources, releves, attendus)` qui
  rend une ligne par système attendu, avec ses comptes vivants, ses administrateurs, ses membres, ses
  invitations, l'âge de la plus ancienne, et l'état de son dernier relevé ;
  `plusAncienneInvitation(acces, maintenant)`.
- Règle portée ici et nulle part ailleurs : un système dont le dernier relevé n'est pas exploitable
  rend `comptes: null` et non `comptes: 0`.

Vérifiable : `pnpm test` sur les scénarios 1 et 4 ci-dessous, sans base.

### Étape 3. Les requêtes d'inventaire

- `src/lib/inventaire.ts` (nouveau) : `chargerInventaire(maintenant, policy)`, un seul
  `Promise.all`, qui rend un objet typé et appelle le pliage de l'étape 2. Les requêtes :
  `externalIdentity.groupBy({ by: ["provider"], where: { vanishedAt: null } })` ;
  `accessGrant.groupBy({ by: ["resourceId", "role"], where: { vanishedAt: null } })` ;
  `resource.findMany({ select: { id: true, provider: true } })` ;
  `accessGrant.aggregate({ _min: { firstSeenAt: true }, where: { vanishedAt: null, role: { startsWith: "invite:" } } })` ;
  trois `externalIdentity.count` partageant les clauses de l'étape 1 ;
  `serviceAccount.findMany` réduit aux champs de la revue, replié avec `revueDe` déjà existant ;
  `startup.count` sur `vanishedAt: null` et sur `currentPhase: { in: policy().startups.terminalPhases }` ;
  `auditEvent.count` sur une fenêtre de trente jours.
- Interdit : une requête par connecteur. Le patron de `src/app/systemes/page.tsx:33-57` ne se
  reproduit pas ici.

Vérifiable : nombre de requêtes constant quel que soit le nombre de connecteurs, contrôlé à l'étape 7.

### Étape 4. La zone d'inventaire à l'écran

- `src/app/page.tsx` : le `Promise.all` existant (`src/app/page.tsx:21-39`) accueille
  `chargerInventaire`, et les personnes déjà chargées servent aussi aux chiffres du périmètre, sans
  requête supplémentaire. Une `<section>` sous les trois files, avec un titre, une phrase qui dit
  d'où sortent ces chiffres et à quelle date, la ligne de santé des collectes de D1, puis les tuiles.
- La mention du journal est explicite : compteur approximatif, écriture sans attente, preuve et non
  donnée de service.
- Les deux bannières (`src/app/page.tsx:65-108`) et les trois files (`src/app/page.tsx:122-147`) ne
  bougent pas.

Vérifiable : à l'écran, base pleine puis base vide.

### Étape 5. L'emplacement à tuiles

Cette étape dépend de #5, qui apporte le registre d'interface. Si #5 est livré, on ajoute un champ
`tuiles` à son registre. Sinon, on crée la tranche minimale, en respectant sa contrainte : **rien de
ce qui suit ne doit être atteignable depuis `src/connectors/index.ts`**, sous peine d'embarquer du
JSX dans `pnpm sync` (`src/cli/sync.ts:6` puis `src/lib/sync/executer.ts:1`).

- `src/ui/connecteurs/contrat.ts` (nouveau) : `TuileDeConnecteur`, `ContexteTuile`, `ResultatTuile`.
- `src/ui/connecteurs/registre.ts` (nouveau) : `REGISTRE_UI: Record<string, { tuiles?: readonly TuileDeConnecteur[] }>`.
- `src/ui/connecteurs/rendreTuile.ts` (nouveau) : le helper de D5, qui ne jette jamais et normalise
  le message d'erreur selon D6.
- `src/ui/connecteurs/Tuiles.tsx` (nouveau) : le composant serveur qui parcourt `CONNECTEURS`, va
  chercher les tuiles dans le registre, et rend chacune dans son `<Suspense>` et sa frontière
  d'erreur.
- `src/ui/connecteurs/FrontiereTuile.tsx` (nouveau) : composant client, classe avec
  `componentDidCatch`, qui rend le cadre d'échec à la place de la tuile.

Vérifiable : le scénario 3 des tests, plus `pnpm sync` qui tourne toujours.

### Étape 6. Une première tuile, pour éprouver la place

Une tuile GitHub qui appelle son système et affiche un chiffre que le socle n'a pas de place pour
tenir : le nombre de membres de l'organisation sans double authentification, via
`/orgs/{org}/members?filter=2fa_disabled`. Elle est indicative, elle ne produit ni `Finding` ni
`PlanStep`, et rien dans le socle ne s'en sert. Le jour où ce chiffre doit décider quelque chose, il
devient une collecte, dans un autre ticket.

- `src/ui/connecteurs/github/TuileDeuxFacteurs.tsx` (nouveau). Elle demande d'abord `probe()` au
  connecteur GitHub et affiche « credential absent » plutôt que de tomber quand `GITHUB_TOKEN`
  manque ; elle passe le `signal` du contexte à `fetch`.

Vérifiable : avec jeton, sans jeton, et avec un jeton invalide.

### Étape 7. Mesure du coût, puis documentation

- Mesure sur un jeu réaliste, environ cent personnes, un millier d'identités, quelques milliers
  d'accès, six mois de runs et de journal. On relève le nombre de requêtes et la durée de la zone
  d'inventaire, en activant le journal de requêtes de Prisma (`src/lib/db.ts:11-14`) le temps de la
  mesure.
- `docs/architecture.md` §5.3 et §3.2, selon D7, après validation explicite. Les deux modifications
  sont proposées séparément : celle sur le statut d'une tuile est exigée par la DoD, celle sur le
  préfixe `invite:` peut être refusée, auquel cas on applique le repli.

## Tests

Emplacement `src/**/<nom>.test.ts`, environnement `node`, imports explicites depuis `vitest`
(`vitest.config.ts`). Aucun test ne touche la base : ils portent sur les fonctions pures et sur le
helper d'isolement.

**1. `src/core/inventaire.test.ts` : un parc réaliste se replie en un inventaire qui dit la même
chose que les écrans.**
Given des relevés bruts imitant ce que rendent les `groupBy` sur deux systèmes, avec des rôles
`admin`, `member` et `invite:direct_member`, des ressources rattachées à leur provider, et des runs
dont l'un est `OK` et l'autre `PARTIAL`. When on replie. Then chaque système porte son total de
comptes vivants, la somme des administrateurs et des membres ne dépasse jamais ce total, les
invitations sont comptées à part et pas confondues avec des membres, l'âge de la plus ancienne est
calculé à partir de `firstSeenAt`, et le système en `PARTIAL` est présenté comme partiellement observé
et non comme sain.

**2. `src/core/comptes-isoles.test.ts` : les comptes non révocables se partagent la file sans se
recouvrir.**
Given une identité sans détenteur en `NONE`, une identité sans détenteur en `HEURISTIC`, une identité
rattachée à `prenom.nom` en `HEURISTIC`, une identité rattachée à un compte de service en `DECLARED`,
et une identité disparue. When on catégorise. Then la somme des deux catégories vaut exactement le
total de la clause partagée, aucune identité n'appartient aux deux, l'identité rattachée par
ressemblance est comptée bien qu'elle ait un détenteur, celle qui est rattachée de façon sûre n'est
comptée nulle part, et la disparue non plus.

**3. `src/ui/connecteurs/rendreTuile.test.ts` : une tuile qui tombe, qui traîne, ou qui ne revient
jamais.**
Given quatre tuiles : une qui rend son chiffre, une qui rejette avec un message contenant une URL et
un paramètre ressemblant à un jeton, une qui ne résout jamais, une qui résout juste avant l'échéance.
When le socle les rend toutes. Then la première rend son contenu, la deuxième rend un échec dont le
message ne contient plus le paramètre sensible, la troisième rend un échec de délai dépassé et son
`AbortSignal` est bien abandonné, la quatrième passe, aucun appel n'a levé d'exception vers
l'appelant, et le temps total reste borné par l'échéance et non par la somme des tuiles.

**4. `src/core/inventaire.test.ts`, second `describe` : une base vide ne se lit pas comme un parc
sain.**
Given aucun relevé, aucune identité, et un système attendu jamais lu. When on replie. Then le système
rend « non observé » et non « 0 compte », l'inventaire porte la marque qu'il n'a jamais été
alimenté, et le compteur du journal est accompagné de son drapeau d'approximation quelle que soit sa
valeur.

**5. `src/cli/sync.test.ts` : la collecte ne charge aucune dépendance d'interface.**
Given le graphe d'imports statique à partir de `src/cli/sync.ts`. When on le parcourt en suivant les
imports relatifs et les alias `@/`. Then aucun fichier atteint n'est un `.tsx`, aucun ne vit sous
`src/ui/`, et aucun n'importe `react` ni `@codegouvfr/react-dsfr`. Ce garde-fou appartient
conceptuellement à #5, mais c'est ce ticket qui crée la tentation de le franchir.

## Risques et pièges

**La tuile qui n'aboutit jamais est le pire des trois échecs.** Elle ne lève rien, ne s'affiche pas,
et laisse la réponse en flux ouverte : la page semble simplement ne jamais finir de charger, sans une
ligne dans les journaux. C'est le seul des trois cas qu'un développeur ne verra pas en local, parce
qu'en local le système répond. D'où l'échéance obligatoire, et le test qui l'exerce.

**« 0 compte » et « pas regardé » se ressemblent trait pour trait.** C'est exactement le mal que
`systemesMuets` a été écrit pour combattre (`src/core/collecte.ts:63-70`). Un inventaire est une
machine à produire cette confusion, puisqu'il aligne des nombres. Chaque ligne par système doit porter
son état de relevé, et un système muet ne doit pas afficher de nombre du tout.

**Un inventaire est une photo de la dernière collecte, pas l'état du jour.** Sur un système en échec,
aucun `vanishedAt` n'a été posé, donc les comptes comptés vivants incluent peut-être des comptes déjà
partis. La bannière de fraîcheur existante le dit pour le référentiel ; la zone d'inventaire doit le
redire pour elle-même, sans quoi un chiffre rond fait plus autorité qu'une bannière.

**Le préfixe `invite:` est une convention d'un seul connecteur.** Tant qu'il n'est pas écrit dans
`docs/architecture.md`, le second connecteur qui remontera des invitations les nommera autrement et
le chiffre baissera sans que personne ne s'en aperçoive. C'est une panne silencieuse, du genre qui se
découvre le jour où l'on cherche pourquoi une porte est restée ouverte.

**Le compteur du journal ne doit jamais devenir un dénominateur.** L'écriture est sans attente avec
capture d'erreur (`src/lib/audit.ts:16-37`) : un ratio construit dessus serait faux d'une quantité
inconnue. Il se présente comme une preuve d'activité, jamais comme une couverture.

**Une frontière d'erreur de route avale la page entière.** Sans frontière par tuile, une exception
dans une tuile remplace tout le tableau de bord par `src/app/error.tsx`, y compris les trois files de
travail, ce que la DoD interdit explicitement.

**Une tuile peut faire fuiter un secret dans son message d'erreur.** Le message brut d'un `fetch`
échoué contient parfois l'URL complète. La normalisation de D6 n'est pas cosmétique.

**Rien n'empêche techniquement une tuile d'écrire.** Le contexte ne lui donne pas de quoi journaliser,
mais son module peut importer `prisma` comme n'importe quel autre. C'est une règle de revue, pas une
garantie du type, et il faut le dire plutôt que de croire le contraire.

**Aucun test ne touche la base.** L'équivalence entre le prédicat pur de `src/core/comptes-isoles.ts`
et la clause Prisma de `src/lib/comptes-isoles.ts` est tenue par la revue et par leur voisinage, pas
par la CI. Les faire diverger ferait diverger deux écrans qui affichent le même total.

**Le coût peut se découvrir en production.** `distinct` sur `SyncRun` et `startsWith` sur
`AccessGrant.role` sont les deux requêtes sans index de cette page. Sur le parc actuel, elles ne se
voient pas ; c'est ce que l'étape 7 est là pour établir plutôt que pour supposer.

## Vérification

Au-delà de `pnpm verify` et de `/verif`, qui inclut le build :

1. **Base vide.** Le tableau de bord s'affiche entièrement, la bannière de fraîcheur est là, la zone
   d'inventaire dit qu'elle n'a jamais été alimentée, et aucun système n'affiche « 0 compte ».
2. **Système en échec.** Forcer un dernier run `FAILED` sur un système : sa ligne d'inventaire dit
   qu'il n'est pas observé, la bannière des systèmes muets reste affichée, et aucun nombre de comptes
   n'apparaît pour lui.
3. **Les trois échecs de tuile, à la main.** Brancher temporairement une tuile qui lève, une qui dort
   trente secondes, et une qui rend un noeud qui lève à son propre rendu. Dans les trois cas, les
   trois files de travail, les deux bannières et toute la zone d'inventaire restent affichées et
   utilisables, et l'échec est cantonné au cadre de la tuile.
4. **Sans `GITHUB_TOKEN`.** La tuile GitHub dit que le credential est absent, elle ne tombe pas, et
   l'écran `/systemes` continue de dire la même chose de son côté (`src/app/systemes/page.tsx:119-129`).
5. **`pnpm sync` tourne toujours.** `node --import tsx src/cli/sync.ts` sur une base de
   développement, sans charger la moindre dépendance d'interface, ce que le scénario de test 5
   vérifie en continu.
6. **Coût mesuré.** Le nombre de requêtes de la page est relevé et noté dans la PR, et il ne dépend
   pas du nombre de connecteurs déclarés. La durée de `chargerInventaire` est relevée sur le jeu
   réaliste.
7. **Aucun appel réseau du socle.** Relecture ciblée : `src/lib/inventaire.ts` n'importe rien qui
   parle au réseau, et seules les tuiles ont le droit d'appeler un système.
8. **Le document de référence est à jour**, avec la validation explicite de D7 tracée dans la PR.
