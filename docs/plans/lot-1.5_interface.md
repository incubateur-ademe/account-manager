# Lot 1.5 : interface

> Plan unique du lot. Les six tickets partagent les mêmes partis pris, les écrire six fois les
> ferait diverger. Chaque ticket porte le quoi et le pourquoi, ce document porte les règles et le
> comment.

## Ce qui existe aujourd'hui

Constaté écran par écran sur la base de développement, 241 personnes, 21 startups, 13 constats
ouverts.

**La fiche d'une personne pèse 743 lignes**, plus que le tableau de bord, la file des constats, les
comptes isolés et la liste des personnes réunis (608). Elle empile sept sections de niveau 2, quatre
de niveau 3, sept emplacements d'alerte et sept composants interactifs.

**Rien n'y répond à la question qui amène quelqu'un dessus** : y a-t-il quelque chose à faire sur
cette personne. Le statut et sa phrase d'explication tiennent en trois lignes coincées entre le titre
et la section Situation. Les constats, seuls à dire qu'il y a à agir, arrivent en sixième position,
sous deux formulaires et un tableau.

**L'ordre des sections raconte l'histoire du développement, pas celle de l'usage.** « Appartenance à
l'incubateur » est en deuxième position et, tant qu'aucune surcharge n'est posée, ne contient que son
formulaire : un champ et deux boutons qui forcent une décision, présentés avant les constats de la
personne. « Corriger la fiche » est en troisième et, sur 236 des 241 fiches, ne contient qu'une phrase
disant qu'on ne peut rien y faire. Deux sections sur trois en haut de page sont donc soit un geste
d'exception, soit du texte mort.

**Les écrans se lisent comme une documentation avec des widgets dedans.** Le bloc « Rattacher à une
startup » compte trois phrases d'introduction, trois textes d'aide sous les champs et une quatrième
phrase après le bouton, pour trois saisies. « Observation » a droit à un titre de niveau 2 pour trois
dates que personne ne consulte.

**La même prose se répète à chaque ligne de tableau.** Sur les comptes isolés, chaque ligne embarque
deux formulaires complets, « Rattacher à » et « Ou créer une fiche », avec leurs libellés et leurs
deux textes d'aide : les mêmes phrases treize fois, et des lignes de près de trois cents pixels. Sur
la file des constats, treize lignes répètent mot pour mot « Compte sans détenteur connu » et sa
consigne, et chaque ligne porte en plus un champ de saisie et un bouton.

**Le tableau de bord souffre du défaut inverse.** Trois tuiles, une phrase, et soixante pour cent de
page vide sous la ligne de flottaison.

**Un défaut technique traverse tous les écrans.** Le DSFR pose ses attributs `data-fr-js-table` sur
les tableaux avant l'hydratation de React, qui signale l'écart et annonce explicitement qu'il ne le
rattrapera pas. Préexistant, sans symptôme visible à ce jour, mais présent sur chaque page portant un
tableau.

## Décisions de conception

**R1. Une page répond d'abord à « y a-t-il quelque chose à faire ».** Ce qui appelle une action passe
avant ce qui décrit. Sur une fiche, cela veut dire les constats ouverts, la péremption de la collecte
et les alertes de contradiction, réunis en un seul bloc sous l'en-tête.

**R2. Une page se lit ; les actions s'y déclenchent sans l'encombrer.** Les faits occupent la page.
Les actions qui portent sur la personne entière vivent en haut à droite, groupées, et n'occupent
qu'une ligne. Une action propre à une section reste dans sa section, mais sous forme de bouton, pas
de formulaire déplié. Un bloc d'actions dédié en bas de page serait un troisième empilement, pas une
simplification.

**R3. Modifier est une vue, pas une section.** « Corriger la fiche » cesse d'être un pavé sur la
fiche : un bouton « Éditer » mène à une vue d'édition qui porte les champs modifiables et la
correction d'identifiant. La fiche redevient ce qu'elle doit être, un écran de lecture. Le corollaire
tient tout seul : sur une fiche que la collecte réécrit, le bouton n'apparaît pas, et il n'y a plus
de section expliquant qu'on ne peut rien faire.

