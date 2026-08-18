# Constat d'arrivée sans onboarding (#12)

> Plan d'implémentation de l'issue #12. Le ticket porte le quoi et le pourquoi, ce document porte le
> comment.

## Ce qui existe aujourd'hui

### Le mécanisme de constat est complet, et il est réutilisable tel quel

Le socle sait déjà tout ce qu'un constat d'arrivée demande, à une exception près développée plus bas.

**Le calcul est pur.** `constatsDe` (`src/core/constat.ts:88-112`) parcourt les personnes, appelle
`sortieDuPerimetre` (`src/core/constat.ts:34-45`) puis `startupsToutesTerminees`
(`src/core/constat.ts:52-86`), et rend une liste triée par clé de déduplication. Sa donnée d'entrée
est `PersonneConstatable` (`src/core/constat.ts:19-26`), une projection minimale de `Person` :
`username`, `fullname`, `attachment`, `startups`, `missionEnd`, `vanishedAt`. Rien d'autre. Aucune
requête, aucune horloge implicite, la date du jour est un paramètre.

**La règle « un seul constat par personne » est déjà écrite**, et elle est écrite en une ligne : le
`continue` de `src/core/constat.ts:102`, avec son commentaire. Une personne sortie du référentiel ne
reçoit pas en plus un constat de startups terminées, parce que les deux appellent le même geste.
C'est exactement la mécanique que le point « lève le constat, et lui seul » de la Definition of Done
réclame, et il n'y a rien à inventer pour l'obtenir.

**La réconciliation existe et fonctionne dans les deux sens.** `syncConstats`
(`src/lib/sync/constats.ts:100-210`) calcule les constats du jour, ouvre ceux qui manquent
(`src/lib/sync/constats.ts:143-191`), et ferme ceux qui ne se vérifient plus
(`src/lib/sync/constats.ts:193-207`). L'ouverture passe par un `upsert` sur `dedupKey` et non par un
`create` (`src/lib/sync/constats.ts:161-180`), parce que la clé est unique sur toute la table, y
compris sur les constats fermés (`prisma/schema.prisma:428`) : un épisode qui se reproduit rouvre la
même ligne, et sa date d'ouverture dit depuis quand dure l'épisode en cours.

**Le verrou de clôture manuelle existe.** `verrousDeCloture` (`src/core/constat.ts:124-140`) départage
les constats clos par un humain selon que la situation dure encore ou non ; ceux dont la situation
persiste restent clos, les autres perdent leur verrou (`src/lib/sync/constats.ts:134-141`, qui remet
`closedBy` à nul sans toucher à `closedAt`). La colonne `Finding.closedBy`
(`prisma/schema.prisma:439`) porte tout ça, documentée dans le schéma. L'écran de clôture existe
aussi, avec sa raison obligatoire et son passage par `actionTracee`
(`src/app/constats/actions.ts:13-51`).

**L'affichage est piloté par le type.** `LIBELLE_CONSTAT` est un
`Record<ConstatKind, Libelle>` (`src/core/libelle-constat.ts:14`), donc ajouter une valeur à
`ConstatKind` (`src/core/constat.ts:1-6`) fait échouer le typecheck tant que le libellé n'est pas
écrit. La page `/constats` lit ce dictionnaire pour le titre, l'action et l'explication de bas de
page (`src/app/constats/page.tsx:68`, `src/app/constats/page.tsx:106-117`), et la fiche d'une
personne le relit pour ses propres constats (`src/app/personnes/[username]/page.tsx:429-455`).

**Le garde-fou sur la chute du périmètre existe**, et il est déjà factorisé. `chuteExcessive`
(`src/core/collecte.ts:10-15`) est une fonction pure de trois nombres, utilisée par le périmètre
(`src/lib/sync/perimetre.ts:250-258`), par la collecte d'un système cible
(`src/lib/sync/collecte.ts:300-307`) et par le référentiel des startups
(`src/lib/sync/constats.ts:81-84`). Le seuil vient de `thresholds.maxScopeDrop`
(`src/core/policy.ts:293-302`).

### Les données d'arrivée sont déjà en base, et elles ne mentent pas

`Person.firstSeenAt` (`prisma/schema.prisma:108`) est posé à la création et jamais réécrit :
l'`upsert` du périmètre le passe uniquement dans la branche `create`
(`src/lib/sync/perimetre.ts:77-79`), la branche `update` porte `lastSeenAt` et `vanishedAt` mais pas
lui (`src/lib/sync/perimetre.ts:52-65`). La création manuelle d'une fiche depuis un compte isolé le
pose de la même façon (`src/app/comptes-isoles/creer.ts:92-103`).

Deux conséquences utiles. D'abord, toutes les personnes créées par une même collecte portent
exactement la même date, puisque `now` est calculé une fois dans `executerSync` et traverse tout le
traitement. Ensuite, `firstSeenAt` est égal à la seconde près au `startedAt` du `SyncRun` du
périmètre, qui est ouvert avec ce même `now` (`src/lib/sync/perimetre.ts:93-95`). Une comparaison
d'égalité large entre les deux est donc exacte, pas approximative.

### Ce dont ce ticket dépend, et qui n'existe nulle part

Le ticket dit « Dépend de : le dossier et le plan génériques », c'est-à-dire l'issue #8. L'état
vérifié :

