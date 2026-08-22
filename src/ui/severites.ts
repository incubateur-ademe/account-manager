import type { Statut } from "@/core/statut";
import type { MatchMethod } from "@/generated/prisma/enums";

// Exhaustives et non `Record<string, ...>` : sous @tsconfig/strictest, une clé
// d'union littérale n'est pas une signature d'index, si bien qu'ajouter une valeur
// à l'enum casse le typecheck au lieu de tomber dans un repli qui afficherait la
// valeur brute.

export const SEVERITE_STATUT: Record<Statut, "success" | "info" | "warning" | "error" | "new"> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "new",
  ACTIF: "success",
  SANS_ECHEANCE: "info",
  ANCIEN: "info",
};

export const SEVERITE_CONSTAT: Record<"HIGH" | "MEDIUM" | "LOW", "error" | "warning" | "info"> = {
  HIGH: "error",
  MEDIUM: "warning",
  LOW: "info",
};

export const LIBELLE_SEVERITE: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "Haute",
  MEDIUM: "Moyenne",
  LOW: "Basse",
};

export const RATTACHEMENT_IDENTITE: Record<MatchMethod, { libelle: string; sur: boolean }> = {
  DECLARED: { libelle: "Déclaré", sur: true },
  GITHUB_LOGIN: { libelle: "Login GitHub", sur: true },
  EMAIL_EXACT: { libelle: "Adresse exacte", sur: true },
  HEURISTIC: { libelle: "Heuristique", sur: false },
  NONE: { libelle: "Aucun", sur: false },
};
