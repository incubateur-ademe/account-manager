import type { Statut } from "@/core/statut";
import type { MatchMethod, PersonSource } from "@/generated/prisma/enums";

export const SEVERITE_STATUT: Record<Statut, "success" | "info" | "warning" | "error" | "new"> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "new",
  ACTIF: "success",
  SANS_ECHEANCE: "info",
  ANCIEN: "info",
};

/**
 * Les seuls statuts qui appellent un geste, et la gravité de ce geste.
 *
 * Les autres décrivent une situation dont il n'y a rien à faire : les porter dans le
 * bloc d'action le ferait paraître sur chaque fiche, et un bloc qui paraît partout ne
 * signale plus rien.
 */
export const STATUT_A_TRAITER: Partial<Record<Statut, "error" | "warning" | "info">> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "info",
};

// Exhaustives et non `Record<string, ...>` : sous @tsconfig/strictest, une clé
// d'union littérale n'est pas une signature d'index, si bien qu'ajouter une valeur
// à l'enum casse le typecheck au lieu de tomber dans un repli qui afficherait la
// valeur brute.
export const SOURCE: Record<PersonSource, string> = {
  BETA: "Espace-membre beta.gouv",
  LOCAL: "Saisie locale",
  SERVICE: "Compte de service",
};

export const RATTACHEMENT_IDENTITE: Record<MatchMethod, { libelle: string; sur: boolean }> = {
  DECLARED: { libelle: "Déclaré", sur: true },
  GITHUB_LOGIN: { libelle: "Login GitHub", sur: true },
  EMAIL_EXACT: { libelle: "Adresse exacte", sur: true },
  HEURISTIC: { libelle: "Heuristique", sur: false },
  NONE: { libelle: "Aucun", sur: false },
};

export const LIBELLE_PHASE: Record<string, string> = {
  investigation: "Investigation",
  construction: "Construction",
  acceleration: "Accélération",
  transfer: "Transfert",
  transfere: "Transférée",
  success: "Pérennisée",
  alumni: "Alumni",
  abandon: "Abandonnée",
  "abandon-investigation": "Abandonnée en investigation",
};

export interface Seuils {
  graceDays: number;
  soonDays: number;
  staleDays: number;
}

export function expliquerStatut(
  statut: Statut,
  { graceDays, soonDays, staleDays }: Seuils,
): string {
  switch (statut) {
    case "SORTI":
      return "Elle a quitté le référentiel de l'incubateur, et rien ici ne dit ce que ses accès sont devenus.";
    case "A_TRAITER":
      return `Son échéance est dépassée au-delà du délai de grâce de ${graceDays} jours.`;
    case "EN_SURSIS":
      return `Son échéance est dépassée, mais le délai de grâce de ${graceDays} jours court encore : un renouvellement signé en retard est encore possible.`;
    case "BIENTOT":
      return `Son échéance tombe dans les ${soonDays} prochains jours.`;
    case "ACTIF":
      return "Son échéance est lointaine : rien ne la signale de ce côté.";
    case "SANS_ECHEANCE":
      return "Aucune date de fin de mission n'est connue : aucune échéance ne la fera remonter.";
    case "ANCIEN":
      return `Son échéance est dépassée depuis plus de ${staleDays} jours : elle relève désormais de l'historique.`;
  }
}

export const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });
