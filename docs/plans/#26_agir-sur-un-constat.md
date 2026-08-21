# Agir sur un constat sans quitter la fiche (#26)

> Plan d'implémentation de l'issue #26. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### Le bloc d'action, et ce qu'il sait faire

**Le bloc affiche des consignes et ne sait offrir qu'un lien.** `MotifDAction`
(`src/app/personnes/[username]/CeQuiAppelleUneAction.tsx:15-22`) porte `cle`, `severite`, `titre`,
`description`, et un seul champ optionnel, `lien: { href, libelle }`, commenté « Où le geste se fait,
quand ce n'est pas sur cette page. » (`:20`). Le rendu (`:31-64`) est une suite d'`Alert` où la
description est un fragment : titre en gras, consigne, puis lien s'il existe. C'est le seul point
d'extension, et il n'accepte ni bouton ni nœud React. Le lot 1.5 l'a laissé ainsi de propos délibéré,
« Ce que le ticket ne fait pas : déplacer les gestes, qui restent où ils sont »
(`docs/plans/lot-1.5_interface.md:194-196`) : ce plan est le ticket qui les déplace.

**Chaque constat ouvert reçoit systématiquement le même lien, et c'est l'aller-retour du ticket.**
`motifsDesConstats` (`CeQuiAppelleUneAction.tsx:66-80`) construit une clé `constat-<id>`, une gravité
traduite par `SEVERITE_CONSTAT` (`:24`), le titre et la consigne lus dans `LIBELLE_CONSTAT`
(`src/core/libelle-constat.ts:14-45`), et toujours
`lien: { href: "/constats?constat=<dedupKey>", libelle: "Le traiter dans la file" }` (`:74-77`). La
file surligne bien la ligne visée (`src/app/constats/FileDesConstats.tsx:65`), mais le geste, lui,
est resté là-bas.

**Le calcul des motifs est déjà séparé de la page, et il n'est pas testable pour autant.**
`motifsDAction` (`src/app/personnes/[username]/motifs.ts:28-119`) est une fonction pure qui prend un
`EtatDeLaFiche` (`:10-20`) et rend une liste ordonnée : statut à traiter (`:39-46`), constats ouverts
(`:48`), fraîcheur (`:50-60`), startups toutes terminées (`:65-73`), surcharge d'appartenance
(`:76-89`), contradiction entre deux autorités (`:95-106`), absence de startup connue (`:108-116`).
Elle importe `MotifDAction` et `motifsDesConstats` depuis un `.tsx` (`:6-7`), qui charge
`@codegouvfr/react-dsfr` et `next/link` : un test qui importerait `motifs.ts` tirerait tout cela
derrière lui, dans un `environment: "node"`.

**La fiche ne lit d'un constat que ce qu'il faut pour l'afficher.** Le `select` des `findings`
(`src/app/personnes/[username]/page.tsx:114-125`) retient `id`, `kind`, `dedupKey`, `severity`,
`openedAt`, `closedAt` et `closeReason`, ni `externalIdentityId` ni la relation `externalIdentity` :
un constat de compte survivant à son détenteur s'affiche sans que la fiche puisse nommer le compte.
Les ouverts partent dans `motifsDAction` (`:221`, `:233-242`), les fermés dans un accordéon en bas de
page (`:222`, `:447-474`).

### La file, et le geste qu'elle porte

**Un seul geste existe sur un constat, il vit dans une modale unique, et il est déjà réutilisable.**
`FileDesConstats` (`src/app/constats/FileDesConstats.tsx:42-166`) est un composant client nourri par
la page serveur (`src/app/constats/page.tsx:49-61`), qui déclare une modale hors composant (`:32`),
retient la ligne choisie dans un état local (`:50`), n'expose sur chaque ligne qu'un bouton « Clore »
(`:116-131`), y rappelle la cible, le titre, l'explication et la consigne (`:136-159`), puis monte
`ClotureConstat` (`:160`). Le commentaire d'en-tête (`:34-41`) dit pourquoi : déplié treize fois, le
formulaire portait treize fois son libellé et son aide. `ClotureConstat`
(`src/app/constats/ClotureConstat.tsx:11-42`) ne prend que `dedupKey` et un `onSucces` optionnel, et
ferme par `useFermetureApresSucces` (`src/ui/modale.ts:13-26`) : rien dedans ne connaît la file.

**`cloreConstat` ne revalide pas le chemin d'une personne.** L'action
(`src/app/constats/actions.ts:13-51`) relit le constat par sa clé en ne sélectionnant que `id` et
`closedAt` (`:24-27`), refuse une clé vide (`:17-19`), une raison trop courte (`:20-22`), un constat
absent (`:29-31`) ou déjà clos (`:32-34`), puis écrit par `actionTracee` avec
`revalider: ["/constats", "/"]` (`:41`) et pose `closedBy: operateur.username` (`:45`), qui est le
verrou de réconciliation (`prisma/schema.prisma:509-514`, `src/lib/sync/constats.ts:125-141`).

### Les gestes que la consigne nomme, et où ils vivent déjà

**« Confirmer son rattachement réel » existe, sous deux noms, et à deux endroits.**
`rattacherAStartup` (`src/app/personnes/[username]/actions.ts:127-228`) pose un `StartupAssignment`
daté et nominatif, refuse un identifiant de startup inconnu (`:151-153`), une date mal formée
(`:155-158`) ou passée (`:161-165`), et exige une confirmation quand la date prolonge la mission
(`:170-177`). Son bouton vit dans l'en-tête de la section Startups (`SectionStartups.tsx:64-68`), via
`ModaleRattacherStartup` (`ModaleRattacherStartup.tsx:18-60`), dont le commentaire (`:13-17`) dit que
rattacher est une action de section. `forcerAppartenance` (`actions.ts:301-364`) est l'autre lecture
du mot (`ActionsDePage.tsx:63-77`).