- `PlanKind` ne connaît que `OFFBOARDING`, `DRIFT_FIX` et `MANUAL_OP` (`prisma/schema.prisma:315-319`).
  Aucune valeur d'arrivée.
- Un `Plan` ne se rattache à une personne que par `departureCaseId`
  (`prisma/schema.prisma:335`, `prisma/schema.prisma:348`), c'est-à-dire par un dossier de départ.
  Il n'existe aucun autre chemin d'un plan vers une `Person`.
- Aucun code n'émet un `Intent` de kind `grant` (`src/core/connector.ts:170-174`), et le seul
  connecteur implémenté rend une liste vide pour tout ce qui n'est pas un retrait
  (`src/connectors/github.ts:223-226`).
- Le calcul de plan est écrit pour le départ de bout en bout : `calculerPlanDeDepart`
  (`src/lib/depart.ts:49-91`) filtre sur les systèmes où la personne a un compte observé et n'appelle
  les connecteurs qu'avec `{ kind: "revoke" }` (`src/lib/depart.ts:77`).

Autrement dit : **la condition « un plan d'arrivée exécuté existe » ne peut aujourd'hui être vraie
pour personne.** Ce plan traite ce fait comme une contrainte de conception, pas comme un détail de
séquencement, et y consacre la décision D7.

### Les pièges déjà présents dans le code

1. **La réconciliation ferme par absence.** Tout constat ouvert dont la clé n'est pas dans la liste
   calculée ce soir est fermé (`src/lib/sync/constats.ts:193-198`). « Ne rien conclure » ne peut donc
   pas se traduire par « produire une liste vide » : ce serait fermer en silence tout ce qui était
   ouvert. C'est le piège central de ce ticket.
2. **Le réarmement du verrou souffre du même travers.** La requête des constats clos par un humain
   porte sur tous les types réconciliés (`src/lib/sync/constats.ts:125-132`), et `verrousDeCloture`
   réarme ceux qui ne sont pas constatés ce soir (`src/core/constat.ts:131-137`). Un soir où l'on ne
   conclut pas, une clôture manuelle perdrait son verrou sans que personne ne l'ait demandé, et le
   constat reviendrait à la collecte suivante.
3. **Les constats se calculent dès que le périmètre n'est pas `FAILED`**
   (`src/lib/sync/executer.ts:154`), donc y compris sur un périmètre `PARTIAL`. C'est sans danger
   pour `SCOPE_EXIT`, qui dépend de `vanishedAt`, lui-même jamais posé sur un run dégradé
   (`src/lib/sync/perimetre.ts:249-279`). Ce n'est pas transposable à une arrivée, qui ne dépend
   d'aucune date posée sous condition : une personne est créée par un run `PARTIAL` comme par un run
   `OK` (`src/lib/sync/perimetre.ts:214-227`).
4. **Il n'existe aucun garde-fou symétrique de `chuteExcessive`.** Le socle sait refuser de conclure
   quand le périmètre s'effondre, il ne sait rien refuser quand il enfle. Or une vague d'arrivées est
   exactement la forme que prend un changement d'identifiant en amont, un mapper corrigé, ou une base
   restaurée depuis une sauvegarde ancienne : le compte total ne baisse pas, donc `chuteExcessive` ne
   voit rien, et chaque personne est pourtant « nouvelle ».
5. **Le journal est écrit sans attente** (`src/lib/audit.ts`), et `syncConstats` journalise chaque
   ouverture en `SYSTEM` (`src/lib/sync/constats.ts:182-190`). Une vague de constats est donc aussi
   une vague d'événements de journal, ce qui est une raison de plus de la refuser à la source plutôt
   que de la nettoyer après coup.

## Décisions de conception

### D1. Le constat s'appelle `SCOPE_ENTRY`, sa gravité est moyenne

Le ticket dit « pendant exact de `SCOPE_EXIT` ». Le nom suit : `SCOPE_ENTRY`. Il se lit dans l'énum à
côté de son symétrique, il n'invente pas un vocabulaire supplémentaire, et il dit ce qu'il est, une
entrée dans le périmètre que rien n'a traitée.

La gravité est `MEDIUM`, et ce point mérite d'être motivé parce que la Definition of Ready le demande
explicitement. `SCOPE_EXIT` est en `HIGH` parce qu'il désigne un accès qui survit à son motif, c'est
à dire une porte restée ouverte. Une arrivée sans onboarding n'ouvre aucun accès de trop : elle dit
que le déclaré ne raconte pas ce qui s'est passé, et que quelqu'un travaille peut être sans les accès
qu'il devrait avoir. Le coût d'un jour de retard n'est pas du même ordre.

Le tri de la file rend cet arbitrage concret : `/constats` trie par gravité puis par ancienneté
(`src/app/constats/page.tsx:28`, `src/app/constats/page.tsx:40-41`). Mettre les arrivées en `HIGH`
les intercalerait avec les sorties non traitées et ferait descendre des coupures sous des créations
de compte. Une file dont le haut ne dit plus « ceci d'abord » cesse d'être lue.

### D2. L'état « onboardée » se déduit, il ne se stocke pas

Le ticket est catégorique : aucun booléen. Une personne est **réputée traitée** quand un plan
d'arrivée exécuté existe pour elle, et le constat se lève sur la négation de cette condition,
recalculée à chaque collecte comme toutes les autres.

