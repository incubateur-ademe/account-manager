import { z } from "zod";

import type { Capability, PlannedStep, RiskLevel } from "@/core/connector";
import type { EtapeEcartee, OrigineDEtapes, OrigineEtape } from "@/core/plan";
import type { PlanKind, RiskLevel as RisqueDeclare, TemplateKind } from "@/generated/prisma/enums";

/**
 * Le propriétaire du modèle de l'incubateur. Une valeur réservée plutôt qu'un `NULL` :
 * dans PostgreSQL deux `NULL` ne s'égalent pas, et l'unicité `(propriétaire, moment)`
 * laisserait alors créer deux modèles d'incubateur pour un même moment. Le caractère
 * `*` est impossible dans un ghid beta.gouv, la collision est exclue par construction.
 */
export const CLE_INCUBATEUR = "*incubateur";

/**
 * Le `systemKey` d'une étape déclarée. Il ne correspond à aucun connecteur, donc
 * aucune relecture ne viendra jamais vérifier une telle étape, et c'est correct :
 * personne ne relira une charte signée.
 */
export const SYSTEME_MODELE = "modele";

/**
 * Une étape déclarée n'appelle aucun geste technique nommé : ce qu'il y a à faire est
 * dans son titre et sa marche à suivre, ce qu'il y a à constater est dans son critère.
 */
const ACTION_MODELE = "geste-declare";

/** Ce qu'une étape déclarée sert, selon le moment. Jamais ce qu'un connecteur ferait. */
const CAPACITE: Record<TemplateKind, Capability> = {
  ONBOARDING: "grant",
  OFFBOARDING: "revoke",
};

const RISQUE: Record<RisqueDeclare, RiskLevel> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

const MOMENT: Record<PlanKind, TemplateKind | null> = {
  ONBOARDING: "ONBOARDING",
  OFFBOARDING: "OFFBOARDING",
  DRIFT_FIX: null,
  MANUAL_OP: null,
};

/**
 * Le moment dont un plan relève, ou rien.
 *
 * Un correctif de dérive et une opération manuelle ne sont ni une arrivée ni un
 * départ : leur demander « quel modèle s'applique ? » est une question sans réponse,
 * et `null` est cette réponse-là.
 */
export function modeleDuPlan(kind: PlanKind): TemplateKind | null {
  return MOMENT[kind];
}

/**
 * La clé d'une étape déclarée, dérivée de son titre.
 *
 * C'est elle qui dédoublonne entre modèles : deux startups qui demandent « Présenter
 * l'équipe » demandent le même geste, et il ne se fait qu'une fois. Le prix assumé est
 * l'inverse : deux gestes distincts nommés pareil n'en font qu'un, d'où la liste des
 * écartées, qui dit tout haut ce qui n'a pas été retenu.
 *
 * Rend une chaîne vide quand le titre ne porte rien qui puisse servir de clé, à
 * l'écriture de refuser : une clé vide est bien une clé aux yeux de l'unicité.
 */