**R3 bis. Une action rare est discrète, pas cachée.** Elle reste sur la même ligne que les autres,
en priorité tertiaire, ce que le DSFR sait faire sans dépliant ni menu. Forcer une appartenance
concerne une poignée de fiches : elle ne doit pas peser autant que préparer un départ, ni pour autant
disparaître derrière un geste supplémentaire.

**R4. Une section qui n'a rien à dire ne s'affiche pas.** Pas de titre suivi d'une phrase expliquant
qu'il n'y a rien à voir.

**R5. Une explication se dit une fois par écran, jamais par ligne.** Une consigne identique répétée
treize fois cesse d'être lue dès la deuxième.

**R6. Une ligne de tableau porte un bouton, jamais un champ de saisie avec son libellé et son aide.**
C'est ce qui distingue « Détacher » et « Retirer », qui restent en ligne, de « Rattacher à » et
« Clore », qui en sortent. Le bouton de ligne ouvre une modale où le formulaire et son explication
vivent une seule fois.

La modale est celle de react-dsfr, `createModal`, ouverte au clic. L'alternative examinée était le
motif des routes parallèles et interceptées, qui donne une adresse à la modale, la rend partageable
et la fait survivre au rechargement, la page complète servant de repli. Elle est écartée pour une
raison précise : la modale du DSFR s'ouvre sur un état client, pas sur une URL, si bien qu'une modale
pilotée par la route oblige à réécrire le `<dialog>` avec sa propre feuille de style. C'est
exactement ce que fait le dépôt qui sert de référence sur ce motif, et cela ferait sauter R8 dès le
premier ticket. Le jour où partager le lien d'une modale devient un besoin constaté, le passage aux
routes interceptées sera une évolution, pas une réécriture.

**R7. Aucun libellé ne peut affirmer ce qu'il ne sait pas.** La précision du motif `STARTUP` dit
aujourd'hui « son échéance est la plus lointaine des startups auxquelles elle est rattachée », juste
au-dessus d'une ligne annonçant que l'échéance vient d'un rattachement manuel. Un libellé calculé
n'affirme que ce que son calcul établit.

**R8. DSFR strict, aucun CSS maison.** Composants et classes utilitaires du système de design de
l'État, et rien d'autre. Ce dépôt n'a aucune feuille de style propre, et ce lot n'en introduit pas :
la contrainte est un choix, elle garde l'outil aligné sur le reste du parc et évite de maintenir une
seconde grammaire visuelle pour un mainteneur à temps partiel.

La règle porte sur la grammaire visuelle, pas sur l'inventaire des composants. Là où le système de
design n'a rien à proposer, react-dsfr ouvre lui-même une porte : sa surcouche MUI, dont il aligne le
thème sur le sien. L'emprunt reste borné à ce qui manque, et le rendu continue de passer par les
classes du DSFR. Le premier cas est la saisie assistée, qu'il n'a pas : le `datalist` natif rend la
main sur deux cent quarante entrées, il n'affiche qu'un préfixe et ne cherche pas dans le libellé.
Emprunter n'est pas contourner : écrire ce composant à la main aurait fait exactement ce que cette
règle interdit.

**R9. Aucun changement de comportement métier.** Ce lot déplace, replie, supprime et reformule. Il ne
touche ni aux actions serveur, ni au calcul des constats, ni aux invariants. La seule exception est
R7, qui corrige un libellé faux, et c'est pour cela qu'elle fait l'objet d'un ticket de bug séparé.

## Le filaire de la fiche

L'écran visé, de haut en bas. Le nom des sections est indicatif, la structure ne l'est pas.

