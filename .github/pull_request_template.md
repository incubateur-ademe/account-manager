<!--
Titre de la PR au format Conventional Commits, en francais : `type: description`.
C'est lui qui devient le message du squash sur main, donc il se lit seul dans six mois.

  feat     une capacite nouvelle              fix      un comportement qui etait faux
  docs     documentation ou plan              refactor sans changement de comportement
  test     tests seuls                        build    outillage, dependances, image
  ci       chaine d'integration               chore    le reste

Ajouter `!` avant les deux points pour une rupture : `feat!: ...`.
Pas de scope : aucun commit de ce depot n'en porte.

Supprimer les sections qui ne servent pas. Une PR d'une ligne n'a pas besoin de six titres.
-->

## Ce que ça change, et pourquoi

<!--
Le pourquoi d'abord. Le quoi se lit dans le diff, le pourquoi ne se lit nulle part
ailleurs et c'est lui qu'on cherchera quand ce code surprendra quelqu'un.
-->

Closes #

## Les décisions qui méritent une relecture

<!--
Ce qui a été tranché et qui aurait pu l'être autrement : une règle métier, un choix qui
engage la suite, une tension avec `docs/architecture.md`. Dire aussi ce qui a été
delibérément écarté, et pourquoi.
-->

## Vérifications

<!--
`pnpm verify` et le build passent, avec le nombre de tests. Ce qui a été vérifié à la
main, dans un navigateur ou sur une base collectée, et ce qui ne l'a pas été.
Un « non vérifié » écrit vaut mieux qu'un silence qui se lira comme un « vérifié ».
-->

## Ce qui reste ouvert

<!--
Les défauts croisés sans les traiter, les points à trancher plus tard, ce qu'une issue
devrait reprendre. Rien à signaler est une réponse valable, et se dit.
-->