Trois précisions qui ne vont pas de soi :

**Seul l'état `EXECUTED` compte.** `PARTIALLY_EXECUTED` veut dire que des étapes ont été écartées ou
ont échoué, et le socle le distingue déjà d'un plan soldé (`src/core/depart.ts:79-95`, où
`dossierSoldable` n'accepte que `EXECUTED`). Un onboarding à moitié fait laisse la personne sans une
partie de ses accès : fermer le constat sur cette base reviendrait à affirmer que l'arrivée est
réglée alors que c'est faux, ce qui est exactement le défaut que le ticket cherche à éviter en
refusant un booléen.

**Un plan annulé, périmé ou en brouillon ne compte pas.** Ouvrir un dossier n'est pas traiter une
arrivée. Le constat se ferme quand le travail a été fait, pas quand quelqu'un a cliqué.

**La condition porte sur la personne, jamais sur ses comptes.** Un compte observé sur GitHub ne prouve
pas qu'un onboarding a eu lieu : c'est même le cas nominal d'une arrivée traitée hors de l'outil, que
ce constat existe précisément pour révéler.

### D3. L'amorçage : le stock initial est structurellement inéligible

C'est le second point de Definition of Ready. La règle retenue tient en une phrase : **une personne ne
peut lever un constat d'arrivée que si elle a été découverte après que l'outil a su voir les
arrivées.**

La date d'amorçage vaut :

```
amorçage = max(première collecte du périmètre ayant vu au moins une personne, mise en service de la détection)
```

et une personne est éligible si et seulement si `firstSeenAt > amorçage`.

Les deux termes couvrent deux situations distinctes, et aucun ne suffit seul.

**Le second terme couvre l'instance en production.** Sa première collecte remonte à des mois, et
toutes les personnes en poste portent un `firstSeenAt` antérieur à la livraison. Sans ce terme, le
jour du déploiement, les quatre vingt quinze personnes déjà connues lèveraient un constat chacune, ce
que la Definition of Ready interdit noir sur blanc. La valeur est une constante datée dans le code,
arrêtée au moment de la mise en service et jamais retouchée après coup. Ce n'est ni un réglage ni un
choix métier : c'est un fait sur l'histoire du code, donc il vit dans le code, versionné.

**Le premier terme couvre une instance neuve.** Déployée après la mise en service, sa première
collecte découvre tout le monde d'un coup, et la constante étant dans le passé, elle ne protégerait
rien. Le `max` fait basculer l'amorçage sur la première collecte, et le stock initial redevient
inéligible. L'égalité `firstSeenAt = startedAt` évoquée plus haut rend la comparaison exacte : les
personnes du premier passage sont à l'amorçage, pas après.

**La première collecte retenue est la plus ancienne ayant vu au moins une personne** (`itemsSeen > 0`
sur le fournisseur du périmètre). Une première tentative en échec ouvre pourtant un `SyncRun`
(`src/lib/sync/perimetre.ts:93-95`) : la retenir daterait l'amorçage avant que qui que ce soit
n'existe en base, et le premier passage réussi lèverait alors une vague. Le filtre sur `itemsSeen`
écarte ce cas.

**Si aucune collecte n'a jamais vu personne, on ne conclut pas** sur les arrivées. Il n'y a rien à
conclure, et c'est le cas d'une base fraîche.

Trois solutions écartées, pour mémoire :

- *Un booléen `onboarded` sur `Person`* : interdit par le ticket, et à raison, puisqu'il faudrait le
  tenir à jour et qu'il finirait par mentir.
- *Un backfill de faux plans exécutés pour le stock initial* : cela fabrique une histoire qui n'a pas
  eu lieu, dans la partie du modèle qui doit rester lisible telle quelle dans deux ans
  (`docs/architecture.md` §3.3), et le journal en porterait la trace.
- *Une date d'amorçage en configuration* : décider quand l'outil a su faire quelque chose n'est pas un
  réglage d'exploitation, et une instance qui ne fournit pas ce fichier fonctionnerait alors soit en
  aveugle, soit en bruit permanent. Les seuils du fichier de politique décrivent des arbitrages
  métier (`src/core/policy.ts:261-311`), pas des dates de livraison.

### D4. Un seul constat par personne, et l'ordre est `SCOPE_EXIT`, puis `SCOPE_ENTRY`, puis `INACTIVE_STARTUP`

La boucle de `constatsDe` (`src/core/constat.ts:96-109`) gagne une branche, insérée entre les deux
existantes, avec le même `continue`.

La sortie prime sur tout, comme aujourd'hui : quelqu'un qui a quitté le référentiel n'a pas besoin
qu'on lui souhaite la bienvenue. L'arrivée prime ensuite sur les startups terminées, et c'est le seul
arbitrage nouveau : proposer de retirer les accès de quelqu'un dont on n'a même pas acté l'arrivée
serait absurde, et les deux lignes se contrediraient dans la même file. Le cas n'est pas théorique,
une personne peut arriver sur une startup qui bascule en phase terminale dans le même mois.

### D5. « Ne pas conclure » n'est pas « produire une liste vide »

