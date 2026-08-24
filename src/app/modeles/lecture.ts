import { CLE_INCUBATEUR, type SaisieAttendue, saisieAttendueSchema } from "@/core/modele-plan";
import type { RiskLevel, TemplateKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { type LigneDEtape, SELECTION_ETAPE } from "@/lib/modele-plan";

/**
 * La lecture des modèles telle que les écrans d'édition la veulent, et elle diffère
 * de celle du calcul d'un plan sur un point : une saisie illisible fait écarter
 * l'étape du plan, alors qu'ici elle s'affiche pour être réparée. Un écran de
 * réparation qui masquerait ce qu'il sert à corriger ne servirait à rien.
 */

/** Les deux moments, dans l'ordre où ils se lisent. */
export const MOMENTS = [
  { moment: "ONBOARDING", titre: "Arrivée", quoi: "Ce qu'il faut faire quand quelqu'un arrive." },
  { moment: "OFFBOARDING", titre: "Départ", quoi: "Ce qu'il faut faire quand quelqu'un part." },
] as const satisfies readonly { moment: TemplateKind; titre: string; quoi: string }[];

export interface EtapeAffichee {
  id: string;
  titre: string;
  critere: string;
  marcheASuivre: string | null;
  lien: string | null;
  risque: RiskLevel;
  saisie: SaisieAttendue | null;
  /**
   * Vrai quand la valeur stockée n'est pas une saisie attendue. L'étape s'affiche
   * quand même : c'est depuis cet écran qu'elle se répare, et la faire disparaître
   * laisserait un dossier inouvrable sans rien pour le corriger.
   */
  saisieIllisible: boolean;
}

export interface ModeleAffiche {
  moment: TemplateKind;
  /** Faux tant que personne n'a rien déclaré pour ce moment. */
  existe: boolean;
  startupsPeuventCompleter: boolean;
  etapes: readonly EtapeAffichee[];
}

function etapeAffichee(etape: LigneDEtape & { id: string }): EtapeAffichee {
  const saisie = etape.input == null ? null : saisieAttendueSchema.safeParse(etape.input);

  return {
    id: etape.id,
    titre: etape.title,
    critere: etape.doneWhen,
    marcheASuivre: etape.runbook,
    lien: etape.deeplink,
    risque: etape.riskLevel,
    saisie: saisie?.success === true ? saisie.data : null,
    saisieIllisible: saisie !== null && !saisie.success,
  };
}

/**
 * Les deux modèles d'un propriétaire, celui qui n'existe pas encore compris : un
 * moment sans modèle n'est pas une page absente, c'est une page vide où se déclare la
 * première étape.
 */
export async function modelesDuProprietaire(proprietaire: string): Promise<ModeleAffiche[]> {
  const lignes = await prisma.planTemplate.findMany({
    where: { ownerKey: proprietaire },
    select: {
      kind: true,
      startupsMayExtend: true,
      steps: {
        orderBy: [{ position: "asc" }, { key: "asc" }],
        select: { id: true, ...SELECTION_ETAPE },
      },
    },
  });

  return MOMENTS.map(({ moment }) => {
    const ligne = lignes.find((candidate) => candidate.kind === moment);

    return ligne
      ? {
          moment,
          existe: true,
          startupsPeuventCompleter: ligne.startupsMayExtend,
          etapes: ligne.steps.map(etapeAffichee),
        }
      : { moment, existe: false, startupsPeuventCompleter: false, etapes: [] };
  });
}

/**
 * Le droit des startups de compléter chaque moment, tel que le modèle de
 * l'incubateur le porte. L'absence de modèle vaut absence d'autorisation, faute de
 * quoi un moment que personne n'a encore ouvert serait le plus permissif de tous.
 */
export async function autorisationsDeLIncubateur(): Promise<Record<TemplateKind, boolean>> {
  const lignes = await prisma.planTemplate.findMany({
    where: { ownerKey: CLE_INCUBATEUR },
    select: { kind: true, startupsMayExtend: true },
  });

  const ouvert = (moment: TemplateKind) =>
    lignes.find((ligne) => ligne.kind === moment)?.startupsMayExtend ?? false;

  return { ONBOARDING: ouvert("ONBOARDING"), OFFBOARDING: ouvert("OFFBOARDING") };
}

/**
 * Le nombre d'étapes de startup qu'un moment fermé neutralise.
 *
 * Ce compte n'est pas décoratif : refermer l'autorisation ne supprime rien, si bien
 * que sans lui des étapes déclarées cesseraient d'être demandées sans que personne ne
 * l'apprenne.
 */
export async function etapesNeutralisees(
  autorise: Record<TemplateKind, boolean>,
  proprietaire?: string,
): Promise<Record<TemplateKind, number>> {
  const compter = async (moment: TemplateKind) =>
    autorise[moment]
      ? 0
      : prisma.planTemplateStep.count({
          where: {
            template: {
              kind: moment,
              ...(proprietaire === undefined
                ? { ownerKey: { not: CLE_INCUBATEUR } }
                : { ownerKey: proprietaire }),
            },
          },
        });

  const [arrivee, depart] = await Promise.all([compter("ONBOARDING"), compter("OFFBOARDING")]);
  return { ONBOARDING: arrivee, OFFBOARDING: depart };
}