**« Retirer les accès » existe aussi, et c'est un dossier, pas un bouton.** `ouvrirDepart`
(`src/app/departs/actions.ts:18-76`) ouvre un dossier, calcule son plan et redirige hors du passage
tracé (`:70-75`). Le bouton est déjà sur la fiche, en priorité primaire, en haut à droite
(`ActionsDePage.tsx:40`, `BoutonDepart.tsx:20-69`). Un seul dossier vivant par personne est garanti
par `ouvrirDossierDeDepart` (`src/lib/depart.ts:118-143`), qui cherche un dossier en `WATCH`,
`CANDIDATE` ou `CONFIRMED` avant d'en créer un (`:122-129`). Le journal connaît ces deux verbes,
comme il connaît `finding.close` (`src/app/journal/libelles.ts:15`, `:18`, `:33`).

### Ce qui n'existe pas, et n'a pas à exister

**Aucun retrait d'accès unitaire n'existe, et l'architecture le ferme.**
`docs/architecture.md:195-196` : « Ce qui coupe des accès reste le dossier de départ, avec son plan,
sa confirmation et son journal. » Le code est aligné : aucune action serveur ne touche un
`AccessGrant`, `Connector.execute` n'est appelé nulle part, et le seul intent `revoke` du dépôt naît
dans `calculerPlanDeDepart` (`src/lib/depart.ts:91`). `detacherIdentite`
(`src/app/personnes/[username]/actions.ts:25-100`) défait un rattachement local sans rien couper sur
le système cible (`:63-66`, commentaire `:22-23`).

**Aucun geste ne juge un constat en passant**, et c'est écrit deux fois :
`docs/architecture.md:407-410` pour le rattachement manuel, `:191-196` pour la surcharge, repris de
très près en commentaire (`src/app/personnes/[username]/actions.ts:122-126`, `:295-299`). Deux gestes
en ferment pourtant sur le champ, sans `closedBy`, parce que la situation qu'ils constataient a
cessé : `detacherIdentite` ferme tous les constats ouverts de l'identité détachée (`:71-83`) et
`rattacherIdentite` ferme les `UNREGISTERED` du compte rattaché
(`src/app/comptes-isoles/actions.ts:173-187`, commentaire `:182-183`). C'est un troisième cas que
§4.2 ne connaît pas, et c'est exactement la frontière que D4 tient.

**`UNREGISTERED` n'atteint aucune fiche, par construction.** Le constat naît sans `username`
(`src/core/constat.ts:265-271`), donc `syncConstats` pose `personId: null`
(`src/lib/sync/constats.ts:148-153`, `:166`, `:176`). Quatre familles atteignent une fiche :
`SCOPE_EXIT`, `INACTIVE_STARTUP`, `ORPHAN`, `OVERDUE_MANUAL_ACTION`.

### Les pièges déjà présents dans le code

1. **La même phrase est écrite à deux endroits de la même fiche.** La description du motif
   `startups-terminees` (`motifs.ts:71`) recopie mot pour mot la consigne d'`INACTIVE_STARTUP`
   (`src/core/libelle-constat.ts:31`). Un garde-fou les empêche de paraître ensemble (`:62-65`), mais
   la phrase vit en double dans les sources.
2. **`OVERDUE_MANUAL_ACTION` ne sait pas nommer l'étape qu'il conteste.** Sa clé ne porte que
   `systemKey` et `username` (`src/core/constat.ts:227`), et le constat n'a ni `planStepId` ni
   `departureCaseId` : `actionsDeclarees` retrouve l'étape à l'envers, en partant de toutes les
   étapes `SUCCEEDED` (`src/lib/sync/constats.ts:219-241`), jamais depuis le constat.
3. **La fiche ne se rafraîchit aujourd'hui que par effet de bord.** `revalider` ne contient que
   `/constats` et `/` (`src/app/constats/actions.ts:41`), et pourtant un `revalidatePath`, quel que
   soit son chemin, fait re-rendre la route courante dans la réponse même de l'action
   (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:43-46`) et rafraîchit au retour
   les pages déjà visitées
   (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md:19`). La
   fiche se met donc à jour sans qu'aucun chemin nommé ne le garantisse, sur un comportement que Next
   annonce comme provisoire.
4. **`revalidatePath` sur un chemin qui n'existe pas ne dit rien.** Deux appels visent `/departs`
   (`src/app/departs/actions.ts:56`, `src/app/personnes/[username]/edition.ts:425`) alors que la
   route n'existe pas. Un chemin mal formé se comporte pareil : silence complet.
5. **La modale du système de design s'enregistre par identifiant, hors composant.** `createModal` est
   appelé au niveau du module dans `FileDesConstats.tsx:32`, `ActionsDePage.tsx:14`,
   `BoutonDepart.tsx:11`, `ModaleRattacherStartup.tsx:11` et
   `src/app/comptes-isoles/FileDesComptesIsoles.tsx:24`, cinq fois en tout. Deux modules
   enregistrant le même identifiant produiraient deux `<dialog>` de même `id`.

## Décisions de conception

**D1. La réponse à la question du ticket est : aucune action serveur nouvelle, et le journal le
prouve.** Le ticket suppose que « confirmer un rattachement » et « retirer un accès » sont des
actions serveur à écrire. Ni l'une ni l'autre : la première existe déjà deux fois (D3), la seconde
est exclue par l'architecture (D2). Le ticket se réduit donc à rendre atteignables depuis le bloc les
gestes qui existent, plus un chemin de revalidation nommé (D12). Le contrôle est mécanique :
`LIBELLE_ACTION` (`src/app/journal/libelles.ts:9-36`) ne gagne aucune entrée, et s'il devait en
gagner une, c'est que ce plan aurait inventé une action. Il **rétrécit** son ticket, et c'est une
raison qui le lui permet, pas un manque d'ambition. Ce ticket n'appartient pas au lot 1.5, dont les
six sont énumérés ailleurs (`docs/plans/lot-1.5_interface.md:191-214`) : il en suit les règles R1 à
R8 comme grammaire d'écran, sans être tenu par R9 ni par son hors périmètre (`:222`). La seule
écriture serveur qu'il touche est une liste de chemins à revalider, qui ne change aucun comportement
métier.

