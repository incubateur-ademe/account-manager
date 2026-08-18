import type { Peremption } from "@/core/plan";

export type EtatEtape = "PENDING" | "SKIPPED" | "SUCCEEDED" | "ALREADY_ABSENT" | "STALE" | "FAILED";

export type EtatPlan =
  | "DRAFT"
  | "CONFIRMABLE"
  | "EXECUTING"
  | "EXECUTED"
  | "PARTIALLY_EXECUTED"
  | "CANCELLED"
  | "EXPIRED"
  | "STALE";

export interface Refus {
  possible: false;
  raison: string;
}

export type Verdict = { possible: true } | Refus;

/**
 * Confirmer, c'est dire « j'ai lu cette liste et j'en réponds ». Le sens de ce geste
 * tient à ce que la liste ne bouge plus après : on ne confirme donc ni un plan trop
 * vieux, ni un plan que la réalité a déjà démenti, ni un plan déjà confirmé.
 */
export function peutConfirmer(etat: EtatPlan, peremption: Peremption, etapes: number): Verdict {
  if (etat !== "DRAFT") {
    return { possible: false, raison: "Ce plan n'est plus un brouillon." };
  }
  if (etapes === 0) {
    return { possible: false, raison: "Ce plan ne demande aucune action." };
  }
  if (peremption.perime) {
    return {
      possible: false,
      raison:
        "Ce plan a dépassé sa date de validité : ce qu'il décrit a été constaté il y a trop longtemps.",
    };
  }
  if (peremption.obsolete) {
    return {
      possible: false,
      raison:
        "Une collecte est passée depuis le calcul : ce plan ne décrit plus les accès de cette personne.",
    };
  }
  return { possible: true };
}

/**
 * Pointer une étape est une déclaration humaine, pas une exécution : l'outil ne
 * touche à aucun système ici. On ne pointe donc que ce qui a été confirmé, sans quoi
 * on consignerait des gestes faits d'après un brouillon que personne n'a approuvé.
 */
export function peutPointer(etat: EtatPlan): Verdict {
  if (etat === "EXECUTING") {
    return { possible: true };
  }
  if (etat === "DRAFT") {
    return { possible: false, raison: "Ce plan doit d'abord être confirmé." };
  }
  return { possible: false, raison: "Ce plan est clos." };
}

/** Une étape qu'on ne reverra plus : elle a été traitée, ou écartée en connaissance de cause. */
export function estSoldee(etat: EtatEtape): boolean {
  return etat === "SUCCEEDED" || etat === "ALREADY_ABSENT" || etat === "SKIPPED";
}

/**
 * Où en est un plan, déduit de ses étapes et jamais posé à la main : un plan dont
 * l'état ne se lit pas dans ses étapes finit par affirmer une chose que le détail
 * dément.
 *
 * « Déjà absent » vaut réussite, c'est le cas nominal quand quelqu'un d'autre est
 * passé avant. « Ignorée » aussi, à la différence près qu'elle porte une raison.
 */
export function etatApresPointage(etapes: readonly EtatEtape[]): EtatPlan {
  if (etapes.length === 0) {
    return "EXECUTED";
  }
  if (etapes.some((etat) => etat === "PENDING")) {
    return "EXECUTING";
  }
  return etapes.every((etat) => estSoldee(etat)) ? "EXECUTED" : "PARTIALLY_EXECUTED";
}

/**
 * Un dossier ne se clôt pas parce que les cases sont cochées, mais parce que plus
 * rien n'attend : un plan partiellement exécuté laisse des accès ouverts, et le
 * dossier doit continuer de le dire.
 */
export function dossierSoldable(etatPlan: EtatPlan): boolean {
  return etatPlan === "EXECUTED";
}
