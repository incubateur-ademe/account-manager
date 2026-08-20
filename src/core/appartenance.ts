import type { Attachment, ScopeDecision } from "@/generated/prisma/enums";

/**
 * Le type vient du schéma et n'est plus recopié à la main : trois unions
 * littérales le redisaient ailleurs, si bien qu'une valeur ajoutée à l'enum les
 * laissait mentir en silence, sans casser aucun typecheck.
 *
 * `import type` pour que rien du client généré ne soit chargé à l'exécution des
 * tests, qui tournent sans base.
 */
export type { Attachment, ScopeDecision } from "@/generated/prisma/enums";

/** Décision d'appartenance prise par un opérateur, contre ou faute de faits. */
export interface Surcharge {
  sens: ScopeDecision;
  par: string;
  depuis: Date;
  raison: string;
}

export interface EtatAppartenance {
  /** Voie constatée par l'espace-membre, « aucune » comprise. */
  attachment: Attachment;
  startupsCollectees: readonly string[];
  /** Startups portées par un rattachement manuel en cours. */
  startupsManuelles: readonly string[];
  surcharge: Surcharge | null;
}

export type MotifAppartenance =
  | "INCLUSION_FORCEE"
  | "EXCLUSION_FORCEE"
  | "EQUIPE_ET_STARTUP"
  | "EQUIPE"
  | "STARTUP"
  | "STARTUP_MANUELLE"
  | "AUCUN";

export interface Appartenance {
  dans: boolean;
  motif: MotifAppartenance;
  startups: readonly string[];
  /** Un rattachement par startup annoncé, sans qu'aucune startup ne soit connue. */
  sansStartupConnue: boolean;
  toutesStartupsTerminees: boolean;
  surcharge: Surcharge | null;
  /** Ce qu'auraient donné les seuls faits, pour que la surcharge n'efface rien. */
  sansSurcharge: MotifAppartenance;
}

/**
 * Prédicat unique de phase terminale, garde-fou de phase inconnue compris.
 *
 * Il vit ici et le calcul des constats l'importe : décidé deux fois, l'écran et le
 * constat finiraient par diverger, et la fiche affirmerait le contraire de la file.
 * Une phase qu'on ne connaît pas interdit de conclure, on ne signale que sur du
 * constaté.
 */
export function toutesLesStartupsSontTerminees(
  startups: readonly string[],
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
): boolean {
  if (startups.length === 0) {
    return false;
  }

  const terminales = new Set(phasesTerminales);
  return startups.every((ghid) => {
    const phase = phaseParStartup.get(ghid) ?? null;
    return phase !== null && terminales.has(phase);
  });
}

function motifDesFaits(etat: EtatAppartenance): MotifAppartenance {
  const equipe = etat.attachment === "DECLARED" || etat.attachment === "BOTH";
  // Une voie annoncée compte même quand aucune startup ne l'accompagne : conclure à
  // une sortie sur une liste vide reviendrait à en sortir quelqu'un sur la foi
  // d'une collecte peut-être tronquée.
  const collectee =
    etat.attachment === "STARTUPS" ||
    etat.attachment === "BOTH" ||
    etat.startupsCollectees.length > 0;
  const manuelle = etat.startupsManuelles.length > 0;

  // Collectés et manuels sont au même rang, sans préséance entre eux. Les traiter
  // en dernier recours ferait dire « aucune startup ne porte son rattachement » à
  // quelqu'un dont la fiche affiche une startup juste en dessous.
  if (equipe && (collectee || manuelle)) {
    return "EQUIPE_ET_STARTUP";
  }
  if (equipe) {
    return "EQUIPE";
  }
  if (collectee) {
    return "STARTUP";
  }
  if (manuelle) {
    return "STARTUP_MANUELLE";
  }
  return "AUCUN";
}

/**
 * À quel titre une personne appartient à l'incubateur, calculé et jamais stocké.
 *
 * Ordre de lecture : une sortie forcée par un opérateur, puis une entrée forcée,
 * puis les rattachements en cours sans préséance entre collectés et manuels, puis
 * rien. La liste transverse de la politique n'y figure pas, et c'est volontaire :
 * la collecte la matérialise déjà en `attachment = DECLARED`, elle est donc lue
 * sous sa forme constatée et il n'y a pas deux chemins à maintenir.
 */
export function appartenanceDe(
  etat: EtatAppartenance,
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
): Appartenance {
  const startups = [...new Set([...etat.startupsCollectees, ...etat.startupsManuelles])].sort();
  const sansSurcharge = motifDesFaits(etat);

  const commun = {
    startups,
    sansStartupConnue:
      (etat.attachment === "STARTUPS" || etat.attachment === "BOTH") && startups.length === 0,
    toutesStartupsTerminees: toutesLesStartupsSontTerminees(
      startups,
      phaseParStartup,
      phasesTerminales,
    ),
    surcharge: etat.surcharge,
    sansSurcharge,
  };

  // Une surcharge l'emporte sur la collecte et n'efface jamais ce qu'elle dit :
  // masquer la réalité serait un bandeau sur les yeux que plus personne ne
  // penserait à retirer.
  if (etat.surcharge !== null) {
    return etat.surcharge.sens === "EXCLUDE"
      ? { ...commun, dans: false, motif: "EXCLUSION_FORCEE" }
      : { ...commun, dans: true, motif: "INCLUSION_FORCEE" };
  }

  return { ...commun, dans: sansSurcharge !== "AUCUN", motif: sansSurcharge };
}