export function cleDEtape(titre: string): string {
  return titre
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Ce qu'une étape déclarée réclame en plus d'une case cochée.
 *
 * Deux champs et pas un de plus : le libellé de ce qu'on demande, et si l'on peut
 * pointer sans. La réponse arrive dans `PlanStep.reponse`, une colonne de texte : un
 * type de saisie déclaré mais non vérifié serait un mensonge, et le vérifier n'est
 * demandé nulle part. L'objet est strict et ses champs ont un défaut, donc une étape
 * déjà gelée reste lisible le jour où une action générique viendra s'y ajouter.
 */
export const saisieAttendueSchema = z.strictObject({
  libelle: z.string().trim().min(1),
  obligatoire: z.boolean().default(true),
});

export type SaisieAttendue = z.infer<typeof saisieAttendueSchema>;

/**
 * Relit la saisie attendue telle qu'elle est stockée. L'absence de saisie est un cas
 * normal, une saisie mal formée non : elle ne peut venir que d'une écriture faite hors
 * de cet outil, et la taire ferait pointer « fait » sur une étape qui demandait une
 * valeur.
 */
export function lireSaisieAttendue(valeur: unknown): SaisieAttendue | null {
  return valeur === null || valeur === undefined ? null : saisieAttendueSchema.parse(valeur);
}

/**
 * L'origine déclarée d'une étape, telle qu'un plan la gèle et telle qu'on la relit.
 *
 * Le schéma et le type de `PlannedStep.template` ne font qu'un ici : ce qui a été
 * gelé il y a six mois se relit aujourd'hui, et deux déclarations de la même forme
 * finiraient par diverger le jour où l'une gagne un champ.
 */
export const origineFigeeSchema = z.strictObject({
  owner: z.string().min(1),
  stepKey: z.string().min(1),
  saisie: saisieAttendueSchema.optional(),
});

export type OrigineFigee = z.infer<typeof origineFigeeSchema>;

/** Une étape telle qu'un modèle la déclare, avant qu'un plan ne la gèle. */
export interface EtapeDeModele {
  cle: string;
  position: number;
  titre: string;
  marcheASuivre: string | null;
  lien: string | null;
  /** Ce qu'il faut constater pour cocher. Sans lui, « fait » ne veut rien dire. */
  critere: string;
  risque: RisqueDeclare;
  saisie: SaisieAttendue | null;
  /**
   * Vrai quand la valeur stockée en guise de saisie n'en est pas une. L'étape est
   * portée jusqu'ici plutôt que d'avoir fait lever sa lecture : une étape qu'une
   * autorisation fermée neutralise ne doit rien casser, et l'écart ne peut donc
   * naître qu'après l'autorisation, dans `etapesDepuisModeles`.
   */
  saisieIllisible: boolean;
}

export interface ModeleDePlan {
  /** Le ghid de la startup, ou `CLE_INCUBATEUR`. */
  proprietaire: string;
  /**
   * N'a de sens que sur le modèle de l'incubateur, et vaut `false` partout ailleurs :
   * l'autorisation se donne à un moment, depuis un seul endroit.
   */
  startupsPeuventCompleter: boolean;
  etapes: readonly EtapeDeModele[];
}

export interface EtapesDeModeles {
  /** À passer à `assembler` avec celle des connecteurs. */
  origines: readonly OrigineDEtapes[];
  /**
   * Ce que la déclaration a proposé sans qu'on le retienne : les étapes de startup
   * qu'une autorisation fermée neutralise, avec la raison `non-autorise`, et celles
   * dont la saisie attendue est illisible, avec la raison `saisie-illisible`. Aucune
   * n'est supprimée ni modifiée : rouvrir l'autorisation ou réécrire la saisie les
   * rend à l'identique. Leur nombre est ce que la page de l'incubateur affiche, sans
   * quoi la neutralisation serait muette.
   */
  ecartees: readonly EtapeEcartee[];
}

/**
 * Fige une étape déclarée en étape de plan.
 *
 * Une étape de modèle est une `PlannedStep` comme les autres, jamais une table
 * d'instances séparée qui dupliquerait la machine à états. Elle porte donc des champs
 * faits pour un connecteur, qu'on remplit de façon documentée : un système réservé, un
 * tier toujours manuel, un état attendu vide, et aucune exécution possible.
 *
 * Les paramètres portent tout ce qui engage l'étape, et pas seulement ce qui
 * l'identifie. Une étape de connecteur tient son sens de son système et de son action,
 * son libellé n'engageant rien ; une étape déclarée n'a ni l'un ni l'autre, et son
 * titre, son critère, son risque et la valeur qu'elle réclame sont tout ce que
 * l'opérateur exécutera. Hors de `params`, ils resteraient hors de l'empreinte, un
 * critère faux ne rendrait aucun brouillon obsolète et sa correction n'atteindrait
 * jamais personne.
 *
 * Les paramètres restent **plats**, et ce n'est pas un hasard : `empreinteDuPlan`
 * filtre les clés de `params` à tous les niveaux, si bien qu'un sous-objet dont les
 * clés ne figurent pas au premier niveau disparaîtrait de l'empreinte et rendrait deux
 * étapes différentes indiscernables. D'où `saisieLibelle` et `saisieObligatoire`
 * côte à côte, et jamais un objet `saisie`.
 */
function etapePlanifiee(
  proprietaire: string,
  etape: EtapeDeModele,
  moment: TemplateKind,
): PlannedStep {
  return {
    systemKey: SYSTEME_MODELE,
    capability: CAPACITE[moment],
    tier: "manual",
    action: ACTION_MODELE,
    label: etape.titre,
    params: {
      proprietaire,
      cle: etape.cle,
      titre: etape.titre,
      critere: etape.critere,
      marcheASuivre: etape.marcheASuivre,
      lien: etape.lien,
      risque: etape.risque,
      saisieLibelle: etape.saisie?.libelle ?? null,
      saisieObligatoire: etape.saisie?.obligatoire ?? null,
    },
    riskLevel: RISQUE[etape.risque],
    expectedState: {},
    // Sans le propriétaire : deux startups qui déclarent le même geste ne le font
    // faire qu'une fois, et la seconde figure dans les écartées. Le suffixe qui rend
    // la clé unique en base est posé à l'enregistrement, jamais ici, sans quoi le
    // retour d'une personne des mois plus tard échouerait sur une violation
    // d'unicité, dans un chemin que personne n'aurait essayé.
    idempotencyKey: `${SYSTEME_MODELE}:${etape.cle}`,
    manual: {
      title: etape.titre,
      doneWhen: etape.critere,
      ...(etape.marcheASuivre ? { runbook: etape.marcheASuivre } : {}),
      ...(etape.lien ? { deeplink: etape.lien } : {}),
    },
    template: {
      owner: proprietaire,
      stepKey: etape.cle,
      ...(etape.saisie ? { saisie: etape.saisie } : {}),
    },
  };
}

interface EtapePreparee {
  etape: PlannedStep;
  illisible: boolean;
}

function etapesPlanifiees(modele: ModeleDePlan, moment: TemplateKind): EtapePreparee[] {
  return [...modele.etapes]
    .sort((a, b) => a.position - b.position || a.cle.localeCompare(b.cle, "fr"))
    .map((etape) => ({
      etape: etapePlanifiee(modele.proprietaire, etape, moment),
      illisible: etape.saisieIllisible,
    }));
}

/**
 * Ce que les modèles déclarés demandent pour un moment donné, prêt à être assemblé
 * avec ce que les connecteurs proposent.
 *
 * L'autorisation donnée aux startups est un booléen par moment, porté par le modèle de
 * l'incubateur et fermé par défaut. Le refus se joue à deux endroits, délibérément :
 * à l'écriture, où une phrase dit quoi faire, et ici, où l'étape est écartée avec sa
 * raison. Absence de modèle d'incubateur vaut absence d'autorisation, faute de quoi un
 * moment que personne n'a encore ouvert serait le plus permissif de tous.
 *
 * Une saisie illisible écarte l'étape ici et pas plus tôt, et l'ordre compte : une
 * étape de startup que l'autorisation neutralise n'est portée par aucun dossier, elle
 * ne peut donc ni rien casser ni rien signaler, et elle sort avec la seule raison
 * `non-autorise`.
 *
 * Ne touche ni à la base ni à l'horloge : deux appels sur les mêmes modèles doivent
 * rendre exactement les mêmes étapes, sans quoi l'empreinte bougerait d'un calcul à
 * l'autre et un plan confirmé se dirait obsolète tout seul.
 */
export function etapesDepuisModeles({
  modeles,
  moment,
}: {
  modeles: readonly ModeleDePlan[];
  moment: TemplateKind;
}): EtapesDeModeles {
  const incubateur = modeles.find(({ proprietaire }) => proprietaire === CLE_INCUBATEUR);
  const autorise = incubateur?.startupsPeuventCompleter ?? false;

  const origines: OrigineDEtapes[] = [];
  const ecartees: EtapeEcartee[] = [];

  const retenir = (origine: OrigineEtape, preparees: readonly EtapePreparee[]): void => {
    origines.push({
      origine,
      etapes: preparees.filter(({ illisible }) => !illisible).map(({ etape }) => etape),
    });

    for (const { etape, illisible } of preparees) {
      if (illisible) {
        ecartees.push({ etape, origine, raison: "saisie-illisible" });
      }
    }
  };

  if (incubateur) {
    retenir("modele:incubateur", etapesPlanifiees(incubateur, moment));
  }

  const startups = modeles
    .filter(({ proprietaire }) => proprietaire !== CLE_INCUBATEUR)
    .sort((a, b) => a.proprietaire.localeCompare(b.proprietaire, "fr"));

  for (const modele of startups) {
    const origine: OrigineEtape = `modele:startup:${modele.proprietaire}`;
    const preparees = etapesPlanifiees(modele, moment);

    if (autorise) {
      retenir(origine, preparees);
      continue;
    }

    for (const { etape } of preparees) {
      ecartees.push({ etape, origine, raison: "non-autorise" });
    }
  }

  return { origines, ecartees };
}

/** Une étape déclarée, désignée par ce qui l'identifie et par ce qui la nomme. */
export interface EtapeDesignee {
  cle: string;
  titre: string;
}

export interface EcartDeModele {
  /** Déclarées aujourd'hui, absentes du plan figé. */
  manquantes: readonly EtapeDesignee[];
  /** Figées dans ce plan, que plus aucun modèle ne déclare. */
  retirees: readonly EtapeDesignee[];
}

function designees(etapes: Iterable<EtapeDesignee>): Map<string, EtapeDesignee> {
  const par = new Map<string, EtapeDesignee>();
  for (const etape of etapes) {
    par.set(etape.cle, etape);
  }
  return par;
}

function* figeesDeclarees(
  figees: readonly { label: string; template: unknown }[],
): Generator<EtapeDesignee> {
  for (const etape of figees) {
    // Une origine illisible ne peut venir que d'une écriture faite hors de cet outil.
    // L'étape passe alors pour une étape de connecteur, ce qui la fera compter comme
    // manquante : l'écart s'annonce de trop plutôt que de se taire.
    const origine = origineFigeeSchema.safeParse(etape.template);
    if (origine.success) {
      yield { cle: origine.data.stepKey, titre: etape.label };
    }
  }
}

function* assembleesDeclarees(assemblees: readonly PlannedStep[]): Generator<EtapeDesignee> {
  for (const etape of assemblees) {
    if (etape.template) {
      yield { cle: etape.template.stepKey, titre: etape.label };
    }
  }
}

/**
 * Ce que les modèles déclarent aujourd'hui et que ce plan ne porte pas, et l'inverse.
 *
 * Un plan est figé à sa création : une startup rattachée depuis, ou une étape ajoutée
 * à un modèle, ne le change pas et ne doit pas le changer. Un brouillon se répare par
 * un recalcul, mais un plan confirmé garde ses étapes, et sans cette comparaison
 * l'écart resterait invisible jusqu'au départ suivant de la personne.
 *
 * Comparé sur la clé d'étape et non sur le propriétaire : deux modèles qui demandent
 * le même geste n'en font faire qu'un, et changer de porteur ne change rien à ce
 * qu'il y a à faire.
 */
export function ecartDeModele(
  figees: readonly { label: string; template: unknown }[],
  assemblees: readonly PlannedStep[],
): EcartDeModele {
  const gelees = designees(figeesDeclarees(figees));
  const declarees = designees(assembleesDeclarees(assemblees));

  return {
    manquantes: [...declarees.values()].filter((etape) => !gelees.has(etape.cle)),
    retirees: [...gelees.values()].filter((etape) => !declarees.has(etape.cle)),
  };
}
