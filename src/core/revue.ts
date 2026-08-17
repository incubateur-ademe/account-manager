export type EtatRevue = "A_JOUR" | "BIENTOT" | "EN_RETARD";

export interface CompteRevisable {
  /** Périodicité déclarée dans la politique. */
  reviewEveryDays: number;
  lastReviewedAt: Date | null;
  /** Date de déclaration du compte, qui tient lieu de point de départ. */
  createdAt: Date;
}

export interface Revue {
  etat: EtatRevue;
  jamaisRevu: boolean;
  echeance: Date;
  /** Jours écoulés depuis l'échéance, nul tant qu'elle n'est pas passée. */
  joursDeRetard: number;
}

const JOUR = 24 * 60 * 60 * 1000;

function joursEntre(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / JOUR);
}

function ajouterJours(depuis: Date, jours: number): Date {
  return new Date(
    Date.UTC(depuis.getUTCFullYear(), depuis.getUTCMonth(), depuis.getUTCDate() + jours),
  );
}

/**
 * Un compte machine n'a pas de fin de mission : la revue périodique est le seul
 * signal qu'il puisse émettre, une revue en retard vaut donc un accès expiré.
 *
 * Faute de dernière revue, la périodicité court depuis la déclaration : sans ce
 * point de départ, tout compte naîtrait en retard le jour où on l'ajoute à la
 * politique, et un signal qui s'allume pour tout le monde ne signale plus rien.
 */
export function revueDe(compte: CompteRevisable, today: Date, soonDays = 30): Revue {
  const jamaisRevu = compte.lastReviewedAt === null;
  const echeance = ajouterJours(compte.lastReviewedAt ?? compte.createdAt, compte.reviewEveryDays);
  const restant = joursEntre(today, echeance);

  // Le jour de l'échéance, la revue est due mais pas encore en retard.
  if (restant < 0) {
    return { etat: "EN_RETARD", jamaisRevu, echeance, joursDeRetard: -restant };
  }

  return {
    etat: restant < soonDays ? "BIENTOT" : "A_JOUR",
    jamaisRevu,
    echeance,
    joursDeRetard: 0,
  };
}

export const LIBELLE_REVUE: Record<EtatRevue, string> = {
  A_JOUR: "À jour",
  BIENTOT: "Revue à prévoir",
  EN_RETARD: "Revue en retard",
};
