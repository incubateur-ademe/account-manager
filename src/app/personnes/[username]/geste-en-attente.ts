import type { EtapeFigee } from "@/app/dossiers/[id]/EtapeOperateur";
import { intentionDUnGeste } from "@/core/geste";
import { prisma } from "@/lib/db";
import { calculerGeste } from "@/lib/geste";

/**
 * Le brouillon de geste qui attend sa confirmation, tel que la fiche de la personne
 * doit le rendre.
 *
 * Il n'y en a jamais qu'un : poser un geste périme le brouillon précédent, et reposer le
 * geste est la seule sortie d'un brouillon, qui n'a ni recalcul ni annulation.
 */
export interface GesteEnAttente {
  planId: string;
  systeme: string;
  etapes: readonly EtapeFigee[];
  /** Le terme du brouillon, au-delà duquel la confirmation refuse. */
  expiresAt: Date;
  perime: boolean;
  /**
   * Vrai quand ce que le geste vaudrait aujourd'hui ne porte plus la même empreinte.
   * La confirmation refusera, et reposer le geste est la seule issue.
   */
  ecarte: boolean;
}

const SELECTION_ETAPE = {
  id: true,
  label: true,
  systemKey: true,
  capability: true,
  idempotencyKey: true,
  tier: true,
  riskLevel: true,
  state: true,
  validation: true,
  expectedActor: true,
  validationBy: true,
  declaredBy: true,
  validatedBy: true,
  validatedAt: true,
  validationNote: true,
  manual: true,
  reponse: true,
  lastError: true,
  executedAt: true,
  grantExpiresAt: true,
} as const;

export async function gesteEnAttente(
  personId: string,
  username: string,
  maintenant: Date,
): Promise<GesteEnAttente | null> {
  const plan = await prisma.plan.findFirst({
    where: { subjectId: personId, kind: "MANUAL_OP", state: "DRAFT" },
    select: {
      id: true,
      intent: true,
      planDigest: true,
      expiresAt: true,
      steps: { orderBy: { ordre: "asc" }, select: SELECTION_ETAPE },
    },
  });

  if (plan === null) {
    return null;
  }

  const intention = intentionDUnGeste.safeParse(plan.intent);

  // L'intention est gelée, faite pour survivre au code qui l'a écrite. Illisible, elle
  // vaut écart : la confirmation refusera pour la même raison, et la seule sortie est la
  // même, reposer le geste.
  const recalcule = intention.success
    ? await calculerGeste(intention.data, personId, username, maintenant)
    : null;

  return {
    planId: plan.id,
    systeme: intention.success ? intention.data.systeme : "",
    etapes: plan.steps,
    expiresAt: plan.expiresAt,
    perime: plan.expiresAt.getTime() <= maintenant.getTime(),
    ecarte: recalcule === null || recalcule.empreinte !== plan.planDigest,
  };
}
