/**
 * À Paris, comme tout ce que cet outil rend et compare. Une colonne `@db.Date` est un
 * minuit UTC, donc une ou deux heures du matin à Paris, donc le même jour : ce qui
 * change ici sont les instants que l'outil calcule lui-même.
 */
export const dateFr = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeZone: "Europe/Paris",
});

/**
 * Le même jour que `dateFr`, pour des `DateTime` complets plutôt que pour des colonnes
 * `@db.Date`. Les deux existent encore parce que leurs usages diffèrent, pas leur
 * fuseau.
 */
export const dateLocale = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeZone: "Europe/Paris",
});

/** Avec l'heure, pour un horodatage que la date seule ne dirait pas assez. */
export const instantLocal = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});