**D2. « Retirer un accès » n'est pas un geste, c'est un dossier.** `docs/architecture.md:195-196`
ferme la question en une phrase, et `:270-271` la referme par l'autre bout : une identité rattachée
par ressemblance ne peut jamais produire une étape de révocation. Le geste que nomment les consignes
d'`INACTIVE_STARTUP` et d'`ORPHAN` est donc `ouvrirDepart` (`src/app/departs/actions.ts:18-76`), déjà
sur la fiche (`ActionsDePage.tsx:40`). L'alternative examinée était le retrait déclaratif, sur le
modèle de `pointerEtape` : une parole au journal, sans exécution. Elle est rejetée parce que rien ne
la rapprocherait ensuite, `OVERDUE_MANUAL_ACTION` ne tenant que parce qu'il s'appuie sur une étape en
base, son `state` et son `executedAt` (`src/lib/sync/constats.ts:220-241`). Un retrait déclaratif
hors plan serait une affirmation que la collecte ne saurait jamais démentir, c'est-à-dire exactement
la panne que cet outil existe pour éviter.

**D3. « Confirmer son rattachement réel », c'est rattacher à une startup, et le geste existe.** La
consigne d'`INACTIVE_STARTUP` (`src/core/libelle-constat.ts:31`) parle de startups, et le constat se
lève sur leurs phases (`src/core/constat.ts:63-114`). Le geste qui le dément est donc
`rattacherAStartup` (`src/app/personnes/[username]/actions.ts:127-228`), pas `forcerAppartenance`
(`:301-364`), qui dit l'appartenance à l'incubateur et n'ordonne rien (`:295-299`) : celle-ci reste
en haut à droite et en priorité tertiaire, ce que R3 bis prévoit pour une action rare
(`docs/plans/lot-1.5_interface.md:69-72`). Une troisième lecture existe, `rattacherIdentite`
(`src/app/comptes-isoles/actions.ts:31`), le seul de ces gestes que `docs/architecture.md` §3.4
(`:324-328`) appelle explicitement une confirmation : il porte sur un compte, pas sur une personne,
et D11 le laisse sur son écran. Conséquence assumée : le bloc n'offre qu'une des trois lectures du
mot « rattachement », celle que le constat désigne.

**D4. Un geste posé depuis le bloc ne ferme jamais le constat en passant.**
`docs/architecture.md:407-410` : poser ou retirer un rattachement manuel ne lève ni ne ferme le
constat sur le champ, parce qu'il dépend des phases de toutes les startups et d'une date qui passe
toute seule. Rattacher à une startup vivante fait disparaître le constat à la collecte suivante, par
`startupsEffectives` et `toutesLesStartupsSontTerminees` (`src/core/constat.ts:77`, `:95`), sans
qu'aucune écriture de clôture soit nécessaire. Corollaire pour la revue : `rattacherAStartup` ne se
modifie pas dans ce ticket, pas même d'une ligne.

**D5. Le motif reste une donnée pure : il nomme le geste, il ne le rend pas.** `MotifDAction` gagne
un champ `gestes`, jamais un `ReactNode`, qui rendrait `motifs.ts` non testable et mêlerait la
décision au rendu, que la file a déjà séparés (`src/app/constats/page.tsx:49-61` décide,
`FileDesConstats.tsx` rend). Le calcul déménage en même temps : `ConstatOuvert`, `MotifDAction`,
`SEVERITE_CONSTAT` et `motifsDesConstats` quittent `CeQuiAppelleUneAction.tsx` pour `motifs.ts`, qui
devient un module sans JSX.

```ts
export type Geste =
  | { nom: "rattacher-startup" }
  | {
      nom: "clore";
      dedupKey: string;
      titre: string;
      explication: string;
      consigne: string;
    };

export interface MotifDAction {
  cle: string;
  severite: "error" | "warning" | "info";
  titre: string;
  description: string;
  /** Ce que la consigne nomme et que cet écran sait faire, dans l'ordre de lecture. */
  gestes?: readonly Geste[];
  /** Où le geste se fait, quand il ne se fait pas ici. */
  lien?: { href: string; libelle: string };
}
```

Le geste de clôture porte les trois textes que sa modale affiche, et pas un de moins : sans eux, le
composant devrait retrouver le motif d'où le geste vient pour savoir quoi rappeler, et deux endroits
diraient le même libellé. `motifs.ts` reste la seule source des textes, comme la file fait porter à
sa ligne l'explication que sa modale rend (`FileDesConstats.tsx:20-22`).

`ConstatOuvert` (`CeQuiAppelleUneAction.tsx:8-13`) suit, avec un champ de plus,
`compte: { provider: string; handle: string } | null`, le compte que le constat désigne quand il en
désigne un (D14).

**D6. Le bloc devient un composant client, comme la file, et pour la même raison.** La modale du
système de design s'ouvre sur un état client et son identifiant doit être unique dans la page. Un
bouton par motif qui monterait chacun sa boîte de dialogue produirait autant de `<dialog>` de même
`id` (piège 5). Le seul montage qui tienne est celui de la file : un composant client unique qui
porte la liste, retient le constat choisi et monte **une** modale. `CeQuiAppelleUneAction.tsx` prend
donc `"use client"`, garde son nom, sa section et sa règle de vacuité (`:32-34`), et ne reçoit que
des chaînes et des unions littérales. L'alternative, garder le composant serveur et déléguer les
boutons à un enfant client, n'a nulle part où mettre l'état partagé entre N boutons et une modale.

**D7. Deux gestes au plus par motif, et le bloc ne reprend pas un geste de l'en-tête de page.**
« Préparer le départ » est en haut de la fiche, en priorité primaire, sans repli
(`ActionsDePage.tsx:40`, `docs/plans/lot-1.5_interface.md:236-238`). Le remettre dans le bloc mettrait
deux fois le même bouton à trois centimètres d'écart, le pavé que le lot 1.5 a démonté et
ce que le garde-fou du fourre-tout interdit (`lot-1.5_interface.md:240-243`). Le critère est la
distance, pas la présence : « Rattacher à une startup » est lui aussi déjà sur l'écran, mais trois
sections plus bas, dans l'en-tête de la section Startups (`SectionStartups.tsx:64-68`), hors du champ
de lecture du bloc, et c'est précisément cet aller-retour que le ticket supprime. La règle tient en
deux lignes : `clore` sur tout motif qui est un constat, `rattacher-startup` en plus sur
`INACTIVE_STARTUP` et sur `startups-terminees`. Le statut, la fraîcheur, la surcharge, la
contradiction d'autorités et l'absence de startup ne sont pas des constats : rien à y clore, et leurs
gestes vivent déjà ailleurs (R2, `lot-1.5_interface.md:53-57`).

