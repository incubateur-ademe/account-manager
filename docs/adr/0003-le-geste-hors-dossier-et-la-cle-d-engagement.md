# ADR-0003 : le geste hors dossier, et la clé d'engagement

## Statut

Accepted

Date : 2026-09-17

## Contexte

Le socle ne connaît que deux moments, l'arrivée et le départ. Ajuster un droit en cours de
mission n'a donc aucun chemin dans l'outil : ni changer un rôle, ni ouvrir un accès ponctuel,
ni émettre un jeton dédié. `docs/architecture.md:697` l'écrit d'ailleurs en toutes lettres du
côté des constats, aucun geste ne coupant un accès hors d'un dossier de départ.

La demande initiale était de dissocier ces actions du principe de plan. Elle s'est déplacée en
cours d'examen, et la reformulation est la bonne : on peut vouloir ouvrir un accès et émettre
un jeton maintenant, puis qu'un départ, plus tard, s'assure de leur reprise. La vraie question
n'est donc pas « avec ou sans plan », c'est **comment un accès ouvert hors d'une arrivée
redevient récupérable au départ.**

### Ce que le code dit déjà

**La collecte est déjà le mécanisme de reprise, pour tout ce qu'elle voit.** Un collaborateur
Scalingo ouvert hors dossier est relevé au passage suivant, devient un `AccessGrant` rattaché à
sa personne, et le plan de départ le coupe parce qu'il le constate. Aucune ligne de code
nouvelle, et c'est plus sûr qu'une note écrite à la main, la collecte disant ce qui est plutôt
que ce qu'on croit avoir fait.

**Le socle a déjà prévu un plan sans dossier.** `PlanKind` porte `MANUAL_OP` et `DRIFT_FIX`
inutilisés (`prisma/schema.prisma:531-536`), `modeleDuPlan("MANUAL_OP")` rend déjà `null`
(`src/core/modele-plan.ts:45`) sous un test qui l'épingle (`src/core/modele-plan.test.ts:495`),
`Plan.accessCaseId` est nullable, la migration `20260824161541` exclut explicitement les plans
sans dossier de l'index d'unicité, et `PlanStep.justification` existe avec un commentaire
disant qu'elle n'est pas remplie depuis un profil (`prisma/schema.prisma:659`).

**Mais un accès peut échapper à toute collecte.** L'API Scalingo ne sait ni lister ni révoquer
les jetons d'une autre personne : c'est une limite du fournisseur, pas un chantier. Un jeton
restreint émis pour quelqu'un n'est donc visible d'aucun relevé, et le départ ne le verra
jamais.

**Et le réflexe qui vient ne marche pas.** Écrire un `AccessGrant` à la main pour mémoriser un
tel accès est inopérant : `src/lib/sync/collecte.ts:432` date en disparu tout `AccessGrant` du
système dont le `lastSeenAt` précède le passage. La ligne écrite à la main serait éteinte à la
nuit suivante, sortirait de `systemesDeLaPersonne` qui ne lit que les accès vivants, et le
départ cesserait de la voir.

### Contraintes

- Les cinq garde-fous d'exécution sont tous accrochés au plan (`docs/architecture.md:840-846`).
- L'exécution recalcule le plan de zéro et compare son empreinte à celle qui a été confirmée
  (`src/lib/execution.ts:315-331`), et toutes les entrées de ce recalcul viennent du dossier.
- Une identité rapprochée par ressemblance ne peut jamais produire de révocation
  (`src/core/rapprochement.ts:23-31`).
- Le journal d'audit précède l'action, et `ACTIONS_ENABLED` vaut faux par défaut.
- Le plan `#26` a déjà rejeté le retrait déclaratif, pour une raison qui n'a pas vieilli : un
  acte sans étape en base est une affirmation que la collecte ne saurait jamais démentir.

## Décision

**Un geste hors dossier est un plan de plus, simplement un plan qui n'a pas de dossier.** Genre
`MANUAL_OP`, portant la personne visée (`Plan.subjectId`, en relation `Restrict`) et l'intention
gelée (`Plan.intent`), qui est à son recalcul d'empreinte ce que `AccessCase.profileKey` est à
celui d'une arrivée. Il n'ouvre jamais qu'un accès et n'en coupe aucun, il porte une
justification nominative, une confirmation et son journal, et il est refusé tant qu'un départ
est ouvert sur la personne.

**Et une étape d'octroi porte une clé d'engagement si et seulement si ce qu'elle ouvre ne
reparaîtra pas dans le `CollectResult` du connecteur qui l'a émise.** Sans clé, le départ
retrouve l'accès par la collecte. Avec clé, il le retrouve par l'étape qui l'a ouvert, et il
n'y a pas d'autre trace au monde. La clé est une chaîne facultative sur `PlannedStep`, que le
connecteur remplit et que le socle transporte **sans jamais l'interpréter**.

### La frontière est par action, jamais par système

C'est le point le plus facile à rater. Scalingo tombe des deux côtés à lui seul : il sait
inviter un collaborateur, que sa propre collecte relit le lendemain, et faire émettre un jeton
restreint, qu'aucune API ne listera jamais. Poser la frontière sur « ce connecteur a-t-il un
`list` » obligerait à scinder Scalingo en deux connecteurs, et ne tiendrait pas au deuxième
système : GitHub a le même problème avec un jeton d'organisation, Notion avec un lien de
partage public.

