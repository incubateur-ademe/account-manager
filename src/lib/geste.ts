import { ETATS_QUI_SOLDENT, ETATS_VIVANTS } from "@/core/dossier";
import {
  dernierGesteSolde,
  type EngagementOuvert,
  type IntentionDUnGeste,
  profilDUnGeste,
  SENS_D_UN_GESTE,
} from "@/core/geste";
import { assembler, empreinteDuPlan } from "@/core/plan";
import type { Prisma } from "@/generated/prisma/client";
import { octroisDUnProfil } from "@/lib/arrivee";
import { prisma } from "@/lib/db";
import type { PlanCalcule } from "@/lib/dossier";

/**
 * Le calcul d'un geste hors dossier, qui n'est pas celui d'une arrivée.
 *
 * Il réutilise `octroisDUnProfil` avec un profil d'une seule ligne plutôt que de fabriquer
 * un second chemin d'octroi : la validation du scope contre le schéma du connecteur, le
 * refus d'un rôle à risque élevé sans terme et la pose de l'échéance vivent déjà dans
 * `assemblerOctrois`, et les contourner donnerait deux endroits où un accès élevé peut
 * s'ouvrir sans échéance.
 *
 * Il n'appelle pas `calculerPlan`, et c'est l'autre moitié du choix : celui-ci interroge
 * tous les connecteurs qui savent donner pour y ajouter ce qu'une arrivée exige quel que
 * soit le profil, puis les étapes déclarées des modèles. Un geste ouvre un accès et un
 * seul, et lui faire traverser ce chemin lui collerait la signature de la charte et les
 * étapes de startup, là où `modeleDuPlan("MANUAL_OP")` ne rend déjà rien.
 *
 * `sens` reste `"ONBOARDING"` parce que c'est le sens du calcul, un geste étant un octroi.
 * Ce qui s'écrit en base sous `kind` est `MANUAL_OP`, et il vient de l'ancrage : le sens
 * dit ce qu'on fait, l'ancrage dit d'où on le fait.
 */
export async function calculerGeste(
  intention: IntentionDUnGeste,
  personId: string,
  username: string,
  maintenant: Date,
): Promise<PlanCalcule> {
  const { etapes, refus } = await octroisDUnProfil(
    profilDUnGeste(intention),
    personId,
    username,
    maintenant,
  );

  const assemblage = assembler({ origines: [{ origine: "connecteur", etapes }] });

  return {
    sens: SENS_D_UN_GESTE,
    etapes: assemblage.etapes,
    ecartees: assemblage.ecartees,
    empreinte: empreinteDuPlan(assemblage.etapes.map(({ etape }) => etape)),
    systemes: [intention.systeme],
    sansConnecteur: [],
    nonConfirmes: [],
    refus,
  };
}

/**
 * Le message d'un geste refusé parce qu'un départ court sur la personne.
 *
 * Il ne porte pas d'adresse, et c'est délibéré : la fiche affiche déjà en tête de son bloc
 * le motif `depart-en-cours` avec son lien, et écrire une adresse en clair mettrait deux
 * chemins vers le même dossier à trois centimètres l'un de l'autre, dont un qui ne se
 * clique pas.
 */
export const REFUS_DEPART_OUVERT =
  "Un départ est ouvert sur cette personne. Ouvrir un accès maintenant déplacerait l'empreinte de son plan, et un plan de départ déjà confirmé n'a plus de recalcul pour rattraper cet écart. Soldez ce départ, ou annulez-le, puis reprenez ce geste.";

/**
 * Le message d'une intention gelée qu'on ne sait plus relire.
 *
 * `intentionDUnGeste` est un `strictObject`, et l'ouverture d'un geste l'y valide déjà :
 * une intention illisible ne peut donc venir que d'une écriture faite hors de cet outil,
 * ou d'un champ ajouté au schéma après coup, qui rend d'un coup illisible chaque ligne
 * déjà écrite. Lever laisserait l'écran sans issue, comme pour l'origine gelée d'une
 * étape : le geste se refuse, et le dit.
 */