**D8. « Clore » est offert sur tout constat, parce que clore porte sur le constat et non sur la
situation.** La consigne d'`INACTIVE_STARTUP` ne nomme pas la clôture, contrairement à celle de
`SCOPE_EXIT` et d'`ORPHAN` (`src/core/libelle-constat.ts:25`, `:31`, `:37`). L'offrir quand même est
délibéré : la file l'offre sur toutes ses lignes (`FileDesConstats.tsx:116-131`), et une fiche qui en
offrirait moins ramènerait, pour un seul type de constat, l'aller-retour que ce ticket supprime.

**D9. Le lien « Le traiter dans la file » disparaît là où le geste se fait ici.** Le garder dirait
« traite-le ailleurs » à côté de ce qui le traite là, une explication de trop par écran (R5,
`lot-1.5_interface.md:77-78`). Le champ `lien` reste sur `MotifDAction`, mais ne sert plus qu'à
`OVERDUE_MANUAL_ACTION` (D10). La direction inverse ne change pas : la file continue de mener vers la
fiche (`FileDesConstats.tsx:82-87`) et de surligner la ligne désignée par l'adresse (`:63-66`).

**D10. `OVERDUE_MANUAL_ACTION` ne se pointe pas depuis une fiche : il s'y lit, et mène à son
dossier.** Le geste que sa consigne nomme est `pointerEtape`
(`src/app/departs/[id]/actions.ts:101`), qui exige un plan `EXECUTING` par `peutPointer`
(`src/core/depart.ts:56-59`, appelé en `:136` de l'action) et l'identifiant d'une étape que le
constat ne porte pas (piège 2). Retrouver l'étape supposerait de découper la clé de déduplication
pour en extraire `systemKey`, puis de choisir entre plusieurs candidates : c'est redeviner ce que le
constat a choisi de ne pas stocker. Ce que la fiche affirme sans deviner, c'est le dossier vivant de
la personne, unique par construction (`src/lib/depart.ts:122-125`). Le motif reçoit donc
`lien: { href: "/departs/<id>", libelle: "Ouvrir le dossier de départ en cours" }` quand ce dossier
existe, et aucun lien sinon : un dossier soldé ne se pointe plus, et renvoyer vers la file n'offrirait
que le bouton « Clore » que le bloc porte désormais. Le libellé dit « en cours » et rien de plus,
parce que rien de plus n'est établi : `actionsDeclarees` balaie toutes les étapes `SUCCEEDED` sans
regarder l'état du dossier (`src/lib/sync/constats.ts:220-241`), si bien qu'un constat peut naître
d'un dossier soldé pendant qu'un autre vit. Le lien mène au dossier vivant de la personne, pas
nécessairement à celui qui porte l'étape contestée, et un libellé n'affirme que ce que son calcul
établit (R7). `EtatDeLaFiche` gagne `dossierVivant: string | null`.

**D11. `UNREGISTERED` reste hors de portée d'une fiche, et ce n'est pas un oubli.** Le constat ne
porte pas de `username` (`src/core/constat.ts:265-271`), donc pas de `personId`, donc il n'apparaît
jamais dans `personne.findings`. Lui en donner un reviendrait à affirmer un rattachement que rien
n'établit, alors que `personId` nullable est le cœur du modèle (`docs/architecture.md:264-265`). Son
geste vit sur les comptes isolés, et ce plan **ne tranche rien** de ce que cet écran doit trancher.

**D12. `cloreConstat` revalide le chemin de la personne, déduit du constat relu en base.** Le
`select` du lookup (`src/app/constats/actions.ts:24-27`) gagne
`person: { select: { username: true } }`, et `revalider` (`:41`) devient `["/constats", "/"]` plus
`/personnes/<username>` quand le constat porte une personne. L'identifiant ne vient jamais d'un champ
de formulaire : un identifiant venu du client ne dit pas ce que la base sait, et un formulaire se
poste sans passer par l'écran qui l'a rendu (`src/app/personnes/[username]/actions.ts:167-169`). Le
chemin s'écrit sans encodage, dans la forme en usage (`src/app/departs/actions.ts:56`,
`src/app/personnes/[username]/actions.ts:197`). Ce n'est pas une panne qu'on répare : la fiche se
rafraîchit déjà, mais par le comportement général des actions serveur et non par un chemin nommé
(piège 3). Le jour où l'invalidation se restreindra au seul chemin passé, comme Next l'annonce, clore
depuis une fiche laisserait le constat affiché. Nommer le chemin aujourd'hui coûte une relation dans
un `select` et évite une panne qui ne se déclarerait qu'à une montée de version, là où elle serait
mise sur le compte de la montée de version.

**D13. Le doublon de la consigne des startups terminées ne se réunit pas, c'est le geste qui les
réunit.** Les deux textes ne paraissent jamais ensemble, le garde-fou de `motifs.ts:62-65` s'en
charge, si bien que R5 n'est pas violée aujourd'hui. Ce qui les sépare est réel : le constat refuse
de conclure quand l'échéance effective est passée (`src/core/constat.ts:82-90`), là où le motif
d'écran ne regarde que les phases (`page.tsx:190-191`). Les fondre supposerait soit de supprimer le
motif, qui couvre un cas que le constat écarte exprès, soit de déplacer le calcul dans
`src/core/constat.ts`, ce qui changerait le comportement du constat lui-même : ce plan ne le fait
nulle part, et un ticket qui déplace des gestes n'est pas celui qui décide quand un constat se lève.
Ils reçoivent le même geste, `rattacher-startup`, sans `clore` pour le motif d'écran qui n'est pas un
constat. Deux routes, une seule destination.

**D14. Le constat d'un compte nomme son compte, et lui seul.** La consigne d'`ORPHAN` dit « Couper
cet accès » (`src/core/libelle-constat.ts:37`) sans que la fiche sache lequel, faute de la relation
dans le `select` (`page.tsx:114-125`). Elle la gagne, et `motifsDesConstats` nomme le compte quand
`compte` est renseigné, jamais sinon. C'est R7 à la lettre (`lot-1.5_interface.md:94-97`) : un
libellé calculé n'affirme que ce que son calcul établit, et sur une fiche seul `ORPHAN` porte une
identité, `UNREGISTERED` n'y arrivant pas (D11).

