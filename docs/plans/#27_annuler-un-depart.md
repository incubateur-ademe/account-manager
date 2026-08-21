# Annuler un départ, et savoir qu'il est ouvert (#27)

> Plan d'implémentation de l'issue #27. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### Le dossier et son plan ont chacun un état d'annulation, et personne ne l'écrit

**Les deux valeurs existent en base depuis la migration initiale, et la colonne du motif aussi.**
`DepartureState` porte `CANCELLED` (`prisma/schema.prisma:366-372`), `PlanState` également
(`:396-405`), et les deux types énumérés sont créés avec elles
(`prisma/migrations/20260808000000_init/migration.sql:23` et `:29`). `DepartureCase.cancelledReason`
(`prisma/schema.prisma:381`) figure dans le `CREATE TABLE` du premier jour (`migration.sql:201`).
Aucune ligne de `src/` ne les écrit ni ne les lit : la seule mention de `CANCELLED` hors du schéma
est le type `EtatPlan` (`src/core/depart.ts:12`) et une assertion négative de test
(`src/core/depart.test.ts:178`).

**La machine à états est complète, et elle tient en sept des huit fonctions du module.**
`src/core/depart.ts` n'importe rien d'autre que `autoriseUneRevocation` et le type `Peremption` :
`peutConfirmer` (`:28-49`), `peutPointer` (`:56-64`), `estSoldee` (`:67-69`), `etatApresPointage`
(`:79-87`), `dossierSoldable` (`:94-96`), `peutRecalculer` (`:152-166`) et `etatDUnPlanRemplace`
(`:173-175`). La huitième, `systemesDuDepart` (`:120-142`), ne décide d'aucune transition : elle
range les systèmes. Les gardes rendent un `Verdict` (`:21`), déclaré avec le `Refus` qu'il porte
(`:16-19`), que les actions consomment sans le traduire. Trois d'entre elles refusent déjà un plan
annulé sans le savoir : `peutPointer` rend « Ce plan est clos. » pour tout ce qui n'est ni
`EXECUTING` ni `DRAFT` (`:63`), `peutConfirmer` et `peutRecalculer` refusent tout ce qui n'est pas
un brouillon (`:29-31`, `:153-158`). Poser `CANCELLED` sur un plan ferme trois portes d'un coup.

**Les quatre actions du dossier ont la même forme, et `cloreDossier` est le modèle exact.**
`cloreDossier` (`src/app/departs/[id]/actions.ts:190-232`) charge le dossier avec son dernier plan
(`:196-204`), refuse l'état `DONE` (`:209-211`), applique une fonction pure du noyau (`:214-218`),
trace `depart.cloture` sur `targetType: "personne"` et le `username` (`:221-223`), revalide les deux
chemins concernés (`:225`), puis écrit (`:227`). Toute écriture passe par `actionTracee`
(`src/lib/actions.ts:30-57`), qui vérifie la session, journalise avant l'écriture (`:43`) et repose
une trace en échec si l'écriture casse (`:51-55`).

**Le motif obligatoire a trois précédents et un seuil unique.** `cloreConstat`
(`src/app/constats/actions.ts:20-22`), `pointerEtape` (`src/app/departs/[id]/actions.ts:141-148`) et
`forcerAppartenance` (`src/app/personnes/[username]/actions.ts:312-317`) refusent tous trois une
raison de moins de trois caractères. Le troisième est le plus proche du geste traité ici, et sa
phrase vient du schéma, sur `ScopeOverride.reason` (`prisma/schema.prisma:356-358`) : « une décision
d'appartenance sans motif est une décision qu'on ne saura pas réexaminer ».

### L'écran d'un dossier ne sait rendre ni une annulation ni un plan remplacé

**Le rendu se pilote par trois booléens, et aucun ne connaît l'annulation.** `brouillon`, `enCours`
et `clos` (`src/app/departs/[id]/page.tsx:106-108`) commandent les alertes de péremption
(`:144-176`), le pointage sous chaque étape (`:266`), la phrase de confirmation avec son bouton
(`:272-280`) et la clôture (`:282-284`). Un dossier `CANCELLED` afficherait donc exactement la page
d'un dossier vivant : le titre « Ce qui sera à faire » (`:209-211`), la liste complète des étapes,
un bouton de confirmation qui aboutit, et un pied de page annonçant « valable jusqu'au » sur un plan
qui ne vaut plus (`:304-310`).

**Deux états de plan sont invisibles par construction, sauf par une panne.** La requête prend
`take: 1` sur les plans triés par date décroissante (`:62-64`), si bien qu'un plan `EXPIRED` ou
`STALE` n'est jamais le dernier, un recalcul en créant aussitôt un neuf. Sauf que `recalculerPlan`
écrit deux fois sans transaction (`src/app/departs/[id]/actions.ts:278-284`) : une panne entre les
deux laisse le dossier avec un dernier plan remplacé et aucun brouillon, état que l'écran rend comme
s'il était vivant.

**Les composants clients suivent un patron unique**, `useActionState` plus un formulaire à champ
caché, bouton désactivé pendant l'envoi et paragraphe d'erreur en `role="alert"`
(`src/app/departs/[id]/Pointage.tsx:15-34`, `:41-94`, `:96-115`, `:117-136`). Pour un motif
obligatoire en modale, l'exemple exact est `ClotureConstat`
(`src/app/constats/ClotureConstat.tsx:11-42`).

### Ce qui manque

**La fiche ne lit aucun `departureCase`.** Les trois requêtes parallèles de la page
(`src/app/personnes/[username]/page.tsx:70-138`) et la lecture des startups (`:146-149`) ne touchent
jamais cette table ; les deux seuls accès à `departureCase` dans le dossier `personnes/[username]`
servent la fusion, en lecture (`edition.ts:155`) et en écriture (`:469`). La fiche ne sait donc rien
des dossiers, ni ouverts ni clos, et `BoutonDepart` reçoit `{ username }` et rien d'autre
(`BoutonDepart.tsx:20`). La relation existe pourtant, `Person.departureCases`
(`prisma/schema.prisma:122`), et l'index `@@index([personId])` (`:386`) couvre la lecture.

**Le bloc qui accueillerait le dossier existe, et il est pur.** `motifsDAction`
(`src/app/personnes/[username]/motifs.ts:28-119`) assemble sept familles de motifs depuis
`EtatDeLaFiche` (`:10-20`), `CeQuiAppelleUneAction` (`.../CeQuiAppelleUneAction.tsx:31-64`) rend
`null` sur une liste vide, et `MotifDAction` porte déjà un lien optionnel (`:15-22`) rendu à la
suite de la description (`:50-57`).

**La règle « dossier vivant » est écrite en dur, deux fois, sans fonction partagée.** Le littéral
`["WATCH", "CANDIDATE", "CONFIRMED"]` vit dans le `findFirst` d'`ouvrirDossierDeDepart`
(`src/lib/depart.ts:122-125`) et dans la projection de la fusion
(`src/app/personnes/[username]/edition.ts:174-177`). Deux copies, aucun test commun, et rien qui
casse si l'une dérive.