/**
 * Vrai quand les faits disent désormais la même chose que la surcharge.
 *
 * L'écran propose alors de la retirer, sans jamais la retirer tout seul : une
 * décision nominative ne s'annule pas par une collecte anonyme.
 */
export function surchargeSuperflue(appartenance: Appartenance): boolean {
  if (appartenance.surcharge === null) {
    return false;
  }
  return appartenance.dans === (appartenance.sansSurcharge !== "AUCUN");
}

/**
 * Table exhaustive, et non `Record<string, ...>` comme les deux tables qu'elle
 * remplace : sous `@tsconfig/strictest`, une clé d'union littérale n'est pas une
 * signature d'index. L'accès rend donc la valeur sans `undefined`, les replis sur
 * la valeur brute de l'enum disparaissent, et ajouter un motif casse le typecheck
 * au lieu de passer au travers.
 *
 * `libelleCourt` sert la colonne d'une liste, où une phrase ne tient pas.
 *
 * Une précision dit à quel titre la personne appartient à l'incubateur, et rien de
 * plus. Ni d'où vient son échéance, que `motifDesFaits` ne regarde jamais, ni ce
 * qu'une autre source constate, que le motif seul n'établit pas. Une phrase qui en
 * dirait davantage contredirait tôt ou tard la ligne affichée juste en dessous.
 */
export const LIBELLE_APPARTENANCE: Record<
  MotifAppartenance,
  { libelle: string; libelleCourt: string; precision: string }
> = {
  INCLUSION_FORCEE: {
    libelle: "Dans l'incubateur, forcé",
    libelleCourt: "Forcé dans",
    precision:
      "Un opérateur a décidé qu'elle en fait partie : sa décision prime sur ce que les rattachements disent.",
  },
  EXCLUSION_FORCEE: {
    libelle: "Hors incubateur, forcé",
    libelleCourt: "Forcé hors",
    precision:
      "Un opérateur l'a déclarée hors incubateur. Ses comptes continuent d'être examinés : c'est un titre d'appartenance, jamais un ordre de coupure.",
  },
  EQUIPE_ET_STARTUP: {
    libelle: "Équipe et startup",
    libelleCourt: "Transverse et startup",
    precision: "Elle relève à la fois d'une équipe de l'incubateur et d'au moins une startup.",
  },
  EQUIPE: {
    libelle: "Équipe transverse",
    libelleCourt: "Transverse",
    precision:
      "Elle relève d'une équipe de l'incubateur : aucune startup ne porte son rattachement.",
  },
  STARTUP: {
    libelle: "Par startup",
    libelleCourt: "Startup",
    precision: "Elle relève d'au moins une startup de l'incubateur, et d'aucune équipe transverse.",
  },
  STARTUP_MANUELLE: {
    libelle: "Par rattachement manuel",
    libelleCourt: "Rattachement manuel",
    precision:
      "Aucune source amont ne la rattache à l'incubateur : elle y est par une décision datée, prise ici, et bornée par elle.",
  },
  AUCUN: {
    libelle: "Hors incubateur",
    libelleCourt: "Hors incubateur",
    precision: "Aucun rattachement en cours, ni collecté ni manuel, ne la place dans l'incubateur.",
  },
};

/**
 * Le libellé part de la table et y replie les nuances qui, seules, l'empêchent de
 * contredire les données affichées juste en dessous.
 */
export function libelleAppartenance(appartenance: Appartenance): {
  libelle: string;
  precision: string;
} {
  const base = LIBELLE_APPARTENANCE[appartenance.motif];
  const precisions = [base.precision];

  if (appartenance.sansStartupConnue) {
    precisions.push(
      "Aucune startup connue ne porte pourtant ce rattachement : la dernière collecte n'en a trouvé aucune.",
    );
  }

  // Seulement quand la décision et les faits se contredisent vraiment. Une
  // surcharge que la collecte a rattrapée porte encore un motif différent tout en
  // disant la même chose : l'annoncer comme un écart ferait chercher une
  // contradiction qui n'existe plus.
  if (appartenance.surcharge !== null && !surchargeSuperflue(appartenance)) {
    precisions.push(
      `Sans cette décision, elle serait « ${LIBELLE_APPARTENANCE[appartenance.sansSurcharge].libelle} » d'après ses rattachements en cours.`,
    );
  }

  return {
    libelle: appartenance.toutesStartupsTerminees
      ? `${base.libelle}, toutes terminées`
      : base.libelle,
    precision: precisions.join(" "),
  };
}