C'est le piège numéro 1 de l'inventaire ci-dessus, et il se traite par une seule notion transverse :
**les types réconciliés ce soir**, qui remplace la constante `RECONCILIES`
(`src/lib/sync/constats.ts:22-28`).

Quand les arrivées ne sont pas concluantes, `SCOPE_ENTRY` sort des trois portes à la fois :

1. il n'est pas calculé, donc rien ne s'ouvre ;
2. il est exclu de la requête des constats ouverts à fermer (`src/lib/sync/constats.ts:116-119`), donc
   rien ne se ferme en silence ;
3. il est exclu de la requête des constats clos par un humain (`src/lib/sync/constats.ts:125-132`),
   donc aucun verrou de clôture n'est réarmé à tort.

Oublier l'une des trois produit une panne muette : le constat disparaît de la file sans que rien ne
le dise, ou bien il revient après qu'un opérateur l'a explicitement écarté. Pour que ce ne soit pas
une affaire de discipline, la liste des types réconciliés devient une **fonction pure testable** dans
`src/core/constat.ts`, et les trois requêtes la consomment.

Corollaire sur la signature : `constatsDe` reçoit un cinquième paramètre `RegleArrivee | null`, et
`null` veut dire « ne conclus rien sur les arrivées ». Le type oblige chaque appelant à trancher,
plutôt que de laisser un défaut décider à sa place.

### D6. Deux conditions pour conclure : un périmètre complet, et pas de vague

**Un périmètre `PARTIAL` ne conclut pas.** C'est le point d'attention du ticket, et c'est la règle
déjà appliquée aux disparitions de startups (`src/lib/sync/executer.ts:73`). Une réponse tronquée mais
valide ne se distingue pas d'une réalité : on ne date rien sur cette base, dans un sens comme dans
l'autre.

**Une vague d'arrivées ne conclut pas non plus.** C'est le piège numéro 4 : il n'existe aucun
garde-fou symétrique de la chute. Une fonction pure `arriveeMassive` rejoint `chuteExcessive` dans
`src/core/collecte.ts`, avec la même forme et la même sobriété :

```ts
export function arriveeMassive(perimetre: number, arrivees: number, partMax: number): boolean {
  if (arrivees < PLANCHER_ARRIVEES || perimetre <= 0) {
    return false;
  }
  return arrivees > Math.floor(perimetre * partMax);
}
```

Le plancher existe parce qu'une part seule est absurde sur un petit périmètre : trois arrivées sur
douze personnes font vingt cinq pour cent et sont pourtant une rentrée de septembre ordinaire. Il vit
dans le noyau, à côté de la fonction, parce qu'il est une propriété de la règle et non un arbitrage
d'exploitation. La part, elle, est un arbitrage : elle rejoint le fichier de politique sous
`thresholds.maxNewPersonShare`, avec le même défaut de `0.2` que sa symétrique.

Quand la vague est refusée, on est dans le cas « ne pas conclure » de D5, aux trois portes, et le
compte rendu de la collecte le dit avec ses nombres, comme le fait déjà la chute
(`src/lib/sync/perimetre.ts:255-257`). Une panne muette de ce garde-fou serait pire que le problème
qu'il traite.

### D7. La dépendance à #8 se réduit à une fonction, et le noyau ne l'attend pas

`arriveeTraitee` est un booléen **déjà résolu** quand il atteint le noyau, exactement comme
`personneSortie`, `rattachementSur` et `compteDeService` le sont pour les identités
(`src/core/constat.ts:142-153`). Le calcul reste pur, testable sans base et sans #8.

Côté branchement, une seule fonction lit le modèle : `arriveesTraitees(): Promise<Set<string>>`, qui
rend les usernames dont un plan d'arrivée est exécuté. C'est le seul point à toucher quand #8 aura
tranché la question qu'il porte, à savoir généraliser `DepartureCase` ou créer un second modèle
(`prisma/schema.prisma:299-313`). Sa forme, une fois #8 livré, sera de l'ordre de :

```ts
const plans = await prisma.plan.findMany({
  where: { kind: "ONBOARDING", state: "EXECUTED" },
  select: { /* le chemin vers la personne que #8 aura défini */ },
});
```

**Ordre de livraison recommandé : #12 après #8.** Livré avant, le constat se lève correctement mais ne
peut se fermer que par une clôture manuelle, puisque aucun plan d'arrivée ne peut exister : la
Definition of Done « le constat se ferme seul quand un plan d'arrivée est exécuté » ne serait pas
vérifiable. Ce n'est pas une impasse, la clôture manuelle avec raison et verrou est un chemin
parfaitement honnête, mais c'est un ticket qui se déclare fini à moitié. Si le séquencement l'impose
malgré tout, `arriveesTraitees` rend un ensemble vide, la fonction porte le commentaire qui dit
pourquoi, et l'étape 4 du découpage est la seule à reprendre.

Ce plan **ne tranche rien** de ce que #8 doit trancher : ni le sort de `DepartureCase`, ni
`PlanKind.ONBOARDING`, ni l'assemblage des étapes d'arrivée. Aucune migration d'ici ne touche `Plan`.

### D8. Une réapparition n'est pas une arrivée