**L'annulation est déjà promise à l'opérateur, et le geste n'existe pas.** Le blocage de fusion dit
« Clôturez ou annulez l'un des deux avant de fusionner » (`src/core/fiche-manuelle.ts:381`), sous un
commentaire qui pose la règle du dossier unique (`:374-377`). Le test qui couvre ce blocage
(`src/core/fiche-manuelle.test.ts:183-242`) vérifie la phrase, la liste d'étapes vide, puis la levée
du blocage dès qu'un des deux dossiers cesse d'être vivant : ce qu'une annulation produit y est
déjà, et il ne doit pas bouger.

### Les pièges déjà présents dans le code

1. **`confirmerPlan` ne regarde jamais l'état du dossier.** Sa garde ne porte que sur `plan.state`
   (`src/app/departs/[id]/actions.ts:65-69`), et le plan chargé ne sélectionne même pas l'état de
   son dossier (`:28-41`). Annuler le dossier en laissant son plan en `DRAFT` laisserait un bouton
   de confirmation rendu, cliquable et aboutissant. C'est le piège central de ce ticket.
2. **`cloreDossier` ne refuse que `DONE`** (`:209-211`) et rendrait, sur un dossier annulé, « Toutes
   les étapes ne sont pas soldées : des accès restent ouverts. » (`:216`). La phrase est fausse et
   envoie pointer des étapes sur un plan qui n'est plus pointable.
3. **`recalculerPlan` écrit deux fois sans transaction** (`:278-284`), et la panne intermédiaire
   fabrique le seul dossier sans brouillon que le produit sache produire.
4. **`ouvrirDossierDeDepart` n'a pas d'index derrière lui** : `findFirst` puis `create`, sans
   transaction (`src/lib/depart.ts:122-140`), l'unicité du dossier vivant étant purement
   applicative.
5. **La trace `depart.ouverture` ne distingue pas les deux cas** : elle est écrite même quand le
   dossier existait déjà (`src/app/departs/actions.ts:51-68`), seul le paramètre d'adresse le dit
   (`:75`). Dans le même fichier, l'entrée `"/departs"` de `revalider` vise une route absente
   (`:56`, et `src/app/personnes/[username]/edition.ts:425`) : `src/app/departs/` ne contient que
   `actions.ts` et `[id]/`, et le seul `revalidatePath` du dépôt consomme ce tableau
   (`src/lib/actions.ts:48`).
6. **Aucun test ne touche la base.** `vitest.config.ts` fixe `environment: "node"` (`:11-15`). Tout
   ce qui doit être couvert doit être pur.

## Décisions de conception

**D1. Annuler porte sur le dossier et sur son brouillon, dans une seule transaction.** L'écriture
est `departureCase.update({ state: "CANCELLED", cancelledReason })` suivie, quand il y a un
brouillon, de `plan.update({ state: "CANCELLED" })`, les deux dans un `prisma.$transaction` à
l'intérieur du bloc tracé, sur le modèle de la pose d'un rattachement qui en remplace un autre
(`src/app/personnes/[username]/actions.ts:199-223`).

L'alternative examinée est de n'annuler que le dossier, ce qui suffirait à débloquer la fusion et à
rouvrir un départ, « dossier vivant » ne regardant que `DepartureCase.state`
(`src/lib/depart.ts:123`). Elle tombe sur une panne précise : `confirmerPlan` ne lit jamais l'état
du dossier (`src/app/departs/[id]/actions.ts:65-69`). Un brouillon laissé sous un dossier annulé
garderait son bouton (`page.tsx:272-280`), passerait en `EXECUTING` (`actions.ts:85`), deviendrait
pointable, et ses étapes pointées « faites » entreraient dans `actionsDeclarees`
(`src/lib/sync/constats.ts:219-221`) pour produire des constats de vérification sur un départ que
quelqu'un avait explicitement annulé.

D1 ne suffit pourtant pas seule. `recalculerPlan` lit `plan.state` (`[id]/actions.ts:264`) puis crée
un brouillon neuf hors transaction (`:283`) : deux opérateurs simultanés, l'un recalculant, l'autre
annulant, laissent un `DRAFT` sous un dossier `CANCELLED`, sans aucune panne d'infrastructure. La
porte se ferme avec la pièce que D7 fournit, `planDuDossier` (`:28-41`) sélectionnant aussi l'état
du dossier et les deux actions refusant quand `dossierVivant` est faux.

**D2. « Tant que rien n'a été confirmé » se lit dans l'état du plan, jamais dans `confirmedAt`.** La
frontière exacte est le passage `DRAFT` vers `EXECUTING` de `confirmerPlan`
(`src/app/departs/[id]/actions.ts:85`), qui écrit au même moment `confirmedBy` et `confirmedAt`
(`:87-88`). Trois états disent l'engagement et refusent l'annulation, `EXECUTING`, `EXECUTED` et
`PARTIALLY_EXECUTED`, ce que §6 tranche dans le même sens : « Pas d'approbateurs multiples, pas de
fenêtre de rétractation, pas de quorum » (`docs/architecture.md:614`). Trois autres ne l'ont jamais
eu : `DRAFT`, `EXPIRED`, `STALE`. `CONFIRMABLE` complète la liste, aucun code ne le posant et le
seul plan que le produit crée naissant en brouillon (`src/lib/depart.ts:163-168`) ; le document
l'oppose à l'attente plutôt qu'il ne l'y range, la délégation devant faire naître un plan « en
attente au lieu de naître confirmable » (`docs/architecture.md:619-620`). Il désigne donc un plan
que personne n'a confirmé, annulable au même titre qu'un brouillon.

L'alternative écartée est `confirmedAt === null` : nulle sur un brouillon, sur un plan remplacé et
sur un plan annulé, cette colonne ne dit que ce qui n'est pas arrivé au plan. Corollaire : seul un
plan que personne n'a confirmé passe en `CANCELLED`, c'est-à-dire `DRAFT` et `CONFIRMABLE`. Un plan
`EXPIRED` ou `STALE` garde son état, portant déjà ce qui l'a écarté, `etatDUnPlanRemplace`
distinguant exprès un fait daté d'une comparaison (`src/core/depart.ts:168-175`). Conséquence
assumée, et elle se paie : sur un plan engagé la seule sortie est la clôture, qui exige un plan
soldé (`:94-96`), donc autant d'étapes pointées « écartée » avec leur note
(`[id]/actions.ts:141-148`) qu'il en reste ouvertes, et ces déclarations se relisent au journal
comme des arbitrages. Élargir la règle à un plan confirmé mais jamais pointé serait une fenêtre de
rétractation, donc une décision d'architecture.

