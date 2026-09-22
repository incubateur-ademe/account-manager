import type { MotifAppartenance } from "@/core/appartenance";
import type { Statut } from "@/core/statut";
import type { PersonSource } from "@/generated/prisma/enums";

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

/**
 * Le badge d'appartenance ne colore que ce que le motif dit : une décision forcée
 * se signale, une absence de rattachement aussi, le reste est du constaté ordinaire.
 */
export const SEVERITE_APPARTENANCE: Record<MotifAppartenance, "success" | "info" | "warning"> = {
  INCLUSION_FORCEE: "warning",
  EXCLUSION_FORCEE: "warning",
  EQUIPE_ET_STARTUP: "success",
  EQUIPE: "success",
  STARTUP: "success",
  STARTUP_MANUELLE: "success",
  AUCUN: "info",
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
      return "Rien ici ne dit ce que ses accès sont devenus.";
    case "A_TRAITER":
      return `Son échéance est dépassée au-delà du délai de grâce de ${graceDays} jours.`;
    case "EN_SURSIS":
      return `Son échéance est dépassée, mais le délai de grâce de ${graceDays} jours court encore.`;
    case "BIENTOT":
      return `Son échéance tombe dans les ${soonDays} prochains jours.`;
    case "ACTIF":
      return "Aucune échéance ne la fait remonter. Seules ses startups disent son activité.";
    case "SANS_ECHEANCE":
      return "Aucune échéance ne la fera remonter.";
    case "ANCIEN":
      return `Son échéance est dépassée depuis plus de ${staleDays} jours.`;
  }
}

/**
 * Le brouillon de geste qui attend, et les deux états où il ne se confirme plus.
 *
 * Les deux disent la même sortie, reposer le geste, parce qu'un brouillon n'en a pas
 * d'autre : il ne se recalcule ni ne s'annule.
 */
export const GESTE = {
  titre: "Un geste attend votre confirmation",

  terme: (expiresAt: Date, format: Intl.DateTimeFormat): string =>
    `Ce brouillon vaut jusqu'au ${format.format(expiresAt)}.`,

  avantDeConfirmer:
    "Confirmer, c'est dire que vous répondez de cette liste. Elle ne bougera plus ensuite, et chaque étape pourra être exécutée.",

  perime: (systeme: string): string =>
    `Le terme de ce brouillon est passé, il ne se confirme plus. Reposez le geste depuis ${systeme}.`,

  ecarte: (systeme: string): string =>
    `Ce que ce geste vaut aujourd'hui a changé depuis l'écriture du brouillon. Reposez le geste depuis ${systeme}.`,

  reposer: (systeme: string): string => `Reposer ce geste depuis ${systeme}`,
} as const;