`firstSeenAt` ne bouge pas quand une personne revient : l'`upsert` remet `vanishedAt` à nul et
rafraîchit `lastSeenAt` (`src/lib/sync/perimetre.ts:52-65`), rien d'autre. Une personne partie puis
revenue ne lève donc aucun constat d'arrivée, et c'est voulu : ce que l'outil détecte est une
découverte, pas un retour. Le retour se lit déjà ailleurs, par la levée du verrou de son `SCOPE_EXIT`
(`src/core/constat.ts:114-140`), qui est l'endroit exact où l'histoire est racontée.

### D9. Les fiches créées à la main lèvent le constat, et c'est le comportement attendu

Une fiche créée depuis un compte isolé (`src/app/comptes-isoles/creer.ts:31-139`) porte un
`firstSeenAt` postérieur à l'amorçage : elle devient éligible. La séquence est alors : la collecte
signale un compte sans détenteur en `UNREGISTERED`, l'opérateur crée la fiche, ce qui ferme
l'`UNREGISTERED` (`src/app/comptes-isoles/creer.ts:110-134`), puis la collecte suivante lève un
`SCOPE_ENTRY` sur la personne ainsi créée.

Ce n'est pas un cumul, les deux ne sont jamais ouverts en même temps et ils ne portent pas sur le même
objet, l'un sur un compte, l'autre sur une personne. Et c'est précisément ce que le ticket décrit
quand il dit qu'un onboarding se déclenche aussi à la main pour une personne créée manuellement : on
vient de mettre un nom sur un compte, il reste à dire quels accès cette personne devrait avoir.

Une fiche de `source: "SERVICE"` est exclue par principe, comme elle l'est déjà des disparitions
(`src/lib/sync/perimetre.ts:275`). Un compte machine n'arrive pas.

## Modèle de données

**Une seule migration, une seule valeur d'énum.**

```prisma
enum FindingKind {
  SCOPE_EXIT
  SCOPE_ENTRY
  INACTIVE_STARTUP
  // le reste inchangé
}
```

`pnpm db:migrate --name constat_arrivee` produit :

```sql
ALTER TYPE "FindingKind" ADD VALUE 'SCOPE_ENTRY';
```

**Aucune autre modification de schéma.** Pas de colonne sur `Person`, pas de table d'amorçage, pas de
valeur ajoutée à `PlanKind` : cette dernière appartient à #8, et l'ajouter ici créerait une valeur que
personne n'écrit, ce qui est la meilleure façon d'obtenir un jour deux mécanismes d'arrivée.

**Aucun backfill.** C'est le sens même de D3 : le stock initial est écarté par une règle de calcul, pas
par une écriture. Une migration de données ici serait une histoire fabriquée.

**Piège Postgres.** Une valeur ajoutée à un type énuméré ne peut pas être utilisée dans la même
transaction que son ajout. La migration se contente donc de l'`ALTER TYPE` et n'écrit aucune ligne
portant la nouvelle valeur, ce qui est de toute façon la conséquence du paragraphe précédent.

**Rappel de discipline, et il porte ici plus qu'ailleurs.** Toute modification du schéma exige
`pnpm db:generate` puis un redémarrage de `pnpm dev`. Le client généré et le client mis en cache sur
`globalThis` servent sinon des métadonnées périmées, et le symptôme d'un ajout d'énum est
littéralement `Value 'SCOPE_ENTRY' not found in enum 'FindingKind'` pendant que le typecheck passe.

**Fichier de politique.** `thresholds.maxNewPersonShare` s'ajoute au schéma Zod
(`src/core/policy.ts:261-311`) avec `.default(0.2)` et sa `.meta()`, puisque c'est le seul endroit que
le générateur de JSON Schema sait lire. Ensuite `config/config.exemple.yaml` reçoit son entrée
commentée, et `pnpm policy:schema` régénère `config/config.schema.json`. Un fichier de politique
existant reste valide sans rien changer, le défaut s'appliquant.

## Découpage en étapes

### 1. Le noyau, sans base et sans #8

Fichiers : `src/core/constat.ts`, `src/core/collecte.ts`, `src/core/constat-arrivee.test.ts`.

- `ConstatKind` reçoit `SCOPE_ENTRY` (`src/core/constat.ts:1-6`).
- `PersonneConstatable` reçoit `firstSeenAt: Date`, `source: "BETA" | "LOCAL" | "SERVICE"` et
  `arriveeTraitee: boolean` (`src/core/constat.ts:19-26`).
- `arriveeSansOnboarding(personne, regle)` rejoint `sortieDuPerimetre` et `startupsToutesTerminees`,
  avec le même style : une fonction, une raison, un `null` quand il n'y a rien à dire.
- `constatsDe` reçoit `arrivees: RegleArrivee | null` en cinquième paramètre et insère la branche
  entre les deux existantes, avec `continue` (D4).
- `typesReconcilies({ arriveesConcluantes })` remplace la constante `RECONCILIES` et devient la
  définition unique des types que la collecte a le droit de refermer.
- `amorcageDesArrivees(premiereCollecte: Date | null, miseEnService: Date): Date | null` applique le
  `max` de D3 et rend `null` quand aucune collecte n'a vu personne.
- `MISE_EN_SERVICE_DES_ARRIVEES` est déclarée ici, en constante datée, avec le commentaire qui dit
  pourquoi elle existe et pourquoi elle ne se retouche pas. Elle n'est jamais lue directement par le
  calcul : elle est passée en paramètre, pour que les tests fixent leur propre horloge.