**D15. Rien à toucher côté environnement ni côté systèmes cibles.** Aucune variable nouvelle, donc
aucun ajout au schéma Zod de `src/lib/env.ts:14-37`. Aucun geste de ce ticket n'écrit sur un système
cible : clore écrit une ligne de `Finding`, rattacher écrit un `StartupAssignment`, et ouvrir un
dossier passe déjà par `calculerPlanDeDepart`, où `dryRun: !env.ACTIONS_ENABLED`
(`src/lib/depart.ts:76`) reste inchangé. `ACTIONS_ENABLED` demeure à `false` par défaut
(`src/lib/env.ts:22-26`) et `RunContext.dryRun` n'est touché nulle part. Le corollaire est la vraie
consigne : il ne faut pas profiter de ce chemin pour y glisser un geste qui toucherait un
fournisseur. Toute évolution qui l'autoriserait repasse par une décision d'architecture.

**D16. Tension avec `docs/architecture.md` : aucune sur les invariants, et deux manques à combler.**
Le document autorise ce que ce plan fait et interdit ce qu'il refuse de faire : §2.3 (`:191-196`) et
§4.2 (`:407-410`) tiennent D2 et D4, §3.4 (`:314-322`) range le rattachement à une startup parmi
l'état décidé, §4.2 (`:386-391`) décrit la clôture à la main sans dire depuis quel écran elle se
fait, incomplétude et non contradiction. Deux ajouts méritent deux phrases : que
`OVERDUE_MANUAL_ACTION` existe, §4.2 ne connaissant que `SCOPE_EXIT` et `INACTIVE_STARTUP`
(`:393-405`), et que les gestes offerts sur un constat sont ceux qui existent déjà, atteignables là
où la consigne est lue, aucun ne coupant un accès hors d'un dossier de départ. La modification est
**proposée à l'étape 7 et appliquée seulement après validation explicite**.

## Modèle de données

**Aucune migration Prisma.** Rien de ce que ce ticket ajoute n'est constaté ni décidé : le bloc lit
ce qui existe, et les deux gestes qu'il rend atteignables écrivent ce qu'ils écrivaient, par les
mêmes actions et avec les mêmes traces. Rapporté à la trichotomie de `docs/architecture.md` §3.1 à
§3.3, ce ticket n'ajoute rien à aucune des trois familles : il rend atteignable ce que le décidé
écrit déjà. `prisma/schema.prisma` n'est pas touché, `Finding`
(`:495-521`) garde ses champs et ses deux index, aucun `prisma migrate dev`, aucun `pnpm db:generate`,
aucun redémarrage à prévoir de ce fait.

Les deux modifications de requête sont en lecture seule : la relation `externalIdentity` s'ajoute au
`select` des findings de la fiche (`page.tsx:114-125`) et la relation `person` à celui de
`cloreConstat` (`src/app/constats/actions.ts:24-27`). Les deux existent déjà dans le client généré
(`prisma/schema.prisma:516-517`), rien n'est à régénérer. Côté politique, rien non plus :
`config/config.exemple.yaml` et `config/config.schema.json` ne bougent pas.

Le rappel vaut pour la suite : dès qu'une étape touche `prisma/schema.prisma`, il faut enchaîner
`pnpm db:generate` puis **redémarrer `pnpm dev`**, le client généré étant mis en cache sur
`globalThis` et servant sinon des métadonnées périmées (`Unknown argument 'X'`,
`Value 'X' not found in enum 'Y'`). Ici, une étape qui réclame une migration signe un geste qui s'est
mis à écrire un état que le socle ne connaît pas.

## Découpage en étapes

### 1. Le calcul, extrait du rendu

Fichiers : `src/app/personnes/[username]/motifs.ts`,
`src/app/personnes/[username]/CeQuiAppelleUneAction.tsx`.

- `ConstatOuvert` (`CeQuiAppelleUneAction.tsx:8-13`), `MotifDAction` (`:15-22`), `SEVERITE_CONSTAT`
  (`:24`) et `motifsDesConstats` (`:66-80`) déménagent vers `motifs.ts`, sans changer une virgule.
- `CeQuiAppelleUneAction.tsx` écrit `import type { MotifDAction } from "./motifs"`, `tsconfig.json:6`
  posant `verbatimModuleSyntax: true`, et ne contient plus que le composant. `motifs.ts` cesse
  d'importer un `.tsx` (`:6-7`), la dépendance s'inverse, aucune boucle n'apparaît.

Livrable vérifiable : `pnpm verify` et `pnpm build` passent, la fiche est identique à l'écran, et un
test peut importer `motifs.ts` sans tirer `@codegouvfr/react-dsfr` derrière lui, seul but de l'étape.

### 2. Les gestes, dans le calcul

Fichiers : `src/app/personnes/[username]/motifs.ts`,
`src/app/personnes/[username]/motifs.test.ts` (nouveau).

- `Geste`, `MotifDAction.gestes` et `ConstatOuvert.compte` prennent la forme donnée en D5, et
  `EtatDeLaFiche` (`motifs.ts:10-20`) gagne `dossierVivant: string | null`.
- `motifsDesConstats` cesse de poser le lien vers la file, pose sur tout constat
  `gestes: [{ nom: "clore", dedupKey, titre, explication, consigne }]` lus dans `LIBELLE_CONSTAT`
  (`src/core/libelle-constat.ts:14-45`), ajoute `{ nom: "rattacher-startup" }` en tête sur
  `INACTIVE_STARTUP`, ajoute le lien vers le dossier sur `OVERDUE_MANUAL_ACTION` quand
  `dossierVivant` n'est pas nul, et complète la description quand `compte` est renseigné.
- Le motif `startups-terminees` (`:65-73`) reçoit `gestes: [{ nom: "rattacher-startup" }]`, et rien
  d'autre ne bouge dans cette fonction. Les cinq scénarios de la section Tests sont écrits ici.

Livrable vérifiable : `pnpm test` passe et les cinq scénarios sont verts. `page.tsx` ne compile plus
tant qu'il ne fournit pas `dossierVivant` : l'étape 3 est rendue obligatoire par le type, pas par la
mémoire.

### 3. Ce que la fiche relit

Fichiers : `src/app/personnes/[username]/page.tsx`.

- Le `select` des `findings` (`:114-125`) gagne
  `externalIdentity: { select: { provider: true, handle: true } }`.
- Une quatrième requête entre dans le `Promise.all` (`:70-138`), filtrée par la relation pour ne pas
  dépendre de l'identifiant de la personne :
  `prisma.departureCase.findFirst({ where: { person: { username }, state: { in: ["WATCH",
  "CANDIDATE", "CONFIRMED"] } }, select: { id: true } })`.
- `ouverts` (`:221`) est projeté vers `ConstatOuvert` en y portant `compte`, et `motifsDAction`
  (`:233-242`) reçoit `dossierVivant`.

Livrable vérifiable : `pnpm build` passe, un motif `ORPHAN` nomme son compte, un motif
`OVERDUE_MANUAL_ACTION` mène au dossier quand il y en a un, et aucun bouton n'existe encore.

### 4. Le bloc passe côté client, à écran constant

Fichiers : `src/app/personnes/[username]/CeQuiAppelleUneAction.tsx`.

Le fichier prend `"use client"` et ne change rien d'autre : mêmes propriétés, même
rendu, même règle de vacuité. C'est le point de rupture le plus probable du ticket, et il se vérifie
seul : toute valeur non sérialisable tomberait ici, pas trois étapes plus loin, mêlée à des boutons
neufs.

Livrable vérifiable : `pnpm build` passe, la fiche est identique au pixel près, et la console ne
rapporte aucune erreur de sérialisation sur une fiche portant un constat ouvert et une surcharge
d'appartenance.

### 5. Les boutons de geste

Fichiers : `src/app/personnes/[username]/CeQuiAppelleUneAction.tsx`,
`src/app/personnes/[username]/ModaleRattacherStartup.tsx`.

- `ModaleRattacherStartup.tsx:11` exporte son objet de modale, déclaré et monté une seule fois par la
  section Startups (`SectionStartups.tsx:64-68`, rendue sans condition par `page.tsx:428`).
  « Rattacher à une startup » ouvre cette modale importée, sans en déclarer une seconde.
- Dans la description de chaque `Alert`, après titre, description et lien éventuel, les gestes
  s'affichent en boutons du système de design, `size="small"`, en priorité tertiaire, espacés par
  `fr.cx("fr-mr-1v")` comme les gestes de page (`ActionsDePage.tsx:47`). Aucun `Aide` : la consigne
  est déjà la phrase au-dessus, la redire en infobulle serait la deuxième fois sur le même écran.

Livrable vérifiable : sur une fiche portant `INACTIVE_STARTUP`, le bouton ouvre la modale de la
section Startups, un rattachement à une startup vivante est posé et tracé, la section affiche la
ligne, et **le constat reste ouvert** dans le bloc, ce que D4 exige.

### 6. La clôture depuis la fiche, et son chemin de revalidation

Fichiers : `src/app/personnes/[username]/CeQuiAppelleUneAction.tsx`,
`src/app/constats/ClotureConstat.tsx` (importé tel quel, jamais recopié),
`src/app/constats/actions.ts`.

- Le fichier déclare, hors composant, une modale unique
  `createModal({ id: "clore-constat-fiche", isOpenedByDefault: false })`, le second champ étant
  obligatoire dans la signature (`node_modules/@codegouvfr/react-dsfr/Modal/Modal.d.ts:34-37`) et
  passé par les cinq appels du dépôt. L'identifiant diffère de celui de la file pour qu'aucun partage
  de chunk ne puisse enregistrer deux fois le même.
- Le geste choisi est retenu dans un `useState`, comme la file retient sa ligne
  (`FileDesConstats.tsx:50`), et le bouton fait les deux d'un coup,
  `onClick={() => { setChoisi(geste); modale.open(); }}`. Étaler `modale.buttonProps` sur N boutons
  répandrait N fois le même attribut `id`, que le type porte (`Modal.d.ts:38-41`).
- La modale monte `ClotureConstat` avec `dedupKey={choisi.dedupKey}` et `onSucces={modale.close}`,
  sous `key={choisi.dedupKey}`. La clé est la clé de déduplication et non un identifiant de constat,
  que le geste ne porte pas ; la file, qui dispose des deux, prend le sien (`:160`). Elle sert la même
  chose : remonter le formulaire quand la cible change.
- La modale rappelle le titre du constat, son explication et sa consigne, tous trois portés par le
  geste (D5), puis dit ce que clore à la main signifie. Elle ne rappelle pas de qui il s'agit : la
  fiche porte déjà le nom en titre.
- `cloreConstat` relit `person: { select: { username: true } }` (`src/app/constats/actions.ts:24-27`)
  et allonge `revalider` (`:41`). La lecture reste **avant** l'appel à `actionTracee`, l'ordre du
  journal ne se négocie pas (`src/lib/actions.ts:18-29`).

Livrable vérifiable : clore depuis une fiche fait disparaître le constat du bloc sans rechargement
manuel, le fait apparaître dans l'accordéon des constats fermés avec sa raison (`page.tsx:447-474`),
le retire de `/constats`, et laisse une trace `finding.close` nominative posée avant l'écriture. Le
chemin nommé, lui, se vérifie à la relecture et non à l'écran, qui ne le distingue pas du
comportement général des actions serveur (D12).

### 7. Le parcours complet, puis la documentation

Fichiers : `docs/architecture.md` (proposition), `docs/plans/lot-1.5_interface.md` (proposition).

Le parcours de la section Vérification est joué en entier avant toute écriture documentaire. Les deux
ajouts de D16 sont ensuite rédigés et **soumis**. Le ticket n'exige aucune mise à jour documentaire
dans sa Definition of Done ; la proposition est soumise à l'utilisateur et n'est pas appliquée par ce
lot, le document ne se modifiant pas sans validation explicite.

Livrable vérifiable : `/verif` complet au vert, et deux propositions de rédaction posées sans qu'un
seul caractère de `docs/architecture.md` ait bougé.