Le connecteur seul sait de quel côté une action tombe, parce que lui seul sait ce que son
propre relevé rend.

### Les deux fautes sont symétriques

Une clé posée sur ce que la collecte relit fait ressortir deux étapes de coupure pour le même
accès au départ, sous deux clés d'idempotence que le dédoublonnage ne rapproche pas. Une clé
absente sur ce qu'elle ne relit pas fait un trou muet : l'accès survit au départ et rien ne le
dit. D'où le « si et seulement si », qui est une vraie équivalence et pas une commodité de
rédaction.

### Justification

- Le plan porte déjà les cinq garde-fous, l'audit nominatif, la reprise et la réconciliation.
  Recréer tout cela à côté serait une seconde vérité, et le premier désaccord entre les deux
  serait insoluble.
- Une trace décidée ne peut pas vivre dans les tables du constaté, la réconciliation les
  balayant. Elle vit sur l'étape de plan, que rien ne balaie.
- Ne rien mémoriser pour ce que la collecte relit évite de construire une comptabilité pour la
  quasi-totalité des cas, et évite surtout qu'elle diverge du réel.

## Options envisagées

### Un geste unitaire journalisé, sans plan

Écartée. C'est la demande initiale, et c'est le moins de code. Mais aucune étape n'existe alors
en base, donc rien que la collecte puisse démentir, et aucun garde-fou de remplacement pour la
masse, la péremption et l'empreinte. C'est exactement le retrait déclaratif que le plan `#26`
avait déjà rejeté.

### Un troisième sens de dossier

Écartée. Elle garde tout, au prix d'une machine à états de plus, d'une migration d'énumération
dont le retour arrière demanderait d'écrire le dossier de migration à la main, et d'une
contradiction avec `docs/architecture.md` §3.4, qui a refusé un second modèle de dossier.

### Une table `Engagement` dédiée

Écartée, mais son vocabulaire est repris. Elle paie deux fois : une seconde vérité que le calcul
d'un départ doit apprendre à lire, avec sa machine d'écriture et sa clôture ; et surtout un
chemin d'exécution hors plan, qui perd quatre des cinq garde-fous. Or ce chemin est précisément
ce que le plan sans dossier rend inutile.

### La collecte suffit, avec un connecteur séparé pour ce qu'elle ne voit pas

Écartée. Sa démonstration que la reprise au départ est déjà gratuite pour tout ce que la
collecte relit est juste, et elle est reprise entière. Mais sa frontière tombe au niveau du
système, ce qui l'oblige à inventer un connecteur distinct pour une action que Scalingo sait
faire, et il faudrait scinder encore au deuxième cas.

## Conséquences

### Positives

- Ajuster un droit en cours de mission a enfin un chemin, sans qu'aucun garde-fou ne tombe.
- La reprise au départ est gratuite pour tout ce que la collecte relit, et explicite pour le
  reste, sans que personne ait à se rappeler lequel est lequel : le connecteur le déclare.
- Le contrat de connecteur ne change pas de forme pour la frontière : une chaîne facultative de
  plus sur une étape, que le socle ne lit jamais.

### Négatives

- **La garde d'empreinte est tautologique sur un jeton restreint.** Ses paramètres viennent
  tous de l'intention gelée, donc l'empreinte recalculée est égale à celle qui a été confirmée
  par construction. Elle mord bien sur un accès de collaborateur, dont le bénéficiaire vient de
  la base, pas sur celui-là. Mieux vaut l'écrire que laisser croire qu'elle protège les deux.
- **La reprise d'un jeton repose sur une parole d'opérateur que rien ne peut démentir.** La
  réconciliation confronte une parole à un compte observé, et sans compte à regarder elle est
  structurellement muette. C'est pourquoi ces étapes portent un second regard, qui est tout ce
  qui reste.
- **`Restrict` sur la personne visée oblige la fusion de fiches à déplacer les gestes avant de
  supprimer la source**, sous peine de lever une violation de clé étrangère au milieu de la
  transaction. `Cascade` était pourtant la règle partout ailleurs : ici, effacer le plan avec la
  fiche laisserait l'accès ouvert et l'outil muet.
- **Un brouillon de geste obsolète n'a pas d'issue.** `recalculerPlan`
  (`src/app/dossiers/[id]/actions.ts:833-835`) refuse tout plan sans dossier, et aucune action
  n'annule un plan seul. Il faut reposer le geste. C'est un trou du découpage, acté et non
  résolu.
- **Le plafond de masse ne mord pas** sur un plan d'une étape. Il passe toujours, et c'est la
  confirmation avec son empreinte qui porte réellement.
- La liste des connecteurs interrogés au départ ne peut plus se limiter aux systèmes où la
  personne est observée : un engagement peut exister sans aucun compte constaté.

## Liens

- `docs/architecture.md` §3.4, le dossier et le plan, qui doit nommer le plan sans dossier
- `docs/architecture.md` §5.4, l'interface d'exécution, où la clé d'engagement se pose
- `docs/architecture.md` §5.6, les invariants d'exécution
- `docs/architecture.md:697`, la phrase symétrique du côté des constats
- `docs/plans/#26_agir-sur-un-constat.md`, qui avait rejeté le retrait déclaratif
- `docs/plans/#99_administrer-les-droits-scalingo.md`, le plan qui met cette décision en œuvre
- ADR-0002, décidé en même temps et sur le même connecteur