```
  Fil d'Ariane
  ─────────────────────────────────────────────────────────────────────
  Nom complet                        [Éditer]  [Préparer le départ]
  identifiant   [badge statut]                 Forcer l'appartenance
  Fiche espace-membre · Historique de cette personne
  ─────────────────────────────────────────────────────────────────────

  ┌─ CE QUI APPELLE UNE ACTION ───────────────────────────────┐  n'apparaît
  │  Phrase du statut                                         │  que s'il y a
  │  Constats ouverts, un par ligne, avec leur consigne       │  quelque chose
  │  Collecte périmée, startups terminées, contradiction      │
  └───────────────────────────────────────────────────────────┘

  Situation
    Échéance · Appartenance · Source
    Adresse principale · Adresse de communication · GitHub
    Une phrase, et une seule, sur l'origine de l'échéance
    L'encart de surcharge, quand il y en a une

  Startups                                    [Rattacher à une startup]
    Tableau en lecture, colonne Origine, bouton Retirer par ligne
    ▸ Rattachements clos ou expirés            (replié)

  Comptes externes
    Tableau en lecture, bouton Détacher par ligne

  Observée du 19 août 2026 au 19 août 2026, toujours présente.
```

Et la vue d'édition, derrière le bouton « Éditer », sur `/personnes/[username]/edit` :

```
  Fil d'Ariane > Nom complet > Éditer
  ─────────────────────────────────────────────────────────────────────
  Éditer la fiche de Nom complet                        [Retour]

  Champs modifiables
    Nom complet · Compte GitHub
    Adresse principale · Adresse de communication
    [Enregistrer]

  Identifiant
    Le champ, son avertissement, et l'aperçu de fusion le cas échéant
    [Corriger l'identifiant]
```

Cinq choses à remarquer, parce qu'elles portent l'essentiel.

Le bloc d'action **n'existe que s'il a quelque chose à dire**. Sur une fiche saine, la page commence
directement par Situation, et l'absence de bloc est en soi l'information : il n'y a rien à faire.

Les actions de page tiennent **sur une ligne, en haut à droite**, et rien d'autre ne les accompagne.
« Éditer » et « Préparer le départ » sont les gestes courants, en priorité secondaire ; « Forcer
l'appartenance » est rare, en priorité tertiaire, et ouvre une modale plutôt que de déplier un
formulaire dans la page.

**L'édition est une vue à part entière**, sur `/personnes/[username]/edit`, donc rechargeable et
partageable.
Elle porte les champs et la correction d'identifiant, fusion comprise. Le bouton n'existe pas sur une
fiche que la collecte réécrit, ce qui supprime d'un coup la section morte des 236 autres fiches.

**Rattacher à une startup** est une action de section, pas de page : son bouton vit dans l'en-tête de
la section Startups et ouvre une modale. C'est là qu'on le cherche, et le formulaire déplié cesse
d'occuper un tiers de la page.

La section « Observation » disparaît en tant que section. Ses trois dates deviennent une phrase de
pied de page, ce qu'elles ont toujours été.

## Découpage

Six tickets, dans cet ordre. Les deux premiers sont indissociables en revue mais séparables en
livraison, le premier laissant la page utilisable même si le second tarde.

**1. La fiche dit d'abord s'il y a quelque chose à faire.** Le bloc d'action, les constats remontés
depuis la sixième position, la fraîcheur et les alertes réunies. Ce que le ticket ne fait pas :
déplacer les gestes, qui restent où ils sont.

**2. La fiche redevient un écran de lecture.** Les actions de page remontent en haut à droite,
l'édition et la correction d'identifiant partent dans leur propre vue, le rattachement passe en
modale, les sections vides disparaissent et « Observation » se réduit à une phrase. C'est le ticket
qui fait passer les 743 lignes sous une taille relisible.

**3. Un libellé ne peut pas contredire la fiche.** Le bug de R7, et la revue de tous les libellés
calculés à la recherche de la même faute. Ticket de bug, indépendant des cinq autres.

