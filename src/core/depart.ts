import type { Peremption } from "@/core/plan";
import { autoriseUneRevocation } from "@/core/rapprochement";

export type EtatEtape = "PENDING" | "SKIPPED" | "SUCCEEDED" | "ALREADY_ABSENT" | "STALE" | "FAILED";

export type EtatDossier = "WATCH" | "CANDIDATE" | "CONFIRMED" | "CANCELLED" | "DONE";

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
      raison: "Les accès observés ont changé depuis le calcul : ce plan ne les décrit plus.",
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

/**
 * Ce qu'est un dossier vivant, dit une fois. La règle vivait en deux exemplaires
 * littéraux, dans l'ouverture d'un dossier et dans le blocage de la fusion : un
 * dictionnaire exhaustif fait tomber le typecheck le jour où une valeur s'ajoute à
 * l'énum, là où un tableau littéral aurait continué de mentir en silence.
 */
const VIVANT: Record<EtatDossier, boolean> = {
  WATCH: true,
  CANDIDATE: true,
  CONFIRMED: true,
  CANCELLED: false,
  DONE: false,
};

export function dossierVivant(etat: EtatDossier): boolean {
  return VIVANT[etat];
}

export const ETATS_VIVANTS: readonly EtatDossier[] = (Object.keys(VIVANT) as EtatDossier[]).filter(
  dossierVivant,
);

/**
 * Un plan qui tombe avec son dossier. Un brouillon n'engage personne, et un plan
 * qui attend d'être confirmé pas davantage. Un plan remplacé garde en revanche ce
 * qui l'a écarté : `EXPIRED` et `STALE` disent pourquoi il ne vaut plus, et les
 * écraser perdrait cette raison.
 */
export function planAAnnuler(plan: EtatPlan | null): boolean {
  return plan === "DRAFT" || plan === "CONFIRMABLE";
}

/**
 * Un plan que quelqu'un a confirmé, et dont les étapes ont pu être pointées. Un plan
 * remplacé n'en est pas : `EXPIRED` et `STALE` disent qu'il a cessé de valoir avant
 * que personne n'en réponde.
 */
function planEngage(plan: EtatPlan): boolean {
  return plan === "EXECUTING" || plan === "EXECUTED" || plan === "PARTIALLY_EXECUTED";
}

/**
 * Annuler, c'est dire qu'un départ n'aura pas lieu. Le geste s'arrête là où
 * commence l'engagement : dès qu'un plan est confirmé, des étapes ont pu être
 * pointées, et défaire le dossier ferait disparaître des paroles que la collecte
 * doit encore vérifier. Il n'y a pas de fenêtre de rétractation ici, il y a la
 * clôture.
 */
export function peutAnnuler(dossier: EtatDossier, plan: EtatPlan | null): Verdict {
  if (dossier === "CANCELLED") {
    return { possible: false, raison: "Ce dossier est déjà annulé." };
  }
  if (dossier === "DONE") {
    return { possible: false, raison: "Ce dossier est clos : il ne s'annule plus." };
  }
  if (plan !== null && planEngage(plan)) {
    // La phrase ne nomme aucun geste : sur un plan partiellement exécuté, l'écran
    // n'offre ni de reprendre les étapes ni de clore, et promettre l'un ou l'autre
    // enverrait chercher ce qui n'existe pas.
    return {
      possible: false,
      raison: "Ce plan est engagé : l'annulation ne défait pas ce qui a été déclaré fait.",
    };
  }
  return { possible: true };
}

/**
 * Clore, c'est constater que tout est soldé. Les trois refus vivaient en dur dans
 * l'action, dont celui qui parlait d'accès restés ouverts sur un dossier annulé, où
 * il n'y en avait aucun.
 */
export function peutClore(dossier: EtatDossier, plan: EtatPlan | null): Verdict {
  if (dossier === "DONE") {
    return { possible: false, raison: "Ce dossier est déjà clos." };
  }
  if (dossier === "CANCELLED") {
    return { possible: false, raison: "Ce dossier est annulé : il n'y a rien à clore." };
  }
  if (plan === null || !dossierSoldable(plan)) {
    return {
      possible: false,
      raison: "Toutes les étapes ne sont pas soldées : des accès restent ouverts.",
    };
  }
  return { possible: true };
}

export interface CompteConstate {
  provider: string;
  methode: string;
}

export interface SystemesDuDepart {
  /** Systèmes où un geste est possible : un compte y est rattaché de façon sûre. */
  revocables: readonly string[];
  /** Tous les systèmes où un compte est observé, quelle que soit la solidité du rattachement. */
  observes: readonly string[];
  /** Systèmes où un compte n'est rattaché que sur une ressemblance : aucune étape ne peut le viser. */
  nonConfirmes: readonly string[];
}

/**
 * Répartit les systèmes selon ce qu'on a le droit d'y faire.
 *
 * Un compte rattaché sur une ressemblance ne produit aucune étape, et c'est une règle
 * dure : couper sur cette base reviendrait à couper l'accès d'un homonyme. Mais son
 * système doit se dire quand même, sans quoi un plan muet laisserait croire qu'il n'y
 * a rien là, alors qu'il y a un compte que personne n'a encore tranché.
 */
export function systemesDuDepart(comptes: readonly CompteConstate[]): SystemesDuDepart {
  const revocables = new Set<string>();
  const observes = new Set<string>();
  const nonConfirmes = new Set<string>();

  for (const compte of comptes) {
    observes.add(compte.provider);
    if (autoriseUneRevocation(compte.methode)) {
      revocables.add(compte.provider);
    } else {
      nonConfirmes.add(compte.provider);
    }
  }

  const trier = (valeurs: ReadonlySet<string>) =>
    [...valeurs].sort((a, b) => a.localeCompare(b, "fr"));

  return {
    revocables: trier(revocables),
    observes: trier(observes),
    nonConfirmes: trier(nonConfirmes),
  };
}

/**
 * Recalculer remplace une liste que personne n'a approuvée. Un plan confirmé porte
 * des pointages : le refaire effacerait ce que quelqu'un a déclaré avoir fait.
 *
 * Sans ce geste, un dossier dont le plan a péri n'a plus d'issue. La confirmation le
 * refuse à juste titre, et rien d'autre ne permet d'en calculer un nouveau : le
 * dossier reste ouvert sur des accès dont personne ne s'occupe plus.
 */
export function peutRecalculer(etat: EtatPlan, peremption: Peremption): Verdict {
  if (etat !== "DRAFT") {
    return {
      possible: false,
      raison: "Seul un brouillon se recalcule : ce plan n'en est plus un.",
    };
  }
  if (!peremption.perime && !peremption.obsolete) {
    return {
      possible: false,
      raison: "Ce plan décrit encore la situation observée : il n'y a rien à recalculer.",
    };
  }
  return { possible: true };
}

/**
 * Ce que devient le plan qu'un recalcul remplace. La péremption prime sur
 * l'obsolescence : c'est un fait daté, là où l'autre est une comparaison qui dépend
 * de ce qu'on vient de lire.
 */
export function etatDUnPlanRemplace(peremption: Peremption): EtatPlan {
  return peremption.perime ? "EXPIRED" : "STALE";
}