## Tests

Cinq scénarios, tous dans `src/app/personnes/[username]/motifs.test.ts`, sans base : après l'étape 1,
tout ce qui décide des gestes est pur, premier bénéfice de cette étape. Aucun test de rendu n'est
possible, `vitest.config.ts:12-13` fixant `environment: "node"` et n'incluant que `src/**/*.test.ts`,
et le précédent d'un test d'application pure existe déjà (`src/app/journal/criteres.test.ts`). Les
jeux d'essai portent `camille.rivet` et `alex.dupuis`, les startups `produit-alpha`, `produit-beta`.

**1. « Le geste que la consigne nomme se fait là où elle est lue ».** Given une fiche de
`camille.rivet` portant un `INACTIVE_STARTUP` ouvert de gravité moyenne, et rien d'autre. When on
calcule les motifs, Then il y a un seul motif, sa description est la consigne de `LIBELLE_CONSTAT`
mot pour mot, il porte deux gestes dans l'ordre `rattacher-startup` puis `clore`, le geste de clôture
porte la clé de déduplication et les trois textes que sa modale affiche, titre, explication et
consigne, chacun égal à celui de `LIBELLE_CONSTAT`, et le motif ne porte **aucun** lien. When
la même fiche porte en plus un `SCOPE_EXIT` de gravité haute, Then le second motif porte un seul
geste, `clore`, sa gravité vaut `error`, et aucun motif ne propose d'ouvrir un départ, ce geste
vivant déjà en haut de la fiche.

**2. « Ce qui coupe reste un dossier, et le bloc ne prétend pas le faire ».** Given une fiche portant
un `ORPHAN` sur le compte `alex.dupuis` du système `github` et un `SCOPE_EXIT`. When on calcule les
motifs, Then le motif d'`ORPHAN` porte le seul geste `clore`, sa description se termine en nommant le
système et le compte, et celle du `SCOPE_EXIT` ne nomme aucun compte. When le constat de compte
arrive sans compte renseigné, Then sa description est la consigne seule, sans phrase ajoutée ni
mention vide. Aucun geste d'aucun motif ne porte un nom qui évoquerait un retrait d'accès : les noms
autorisés sont deux, et le test l'affirme.

**3. « Une action déclarée sans effet mène à son dossier, ou nulle part ».** Given une fiche portant
un `OVERDUE_MANUAL_ACTION` et un dossier vivant d'identifiant connu. When on
calcule les motifs, Then le motif porte le geste `clore` et un lien vers `/departs/<identifiant>`
dont le libellé est « Ouvrir le dossier de départ en cours », sans rien nommer de l'étape contestée.
When la même fiche n'a aucun dossier vivant, Then le motif porte toujours son geste de clôture et
**plus aucun lien**. When on parcourt les motifs des deux cas, Then aucun `href` ne commence par
`/constats` : l'aller-retour supprimé ne se reconstitue nulle part.

**4. « Le doublon de la consigne reste écarté, et le geste réunit les deux routes ».** Given une
fiche rattachée aux startups `produit-alpha` et `produit-beta`, toutes deux dans une phase terminale,
qui n'est pas rattachée par équipe, et qui porte un `INACTIVE_STARTUP` ouvert. When on calcule les
motifs, Then le motif `startups-terminees` est absent, celui du constat est présent, et la consigne
n'apparaît qu'une fois dans toute la liste. When le constat n'est pas levé, Then
`startups-terminees` reparaît, porte le seul geste `rattacher-startup`, et aucun de clôture puisqu'il
n'est pas un constat. When on ajoute le rattachement par équipe à cette même fiche sans constat, Then
ni l'un ni l'autre ne paraît.

**5. « Deux gestes au plus, et rien sur ce qui n'est pas un constat ».** Given une fiche qui
déclenche les cinq motifs qui ne naissent d'aucun constat et ne portent aucun geste : statut à
traiter, collecte périmée, surcharge d'appartenance, contradiction entre deux autorités, absence de
startup connue. When on calcule les motifs, Then chacun est présent, aucun ne porte ni geste ni lien,
et l'ordre de lecture est celui d'avant ce ticket. When on ajoute les quatre familles de constat qui
atteignent une fiche, Then aucun motif de la liste entière ne porte plus de deux gestes, et le nombre
total de gestes de clôture vaut exactement quatre, soit un par constat ouvert et pas un de plus.

## Risques et pièges

**Le passage du bloc en composant client est le risque principal.** Une valeur non sérialisable qui
traverserait la frontière ne tombe pas au typecheck, elle tombe au rendu. `MotifDAction` ne porte que
des chaînes et des unions littérales, et D5 la garde ainsi : une `Date` ou un `ReactNode` glissé dans
un motif casserait la fiche entière, pas le bloc seul. D'où l'étape 4, à écran constant.

**La chaîne de la modale de rattachement ne tient à aucun type.** `createModal` enregistre au niveau
du module (piège 5) : le bloc n'en déclare qu'une, `clore-constat-fiche`, et importe celle du
rattachement, faute de quoi deux `<dialog>` de même `id` se verraient dans l'inspecteur et nulle part
ailleurs. Or cette modale importée n'est montée que par `SectionStartups.tsx:64-68`, rendue sans
condition par `page.tsx:428`, et rien ne le garantit. Le jour où l'une des deux devient
conditionnelle, le bouton du bloc ouvrirait le vide, en silence. La revue de l'étape 5 vérifie cette
chaîne, elle ne la suppose pas.

**La fermeture silencieuse par un geste voisin.** Rattacher à une startup ne doit fermer aucun
constat (D4, `docs/architecture.md:407-410`), et la tentation est réelle de « finir le travail »
puisque l'écran vient de le montrer. Cela créerait une seconde vérité, incomplète le jour
où un rattachement expire sans que personne n'ait cliqué. Le scénario 1 tient cet invariant côté
calcul, la revue de l'étape 5 le tient côté action.

