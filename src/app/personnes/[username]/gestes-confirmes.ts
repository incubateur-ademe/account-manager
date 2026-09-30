import type { EtapeFigee } from "@/app/dossiers/[id]/EtapeOperateur";
import { tiersDuJour, voieLisible, voiesDuJour } from "@/app/dossiers/[id]/voie";
import { ISSUE_GESTE, refusDEcart, refusDePeremption } from "@/core/execution";
import { intentionDUnGeste } from "@/core/geste";
import { type Masse, masseDuPlan } from "@/core/plan";
import { prisma } from "@/lib/db";
import {
  calculerGeste,
  departOuvertSur,
  REFUS_DEPART_OUVERT,
  REFUS_INTENTION_ILLISIBLE,
} from "@/lib/geste";
import { policy } from "@/lib/policy";

import { SELECTION_ETAPE } from "./geste-en-attente";

/** Un geste confirmé dont une étape au moins reste à solder. */
export interface GesteEnCours {
  planId: string;
  systeme: string;
  etat: "EXECUTING" | "PARTIALLY_EXECUTED";
  etapes: readonly (EtapeFigee & { voie: string | null })[];
  confirmeLe: Date | null;
  confirmePar: string | null;
  /** Le refus que l'exécution opposerait maintenant, mot pour mot, ou rien. */
  refus: string | null;
  /** Faux pendant un départ ouvert, où le pointage refuse comme l'exécution. */
  pointable: boolean;
  masse: Masse | null;
}

export interface GesteSolde {
  planId: string;
  systeme: string;
  etapes: number;
  confirmeLe: Date | null;
  confirmePar: string | null;
  termes: readonly Date[];
}

export interface GestesConfirmes {
  enCours: readonly GesteEnCours[];
  soldes: readonly GesteSolde[];
}

const ETATS_CONFIRMES = ["EXECUTING", "PARTIALLY_EXECUTED", "EXECUTED"] as const;

/**
 * Les gestes que la personne a reçus après leur confirmation, tels que sa fiche doit les
 * rendre.
 *
 * Le refus d'exécution se lit aux gardes mêmes d'`executerPlan`, dans son ordre, plutôt
 * qu'il ne se rejoue : un bouton offert sur un plan que le lancement refuse ferait
 * cliquer sur un refus.
 */
export async function gestesConfirmes(
  personId: string,
  username: string,
  maintenant: Date,
): Promise<GestesConfirmes> {
  const plans = await prisma.plan.findMany({
    where: { subjectId: personId, kind: "MANUAL_OP", state: { in: [...ETATS_CONFIRMES] } },
    orderBy: [{ confirmedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      state: true,
      intent: true,
      confirmedDigest: true,
      confirmedAt: true,
      confirmedBy: true,
      expiresAt: true,
      steps: { orderBy: { ordre: "asc" }, select: SELECTION_ETAPE },
    },
  });

  const soldes: GesteSolde[] = [];
  const enCours: GesteEnCours[] = [];
  const depart = plans.some((plan) => plan.state !== "EXECUTED")
    ? await departOuvertSur(personId)
    : false;

  for (const plan of plans) {
    const intention = intentionDUnGeste.safeParse(plan.intent);
    const systeme = intention.success ? intention.data.systeme : (plan.steps[0]?.systemKey ?? "");

    if (plan.state === "EXECUTED") {
      soldes.push({
        planId: plan.id,
        systeme,
        etapes: plan.steps.length,
        confirmeLe: plan.confirmedAt,
        confirmePar: plan.confirmedBy,
        termes: [
          ...new Set(
            plan.steps.flatMap(({ grantExpiresAt }) =>
              grantExpiresAt === null ? [] : [grantExpiresAt.getTime()],
            ),
          ),
        ].map((instant) => new Date(instant)),
      });
      continue;
    }

    const actuel = intention.success
      ? await calculerGeste(intention.data, personId, username, maintenant)
      : null;

    const refus = depart
      ? REFUS_DEPART_OUVERT
      : (refusDePeremption(plan.expiresAt, maintenant, ISSUE_GESTE) ??
        (actuel === null
          ? REFUS_INTENTION_ILLISIBLE
          : refusDEcart(plan.confirmedDigest, actuel.empreinte, ISSUE_GESTE)));

    const voies = await voiesDuJour(plan.steps);
    const tiers = tiersDuJour(plan.id, actuel);

    enCours.push({
      planId: plan.id,
      systeme,
      etat: plan.state === "PARTIALLY_EXECUTED" ? "PARTIALLY_EXECUTED" : "EXECUTING",
      etapes: plan.steps.map((etape) => ({
        ...etape,
        voie: voieLisible(
          etape.tier,
          tiers.get(etape.idempotencyKey),
          voies.get(`${etape.systemKey}:${etape.capability}`),
        ),
      })),
      confirmeLe: plan.confirmedAt,
      confirmePar: plan.confirmedBy,
      refus,
      pointable: !depart,
      masse:
        refus === null && actuel !== null
          ? masseDuPlan(
              actuel.etapes.map(({ etape }) => etape),
              policy().thresholds.maxPlanSteps,
            )
          : null,
    });
  }

  return { enCours, soldes };
}