- `arriveeMassive` et `PLANCHER_ARRIVEES` rejoignent `chuteExcessive` dans `src/core/collecte.ts`.

Livrable vérifiable : `pnpm test` passe, les scénarios 1, 2 et 5 des tests sont verts, et rien
d'autre dans l'application n'a bougé. Les appels existants de `constatsDe` ne compilent plus tant que
le cinquième argument n'est pas fourni, ce qui est le but.

### 2. L'énum, la migration et le libellé

Fichiers : `prisma/schema.prisma`, `prisma/migrations/<horodatage>_constat_arrivee/migration.sql`,
`src/core/libelle-constat.ts`.

Le typecheck impose l'entrée de `LIBELLE_CONSTAT`, dont le contenu est arrêté ici :

- titre : « Arrivée sans onboarding » ;
- explication : cette personne est apparue dans le périmètre sans qu'aucun plan d'arrivée n'ait été
  exécuté pour elle, ce qui veut dire que ses accès ont été posés ailleurs, ou pas posés du tout ;
- action : « Préparer son arrivée, ou clore ce constat en disant ce qui a déjà été fait. »

Puis `pnpm db:migrate`, `pnpm db:generate`, redémarrage.

### 3. Le seuil de politique

Fichiers : `src/core/policy.ts`, `config/config.exemple.yaml`, `config/config.schema.json` (généré).

`thresholds.maxNewPersonShare`, défaut `0.2`, avec la `.meta()` qui explique que la symétrie avec
`maxScopeDrop` n'est pas décorative : le périmètre arrive en un seul appel, et une réponse anormale
peut aussi bien enfler que fondre. `pnpm policy:schema` puis `pnpm policy:check` pour valider le
fichier d'exemple.

### 4. Le branchement dans la collecte

Fichiers : `src/lib/sync/constats.ts`, `src/lib/sync/executer.ts`.

- `arriveesTraitees()` est écrite dans `src/lib/sync/constats.ts`, à côté de `actionsDeclarees`
  (`src/lib/sync/constats.ts:219-274`), qui est son modèle : une requête, une projection, un
  commentaire qui dit ce qu'elle rapproche de quoi.
- `dateDAmorcage()` lit la plus ancienne `SyncRun` du fournisseur du périmètre avec `itemsSeen > 0`
  et applique `amorcageDesArrivees`.
- `syncConstats` reçoit `arriveesConcluantes: boolean`, calcule le nombre d'arrivées éligibles, passe
  `arriveeMassive` et construit la `RegleArrivee` ou `null`. Les trois requêtes
  (`src/lib/sync/constats.ts:116-119`, `:125-132`, et la fermeture `:193-207`) consomment
  `typesReconcilies`.
- `executerSync` passe `perimetre.status === "OK"`, ajoute `firstSeenAt` et `source` à la projection
  des personnes (`src/lib/sync/executer.ts:156-165`), et enrichit la ligne de compte rendu
  (`src/lib/sync/executer.ts:195-197`) : nombre d'arrivées levées, ou la raison pour laquelle rien
  n'a été conclu, périmètre partiel ou vague refusée avec ses nombres.

Livrable vérifiable : `pnpm sync` sur une base de développement, deux fois de suite, sans arrivée
nouvelle, ne change rien. Le compte rendu dit ce qu'il a fait des arrivées à chaque passage.

### 5. Les écrans : ouvrir le dossier d'un clic

Fichiers : `src/app/constats/page.tsx`, `src/app/personnes/[username]/page.tsx`,
`src/app/personnes/[username]/BoutonArrivee.tsx` (nouveau), `src/app/page.tsx`.

- La colonne « Traitement » de `/constats` propose, pour un `SCOPE_ENTRY`, l'ouverture du dossier
  d'arrivée en plus de la clôture, exactement comme la fiche propose aujourd'hui la préparation d'un
  départ (`src/app/personnes/[username]/page.tsx:354-361`). Le composant client reprend la forme de
  `BoutonDepart` (`src/app/personnes/[username]/BoutonDepart.tsx`), avec l'action serveur d'arrivée
  livrée par #8.
- La fiche d'une personne gagne une section « Arrivée » symétrique de « Départ », avec la même phrase
  de prudence : rien n'est exécuté, l'outil dit ce qu'il faudrait faire.
- Le tableau de bord ajoute au compteur de constats la mention des arrivées à acter, comme il mentionne
  déjà les sorties sans traitement (`src/app/page.tsx:31-32`, `src/app/page.tsx:122-128`). Un `count`
  de plus, sur un index existant (`prisma/schema.prisma:444`).

**Si #8 n'est pas livré**, cette étape se réduit au lien vers la fiche de la personne, et la section
« Arrivée » attend. Le reste du ticket est complet sans elle.

### 6. Documentation

Fichier : `docs/architecture.md`, section 4.2.

`SCOPE_ENTRY` rejoint la liste des constats, en deux phrases qui disent ce qu'il signale et pourquoi
sa gravité est moyenne, plus une phrase sur l'amorçage, qui est la seule notion de ce ticket qu'un
lecteur ne devinerait pas depuis le code.

**Le document ne se modifie pas sans validation explicite** : la rédaction est proposée, et attend
l'accord avant d'être appliquée.

