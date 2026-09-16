# ADR-0001 : une configuration à trois niveaux, et une interface pour la régler

## Statut

Accepted

Date : 2026-09-16

## Contexte

La configuration de l'outil vit aujourd'hui dans deux fichiers YAML versionnés d'un dépôt
privé, `accounts.yaml` et `config.yaml`, plus une poignée de variables d'environnement.
Changer un seuil, ajouter un domaine ou déclarer un compte de service demande donc une
demande de tirage sur ce dépôt, puis un redéploiement.

Trois constats ont ouvert la question.

**La frontière entre les deux fichiers ne veut plus rien dire.** `accounts.yaml` ne porte
que `scope` et `serviceAccounts`, quand `config.yaml` porte tout le reste, dérogations
permanentes comprises.

**`config.systems` est mort.** Rien ne le lit, sauf `src/cli/verifier-politique.ts:53` qui
en compte les entrées pour les afficher. Le catalogue réel est le registre `CONNECTEURS`,
et c'est lui que l'écran des systèmes rend.

**La friction se paie à chaque système ajouté.** Le connecteur Scalingo a demandé de
relever un identifiant dans un écran, puis de le recopier à la main dans un fichier d'un
autre dépôt, puis de redéployer, pour que la collecte suivante cesse de signaler un compte
que personne ne réclamait.

### Contraintes

- Un mainteneur à temps partiel, un outil sollicité sérieusement deux fois par an.
- `docs/architecture.md` §3.5 pose que la politique dit les règles, que la base porte les
  faits et les décisions, et que le journal garantit qu'on puisse les retrouver.
- `docs/architecture.md` §3.1 pose que `OPERATORS` et `BREAK_GLASS_USERNAMES` relèvent du
  déploiement et n'ont pas à être publiés dans un dépôt lisible.
- `ACTIONS_ENABLED` est l'interrupteur général, et il ne se contourne pas par du code.
- Le fichier de politique est versionné dans un dépôt lisible : aucun secret n'y entre, et
  la page d'un connecteur affiche la configuration résolue telle quelle.

## Décision

La configuration se résout à trois niveaux, `environnement < fichier < base`, et une
interface d'administration écrit le dernier. Une famille de valeurs y échappe entièrement :
les garde-fous et le branchement, qui restent en environnement seul et s'affichent en
lecture seule.

La ligne de partage est celle-ci : **la configuration porte les règles métier, et
l'environnement porte le branchement et les garde-fous.** Elle se tient sans juger au cas
par cas si une valeur est sensible.

Au passage, les deux fichiers fusionnent, `config.systems` disparaît, `serviceAccounts`
passe en base, et `permanentDerogations` rejoint le reste.

### Justification

- Le besoin est réel et se répétera à chaque système ajouté, or la valeur de l'outil est
  proportionnelle au nombre de systèmes couverts.
- Ce que `git log` donnait gratuitement, le journal d'audit sait le donner aussi, et il le
  fait déjà pour tout ce que le produit appelle une décision.
- La ligne règle métier contre branchement est plus simple à tenir que secret contre non
  secret : elle ne demande aucun jugement, et elle laisse hors d'atteinte ce dont la
  compromission ferait le plus de dégâts.
- Un garde-fou qu'une interface peut rouvrir n'est pas un garde-fou. L'interrupteur général
  et la liste des opérateurs perdraient leur sens à devenir surchargeables.

## Options envisagées

### Ne rien faire

Écartée parce que la friction se paie à chaque système ajouté, et que le produit existe
justement pour en couvrir davantage. Elle gardait pourtant deux qualités qu'il faut
maintenant payer autrement : l'audit par `git log`, et une configuration hors du périmètre
de sauvegarde critique.

### Ranger sans déplacer

Fusionner les fichiers, supprimer ce qui est mort, regrouper ce qui va ensemble, et rester
en git. Écartée comme insuffisante, mais retenue comme partie de cette décision : le
rangement vaut indépendamment du reste.

### Porter aussi les credentials en configuration

Écartée. Le gain est mince, la plateforme de déploiement posant déjà une variable sans
reconstruction, au prix d'un redémarrage et non d'une livraison. Le coût ne l'est pas : ce
produit existe pour savoir qui a accès à quoi sur dix-neuf systèmes, et faire de sa base le
coffre de tous les credentials du parc y créerait la cible unique qu'il sert à surveiller.
Il perdrait en plus un invariant qui rend service tous les jours, un dump de production se
restaurant en développement sans exposer un seul jeton.

Le besoin réel derrière cette demande, savoir lequel manque sans ouvrir un terminal, se
traite sans déplacer le secret : `probe()` constate déjà leur présence, il suffit que
l'interface dise lequel manque, sous quel nom le poser, et ce que son absence dégrade.

## Conséquences

### Positives

- Un seuil, un domaine, un compte de service se changent depuis l'outil, tracés, sans
  demande de tirage ni redéploiement.
- Le fichier reste possible pour ce qu'on veut figer et relire en revue, et l'environnement
  garde le dernier mot sur ce qui protège.
- Une valeur qui manque se voit dans l'interface au lieu de se découvrir au démarrage.

### Négatives

- **La configuration cesse d'être reconstructible.** `docs/architecture.md` §3.5 doit être
  amendé : le périmètre de sauvegarde critique passe de trois familles à quatre.
- L'audit de la configuration devient une obligation et non un agrément : sans lui, ce que
  `git log` donnait est perdu, et une règle changée ne se retrouve plus.
- Trois niveaux à résoudre, donc un endroit de plus où se tromper. L'interface doit dire
  d'où vient chaque valeur affichée, faute de quoi personne ne saura pourquoi un réglage ne
  prend pas.
- La convention `CONFIG_` devient structurante : un nom d'environnement non préfixé n'est
  jamais surchargeable, et le schéma doit refuser une clé de fichier qui prétendrait porter
  un garde-fou.

## Liens

- `docs/architecture.md` §3.1, le déclaré, qui perd `systems` et `serviceAccounts`
- `docs/architecture.md` §3.5, la reconstructibilité, dont le périmètre s'élargit
- `docs/architecture.md` §5.5, où vivent les credentials, que cette décision ne change pas