**Le geste le plus facile devient celui qui tait, et c'est le risque que ce ticket crée.** Sur une
fiche, « Clore » est désormais à un clic de chaque consigne, y compris de celles qui demandent d'agir
avant : `ORPHAN` dit « Couper cet accès, puis clore ce constat » (`src/core/libelle-constat.ts:37`),
et `OVERDUE_MANUAL_ACTION` n'existe que parce qu'une parole n'a pas été suivie d'effet
(`src/core/constat.ts:205-212`). Or `cloreConstat` écrit `closedBy`
(`src/app/constats/actions.ts:45`), qui pose le verrou (`prisma/schema.prisma:509-514`) : un constat
clos sans que l'accès ait été coupé ne revient pas tant que la situation dure
(`src/lib/sync/constats.ts:125-141`), et le silence ressemble à une absence d'écart. Le verrou est
voulu et doit le rester, fermer sans `closedBy` comme le font les gestes qui constatent qu'une
situation a cessé (`src/app/personnes/[username]/actions.ts:80-83`) ramènerait le constat chaque
nuit. Ce que le bloc doit rendre facile, c'est le geste que la consigne nomme, pas sa mise sous
silence : la modale porte l'explication et la consigne avant le champ de saisie (étape 6).

**La revalidation muette.** Un chemin absent ou mal formé passé à `revalidatePath` ne produit ni
erreur ni avertissement (piège 4). Une faute de frappe dans `/personnes/<username>` ne se verrait
nulle part, la fiche se rafraîchissant par ailleurs (piège 3) : la panne attendrait la version de
Next qui restreindra l'invalidation au chemin nommé. C'est la relecture du chemin écrit à l'étape 6,
contre la forme en usage, qui tient cet invariant, et elle seule.

**Le journal précède l'écriture, y compris quand on ajoute une lecture.** `actionTracee` journalise
avant d'écrire (`src/lib/actions.ts:43-46`). La lecture de `person` ajoutée par D12 se fait dans le
lookup existant, avant l'appel tracé : la glisser dans le bloc `ecrire` ferait dépendre la trace
d'une requête, ce que l'ordre interdit.

**Le bloc peut redevenir un fourre-tout.** `lot-1.5_interface.md:240-243` prévient : s'il finit par
afficher quelque chose sur chaque fiche, il cesse de signaler quoi que ce soit. Ce ticket n'ajoute
aucun motif, seulement des boutons, et D7 plafonne à deux. La dérive commencerait par un troisième.

**L'invariant du rapprochement n'est pas sollicité, et c'est ce qui doit rester vrai.** Aucun geste
de ce ticket ne coupe, donc `autoriseUneRevocation` (`src/core/rapprochement.ts:29-31`) n'entre pas
en jeu. Le piège serait qu'un futur bouton de retrait recopie la liste des méthodes révocables au
lieu de l'appeler : elle ne se recopie pas, elle s'appelle (`src/core/rapprochement.ts:16-17`).

**Aucune migration, et c'est un signal autant qu'un constat.** Si une étape se met à réclamer une
colonne, c'est qu'un geste a commencé à écrire un état que le socle ne connaît pas. Le double cache
Prisma ne se manifeste donc pas ici, à condition que rien ne touche `prisma/schema.prisma`.

**`ACTIONS_ENABLED` reste hors jeu, et doit le rester.** Rien de ce ticket n'écrit sur un système
cible (D15). Le corollaire est qu'il ne faut pas profiter de ce chemin pour y glisser un geste qui
toucherait un fournisseur : il contournerait le drapeau, et cela ne se verrait qu'au premier accès
coupé par erreur.

**Les tests ne couvrent pas l'écran.** `vitest` tourne en `environment: "node"` et rien ne rend un
composant (`lot-1.5_interface.md:249-252`). Un `pnpm verify` vert dit que le calcul des gestes est
juste, rien de plus. Le build Next est le seul filet sur le rendu, et il ne dit que la compilation.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire dès l'étape 4 où un composant
serveur passe en client. Au-delà, le parcours manuel, qui est aussi la Definition of Done :

1. Sur une fiche portant un `INACTIVE_STARTUP` ouvert : la consigne est suivie de deux boutons,
   « Rattacher à une startup » et « Clore », et d'aucun lien vers la file.
2. Le premier ouvre la modale de la section Startups, formulaire et explication rendus une seule fois
   dans la page. Poser un rattachement vers une startup vivante : la ligne apparaît dans la section
   avec son auteur, le journal montre `rattachement.pose` nominatif, et **le constat reste affiché**.
3. Le second, avec une raison saisie : la modale rappelle titre, explication et consigne avant le
   champ, le constat quitte le bloc sans rechargement manuel, réapparaît dans l'accordéon des
   constats fermés avec sa raison, et `/constats` ne l'affiche plus. Puis l'inverse, clore depuis
   `/constats` un constat portant sur une personne : sa fiche ne l'affiche plus non plus.
4. Inspecteur ouvert sur une fiche à plusieurs constats : un seul `<dialog>` par identifiant de
   modale, un seul bouton par `id`, aucune erreur de sérialisation en console.
5. Sur une fiche portant un `ORPHAN` : la description nomme le système et le compte, le seul bouton
   est « Clore », « Préparer le départ » restant unique en haut à droite. Sur une fiche dont toutes
   les startups sont terminées **sans** constat levé : « Rattacher à une startup » seul, la consigne
   une seule fois sur l'écran.
6. Sur une fiche portant un `OVERDUE_MANUAL_ACTION` : le lien ouvre le dossier en cours. Clore ce
   dossier, recharger la fiche : le lien a disparu, le bouton « Clore » reste.
7. Sur une fiche sans constat mais avec collecte périmée et surcharge : le bloc s'affiche sans aucun
   bouton. Sur une fiche sans aucun motif, il reste absent, titre compris.

Contrôle du verrou après le point 3, `pnpm sync` relancé :

```sql
SELECT "dedupKey", "closedAt", "closedBy", "closeReason" FROM "Finding"
WHERE "dedupKey" = 'INACTIVE_STARTUP:camille.rivet';
```

`closedBy` doit rester renseigné et le constat ne pas se rouvrir tant que la situation dure. Un
`closedBy` nul après une clôture depuis la fiche signerait un geste qui a contourné `cloreConstat`.

`ACTIONS_ENABLED` reste à `false` du début à la fin du parcours, et aucun appel sortant n'a lieu :
clore, rattacher et ouvrir un dossier ne touchent aucun système cible.