## Tests

Cinq scénarios, dans `src/core/constat-arrivee.test.ts` pour les quatre premiers et
`src/core/collecte.test.ts` pour le cinquième. Aucun n'a besoin de base : tout ce qui décide est pur,
et c'est le premier bénéfice de l'étape 1. Les personnes des jeux d'essai portent des identifiants
inventés du type `camille.rivet` et `alex.dupuis`.

**1. « Le premier déploiement ne noie pas la file ».** Une histoire en trois passages. Given un
périmètre de dix personnes découvertes toutes le même jour, qui est la première collecte, et une mise
en service postérieure. When la collecte du jour de la mise en service tourne, Then aucune arrivée
n'est levée. When le lendemain une onzième personne apparaît, Then un constat et un seul est levé, sur
elle, avec la clé `SCOPE_ENTRY:camille.rivet` et la gravité `MEDIUM`. When un plan d'arrivée est
exécuté pour elle, Then plus rien n'est constaté. Le scénario asserte aussi le cas d'une instance
neuve, où l'amorçage bascule sur la première collecte et où la constante ne protège rien.

**2. « L'arrivée prime sur les startups terminées, la sortie prime sur tout ».** Quatre personnes dans
le même appel : une arrivante dont toutes les startups sont en phase terminale, une arrivante en
règle, une personne ancienne dont les startups sont terminées, une personne sortie du référentiel
découverte hier. Then la première ne produit qu'un `SCOPE_ENTRY`, la troisième un `INACTIVE_STARTUP`,
la quatrième un `SCOPE_EXIT` et rien d'autre. Assertions sur le nombre total, sur l'unicité par
personne, et sur les types.

**3. « Une collecte qui n'est pas complète ne conclut ni dans un sens ni dans l'autre ».** Given une
arrivante éligible et un `SCOPE_ENTRY` clos à la main sur une personne dont la situation dure. When la
règle d'arrivée vaut `null`, Then `constatsDe` ne rend aucun constat d'arrivée, `typesReconcilies` ne
contient pas `SCOPE_ENTRY`, et `verrousDeCloture` appelé sur les seuls types réconciliés ne réarme pas
la clôture manuelle. C'est le scénario qui garde les trois portes de D5 : il échoue si l'une d'elles
est oubliée.

**4. « Le verrou tient tant que la situation dure, et se lève quand elle cesse ».** Given un
`SCOPE_ENTRY` clos à la main avec sa raison. When la personne est toujours là sans plan d'arrivée,
Then le constat reste verrouillé et n'est pas rouvert. When la personne quitte le périmètre, Then le
verrou se lève, et c'est un `SCOPE_EXIT` qui la concerne désormais. Le scénario vérifie au passage
qu'une réapparition ultérieure ne relève aucune arrivée, `firstSeenAt` n'ayant pas bougé.

**5. « Une vague d'arrivées est refusée, et elle le dit ».** Un tableau de cas sur `arriveeMassive` :
trois arrivées sur douze personnes passent malgré la part, à cause du plancher ; vingt cinq arrivées
sur quatre vingt quinze sont refusées ; une arrivée sur un périmètre inconnu ne déclenche rien. Le
scénario asserte aussi la symétrie voulue avec `chuteExcessive` sur les mêmes nombres, pour que les
deux garde-fous restent lisibles ensemble.

## Risques et pièges

**La fermeture silencieuse par absence est le risque numéro un.** Il ne se voit pas en test manuel
court, il ne lève aucune erreur, et il se découvre quand un opérateur cherche un constat qu'il avait
vu la veille. Les trois portes de D5 et le scénario de test 3 existent pour ça, et la revue de l'étape
4 doit vérifier les trois requêtes une par une, pas la première seulement.

**Le réarmement silencieux d'un verrou est le même défaut, en pire.** Il redonne du travail déjà fait
à quelqu'un qui a explicitement dit qu'il l'avait fait, et c'est ainsi qu'une file cesse d'être lue.

**La constante de mise en service se fixe une fois.** Une valeur trop tardive produit du silence, une
valeur trop précoce produit une vague. En cas de doute, la valeur tardive est la bonne : une arrivée
manquée se rattrape par la clôture manuelle, une file noyée le jour du déploiement décrédibilise
l'outil. Elle ne se modifie jamais après coup, sous peine de faire réapparaître d'un coup des constats
sur des gens en poste depuis des mois.

**Une suppression suivie d'une recréation fabrique une fausse arrivée.** `firstSeenAt` est réinitialisé
par toute création, et la fusion de fiches prévue par #1 supprime une `Person`. Une fiche fusionnée
vers une cible existante ne pose pas de problème, mais une suppression puis une reprise par la
collecte en poserait un. À signaler à #1 plutôt qu'à traiter ici : c'est son chemin d'écriture qui
sait ce qu'il détruit. Rappel connexe, `Finding.personId` est en `onDelete: Cascade`
(`prisma/schema.prisma:441`), donc les constats d'une personne supprimée disparaissent sans trace en
base ; seul le journal les garde.