**D3. La garde est une fonction pure rendant un `Verdict`, et l'absence de plan y est un cas
nominal.** `peutAnnuler(dossier, plan)` se pose entre `dossierSoldable` (`src/core/depart.ts:94-96`)
et `CompteConstate` (`:98`). Le noyau ne connaît que `EtatEtape` et `EtatPlan` (`:4-14`), les états
de dossier n'étant lus que par des littéraux dans `src/lib` et `src/app` : `EtatDossier` les
rejoint, miroir de `DepartureState` (`prisma/schema.prisma:366-372`). Trois refus, trois phrases
distinctes : dossier déjà annulé, dossier clos, plan engagé. `peutConfirmer` en donne quatre sur le
même modèle (`:28-49`), et son test dit pourquoi elles ne se confondent pas
(`src/core/depart.test.ts:24-34`).

Un dossier sans plan s'annule, et c'est aujourd'hui le seul geste qui le sorte de l'impasse : la
panne entre les deux écritures de `recalculerPlan` (`[id]/actions.ts:278-284`) laisse un dossier
vivant sans brouillon, que `ouvrirDossierDeDepart` rend tel quel (`src/lib/depart.ts:122-128`), que
la confirmation et le recalcul refusent, et que la clôture refuse avec le message des accès restés
ouverts. Une fonction pure qui lèverait sur l'absence de plan ferait tomber l'action au lieu de la
refuser. L'alternative, écrire la règle dans l'action serveur, tombe sur la contrainte de test :
aucun test ne touche la base (`vitest.config.ts:11-15`), donc une règle écrite là devient
invérifiable.

**D4. Le motif est obligatoire, au même seuil de trois caractères, et il s'écrit deux fois.** Il va
dans `DepartureCase.cancelledReason` (`prisma/schema.prisma:381`) et dans la charge utile de la
trace : la colonne rend le motif lisible sur l'écran sans passer par le journal, le journal le rend
nominatif et daté. Le précédent est exact, `cloreConstat` écrivant la même raison dans
`Finding.closeReason` et dans sa trace (`src/app/constats/actions.ts:40-46`). Le refus est côté
serveur avant toute lecture, `messageObligatoire` (`src/ui/validation.ts:12-21`) ne protégeant que
le navigateur. L'alternative, un motif facultatif avec un libellé par défaut, tombe sur la règle
déjà écrite dans le schéma (`prisma/schema.prisma:356-358`) : un dossier annulé sans motif est
indiscernable d'un dossier ouvert par erreur, et c'est la question qu'on se posera en le retrouvant.

**D5. Ni `cancelledBy` ni `cancelledAt` : l'asymétrie avec la confirmation est assumée, et elle se
paie une seule fois.** Face à `confirmedBy` et `confirmedAt` (`prisma/schema.prisma:418-419`),
l'annulation n'a que sa colonne de motif. `actionTracee` écrit déjà le nom et la date avant
l'écriture métier (`src/lib/actions.ts:31-43`), et le schéma a tranché dans ce sens pour
`ScopeOverride`, dont le commentaire dit que « L'historique n'est pas dupliqué ici : il vit dans le
journal » (`prisma/schema.prisma:346-347`). `confirmedBy` et `confirmedAt` existent pour une autre
raison : ils sont relus à chaque affichage du dossier (`src/app/departs/[id]/page.tsx:306-308`), une
confirmation étant un engagement qu'on relit tant que le dossier vit, là où une annulation se lit
une fois.

L'alternative coûterait deux colonnes nullables, une migration additive et deux lignes à amender
dans le schéma cible de #8, dont le SQL est déjà rédigé
(`docs/plans/#08_plan-generique.md:260-276`). Le prix n'est pas l'écriture, c'est qu'une colonne
d'auteur que nul écran ne lit devient une colonne qu'on croit peuplée. Le jour où un écran voudra
afficher « annulé par », l'ajouter restera une migration additive.

**D6. `cloreDossier` refuse par une fonction pure, exactement comme l'annulation.** Le refus d'un
dossier annulé existe déjà, mais il passe par `dossierSoldable` (`[id]/actions.ts:214-218`) et rend
« Toutes les étapes ne sont pas soldées : des accès restent ouverts. » (`:216`). La phrase affirme
un fait qu'elle ne connaît pas, ce que R7 du lot 1.5 interdit, et elle envoie pointer des étapes sur
un plan qui n'est plus pointable. Écrire le nouveau refus à côté du test sur `DONE` (`:209-211`)
tomberait sur la contrainte que D3 vient de poser : rien ne teste la base, donc rien ne vérifierait
la seule règle non facultative de ce ticket. `peutClore(dossier, plan)` rejoint donc `peutAnnuler`
dans le noyau et absorbe les trois refus, dossier clos, dossier annulé, plan non soldé. Bénéfice de
bord : la tautologie `dossierSoldable("EXECUTED")` (`src/app/departs/[id]/page.tsx:282`), un appel
dont l'argument porte déjà la réponse, disparaît avec elle.

**D7. « Dossier vivant » devient une fonction du noyau, et c'est le seul littéral recopié que ce
ticket supprime.** `dossierVivant(etat)` remplace les deux littéraux de `src/lib/depart.ts:123` et
de `src/app/personnes/[username]/edition.ts:176`, et trois appelants neufs s'y ajoutent : la lecture
de la fiche, puis les deux gardes qui gagnent l'état du dossier (D1). `peutAnnuler` et `peutClore`
ne l'appellent pas, leurs refus devant nommer lequel des deux états ferme la porte. La fonction
s'adosse à un `Record<EtatDossier, boolean>` et non à un tableau, sur le modèle de `ETAPE`
(`src/app/departs/[id]/page.tsx:24-31`) : une valeur ajoutée à `EtatDossier` fait alors échouer le
typecheck tant que personne n'a dit de quel côté elle tombe. `ETATS_VIVANTS` s'en déduit, pour le
`in` que Prisma attend.

#8 le demande déjà : `ouvrirDossier(personId, kind, effectiveDate)` doit tenir « un seul dossier
vivant par personne et par sens » (`docs/plans/#08_plan-generique.md:392-394`), ce qu'un littéral
recopié à chaque appel ne sait pas faire. Le dépôt a déjà payé ce prix une fois : « elle était
recopiée dans le calcul des constats et absente de celui des plans, où son oubli ne se voyait pas »
(`src/core/rapprochement.ts:16-17`).

**D8. L'écran du dossier nomme l'annulation, et nomme aussi les deux états qu'il taisait.** Un
quatrième dérivé rejoint les trois existants (`src/app/departs/[id]/page.tsx:106-108`) et commande
tout ce qui écrit : la bannière de péremption, le pointage, la confirmation et la clôture cessent de
se rendre, un badge rejoint celui de la clôture dans le titre, une alerte porte le motif, et l'étape
6 nomme chaque emplacement. Le recalcul d'affichage est court-circuité (`:100-103`) : ses trois
sorties, la péremption (`:105`), les comptes non confirmés (`:178-198`) et les systèmes sans
connecteur (`:200-207`), ne servent plus à rien, et le laisser coûterait un tour de connecteurs par
affichage.

