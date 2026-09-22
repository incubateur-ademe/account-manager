export type Statut =
  | "SORTI"
  | "SANS_ECHEANCE"
  | "ACTIF"
  | "BIENTOT"
  | "EN_SURSIS"
  | "A_TRAITER"
  | "ANCIEN";

export interface StatutOptions {
  /** Jours de tolérance après la fin de mission avant de proposer quoi que ce soit. */
  graceDays: number;
  /** Fenêtre d'anticipation avant l'échéance. */
  soonDays?: number;
  /** Au-delà, une mission terminée relève de l'historique et non d'une action. */
  staleDays?: number;
}

const PARIS = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Le jour de Paris que porte cette date, sous forme comparable.
 *
 * Comparer deux `Date` brutes fait dépendre le résultat de l'heure à laquelle on
 * regarde : une échéance arrive à minuit, l'instant courant non. Le dernier jour
 * travaillé se retrouve alors déjà passé dès la première seconde de la journée, et un
 * accès se coupe un jour trop tôt.
 *
 * À Paris et non en UTC, parce que c'est le jour que les écrans rendent et celui que
 * l'amont livre déjà. Une échéance stockée à minuit UTC tombe à une ou deux heures du
 * matin à Paris, donc le même jour, et ce qui change ici sont les seuls instants que
 * l'outil calcule lui-même, entre 22h ou 23h UTC et minuit.
 */
/** Le même jour, écrit, pour un message ou pour un système tiers qui attend une date. */
export function jourDeParis(date: Date): string {
  return PARIS.format(date);
}

export function jourMetier(date: Date): number {
  // `Intl` lève sur une date invalide là où l'arithmétique rendait `NaN`. Les appelants
  // testent ce `NaN` pour refuser une saisie, et lever ici passerait avant leur garde.
  if (Number.isNaN(date.getTime())) {
    return Number.NaN;
  }

  // Par parts plutôt qu'en découpant la chaîne : un composant absent rend alors `NaN`,
  // qui se propage, là où un défaut de découpage vaudrait zéro et donnerait un jour faux
  // sans que rien ne le dise.
  const parts = PARIS.formatToParts(date);
  const valeur = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return Date.UTC(valeur("year"), valeur("month") - 1, valeur("day"));
}

function daysBetween(from: Date, to: Date): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((jourMetier(to) - jourMetier(from)) / day);
}

/**
 * La fin de mission est un jalon contractuel, pas un départ : elle est saisie à la
 * main et souvent après coup. Le délai de grâce existe pour qu'un renouvellement
 * signé en retard ne déclenche pas un offboarding, ce qui coûterait bien plus cher
 * qu'une semaine d'accès en trop.
 */
export function statutDe(
  missionEnd: Date | null,
  today: Date,
  { graceDays, soonDays = 30, staleDays = 180 }: StatutOptions,
): Statut {
  if (missionEnd === null) {
    return "SANS_ECHEANCE";
  }

  // La fin de mission est le dernier jour travaillé : elle est inclusive.
  const restant = daysBetween(today, missionEnd);

  if (restant >= soonDays) {
    return "ACTIF";
  }
  if (restant >= 0) {
    return "BIENTOT";
  }
  if (-restant <= graceDays) {
    return "EN_SURSIS";
  }
  // Une mission close depuis des années n'appelle pas la même réaction qu'une
  // mission close la semaine dernière. Les confondre met 74 personnes parties
  // depuis plus d'un an au même rang que celles qu'il faut traiter maintenant,
  // et une liste où tout est urgent ne signale plus rien.
  return -restant <= staleDays ? "A_TRAITER" : "ANCIEN";
}

/**
 * Une personne peut quitter le référentiel amont avant qu'on ait coupé ses accès :
 * le cron de beta.gouv retire les expirés des équipes, et elle disparaît alors de
 * la source. La masquer serait la perdre de vue au moment précis où elle compte le
 * plus, donc la sortie prime sur toute échéance.
 */
export function statutDePersonne(
  personne: { missionEnd: Date | null; vanishedAt: Date | null },
  today: Date,
  options: StatutOptions,
): Statut {
  if (personne.vanishedAt !== null) {
    return "SORTI";
  }
  return statutDe(personne.missionEnd, today, options);
}

export const LIBELLE_STATUT: Record<Statut, string> = {
  SORTI: "Sorti du référentiel des personnes",
  ANCIEN: "Ancien",
  SANS_ECHEANCE: "Sans échéance",
  ACTIF: "Échéance lointaine",
  BIENTOT: "Échéance proche",
  EN_SURSIS: "En sursis",
  A_TRAITER: "À traiter",
};
