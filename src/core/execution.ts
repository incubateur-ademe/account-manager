import type { PrecheckResult, RiskLevel, StepOutcome } from "@/core/connector";
import type { EtatEtape, EtatPlan, Verdict } from "@/core/dossier";
import { plusValableApres } from "@/core/plan";

/**
 * Ce que le journal retient d'un geste : l'action a eu lieu, elle a échoué, ou elle
 * n'a pas eu lieu. Le même vocabulaire que `AuditInput`, redit ici pour que ce module
 * ne dépende d'aucun type généré.
 */
export type ResultatJournalise = "SUCCESS" | "FAILURE" | "SKIPPED";

/**
 * Exécuter, c'est reprendre un plan que quelqu'un a confirmé. Un brouillon n'a été
 * relu par personne, et un plan clos n'attend plus rien.
 *
 * `PARTIALLY_EXECUTED` autant qu'`EXECUTING`, pour la raison qui vaut déjà au
 * pointage : c'est l'état d'un plan dont une étape a échoué, et le refuser murerait le
 * dossier en interdisant la reprise de ce qui a échoué.
 */
export function peutExecuter(etat: EtatPlan): Verdict {
  if (etat === "EXECUTING" || etat === "PARTIALLY_EXECUTED") {
    return { possible: true };
  }
  if (etat === "DRAFT") {
    return {
      possible: false,
      raison: "Ce plan doit d'abord être confirmé : personne n'a encore répondu de cette liste.",
    };
  }
  return { possible: false, raison: "Ce plan est clos : il n'y a plus rien à exécuter." };
}

/**
 * Un plan cesse de valoir de deux façons qu'il ne faut pas confondre, et la seconde
 * manquait au seul chemin qui écrit : il périme par le temps, ce qu'il décrit devenant
 * trop vieux pour qu'on agisse dessus sans regarder à nouveau, et il devient obsolète
 * par son contenu. La confirmation vérifiait déjà les deux ; l'exécution ne regardait
 * que l'empreinte, si bien qu'un plan approuvé des mois plus tôt restait exécutable
 * sur des accès constatés à une époque où personne ne les a revus depuis.
 *
 * L'échéance d'un octroi est calculée au moment du calcul : exécuter un plan périmé
 * ouvrirait donc des accès dont le terme a été fixé sur une situation révolue.
 */
export function refusDePeremption(expiresAt: Date, maintenant: Date): string | null {
  if (!plusValableApres(expiresAt, maintenant)) {
    return null;
  }

  return `Ce plan valait jusqu'au ${expiresAt.toISOString().slice(0, 10)} : ce qu'il décrit a été constaté il y a trop longtemps pour qu'on agisse dessus sans regarder à nouveau. Rien n'a été ni lu ni écrit. Un plan confirmé ne se recalcule plus : pointez à la main ce qui a été fait, clôturez ce dossier, et rouvrez-en un pour repartir d'un plan à jour.`;
}

/**
 * L'écart entre ce qui a été approuvé et ce qu'on s'apprête à faire, et le refus en
 * bloc qu'il entraîne.
 *
 * `confirmedDigest` est écrit à la confirmation et relu ici, une seule fois pour les
 * deux sens : c'est la seule question à laquelle une empreinte répond, et la poser à
 * l'exécution plutôt qu'à la seule confirmation est ce qui empêche une collecte passée
 * entre-temps de faire exécuter autre chose que la liste relue.
 *
 * En bloc et non étape par étape : un plan dont une ligne a changé n'est plus le plan
 * qui a été approuvé, et en exécuter les lignes inchangées reviendrait à laisser
 * quelqu'un approuver une liste dont on retirerait ensuite les éléments gênants.
 */
export function refusDEcart(
  confirmedDigest: string | null,
  empreinteActuelle: string,
): string | null {
  if (confirmedDigest === null) {
    return "Ce plan ne porte aucune empreinte confirmée : rien ne dit ce qui a été approuvé, et il n'y a donc rien à comparer. Recalculez-le, puis confirmez-le.";
  }
  if (confirmedDigest === empreinteActuelle) {
    return null;
  }

  return "Ce plan ne décrit plus ce qui a été approuvé : les accès observés ont changé depuis la confirmation. Rien n'a été exécuté, et rien ne le sera avant qu'un plan à jour ait été relu et confirmé.";
}