export const REFUS_INTENTION_ILLISIBLE =
  "L'intention gelée de ce geste est illisible. Reprenez le geste depuis l'écran du système.";

export async function departOuvertSur(personId: string): Promise<boolean> {
  const ouvert = await prisma.accessCase.findFirst({
    where: { personId, kind: "OFFBOARDING", state: { in: [...ETATS_VIVANTS] } },
    select: { id: true },
  });

  return ouvert !== null;
}

/**
 * Ce qu'une écriture sur un plan exige de son ancrage, du côté où le plan ne le porte pas
 * lui-même.
 *
 * Elle est exactement aussi forte pour un geste que pour un plan de dossier, et pour la
 * même raison : la garde lue plus haut laisse passer ce qui arrive entre la lecture et
 * l'écriture. Ici, ce qui peut arriver est l'ouverture d'un départ, et `Person.accessCases`
 * permet de l'exprimer dans le même `where`, donc dans la même écriture atomique. Sans
 * elle, deux onglets suffiraient à confirmer un geste pendant qu'un départ s'ouvre.
 */
export function conditionDAncrage(accessCaseId: string | null): Prisma.PlanWhereInput {
  return accessCaseId === null
    ? {
        accessCaseId: null,
        subject: {
          accessCases: {
            none: { kind: "OFFBOARDING", state: { in: [...ETATS_VIVANTS] } },
          },
        },
      }
    : { accessCase: { state: { in: [...ETATS_VIVANTS] } } };
}

/**
 * Les engagements encore ouverts sur une personne, et ce qui les a ouverts.
 *
 * L'`OR` sur deux ancrages n'est pas une redondance : un engagement naît d'un geste hors
 * dossier, dont le plan porte `subjectId`, ou d'une arrivée dont le profil ouvrait un
 * jeton, dont le plan porte `accessCaseId`. `subjectId` n'existe que là où il est
 * nécessaire, et le prix de ce choix est cet `OR`.
 *
 * Le filtre reproduit `estSoldee` plutôt que de l'appeler, parce qu'il doit se dire en SQL.
 * Il dérive sa liste d'états de celle du cœur au lieu de la réécrire. Une étape pointée mais
 * dont la validation est `AWAITING` n'a rien ouvert ni rien fermé, et la compter ferait dire
 * au départ qu'un jeton est vivant avant que quiconque ait relu qu'il l'est.
 *
 * L'instant ne borne pas que les termes, il borne l'ensemble : ce qui ressort est l'état des
 * engagements **à cet instant-là**. Un départ confirmé rejoue les siens comme il rejoue ses
 * tolérances, et sans cette borne un geste soldé après sa confirmation entrerait dans son
 * recalcul, déplacerait son empreinte et le rendrait inexécutable sans issue, le recalcul
 * n'étant ouvert qu'à un brouillon.
 */
export async function engagementsOuverts(
  personId: string,
  instant: Date,
): Promise<readonly EngagementOuvert[]> {
  const lignes = await prisma.planStep.findMany({
    where: {
      engagementKey: { not: null },
      state: { in: [...ETATS_QUI_SOLDENT] },
      validation: { notIn: ["AWAITING", "REFUSED"] },
      executedAt: { not: null, lte: instant },
      plan: {
        OR: [{ subjectId: personId }, { accessCase: { personId } }],
      },
    },
    select: {
      engagementKey: true,
      capability: true,
      systemKey: true,
      label: true,
      params: true,
      grantExpiresAt: true,
      executedAt: true,
    },
    // Décroissant sur la date, et `nulls: "last"` écrit plutôt que laissé au défaut :
    // PostgreSQL range les nuls en dernier sur un ordre croissant, mais en premier sur un
    // décroissant. Une étape jamais exécutée se retrouverait en tête du tri qui décide.
    orderBy: [{ executedAt: { sort: "desc", nulls: "last" } }, { capability: "asc" }],
  });

  return dernierGesteSolde(lignes, instant);
}
