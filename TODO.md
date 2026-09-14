# TODO - liste des features qui seraient intéressantes à ajouter à l'application

_document fourni pas l'utilisateur_

- Améliorer le tableau de bord
    - pour montrer le nombre d'opérations (journal), le nombre de personnes, de comptes etc.
    - pour permettre aux connecteurs d'exposer des stats spécifiques
    - donner des infos sur les dernières collectes

## Personnes
- [x] Pouvoir éditer une fiche créée manuellement
- [x] (1.) Pouvoir rattacher une personne créée manuellement à une startup. Use case : il est possible d'avoir des personnes externe qui participent à une startup via contribution (compte guest Notion dédié pour une startup, team flagguée "externe" sur Github, etc.) mais elle n'auront jamais de compte Espace Membre.
- [x] Ajouter un type de rattachement "Manuel Hors Incubateur" et "Manuel Incubateur", pour distinguer les personnes créées manuellement et celles créées par collecte
    - il est possible d'ajouter une personne manuellement et rattachée à l'incubateur (cf 1.)

## Startup
- Avoir une page startup pour lister les membres, les comptes

## Chantiers repérés en séance (18 août 2026)

_ajoutés par Claude, objectif seulement : ni l'un ni l'autre n'a de plan d'implémentation
étudié à ce stade_

### Brancher les dérogations et les références
Suivis dans #15 et #16, et cette entrée ne dit plus que ce qu'elles n'ont pas encore livré. La
collecte lit désormais les dérogations et tait les écarts couverts, mais rien ne permet encore
d'en poser une depuis l'interface, ni n'écarte du plan un système entièrement toléré. `Reference`
est lue par la fusion de fiches, qui la déplace et la supprime, et par personne d'autre : une
référence est un objet possédé, ni accès ni révocable (une page, un dépôt), qui appelle
`ARCHIVE`, `TRANSFER` ou `KEEP` au départ de son auteur, et non une suppression, et rien ne sait
encore le faire. Sans elles, les plans de départ proposent des gestes absurdes sur ce qui n'est
pas un accès.

### Étendre la couverture au-delà de GitHub
La valeur de l'outil est proportionnelle au nombre de systèmes couverts, pas à la finesse avec
laquelle on en traite un. Les candidats sont listés dans `.env.example` : Notion par SCIM, Notion
par jeton de session, OVH via fine-grained-proxy. Un système entièrement manuel est un connecteur
de plein droit, `plan` étant la seule méthode obligatoire du contrat : il suffit qu'il sache dire
quoi faire à la main, avec le lien et le critère de complétion.