`EXPIRED` et `STALE` entrent dans le périmètre, mais au minimum : une phrase qui dit que le
remplacement du brouillon n'a pas abouti, et aucun bouton. `peutRecalculer` refuse à juste titre un
plan qui n'est plus un brouillon (`src/core/depart.ts:153-158`), et proposer un bouton qui répond
toujours non serait pire que pas de bouton du tout, comme #8 le pose pour la bannière de dérive
(`docs/plans/#08_plan-generique.md:430-432`). Le geste qui reste sur ce dossier est justement
l'annulation.

**D9. La fiche signale le dossier en cours, et rien d'autre.** Un dossier vivant appelle un geste :
y retourner, le confirmer, le pointer ou l'annuler. Il entre donc dans `motifsDAction`
(`src/app/personnes/[username]/motifs.ts:28`), en tête de liste, avec son lien vers le dossier. En
tête parce que c'est la réponse la plus courte à « y a-t-il quelque chose à faire » : placé sous les
constats, il faudrait le chercher, sur une fiche qui en porte cinq, pour apprendre que le travail a
déjà commencé. Sa gravité est `info` et non `warning` : un départ en cours n'est pas un écart.

Cette ligne coexiste avec le constat de sortie du référentiel, et c'est le cas courant. Ce n'est pas
le doublon qu'écartent `sortieDejaConstatee` (`motifs.ts:36-38`) et `constatDejaLeve` (`:64`), où
deux lignes portaient la même chose : le constat dit la situation et ce qu'elle appelle, « Vérifier
ses accès et les couper, puis clore ce constat. » (`src/core/libelle-constat.ts:25`), le dossier dit
que ce travail a commencé et où il se poursuit. L'`info` passe devant l'`error` parce que l'ordre du
bloc suit le geste et non la gravité (`motifs.ts:28-119`) : reprendre le dossier solde les deux,
quand le lien du constat mène à la file (`.../CeQuiAppelleUneAction.tsx:74-77`).

Un dossier clos ou annulé ne va nulle part ici : « Son contenu se limite à ce qui appelle un geste :
constats ouverts, données périmées, contradictions. Pas les informations simplement notables. »
(`docs/plans/lot-1.5_interface.md:240-243`). L'alternative examinée, une section « Dossiers » sur la
fiche, tombe sur R4 du même lot et sur une destination déjà prévue, la page personnelle de #14
portant un bloc « Vos dossiers » (`docs/plans/#14_page-perso.md:134`). Conséquence assumée : après
l'annulation la fiche cesse de mentionner ce départ, et le seul chemin qui y ramène est le journal
de la personne, déjà lié depuis la fiche (`src/app/personnes/[username]/page.tsx:306-311`).

**D10. Le journal reçoit `depart.annulation`, et sa cible reste la personne.** Le verbe s'ajoute
dans `LIBELLE_ACTION` juste après `depart.recalcul` (`src/app/journal/libelles.ts:22`). Sans lui, le
journal afficherait la valeur brute : le repli est explicite (`:56-74`) et il existe pour ne pas
laisser une case muette, pas pour dispenser d'écrire le libellé. `LIBELLE_CIBLE` connaît `personne`,
`plan` et `etape`, pas `dossier` (`:38-48`) : on ne l'ajoute pas, on suit `depart.cloture`, qui
cible déjà la personne par son `username` (`src/app/departs/[id]/actions.ts:221-223`). La raison est
le filtre du journal, qui retient les événements dont la cible vaut l'identifiant ou se termine par
lui (`src/app/journal/criteres.ts:133-144`) : une cible portant l'identifiant technique du dossier
sortirait l'annulation de l'historique de la personne, du seul endroit où on la cherchera.

**D11. Rien à toucher côté environnement, ni côté systèmes cibles.** `src/lib/env.ts` ne change pas.
Annuler est une écriture locale : deux mises à jour en base et une trace. Aucun connecteur n'est
appelé, `RunContext.dryRun` n'entre pas en jeu, et `ACTIONS_ENABLED` reste à `false` par défaut
(`src/lib/env.ts:22-26`) sans que rien de ce ticket ne le lise. Le corollaire est le même que
partout : il ne faut pas glisser dans ce chemin un geste vers un fournisseur, il contournerait le
drapeau. Contrôle de revue : le code ajouté n'importe ni `@/connectors` ni `env`.

**D12. Rien de ce qui est écrit ici n'est à défaire par #8 : ce qui lui revient tient en
renommages.** Il laisse `DepartureCase` vers `AccessCase` et `DepartureState` vers `CaseState`,
valeurs inchangées (`docs/plans/#08_plan-generique.md:85-97`), `src/core/depart.ts` vers
`src/core/dossier.ts` (`:382-383`), `src/app/departs` vers `src/app/dossiers` (`:417-420`), le verbe
`dossier.annulation`, absent de la liste des cinq verbes de sa D8 (`:167-175`), et le chemin
`/departs/<id>` codé en dur dans le motif de la fiche.

Il lui évite davantage. `CANCELLED` est conservé dans les deux sens (`:82`, `:213`) ; `peutAnnuler`,
`peutClore` et `dossierVivant` atterrissent dans `src/core/dossier.ts` à côté de `etatsAdmis(kind)`
et `peutOuvrir(kind, etat)` (`:382-383`), et `dossierVivant` est précisément ce dont `ouvrirDossier`
a besoin (`:392-394`) ; aucune colonne n'est ajoutée, donc le SQL déjà rédigé n'est pas à amender
(`:260-276`). #8 ne dit rien de l'annulation comme geste : ce plan comble un manque, il ne conçoit
pas contre.

**D13. Tension avec `docs/architecture.md` : aucune, et un ajout à proposer.** Le document ne nomme
aucun état de dossier ni de plan : §3.3 se contente de lister `DepartureCase`, `Plan` et `PlanStep`
parmi les objets décidés (`docs/architecture.md:289-292`), et §2.3 pose que « Ce qui coupe des accès
reste le dossier de départ, avec son plan, sa confirmation et son journal » (`:191-196`). Rien n'est
contredit : annuler ne coupe rien, ne date aucune disparition et ne ferme aucun constat.

Le document est seulement incomplet : il décrit la confirmation et l'exécution (§5.6 `:514-527`, §6
`:609-620`) sans dire ce qu'il advient d'un dossier qu'on renonce à instruire. Trois phrases à
ajouter en §3.3, plus une quatrième qui évite une transposition de travers, §4.2 disant d'une
clôture de constat qu'elle « retient le nom de son auteur » (`:388-389`) alors que pour un dossier
ce nom vit au journal (D5). La modification est **proposée à l'étape 8 et appliquée seulement après
validation explicite**, le document ne se modifiant pas sans accord.

## Modèle de données

