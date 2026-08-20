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

/**
 * Minuit UTC du jour que porte cette date, sous forme comparable.
 *
 * Comparer deux `Date` brutes fait dépendre le résultat de l'heure à laquelle on
 * regarde : une échéance arrive à minuit UTC, l'instant courant non. Le dernier
 * jour travaillé se retrouve alors déjà passé dès la première seconde de la
 * journée, et un accès se coupe un jour trop tôt.
 */
export function jourUTC(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysBetween(from: Date, to: Date): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((jourUTC(to) - jourUTC(from)) / day);
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
  SORTI: "Sorti du référentiel",
  ANCIEN: "Ancien",
  SANS_ECHEANCE: "Sans échéance",
  ACTIF: "Échéance lointaine",
  BIENTOT: "Échéance proche",
  EN_SURSIS: "En sursis",
  A_TRAITER: "À traiter",
};
