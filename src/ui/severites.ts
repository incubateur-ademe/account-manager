import type { Statut } from "@/core/statut";
import type { MatchMethod, RiskLevel } from "@/generated/prisma/enums";

// Quatre tables exhaustives, dont la clé est le type lui-même et jamais sa copie :
// sous @tsconfig/strictest, une union de littéraux n'est pas une signature d'index,
// si bien qu'ajouter une valeur au type casse le typecheck au lieu de tomber dans un
// repli qui afficherait la valeur brute. Recopier l'union à la main annulerait ce
// filet, la copie restant muette le jour où l'enum bouge.
//
// `import type` seul : ce module reste des données pures, sans quoi le client généré
// suivrait jusque dans le bundle client et dans les tests, qui tournent sans base.

export const SEVERITE_STATUT: Record<Statut, "success" | "info" | "warning" | "error" | "new"> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "new",
  ACTIF: "success",
  SANS_ECHEANCE: "info",
  ANCIEN: "info",
};

export const SEVERITE_CONSTAT: Record<RiskLevel, "error" | "warning" | "info"> = {
  HIGH: "error",
  MEDIUM: "warning",
  LOW: "info",
};

export const LIBELLE_SEVERITE: Record<RiskLevel, string> = {
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