**Aucune migration Prisma.** Les trois éléments dont ce ticket a besoin sont en base depuis le
premier jour : `DepartureState.CANCELLED` (`prisma/schema.prisma:370`), `PlanState.CANCELLED`
(`:402`) et `DepartureCase.cancelledReason` (`:381`). Les deux types énumérés les portent dès leur
création (`prisma/migrations/20260808000000_init/migration.sql:23` et `:29`) et la colonne figure
dans le `CREATE TABLE` (`:195-204`, ligne `:201`). Aucune ligne de `src/` ne les écrit ni ne les
lit : ce plan se sert d'un modèle déjà posé. Le décidé de `docs/architecture.md` §3.3 (`:289-292`)
le confirme plutôt qu'il ne l'excuse : une annulation relève du décidé, comme la clôture d'un
dossier, et le décidé vit en base. La question n'est pas de savoir s'il faut persister, mais si la
place manque, et elle ne manque pas.

Le seul ajout au fichier de schéma est un commentaire de documentation, qui n'engendre aucun SQL :

```prisma
model DepartureCase {
  /// Pourquoi le dossier a ete abandonne, ecrit en meme temps que l'etat CANCELLED.
  /// Obligatoire cote action : une decision sans motif est une decision qu'on ne
  /// saura pas reexaminer. Le nom de son auteur et sa date vivent au journal.
  cancelledReason String?
  // le reste inchange
}
```

**Aucune reprise de données, et il n'y a rien à reprendre.** Tout dossier en base vaut `CANDIDATE`
ou `DONE`, les deux seules valeurs qu'un code pose (`src/lib/depart.ts:136`,
`src/app/departs/[id]/actions.ts:227`). Aucun dossier n'est annulé rétroactivement : l'annulation
est une décision humaine datée, et en fabriquer par migration inventerait des décisions que personne
n'a prises.

**Rappel de discipline, retourné en signal d'alarme.** Toute modification du schéma exige
`pnpm db:generate` puis un redémarrage de `pnpm dev`, faute de quoi le client généré et celui mis en
cache sur `globalThis` servent des métadonnées périmées, avec pour symptôme littéral
`Unknown argument 'X'` ou `Value 'X' not found in enum 'Y'` pendant que le typecheck passe. Ici, un
commentaire de documentation ne produit aucun SQL et `pnpm db:migrate` n'a rien à écrire : il ne se
propage dans le client généré qu'après `pnpm db:generate`, mais rien ne casse s'il ne l'est pas, et
aucune migration n'est due. Si une étape en réclame une, c'est le signe qu'on a glissé hors du
ticket : une colonne d'auteur y est entrée par la porte de derrière, contre D5.

**Côté politique, rien.** Le seuil de trois caractères du motif est le littéral déjà présent chez
`cloreConstat` (`src/app/constats/actions.ts:20`), `pointerEtape`
(`src/app/departs/[id]/actions.ts:141`) et `forcerAppartenance`
(`src/app/personnes/[username]/actions.ts:312`) : le sortir en configuration ferait de quatre
valeurs identiques une clé que personne ne changera jamais.

## Découpage en étapes

### 1. Le noyau : la garde, l'état de dossier et la règle du dossier vivant

Fichiers : `src/core/depart.ts`, `src/core/depart.test.ts`.

- `EtatDossier` rejoint `EtatEtape` et `EtatPlan` (`src/core/depart.ts:4-14`), miroir de
  `DepartureState` (`prisma/schema.prisma:366-372`).
- `dossierVivant` s'adosse à un `Record<EtatDossier, boolean>` (D7). `ETATS_VIVANTS` s'en déduit du
  dictionnaire, et la déduction porte l'assertion vers `EtatDossier[]` que `@tsconfig/strictest`
  impose, `Object.keys` rendant `string[]`. Sans elle, l'implémentation retombera sur un tableau
  littéral et perdra le garde-fou de typecheck qui est toute la raison d'être du dictionnaire.
- `peutAnnuler` se pose entre `dossierSoldable` (`:94-96`) et `CompteConstate` (`:98`), avec un
  commentaire qui dit pourquoi un plan engagé ne s'annule pas.
- `peutClore` la suit et absorbe les trois refus que l'action porte aujourd'hui en dur (D6).
- `planAAnnuler` isole le corollaire de D2 : vrai de `DRAFT` et de `CONFIRMABLE`, faux partout
  ailleurs, un plan remplacé gardant ce qui l'a écarté.

```ts
export type EtatDossier = "WATCH" | "CANDIDATE" | "CONFIRMED" | "CANCELLED" | "DONE";
export const ETATS_VIVANTS: readonly EtatDossier[];
export function dossierVivant(etat: EtatDossier): boolean;
export function peutAnnuler(dossier: EtatDossier, plan: EtatPlan | null): Verdict;
export function peutClore(dossier: EtatDossier, plan: EtatPlan | null): Verdict;
export function planAAnnuler(plan: EtatPlan | null): boolean;
```

Livrable vérifiable : `pnpm test` passe, les cinq scénarios sont verts, et rien d'autre dans
l'application n'a bougé. Les cinq ajouts sont purs, sans Prisma, sans horloge et sans environnement.

### 2. « Dossier vivant » cesse d'exister en deux exemplaires

Fichiers : `src/lib/depart.ts`, `src/app/personnes/[username]/edition.ts`.

Le `findFirst` d'`ouvrirDossierDeDepart` lit `state: { in: [...ETATS_VIVANTS] }`
(`src/lib/depart.ts:122-125`) et son commentaire d'en-tête reste (`:111-117`) : il dit la règle, la
fonction la porte désormais. La projection de la fusion appelle `dossierVivant(dossier.state)`
(`src/app/personnes/[username]/edition.ts:174-177`).

Livrable vérifiable : aucun changement de comportement, `pnpm test` reste vert sans qu'un seul test
soit touché, blocage de fusion compris (`src/core/fiche-manuelle.test.ts:183-242`),
`DossierDeFiche.vivant` (`src/core/fiche-manuelle.ts:156-159`) restant un booléen calculé en amont.

### 3. L'action serveur et son verbe de journal

Fichiers : `src/app/departs/[id]/actions.ts`, `src/app/journal/libelles.ts`.

- `annulerDossier` suit `cloreDossier` pas à pas (`:190-232`) : lecture de `dossierId` et `motif`,
  refus d'un motif trop court avant toute requête, chargement du dossier avec son dernier plan
  (`:196-204`) en ajoutant `id` au `select` des plans, verdict de `peutAnnuler`, puis écriture
  tracée.
- La trace : `action: "depart.annulation"`, `targetType: "personne"`, `targetId` valant le
  `username` (D10), `before: { etat, plan }`, `after: { etat: "CANCELLED", plan, motif }`, et
  `revalider: ["/departs/<id>", "/personnes/<username>"]` comme la clôture (`:225`). `/departs` n'y
  figure pas : la route n'existe pas.
- L'écriture tient dans un `prisma.$transaction` à l'intérieur d'`ecrire`
  (`src/app/personnes/[username]/actions.ts:204-223`) : le dossier d'abord, le plan ensuite quand
  `planAAnnuler` le désigne.
- `planDuDossier` (`:28-41`) sélectionne l'état du dossier, et `confirmerPlan` (`:65-69`) comme
  `recalculerPlan` (`:264`) refusent quand `dossierVivant` est faux : c'est ce qui ferme la course
  décrite en D1, et cela ne change rien sur un dossier vivant.
