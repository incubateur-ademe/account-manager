/**
 * En UTC, et non dans le fuseau du lecteur : les échéances et les phases sont des
 * colonnes `@db.Date`, donc des minuits UTC. Les rendre à Paris les reculerait d'un
 * jour la moitié de l'année, sur les écrans mêmes où une date décide d'une coupure.
 */
export const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

/**
 * Sans fuseau déclaré, donc dans celui du processus qui rend, et non dans celui du
 * lecteur qu'un composant serveur ne connaît pas. Il sert des `DateTime` complets, un
 * pointage ou une validation, là où `dateFr` sert des colonnes `@db.Date`. Une date
 * rendue près de minuit peut donc s'afficher la veille, et aucun choix n'a été fait
 * contre ça.
 */
export const dateLocale = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