**4. La file des constats cesse de se répéter.** Une consigne par type de constat et non par ligne,
le formulaire de clôture dans une modale.

**5. Les comptes isolés cessent de répéter deux formulaires par ligne.** Même traitement, même
modale. Le ticket le plus mécanique du lot, et celui qui gagne le plus de hauteur d'écran.

**6. L'avertissement d'hydratation du DSFR.** Technique et non UX, mais il traverse tous les écrans
que ce lot touche, et le corriger ailleurs qu'ici demanderait d'y revenir. À traiter en dernier,
parce qu'il faut d'abord savoir quels tableaux survivent au lot.

Le tableau de bord n'a pas de ticket. Son défaut est d'être vide, ce qui relève de l'issue #7 du lot
4, qui existe déjà et prévoit sa zone d'inventaire et ses tuiles de connecteur. Le remplir ici ferait
doublon.

## Hors périmètre

Aucune nouvelle donnée, aucune migration, aucune action serveur nouvelle. Aucun changement de
vocabulaire métier : celui-ci a été tranché avec le lot 1, « périmètre » désignant l'ensemble des
personnes suivies et « incubateur » l'appartenance.

Aucun travail sur les écrans que ce lot ne cite pas : comptes de service, systèmes, collectes,
journal. Ils suivront les mêmes règles le jour où on y touchera, et les règles sont écrites ici pour
ça.

Aucune feuille de style, aucun composant maison. Aucune dépendance ajoutée, à la seule exception de
la surcouche MUI de react-dsfr et de ce qu'elle exige, au titre de R8 et pour ce que le DSFR n'a
pas.

## Risques et pièges

**Le repliement peut cacher ce qu'il fallait voir.** Un geste replié est un geste qu'on ne trouve
plus. La règle qui protège : on ne replie que ce qui concerne une poignée de fiches, jamais ce qui
concerne toutes. Préparer un départ ne se replie pas.

**Le bloc d'action peut devenir un fourre-tout.** S'il finit par afficher quelque chose sur chaque
fiche, il cesse de signaler quoi que ce soit et redevient une section comme les autres. Son contenu
se limite à ce qui appelle un geste : constats ouverts, données périmées, contradictions. Pas les
informations simplement notables.

**Une modale masque le contexte.** Sur les comptes isolés, l'opérateur décide en regardant les accès
constatés du compte : la modale doit les porter, sans quoi elle l'oblige à mémoriser la ligne avant
de cliquer.

**Les tests ne couvrent pas les écrans.** `vitest` tourne en `environment: "node"`, aucun test ne rend
un composant, et ce lot n'en introduit pas. La vérification est donc manuelle et le reste : c'est
assumé, mais il ne faut pas présenter un `pnpm verify` vert comme une preuve que l'interface marche.
Le build Next reste le seul filet automatique, et il ne dit que la compilation.

**Le DSFR contraint plus qu'il n'y paraît.** Ses composants n'offrent pas tout ce qu'une page dense
demande. Là où il manque quelque chose, on compose avec ce qu'il a plutôt que d'écrire du CSS : c'est
R8, et elle ne se contourne pas au premier obstacle. Quand il ne manque pas un habillage mais un
composant entier, l'emprunt à la surcouche MUI est la sortie prévue, à condition que le rendu reste
habillé par le DSFR.

## Vérification

`pnpm verify` puis le build, qui reste le seul contrôle automatique.

Puis, à l'écran, sur la base de développement, quatre fiches qui couvrent les cas : une personne
saine sans constat, une personne à traiter avec ses constats ouverts, une fiche fabriquée éditable et
renommable, une personne portant une surcharge contradictoire. Sur chacune, la question à se poser
est la même : en arrivant dessus, combien de temps pour savoir s'il y a quelque chose à faire.

Sur les comptes isolés et la file des constats, compter le nombre de lignes visibles sans défiler
avant et après. C'est la mesure la plus honnête du lot.