- `LIBELLE_ACTION` reçoit « Annulation d'un dossier de départ » après `depart.recalcul`
  (`src/app/journal/libelles.ts:22`).

La signature est celle des quatre actions voisines :
`annulerDossier(_etat: EtatAction | null, formData: FormData): Promise<EtatAction>`.

Livrable vérifiable : depuis une session d'opérateur, l'action fait passer le dossier et son
brouillon en `CANCELLED` dans la même transaction, le journal montre `depart.annulation` sous son
libellé avec le motif dans la charge utile, et la trace précède l'écriture métier.

### 4. La clôture cesse de mentir

Fichier : `src/app/departs/[id]/actions.ts`.

`cloreDossier` remplace ses deux refus écrits en dur (`:209-211`, `:214-218`) par un appel unique à
`peutClore(dossier.state, dossier.plans[0]?.state ?? null)` et rend sa raison telle quelle, comme
ses trois voisines (D6). Le bouton de clôture disparaît de l'écran à l'étape 6, mais une action
serveur ne se protège pas par l'absence d'un bouton.

Livrable vérifiable : une tentative de clôture sur un dossier annulé rend la phrase de l'annulation,
et jamais celle des accès restés ouverts ; le scénario 5 le couvre sans base, ce que l'ancienne
forme n'aurait pas permis.

### 5. Le bouton et sa modale

Fichiers : `src/app/departs/[id]/Pointage.tsx`, `src/app/departs/[id]/AnnulationDossier.tsx`
(nouveau).

- `AnnulationDossier` reprend `ClotureConstat` (`src/app/constats/ClotureConstat.tsx:11-42`) : un
  `Input` nommé `motif`, `required`, `messageObligatoire` (`src/ui/validation.ts:12-21`), l'erreur
  serveur rendue par `state` et `stateRelatedMessage`, et `useFermetureApresSucces`
  (`src/ui/modale.ts:13-26`).
- `BoutonAnnuler` rejoint `Pointage.tsx`, qui est déjà le fichier des boutons du dossier et porte
  les quatre autres (`:15-34`, `:41-94`, `:96-115`, `:117-136`). Priorité secondaire, et une modale
  déclarée au niveau module avec un identifiant propre, le dépôt s'en tenant à un identifiant par
  usage (`src/app/personnes/[username]/ActionsDePage.tsx:12-14`).
- **Le composant rend toujours `modale.Component`, seul son contenu est conditionnel.** C'est le
  patron des modales du dépôt (`src/app/constats/FileDesConstats.tsx:136-163`,
  `.../ActionsDePage.tsx:80-93`), et ici il n'est pas facultatif : après l'écriture, `actionTracee`
  revalide le chemin du dossier (`src/lib/actions.ts:47-49`), la page serveur se re-rend,
  `peutAnnuler` refuse désormais, et un composant qui ne se rendrait que sur verdict favorable
  emporterait le `<dialog>` ouvert avant que `useFermetureApresSucces` (`src/ui/modale.ts:20-25`)
  n'ait eu son tour, laissant le verrou de défilement du DSFR posé sur `<body>`.
- Le composant reçoit son contexte plutôt que de le calculer :
  `BoutonAnnuler({ dossierId, etapes, annulable })`, avec `etapes: number` pour le décompte de la
  modale et `annulable: boolean` pour le verdict. Seuls le bouton déclencheur et le formulaire en
  dépendent.
- La modale porte son contexte, comme le lot 1.5 l'exige
  (`docs/plans/lot-1.5_interface.md:245-247`) : le nombre d'étapes abandonnées, le fait qu'aucun
  accès n'est coupé ni rouvert, et le fait qu'un nouveau départ reste ouvrable ensuite tandis que la
  fiche cessera d'en parler (D9).
- R8 du lot 1.5 tient sans effort : `Input`, `Button`, `Modal`, `Alert` et `Badge` du système de
  design suffisent, et ni cette étape ni la suivante n'introduisent de feuille de style.

Livrable vérifiable : `pnpm build` passe, la modale s'ouvre, refuse un motif vide côté navigateur
comme côté serveur, se ferme d'elle-même quand l'action aboutit, et la page revient déverrouillée.

### 6. L'écran du dossier

Fichier : `src/app/departs/[id]/page.tsx`.

- `cancelledReason` rejoint le `select` du dossier (`:56-61`), et un quatrième dérivé rejoint les
  trois existants (`:106-108`).
- Le recalcul d'affichage est court-circuité sur un dossier annulé (`:100-103`), ainsi que les deux
  alertes qui en dépendent (`:178-198`, `:200-207`).
- Le badge du titre devient une alternative à trois branches (`:115-119`), et une alerte porte le
  motif.
- Le titre de section cesse d'être un ternaire binaire (`:209-211`) : un dossier annulé annonce ce
  qui n'aura pas lieu, un dernier plan `EXPIRED` ou `STALE` annonce ce que ce plan proposait, et
  « Ce qu'il reste à faire » ne paraît plus que là où un travail attend vraiment. Le laisser à deux
  branches ferait dire à un dossier annulé qu'il reste quelque chose à faire, ce que R7 interdit
  exactement comme la phrase qu'on retire.
- L'absence de plan reçoit sa propre phrase. « Aucune étape : aucun compte rattaché de façon sûre
  n'a été trouvé » (`:213-217`) affirme qu'on a cherché sans rien trouver, alors qu'un dossier sans
  plan est un calcul qui n'a pas abouti, et dont l'annulation est la seule sortie (D3). Le pied de
  page ne se rend pas non plus sans plan, faute de quoi il annonce « Plan calculé le » du jour,
  « par » et rien (`:304-310`).
- Le pointage (`:266`), la confirmation (`:272-280`) et la clôture (`:282-284`) ne se rendent plus.
  `BoutonAnnuler` se rend toujours et reçoit
  `peutAnnuler(dossier.state, plan?.state ?? null).possible` : c'est lui qui décide de montrer son
  bouton, l'écran ne le démonte jamais (étape 5).
- Le pied de page cesse d'annoncer « valable jusqu'au » sur un plan annulé, `EXPIRED` ou `STALE`
  (`:304-310`), et un dernier plan remplacé gagne sa phrase, sans bouton (D8).

Livrable vérifiable : sur un dossier annulé, aucun bouton d'écriture n'est rendu, le motif est
lisible, et le build Next passe.

### 7. La fiche : savoir qu'un départ est en cours

Fichiers : `src/app/personnes/[username]/page.tsx`, `src/app/personnes/[username]/motifs.ts`.

- La requête de la personne (`:71-127`) gagne la relation `departureCases`
  (`prisma/schema.prisma:122`), filtrée sur `ETATS_VIVANTS`, limitée à une ligne et réduite à son
  identifiant, l'index `@@index([personId])` (`:386`) la couvrant.
