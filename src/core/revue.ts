export type EtatRevue = "A_JOUR" | "BIENTOT" | "EN_RETARD" | "EXPIRE";

export interface CompteRevisable {
  /** Périodicité déclarée dans la politique. */
  reviewEveryDays: number;
  lastReviewedAt: Date | null;
  /** Date de déclaration du compte, qui tient lieu de point de départ. */
  createdAt: Date;
  /**
   * Le terme, pour les comptes qui en ont un, et il n'y a que les jetons émis.
   *
   * Exigé plutôt que facultatif, bien qu'il soit nul sur la majorité des lignes : une
   * lecture qui oublierait de le sélectionner afficherait « à jour » sur un jeton mort,
   * et rien ne le signalerait. Le typecheck le signale.
   */
  expiresAt: Date | null;
}

export interface Revue {
  etat: EtatRevue;
  jamaisRevu: boolean;
  echeance: Date;
  /** Jours écoulés depuis l'échéance, nul tant qu'elle n'est pas passée. */
  joursDeRetard: number;
  /**
   * Vrai quand se prononcer sur ce compte est un geste que quelqu'un peut faire.
   *
   * Faux pour tout compte dont un terme porte la péremption : il meurt de lui-même, rien ne
   * sait le révoquer avant, et rien ne sait le prolonger. Proposer « revue faite » dessus
   * offre un bouton qui ne change rien, le terme reprenant la main au calcul suivant.
   */
  reclamee: boolean;
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

  /*
   * Le terme décide seul, et la périodicité ne dit plus rien par-dessus lui.
   *
   * Rien d'autre ne peut éteindre un jeton émis : le proxy qui l'a produit n'offre ni
   * révocation ni introspection, si bien qu'il n'existe aucun geste à demander à personne,
   * ni avant le terme ni après. Sans cette branche, un jeton mort resterait « revue en
   * retard » indéfiniment, c'est-à-dire un signal qui ne s'éteint jamais, exactement la
   * panne que la revue existe pour éviter.
   *
   * Et avant le terme, « à jour » plutôt que l'état que la périodicité aurait rendu : cette
   * périodicité vaut la durée du terme, si bien que tout jeton de moins de trente jours
   * tombait sous le seuil de « bientôt » dès sa naissance et y restait toute sa vie. Sur un
   * parc de jetons courts, la colonne était orange en permanence et cessait de distinguer ce
   * qui demande un geste, pendant que le bouton de revue qu'on proposait ne changeait rien,
   * le terme reprenant la main au calcul suivant.
   */
  if (compte.expiresAt !== null) {
    return {
      etat: compte.expiresAt.getTime() <= today.getTime() ? "EXPIRE" : "A_JOUR",
      jamaisRevu,
      echeance,
      joursDeRetard: 0,
      reclamee: false,
    };
  }

  // Le jour de l'échéance, la revue est due mais pas encore en retard.
  if (restant < 0) {
    return { etat: "EN_RETARD", jamaisRevu, echeance, joursDeRetard: -restant, reclamee: true };
  }

  return {
    etat: restant < soonDays ? "BIENTOT" : "A_JOUR",
    jamaisRevu,
    echeance,
    joursDeRetard: 0,
    reclamee: true,
  };
}

export const LIBELLE_REVUE: Record<EtatRevue, string> = {
  A_JOUR: "À jour",
  BIENTOT: "Revue à prévoir",
  EN_RETARD: "Revue en retard",
  EXPIRE: "Terme passé",
};

const JOURS_MIN = 1;

/**
 * La périodicité de revue d'un credential qui porte un terme : la durée qui reste, en jours
 * arrondie au supérieur.
 *
 * Aucune revue ne tombe ainsi avant que le credential ne meure, ce qui est le seul réglage
 * qui ait un sens : demander de se prononcer sur un jeton qu'on ne peut ni reprendre ni
 * prolonger ne demande rien à personne.
 */
export function periodiciteDUnTerme(depuis: Date, terme: Date): number {
  return Math.max(JOURS_MIN, Math.ceil((terme.getTime() - depuis.getTime()) / JOUR));
}
