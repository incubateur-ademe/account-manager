# TODO - liste des features qui seraient intéressantes à ajouter à l'application

_document fourni pas l'utilisateur_

- [x] Améliorer le tableau de bord (PR 47)
    - pour montrer le nombre d'opérations (journal), le nombre de personnes, de comptes etc.
    - pour permettre aux connecteurs d'exposer des stats spécifiques
    - donner des infos sur les dernières collectes

## Personnes
- [x] Pouvoir éditer une fiche créée manuellement
- [x] (1.) Pouvoir rattacher une personne créée manuellement à une startup. Use case : il est possible d'avoir des personnes externe qui participent à une startup via contribution (compte guest Notion dédié pour une startup, team flagguée "externe" sur Github, etc.) mais elle n'auront jamais de compte Espace Membre.
- [x] Ajouter un type de rattachement "Manuel Hors Incubateur" et "Manuel Incubateur", pour distinguer les personnes créées manuellement et celles créées par collecte
    - il est possible d'ajouter une personne manuellement et rattachée à l'incubateur (cf 1.)

## Startup
- [x] Avoir une page startup pour lister les membres, les comptes (PR 43)

## Chantiers repérés en séance (18 août 2026)

_ajoutés par Claude. Les références ont un plan d'implémentation, `docs/plans/#16_references.md`,
la couverture n'en a pas._

### Brancher les références
Suivies dans #16, découpé en six lots. Les lots 1 et 2 sont livrés, le repreneur d'un transfert
Scalingo (PR 134) et la capacité de lire les objets possédés (PR 132). Restent les lots 3 à 6 : le
schéma de `Reference` et la fusion qui le suit, le cœur et la collecte des références, les
références dans le plan de départ, et l'écran de l'inventaire. D'ici là, `Reference` est lue par
la fusion de fiches, qui la déplace et la supprime, et par personne d'autre. Une référence est un
objet possédé, ni accès ni révocable (une page, un dépôt), qui appelle `ARCHIVE`, `TRANSFER` ou
`KEEP` au départ de son auteur, et non une suppression, et rien ne sait encore le faire. Sans
elles, les plans de départ proposent des gestes absurdes sur ce qui n'est pas un accès.

### Étendre la couverture au-delà de GitHub, Notion et Scalingo
La valeur de l'outil est proportionnelle au nombre de systèmes couverts, pas à la finesse avec
laquelle on en traite un. Trois connecteurs existent, `github`, `notion` par SCIM et `scalingo`.
Restent OVH (`email-list`) via fine-grained-proxy et Notion par jeton de session, dont
`.env.example` porte déjà les variables, puis `vaultwarden`, `grafana`, `sentry` et `teams-o365`,
au catalogue de `docs/architecture.md` §5.8. Un système entièrement manuel est un connecteur de
plein droit, `probe` et `plan` étant les seules méthodes obligatoires du contrat : il suffit qu'il
sache dire quoi faire à la main, avec le lien et le critère de complétion.