// ---------------------------------------------------------------------------
// L'ordre d'exécution
// ---------------------------------------------------------------------------

const RANG_DE_RISQUE: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export interface EtapeOrdonnable {
  /** Rang de lecture, figé dans l'étape. Il départage, il ne décide pas. */
  ordre: number;
  reversibleForDays?: number | undefined;
  riskLevel: RiskLevel;
}

/**
 * L'ordre d'exécution, qui est celui de la réversibilité décroissante : ce qui se
 * défait le plus facilement passe en premier.
 *
 * La raison est qu'une exécution s'interrompt. Une panne, un jeton révoqué, un rappel
 * de dernière minute, et le plan s'arrête au milieu : ce qui a déjà été fait à ce
 * moment-là doit être ce qu'on sait le mieux défaire. Commencer par l'irréversible
 * ferait payer chaque interruption au prix fort.
 *
 * Une étape sans fenêtre de réversibilité déclarée est tenue pour irréversible, et non
 * pour inconnue : c'est le défaut prudent, et le connecteur qui sait faire mieux le
 * dit dans sa capacité. Le risque départage à réversibilité égale, le rang de lecture
 * ensuite, pour que deux exécutions du même plan se déroulent dans le même ordre.
 *
 * Cet ordre ne réécrit rien : le rang de lecture figé dans l'étape reste ce qu'il est,
 * et l'écran continue de présenter le plan tel qu'il a été approuvé.
 */
export function ordreDExecution<T extends EtapeOrdonnable>(etapes: readonly T[]): readonly T[] {
  return [...etapes].sort(
    (a, b) =>
      (b.reversibleForDays ?? 0) - (a.reversibleForDays ?? 0) ||
      RANG_DE_RISQUE[a.riskLevel] - RANG_DE_RISQUE[b.riskLevel] ||
      a.ordre - b.ordre,
  );
}

// ---------------------------------------------------------------------------
// La décision, étape par étape
// ---------------------------------------------------------------------------

export interface DecisionDEtape {
  /** `executer` est le seul geste qui touche un système tiers. */
  geste: "executer" | "aucun";
  /**
   * L'état à poser, ou `null` quand aucun état ne doit bouger.
   *
   * `null` n'est pas l'absence de décision, c'en est une : en simulation, une étape
   * prête à être exécutée ne change pas d'état. Poser `SUCCEEDED` ferait mentir le
   * dossier sur un geste qui n'a pas eu lieu, poser `SKIPPED` ferait croire qu'un
   * humain l'a écartée en connaissance de cause. Le seul état honnête est l'absence
   * de changement, plus la trace au journal.
   */
  etat: EtatEtape | null;
  /** Ce que le journal dit de ce choix, rédigé pour être relu dans deux ans. */
  motif: string;
  resultat: ResultatJournalise;
}

const DEJA_OUVERT =
  "Le précheck constate l'accès déjà ouvert : quelqu'un ou quelque chose est passé avant, l'étape est soldée sans qu'aucun appel ait été fait.";

const DEJA_FERME =
  "Le précheck constate l'accès déjà fermé : quelqu'un ou quelque chose est passé avant, l'étape est soldée sans qu'aucun appel ait été fait.";

const SIMULATION =
  "Simulation : ACTIONS_ENABLED n'autorise aucune écriture. L'étape est prête et reste en attente, son état ne bouge pas.";

const SANS_VOIE =
  "Aucune voie automatique sur cette étape : elle attend la main d'un opérateur, et son état ne bouge pas.";

const PRETE = "Étape prête, et l'exécution est autorisée : l'appel part maintenant.";

