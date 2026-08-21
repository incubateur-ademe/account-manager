import { randomUUID } from "node:crypto";

import { CONNECTEURS } from "@/connectors";
import type { PlannedStep, RunContext } from "@/core/connector";
import { ETATS_VIVANTS, type SystemesDuDepart, systemesDuDepart } from "@/core/depart";
import { empreinteDuPlan } from "@/core/plan";
import type { Prisma } from "@/generated/prisma/client";
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
 * Les systèmes sur lesquels la personne a été observée, répartis selon ce qu'on a le
 * droit d'y faire. Planifier ailleurs reviendrait à demander de retirer quelqu'un
 * d'un endroit où il n'est pas : chaque ligne d'un plan doit appeler un geste, sinon
 * c'est une liste qu'on cesse de lire.
 *
 * Une identité disparue ne compte pas : elle dit qu'on ne l'observe plus, donc qu'il
 * n'y a plus rien à couper.
 */
async function systemesDeLaPersonne(personId: string): Promise<SystemesDuDepart> {
  const identites = await prisma.externalIdentity.findMany({
    where: { personId, vanishedAt: null },
    select: { provider: true, matchMethod: true },
  });

  return systemesDuDepart(
    identites.map((identite) => ({
      provider: identite.provider,
      methode: identite.matchMethod,
    })),
  );
}

export interface PlanCalcule {
  etapes: readonly PlannedStep[];
  empreinte: string;
  /** Systèmes couverts par un connecteur, sur lesquels la personne a un compte. */
  systemes: readonly string[];
  /** Systèmes où elle a un compte, mais qu'aucun connecteur ne sait traiter. */
  sansConnecteur: readonly string[];
  /**
   * Systèmes couverts par un connecteur où elle a un compte qu'aucune étape ne peut
   * viser, faute d'un rattachement sûr. Sans cette liste, le plan se tairait sur eux
   * et son silence passerait pour une absence de compte.
   */
  nonConfirmes: readonly string[];
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
  const constates = await systemesDeLaPersonne(personId);
  const presente = new Set(constates.revocables);

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
    // Sur tous les systèmes observés et non sur les seuls révocables : un compte que
    // rien ici ne sait traiter est à traiter dehors, que son rattachement soit sûr
    // ou non.
    sansConnecteur: constates.observes.filter((provider) => !couverts.has(provider)),
    nonConfirmes: constates.nonConfirmes.filter((provider) => couverts.has(provider)),
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
    where: { personId, state: { in: [...ETATS_VIVANTS] } },
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
  /**
   * Le client d'une transaction en cours, quand l'appelant en ouvre une. Le recalcul
   * remplace un plan puis en enregistre un neuf : séparées, une panne entre les deux
   * laisse le plan remplacé comme plan le plus récent, et le dossier sans autre issue
   * que l'annulation.
   */
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  const expiresAt = new Date(maintenant.getTime() + VALIDITE_JOURS * 24 * 60 * 60_000);

  // L'identifiant est tiré ici pour entrer dans les clés d'idempotence, uniques en
  // base. Les suffixer par le dossier donnerait les mêmes clés à deux plans successifs
  // du même dossier, ce qui interdirait d'en recalculer un après péremption.
  const planId = randomUUID();

  const plan = await client.plan.create({
    data: {
      id: planId,
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
          idempotencyKey: `${etape.idempotencyKey}:${planId}`,
          ...(etape.manual ? { manual: etape.manual as object } : {}),
        })),
      },
    },
    select: { id: true },
  });

  return plan.id;
}