- `EtatDeLaFiche` (`motifs.ts:10-20`) gagne le dossier en cours, et `motifsDAction` (`:28`) pousse
  son motif en tête, avec la gravité `info` et le lien vers `/departs/<id>` (D9).
- Rien à changer dans `CeQuiAppelleUneAction`, dont `MotifDAction` porte déjà le lien (`:15-22`)
  rendu à la suite (`:50-57`), ni dans `BoutonDepart`, dont la modale dit déjà qu'un dossier ouvert
  ramène dessus plutôt que d'en créer un second (`BoutonDepart.tsx:50-53`).

Livrable vérifiable : une fiche dont le dossier est ouvert affiche la ligne et son lien ; la même
fiche, dossier annulé, ne l'affiche plus, et le bloc entier disparaît si elle en était le seul
motif.

### 8. Documentation

Fichier : `docs/architecture.md`, section 3.3.

Les quatre phrases de D13 : ce qu'annuler veut dire, jusqu'à quand c'est possible, ce que le motif
devient, et où vit le nom de celui qui a décidé. **Le document ne se modifie pas sans validation
explicite** : la rédaction est proposée, et attend l'accord avant d'être appliquée.

## Tests

Cinq scénarios, tous dans `src/core/depart.test.ts` à côté des cinq `describe` existants. Aucun n'a
besoin de base : tout ce qui décide de l'annulation est pur, et c'est le point de l'étape 1. Aucun
ne couvre les écrans, `vitest.config.ts` fixant `environment: "node"` (`:11-15`) : les étapes 5 à 7
n'ont que le build Next et la vérification manuelle pour filet. Rien n'est ajouté à
`src/core/fiche-manuelle.test.ts` : le blocage de fusion, sa levée dès qu'un dossier cesse d'être
vivant et le déplacement du dossier y sont déjà couverts (`:183-242`, `:170-179`). Il n'y a rien à
écrire pour cela, seulement à ne pas le casser. Les jeux d'essai portent des identifiants inventés
du type `camille.rivet` et `alex.dupuis`.

**1. « Un départ qu'on annule avant de l'avoir confirmé, et la personne redevient ouvrable ».**
Given un dossier `CANDIDATE` dont le plan est un brouillon de trois étapes. When on demande
l'annulation, Then le verdict est favorable, Then `planAAnnuler` désigne le brouillon, donc les deux
états à écrire valent `CANCELLED`, Then `dossierVivant("CANCELLED")` est faux, ce qui rouvre la
porte à un dossier neuf. When on redemande l'annulation sur le dossier déjà annulé, Then elle est
refusée par une raison qui nomme l'annulation et non la clôture. Emplacement :
`src/core/depart.test.ts`.

**2. « Un plan engagé ne s'annule pas, et les trois refus ne se confondent pas ».** Given un dossier
`CANDIDATE`. When son plan vaut successivement `EXECUTING`, `EXECUTED` puis `PARTIALLY_EXECUTED`,
Then les trois refusent l'annulation avec la raison de l'engagement. When le dossier vaut `DONE`,
Then le refus change de phrase et parle de clôture. Then les trois raisons rendues, plan engagé,
dossier annulé, dossier clos, sont deux à deux distinctes : les confondre ferait chercher la
mauvaise sortie. Then `peutConfirmer` et `peutPointer` refusent un plan `CANCELLED`, ce que
`peutRecalculer` asserte déjà (`src/core/depart.test.ts:178`) : rien n'est à écrire pour cela,
seulement à ne pas le casser. Emplacement : `src/core/depart.test.ts`.

**3. « Un dossier sans plan s'annule, un plan déjà remplacé garde ce qui l'a écarté ».** Given un
dossier `CANDIDATE` sans aucun plan, ce que produit une panne au milieu d'un recalcul. When on
l'annule, Then le verdict est favorable et `planAAnnuler(null)` est faux : il n'y a qu'un seul état
à écrire. When le dernier plan vaut `EXPIRED`, puis `STALE`, Then l'annulation reste possible et
`planAAnnuler` reste faux, ce que `etatDUnPlanRemplace` a posé et que son test asserte déjà
(`src/core/depart.test.ts:159-162`). When le plan vaut `CONFIRMABLE`, Then l'annulation est possible
et `planAAnnuler` est vrai : la valeur est morte en base aujourd'hui, et c'est pourquoi rien d'autre
ne la couvrirait le jour où la délégation la fera naître. Emplacement : `src/core/depart.test.ts`.

**4. « La règle du dossier vivant vit en un seul endroit, et elle range les cinq états ».** Given
les cinq valeurs de `EtatDossier`. Then `dossierVivant` rend vrai pour `WATCH`, `CANDIDATE` et
`CONFIRMED`, faux pour `CANCELLED` et `DONE`, ce qui reproduit exactement le littéral
qu'`ouvrirDossierDeDepart` portait (`src/lib/depart.ts:123`) et celui de la fusion
(`src/app/personnes/[username]/edition.ts:176`). Then `ETATS_VIVANTS` compte ces trois valeurs et
pas une de plus. Le garde-fou contre une sixième valeur n'est pas dans le test mais dans le
dictionnaire de D7. Emplacement : `src/core/depart.test.ts`.

**5. « La clôture nomme ce qui la bloque, et cesse d'envoyer pointer un plan mort ».** Given un
dossier `CANDIDATE` dont le plan vaut `EXECUTED`. When on demande la clôture, Then le verdict est
favorable. When le dossier vaut `CANCELLED`, Then le refus nomme l'annulation, et sa phrase est
distincte de celle du dossier déjà clos comme de celle des accès restés ouverts : trois refus, trois
sorties. When le dossier reste `CANDIDATE` et que son plan vaut `EXECUTING`, puis
`PARTIALLY_EXECUTED`, puis rien du tout, Then les trois refusent avec la phrase des accès restés
ouverts, celle que porte `dossierSoldable` aujourd'hui, mot pour mot. Emplacement :
`src/core/depart.test.ts`.

## Risques et pièges

**Le trou de `confirmerPlan` est le risque principal, et il ne se voit qu'en le cherchant.** Sa
garde ne lit que `plan.state` (`src/app/departs/[id]/actions.ts:65-69`) et son chargement ne
sélectionne même pas l'état du dossier (`:28-41`). Une annulation qui oublierait le brouillon ne
lèverait aucune erreur, n'échouerait à aucun test et se découvrirait le jour où quelqu'un
confirmerait un plan dans un dossier mort. La revue de l'étape 3 doit vérifier trois choses : que la
seconde écriture est là, qu'elle est dans la transaction, et que la garde lit désormais l'état du
dossier, sans quoi un recalcul concurrent glisse un brouillon neuf sous un dossier annulé (D1).

**La transaction, et l'ordre de ses deux écritures.** Sans `prisma.$transaction`, une panne entre le
dossier et son plan produit l'état même que D1 existe pour interdire, et l'affichage suivant le rend
normalement, bouton de confirmation compris. Aucun test ne le rattraperait, puisque rien ne teste la
base : c'est la relecture de l'ordre des opérations qui tient cet invariant.

