/**
 * En UTC, et non dans le fuseau du lecteur : les échéances et les phases sont des
 * colonnes `@db.Date`, donc des minuits UTC. Les rendre à Paris les reculerait d'un
 * jour la moitié de l'année, sur les écrans mêmes où une date décide d'une coupure.
 */
export const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });
