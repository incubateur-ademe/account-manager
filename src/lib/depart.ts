import { randomUUID } from "node:crypto";

import { CONNECTEURS } from "@/connectors";
import type { PlannedStep, RunContext } from "@/core/connector";
import { empreinteDuPlan } from "@/core/plan";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Durée de validité d'un plan. Passé ce délai, ce qui a été constaté est trop vieux
 * pour qu'on agisse dessus sans regarder à nouveau : la personne a pu récupérer un
 * accès, en perdre un autre, ou revenir.
 */
const VALIDITE_JOURS = 7;

const RISQUE = { low: "LOW", medium: "MEDIUM", high: "HIGH" } as const;

/**
 * Les systèmes sur lesquels la personne a été observée. Planifier ailleurs
 * reviendrait à demander de retirer quelqu'un d'un endroit où il n'est pas : chaque
 * ligne d'un plan doit appeler un geste, sinon c'est une liste qu'on cesse de lire.
 *
 * Une identité disparue ne compte pas : elle dit qu'on ne l'observe plus, donc qu'il
 * n'y a plus rien à couper.
 */
async function systemesOuElleExiste(personId: string): Promise<Set<string>> {
  const identites = await prisma.externalIdentity.findMany({
    where: { personId, vanishedAt: null },
    select: { provider: true },
    distinct: ["provider"],
  });
  return new Set(identites.map((identite) => identite.provider));
}

export interface PlanCalcule {
  etapes: readonly PlannedStep[];
  empreinte: string;
  /** Systèmes couverts par un connecteur, sur lesquels la personne a un compte. */
  systemes: readonly string[];
  /** Systèmes où elle a un compte, mais qu'aucun connecteur ne sait traiter. */
  sansConnecteur: readonly string[];
}

/**
 * Ce qu'il faudrait faire pour retirer ses accès à quelqu'un, tel que les
 * connecteurs le disent aujourd'hui. Ne touche à rien, ni ici ni ailleurs.
 */
export async function calculerPlanDeDepart(
  personId: string,
  username: string,
  maintenant: Date,
): Promise<PlanCalcule> {
  const presente = await systemesOuElleExiste(personId);

  const ctx: RunContext = {
    runId: randomUUID(),
    now: maintenant,
    // Calculer n'écrit nulle part, mais le contexte le dit quand même : un
    // connecteur qui sonderait le système cible pour affiner son plan doit savoir
    // qu'il n'a le droit de rien changer.
    dryRun: !env.ACTIONS_ENABLED,
    audit,
  };

  const etapes: PlannedStep[] = [];
  const systemes: string[] = [];

  for (const connecteur of CONNECTEURS) {
    const cle = connecteur.contract.key;
    if (!presente.has(cle)) {
      continue;
    }

    systemes.push(cle);
    const proposees = await connecteur.plan(
      { kind: "revoke", subject: { kind: "person", username } },
      ctx,
    );
    etapes.push(...proposees);
  }

  const couverts = new Set(CONNECTEURS.map((connecteur) => connecteur.contract.key));

  return {
    etapes,
    empreinte: empreinteDuPlan(etapes),
    systemes,
    sansConnecteur: [...presente].filter((provider) => !couverts.has(provider)).sort(),
  };
}

/**
 * Ouvre un dossier, ou rend celui qui est déjà ouvert.
 *
 * Un seul dossier vivant par personne : deux dossiers concurrents pour un même
 * départ produiraient deux plans, deux approbations, et deux façons de croire que
 * l'affaire est réglée.
 */
export async function ouvrirDossierDeDepart(
  personId: string,
  effectiveDate: Date | null,
): Promise<{ id: string; deja: boolean }> {
  const ouvert = await prisma.departureCase.findFirst({
    where: { personId, state: { in: ["WATCH", "CANDIDATE", "CONFIRMED"] } },
    select: { id: true },
  });

  if (ouvert) {
    return { id: ouvert.id, deja: true };
  }

  const cree = await prisma.departureCase.create({
    data: {
      personId,
      // CANDIDATE et non WATCH : un dossier ouvert à la main est une décision, pas
      // une veille. WATCH reste pour ce qu'une collecte lèvera un jour toute seule.
      state: "CANDIDATE",
      ...(effectiveDate ? { effectiveDate } : {}),
    },
    select: { id: true },
  });

  return { id: cree.id, deja: false };
}

/**
 * Fige un plan calculé. Chaque étape stocke la photo de ce qu'elle engage, jamais
 * une référence : ce qui a été approuvé doit rester lisible tel quel dans deux ans,
 * même si la ressource visée a changé de nom depuis.
 */
export async function enregistrerPlan(
  departureCaseId: string,
  calcule: PlanCalcule,
  createdBy: string,
  maintenant: Date,
): Promise<string> {
  const expiresAt = new Date(maintenant.getTime() + VALIDITE_JOURS * 24 * 60 * 60_000);

  const plan = await prisma.plan.create({
    data: {
      departureCaseId,
      kind: "OFFBOARDING",
      state: "DRAFT",
      planDigest: calcule.empreinte,
      createdBy,
      expiresAt,
      steps: {
        create: calcule.etapes.map((etape) => ({
          systemKey: etape.systemKey,
          tier: etape.tier,
          capability: etape.capability,
          action: etape.action,
          label: etape.label,
          params: etape.params as object,
          riskLevel: RISQUE[etape.riskLevel],
          expectedState: (etape.expectedState ?? {}) as object,
          idempotencyKey: `${etape.idempotencyKey}:${departureCaseId}`,
          ...(etape.manual ? { manual: etape.manual as object } : {}),
        })),
      },
    },
    select: { id: true },
  });

  return plan.id;
}