/**
 * Ce qu'il advient d'une étape, décidé sans rien lire ni rien écrire.
 *
 * Trois règles vivent ici et nulle part ailleurs.
 *
 * Le précheck tourne même en simulation, parce que c'est une lecture, et son verdict
 * vaut donc dans les deux régimes : un accès déjà ouvert solde l'étape en simulation
 * comme hors simulation. Éviter d'envoyer un humain faire quelque chose de déjà fait
 * est le meilleur usage de ce précheck, et il serait perdu si la simulation le taisait.
 *
 * Un écart entre l'état attendu et l'état constaté n'exécute jamais rien. Un octroi
 * n'est pas idempotent : accorder à nouveau un accès à quelqu'un qui l'a déjà, avec un
 * autre rôle, est une escalade de privilège que le système cible accepte sans un mot.
 * `STALE` est ce qui l'empêche, et l'étape attend qu'un humain regarde.
 *
 * En simulation, une étape prête ne change pas d'état, et `dryRun` n'est jamais lu
 * ici : il arrive par paramètre, depuis l'environnement, et rien dans ce module ne
 * saurait le forcer.
 */
export function decider(
  precheck: PrecheckResult | null,
  dryRun: boolean,
  /** Vrai quand la boucle appellerait vraiment le connecteur : tier exécutable, et `execute` présent. */
  executable: boolean,
): DecisionDEtape {
  if (precheck?.state === "ALREADY_PRESENT") {
    return { geste: "aucun", etat: "ALREADY_PRESENT", motif: DEJA_OUVERT, resultat: "SUCCESS" };
  }
  if (precheck?.state === "ALREADY_ABSENT") {
    return { geste: "aucun", etat: "ALREADY_ABSENT", motif: DEJA_FERME, resultat: "SUCCESS" };
  }
  if (precheck?.state === "STALE") {
    return {
      geste: "aucun",
      etat: "STALE",
      motif: `L'état constaté diffère de l'état attendu : attendu ${JSON.stringify(precheck.expected)}, constaté ${JSON.stringify(precheck.actual)}. Rien n'est exécuté, un octroi n'étant pas idempotent : le refaire sur un accès existant changerait le rôle en place au lieu de ne rien faire.`,
      resultat: "SKIPPED",
    };
  }

  if (!executable) {
    return { geste: "aucun", etat: null, motif: SANS_VOIE, resultat: "SKIPPED" };
  }
  if (dryRun) {
    return { geste: "aucun", etat: null, motif: SIMULATION, resultat: "SKIPPED" };
  }

  return { geste: "executer", etat: null, motif: PRETE, resultat: "SUCCESS" };
}

export interface IssueDEtape {
  etat: EtatEtape;
  motif: string;
  resultat: ResultatJournalise;
  reversibleUntil?: Date;
  erreur?: string;
}

/** Ce qu'un retour de connecteur devient dans le dossier, sans que la boucle ait à le relire. */
export function issueDeLEtape(issue: StepOutcome): IssueDEtape {
  switch (issue.state) {
    case "SUCCEEDED":
      return {
        etat: "SUCCEEDED",
        motif: issue.evidence ?? "Le connecteur rend l'étape exécutée.",
        resultat: "SUCCESS",
        ...(issue.reversibleUntil ? { reversibleUntil: issue.reversibleUntil } : {}),
      };
    case "ALREADY_PRESENT":
      return { etat: "ALREADY_PRESENT", motif: DEJA_OUVERT, resultat: "SUCCESS" };
    case "ALREADY_ABSENT":
      return { etat: "ALREADY_ABSENT", motif: DEJA_FERME, resultat: "SUCCESS" };
    default:
      return {
        etat: "FAILED",
        motif: issue.retryable
          ? `L'appel a échoué et la cause peut disparaître d'elle-même : ${issue.error}`
          : `L'appel a échoué, et le reprendre tel quel échouera de la même façon : ${issue.error}`,
        resultat: "FAILURE",
        erreur: issue.error,
      };
  }
}

/**
 * Ce qu'une exception laisse dans le dossier. Un connecteur qui lève au lieu de rendre
 * `FAILED` n'a rien dit de la reprise : l'étape échoue, et la cause est recopiée telle
 * quelle plutôt que reformulée en verdict qu'on n'a pas.
 */
export function issueDUneException(cause: unknown): IssueDEtape {
  const erreur = cause instanceof Error ? cause.message : String(cause);

  return {
    etat: "FAILED",
    motif: `L'appel a levé une exception : ${erreur}`,
    resultat: "FAILURE",
    erreur,
  };
}