**Le silence de l'écran est le second risque, et c'est la panne la plus discrète du lot.** Un
dossier annulé qui continue d'afficher ses étapes et sa date de validité affirme qu'un travail
attend alors que personne ne l'attend plus, et retirer « Ce qui sera à faire » sans nommer la
troisième branche laisse la panne intacte sous un autre libellé. Rien ne le signale : la page se
rend, le build passe, et le seul symptôme est un opérateur qui reprend un dossier abandonné.

**Le journal précède l'écriture, y compris pour le geste qui défait.** `actionTracee` trace le
succès avant d'appeler l'écriture et repose une trace d'échec si elle casse
(`src/lib/actions.ts:30-57`). Une annulation écrite par un `prisma.departureCase.update` direct
perdrait sa trace sans que rien ne le signale, ce que le commentaire du module dit en toutes lettres
(`:27-28`). Le motif ne doit pas non plus rester en base seulement : la colonne se relit à l'écran,
la trace se relit dans dix-huit mois.

**Le double cache Prisma, pris à l'envers.** Ce ticket ne migre rien, donc il n'y a rien à
régénérer. Le piège est inverse : si `pnpm db:generate` devient nécessaire en cours
d'implémentation, c'est qu'une colonne est entrée dans le schéma contre D5, et la question à poser
est pourquoi, pas comment.

**Le refus par absence de bouton n'est pas un refus.** L'écran cesse de rendre la confirmation, le
pointage et la clôture sur un dossier annulé, mais les quatre actions serveur restent appelables, et
un onglet resté ouvert suffit à les atteindre. Ce sont `peutConfirmer`, `peutPointer` et `peutClore`
qui refusent, pas le rendu. La revue doit lire les gardes, pas les conditions d'affichage.

**Une fiche qui cesse de parler du dossier.** Après l'annulation, la fiche redevient muette sur ce
départ. C'est voulu (D9), mais cela se découvre au mauvais moment si personne ne l'a écrit : le
chemin qui reste est le journal de la personne (`src/app/personnes/[username]/page.tsx:306-311`), et
la modale doit le dire avant le geste, pas après.

**La course sur l'ouverture d'un dossier devient plus atteignable.** `ouvrirDossierDeDepart` fait un
`findFirst` puis un `create` sans transaction ni index unique (`src/lib/depart.ts:122-140`) :
annuler rouvre la porte, donc la franchit plus souvent, et deux clics rapprochés peuvent ouvrir deux
dossiers. La correction est un index unique partiel, que Prisma ne sait pas exprimer, donc un SQL à
la main : elle revient à #8, qui refait de toute façon la table
(`docs/plans/#08_plan-generique.md:260-276`).

**La collecte est insensible à l'annulation, et il faut que ça reste vrai.** `actionsDeclarees` ne
lit que les étapes réussies et datées (`src/lib/sync/constats.ts:219-221`), et un plan annulé n'a
que des étapes en attente, `peutPointer` exigeant un plan confirmé (`src/core/depart.ts:56-64`) :
aucune action déclarée, donc aucun `OVERDUE_MANUAL_ACTION` (`src/core/constat.ts:226-227`). Ce
raisonnement tombe le jour où l'on autoriserait d'annuler un plan engagé, des étapes réussies
continuant d'alimenter la vérification. À dire avant de l'élargir, pas après.

**L'invariant `HEURISTIC` n'entre pas en jeu, et il ne faut pas l'y faire entrer.** L'annulation ne
calcule aucun plan, ne lit aucune identité et ne produit aucune étape : `autoriseUneRevocation`
(`src/core/rapprochement.ts:29-31`) n'est pas appelé et ne doit pas l'être. La liste des méthodes ne
se recopie pas, elle s'appelle, et ici elle ne s'appelle pas du tout.

**`ACTIONS_ENABLED` reste à `false` et rien ici n'écrit sur un système cible.** Le corollaire est de
ne pas profiter de ce chemin pour y glisser un geste qui toucherait un fournisseur : il
contournerait le drapeau. Toute évolution future qui l'autoriserait doit repasser par une décision
d'architecture.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire dès que les étapes 5 à 7 touchent
un composant client et une page serveur. Au-delà, le parcours manuel, qui est aussi la Definition of
Done du ticket :

1. Ouvrir un départ depuis la fiche d'une personne d'essai, puis y revenir : la ligne du départ en
   cours paraît en tête de « Ce qu'il y a à faire », et son lien mène au dossier.
2. Annuler sans motif : le navigateur refuse en français, un envoi forcé sans le champ est refusé
   par le serveur. Annuler ensuite avec un motif : le badge le dit, le motif est lisible, aucun
   bouton d'écriture ne reste.
3. Recharger la fiche : la ligne a disparu, et le bloc entier avec elle si elle en était le seul
   motif.
4. Rouvrir un départ sur la même personne : un dossier neuf est créé, et l'alerte du dossier déjà
   ouvert (`src/app/departs/[id]/page.tsx:128-135`) ne paraît pas.
5. Le journal montre `depart.annulation` sous son libellé, avec le nom de l'opérateur, le motif dans
   la charge utile, et la trace datée avant l'écriture. Le filtre par personne la retient.
6. Contrôle en base sur le dossier annulé :

```sql
SELECT c."state", c."cancelledReason", p."state" AS plan, p."confirmedBy", p."confirmedAt"
FROM "DepartureCase" c
LEFT JOIN "Plan" p ON p."departureCaseId" = c."id"
WHERE c."id" = '<identifiant du dossier>';
```

Les deux états valent `CANCELLED`, le motif est celui qui a été saisi, et les deux colonnes de
confirmation restent nulles : une valeur ici signerait une garde contournée.

7. Confirmation depuis un onglet périmé : ouvrir le dossier dans un second onglet, annuler dans le
   premier, puis cliquer « Confirmer ce plan » dans celui resté en arrière. Il rend « Ce plan n'est
   plus un brouillon. » et n'écrit rien, la requête ci-dessus donnant le même résultat après.
8. Clôture depuis un onglet périmé : sur un dossier dont toutes les étapes sont pointées, garder
   l'écran ouvert, passer le dossier à `CANCELLED` en base, puis cliquer sur la clôture. La phrase
   nomme l'annulation, jamais les accès restés ouverts, et c'est le seul chemin qui y mène (D2).
9. Dossier sans plan, fabriqué par `UPDATE "Plan" SET "departureCaseId" = NULL` : l'écran dit que le
   calcul n'a pas abouti au lieu de dire qu'il n'y a rien à faire, le pied de page ne se rend pas,
   et l'annulation reste le seul geste offert.
10. Fusion : deux fiches d'essai portant chacune un dossier ouvert refusent la fusion ; annuler l'un
    des deux la débloque, et le dossier annulé suit la fusion vers la fiche cible.
11. `ACTIONS_ENABLED` reste à `false` du début à la fin, aucun appel sortant n'a lieu, et
    `prisma/migrations/` compte le même nombre de dossiers qu'avant.