**La table `SyncRun` grossit d'une ligne par système et par nuit**, et la requête d'amorçage la
parcourt en cherchant la plus ancienne. L'index `[provider, startedAt]` (`prisma/schema.prisma:283`)
la couvre, et la requête est faite une fois par collecte, pas une fois par personne. À surveiller le
jour où une rétention sera posée sur cette table : purger les plus anciens runs ferait avancer
l'amorçage, donc épargner davantage de monde. Le mode de défaillance est le silence, ce qui est le bon
sens de dégradation, mais il faut le savoir plutôt que de le découvrir.

**Un run non `ok` ne pose aucun `vanishedAt`**, et ce plan ne touche pas à cette règle
(`src/lib/sync/collecte.ts:300-325`, `src/lib/sync/perimetre.ts:249-279`). Corollaire pour ce ticket :
le constat d'arrivée ne dépend d'aucune date posée sous condition, donc il ne bénéficie pas
automatiquement de cette protection. C'est exactement pourquoi D6 pose ses deux conditions explicites,
au lieu de compter sur celles qui existent.

**Rien ici n'écrit sur un système cible.** Lever un constat est une lecture qui se journalise
(`src/lib/sync/constats.ts:182-190`), et le journal précède toujours ce qu'il décrit. `ACTIONS_ENABLED`
n'entre pas en jeu dans ce ticket, et c'est un point de vigilance plutôt qu'un soulagement : le jour où
l'ouverture d'un dossier d'arrivée sera branchée sur ce constat, elle passera par le plan de #8, donc
par `actionTracee` (`src/lib/actions.ts:30-56`) pour la trace nominative et par `RunContext.dryRun`
(`src/lib/depart.ts:56-64`) pour la simulation. Aucun raccourci depuis la file de constats vers un
octroi d'accès.

**Un constat d'arrivée ne peut jamais produire une révocation**, et il ne s'en approche même pas : il
porte sur une `Person`, jamais sur une `ExternalIdentity`, donc la règle qui interdit à une identité
`HEURISTIC` ou `NONE` de fonder une coupure (`docs/architecture.md` §3.2) n'est ni contournée ni
sollicitée. Le champ `identiteId` de `Constat` (`src/core/constat.ts:16`) reste vide pour ce type.

**Le compte rendu de collecte est la seule trace du refus de conclure.** Si la ligne de journal n'est
pas écrite, un garde-fou qui se déclenche toutes les nuits ressemble trait pour trait à une absence
d'arrivée. La chute du périmètre a le même défaut aujourd'hui, atténué par le fait qu'elle bascule le
statut en `PARTIAL` ; le refus de vague, lui, ne bascule rien. Sa ligne de compte rendu n'est donc pas
un confort.

**Le libellé du constat doit dire quoi faire à quelqu'un qui n'a pas lu ce document.** `UNREGISTERED`
et `SCOPE_ENTRY` se ressemblent de loin, l'un dit qu'un compte n'a pas de personne, l'autre qu'une
personne n'a pas d'onboarding. Les confondre fait chercher au mauvais endroit. Les deux explications
de `LIBELLE_CONSTAT` doivent se lire l'une à côté de l'autre sans ambiguïté, et c'est un critère de
relecture de l'étape 2.

## Vérification

`pnpm verify` puis `/verif`, qui ajoute le build Next, nécessaire dès qu'un composant client est
touché à l'étape 5.

**Contrôle avant livraison, à faire sur la base de production et non en local.** Compter ce que le
déploiement lèverait, avec la date retenue pour la mise en service :

```sql
SELECT count(*) FROM "Person"
WHERE "firstSeenAt" > '<date de mise en service>'
  AND "vanishedAt" IS NULL
  AND "source" <> 'SERVICE';
```

Ce nombre est celui des constats qui apparaîtront à la première collecte suivant le déploiement. S'il
dépasse quelques unités, la date est mauvaise, ou bien quelque chose s'est passé en base qu'il faut
comprendre avant de livrer. C'est la vérification directe de la Definition of Ready.

**Parcours manuel de bout en bout**, qui est aussi la Definition of Done du ticket :

1. Lancer `pnpm sync` après le déploiement : le compte rendu annonce zéro arrivée, et `/constats` ne
   montre aucun `SCOPE_ENTRY`.
2. Créer une fiche à la main depuis un compte isolé, relancer la collecte : un constat d'arrivée
   apparaît sur cette personne, et lui seul. Vérifier l'entrée `finding.open` en `SYSTEM` dans le
   journal, avec le `correlationId` de la collecte.
3. Depuis `/constats`, ouvrir le dossier d'arrivée d'un clic, exécuter le plan jusqu'à `EXECUTED`,
   relancer la collecte : le constat s'est fermé seul, avec la raison de réconciliation et sans
   `closedBy`. Cette étape suppose #8.
4. Sur une seconde personne, clore le constat à la main avec une raison, relancer deux collectes : il
   reste clos, il ne revient pas, et le journal porte la clôture nominative.
5. Faire sortir cette seconde personne du périmètre, relancer : son verrou se lève, c'est un
   `SCOPE_EXIT` qui la concerne désormais, et aucun constat d'arrivée ne réapparaît.
6. Simuler un périmètre `PARTIAL`, par exemple en rendant une fiche illisible, et relancer : le compte
   rendu dit que rien n'a été conclu sur les arrivées, aucun constat d'arrivée n'est ouvert, **et
   surtout aucun n'est fermé**. C'est le point de contrôle qui vaut pour toute la Definition of Done.
