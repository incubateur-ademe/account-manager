import { randomUUID } from "node:crypto";

import { connecteur } from "@/connectors";
import type { PlannedStep, PrecheckResult, RiskLevel, RunContext } from "@/core/connector";
import { dossierVivant, type EtatEtape, etatApresPointage } from "@/core/dossier";
import {
  decider,
  type IssueDEtape,
  issueDeLEtape,
  issueDUneException,
  ordreDExecution,
  peutExecuter,
  refusDEcart,
  refusDePeremption,
} from "@/core/execution";
import { estExecutable, type Masse, masseDuPlan, refusDeMasse } from "@/core/plan";
import type { Prisma } from "@/generated/prisma/client";
import { profilDeLaPolitique } from "@/lib/arrivee";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { calculerPlan } from "@/lib/dossier";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";

const RISQUE_LU: Record<string, RiskLevel> = { LOW: "low", MEDIUM: "medium", HIGH: "high" };

/**
 * Les états d'une étape que l'exécution reprend.
 *
 * `FAILED` autant que `PENDING` : une reprise sert précisément à retenter ce qui a
 * échoué. `STALE` aussi, et c'est ce qui l'empêche de sortir définitivement de la portée
 * de la boucle : une simulation le pose sur le seul verdict d'un précheck, sans que rien
 * n'ait été ni tenté ni écrit, et l'étape ne serait ensuite plus jamais relue. La reprise
 * ne coûte qu'une lecture, `decider` refusant de toute façon toute exécution sur un
 * précheck `STALE` dans les deux régimes. Ce qui est soldé, lui, n'est pas retouché.
 */
const ETATS_REPRIS: readonly EtatEtape[] = ["PENDING", "FAILED", "STALE"];

export interface ResultatDExecution {
  /** Ce qui a empêché de partir. Non nul, rien n'a été ni lu ni écrit sur un système. */
  refus?: string;
  masse?: Masse;
  /** Vrai quand ACTIONS_ENABLED n'autorise aucune écriture, ce qui est le défaut. */
  simulation: boolean;
  /** Étapes pour lesquelles un connecteur a réellement été appelé. */
  executees: number;
  /** Étapes que ce passage a soldées, précheck compris. */
  soldees: number;
  echecs: number;
}

interface EtapeAExecuter {
  id: string;
  label: string;
  /** L'étape recalculée, celle que le connecteur reçoit. */
  etape: PlannedStep;
  ordre: number;
  riskLevel: RiskLevel;
  reversibleForDays?: number | undefined;
}

async function planEnBase(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      state: true,
      confirmedDigest: true,
      expiresAt: true,
      accessCaseId: true,
      accessCase: {
        select: {
          kind: true,
          state: true,
          profileKey: true,
          person: { select: { id: true, username: true } },
        },
      },
      steps: {
        select: {
          id: true,
          label: true,
          state: true,
          ordre: true,
          riskLevel: true,
          idempotencyKey: true,
          grantExpiresAt: true,
        },
      },
    },
  });
}

/**
 * Le plan recalculé, rapproché du plan figé.
 *
 * Le rapprochement se fait sur la clé d'idempotence, la seule chose qui dise « ce
 * geste-là, sur ce système-là, pour cette personne-là ». L'enregistrement la suffixe
 * par l'identifiant du plan, ce qui la rend unique en base sans changer ce qu'elle
 * désigne.
 *
 * Ce que le connecteur reçoit est l'étape recalculée, à deux valeurs près qui viennent
 * du plan figé : sa clé, qui est celle qui vaut en base, et son échéance d'octroi, qui
 * est hors empreinte et donc libre d'avoir bougé depuis la confirmation. Prendre celle
 * du recalcul reviendrait à repousser le terme d'un accès élevé du simple fait de
 * l'exécuter plus tard, c'est-à-dire à le reconduire sans que personne ne l'ait décidé.
 */
function rapprocher(
  stockees: readonly {
    id: string;
    label: string;
    state: string;
    ordre: number;
    riskLevel: string;
    idempotencyKey: string;
    grantExpiresAt: Date | null;
  }[],
  recalculees: readonly { etape: PlannedStep }[],
  planId: string,
): readonly EtapeAExecuter[] {
  const parCle = new Map(
    recalculees.map(({ etape }) => [`${etape.idempotencyKey}:${planId}`, etape]),
  );

  return stockees.flatMap((stockee) => {
    if (!ETATS_REPRIS.includes(stockee.state as EtatEtape)) {
      return [];
    }

    const nue = parCle.get(stockee.idempotencyKey);
    if (!nue) {
      return [];
    }

    const etape: PlannedStep = {
      ...nue,
      idempotencyKey: stockee.idempotencyKey,
      ...(stockee.grantExpiresAt ? { grantExpiresAt: stockee.grantExpiresAt } : {}),
    };

    return [
      {
        id: stockee.id,
        label: stockee.label,
        etape,
        ordre: stockee.ordre,
        riskLevel: RISQUE_LU[stockee.riskLevel] ?? etape.riskLevel,
        reversibleForDays: nue.reversibleForDays,
      },
    ];
  });
}

/**
 * Exécute un plan confirmé.
 *
 * Trois gardes précèdent la moindre lecture d'un système tiers, et elles refusent en
 * bloc. Le plan doit être confirmé, sans quoi rien n'a été relu par personne. Le plan
 * recalculé doit porter l'empreinte confirmée, faute de quoi ce qu'on exécuterait n'est
 * plus ce qui a été approuvé. Et la masse du plan doit tenir sous le plafond, ou porter
 * une confirmation humaine de plus.
 *
 * Puis, étape par étape et dans l'ordre de la réversibilité décroissante : une trace au
 * journal avant le premier appel, le précheck qui tourne dans les deux régimes, une
 * exécution seulement si elle est autorisée, et une seconde trace qui dit ce qui a été
 * décidé ou ce qui a échoué. L'ordre d'exécution se calcule ici et ne réécrit rien : le
 * rang de lecture figé dans l'étape reste ce qu'il est.
 *
 * `dryRun` vient de l'environnement et n'est jamais forcé : sous `ACTIONS_ENABLED=false`,
 * qui est le défaut, tout ce chemin lit et ne pose aucun état, sauf là où le précheck a
 * soldé une étape.
 */
export async function executerPlan(
  planId: string,
  options: { operateur: string; masseConfirmee: boolean; maintenant: Date },
): Promise<ResultatDExecution> {
  const { operateur, masseConfirmee, maintenant } = options;
  const runId = randomUUID();
  const dryRun = !env.ACTIONS_ENABLED;

  const traceDuPlan = {
    actorKind: "HUMAN" as const,
    actorUsername: operateur,
    action: "plan.execution",
    targetType: "plan",
    targetId: planId,
    correlationId: runId,
  };

  const refuser = (raison: string, masse?: Masse): ResultatDExecution => {
    audit({
      ...traceDuPlan,
      after: { refus: raison, simulation: dryRun, ...(masse ? { masse } : {}) },
      result: "SKIPPED",
    });
    return {
      refus: raison,
      simulation: dryRun,
      executees: 0,
      soldees: 0,
      echecs: 0,
      ...(masse ? { masse } : {}),
    };
  };

  const plan = await planEnBase(planId);

  if (!plan?.accessCase) {
    return refuser("Ce plan n'existe plus.");
  }
  if (!dossierVivant(plan.accessCase.state)) {
    return refuser("Ce dossier n'est plus ouvert.");
  }

  const verdict = peutExecuter(plan.state);
  if (!verdict.possible) {
    return refuser(verdict.raison);
  }

  // Avant le calcul, et non après : ce refus ne coûte aucune lecture, et un plan dont
  // la date est passée n'a pas à faire interroger les systèmes pour qu'on le lui dise.
  const perime = refusDePeremption(plan.expiresAt, maintenant);
  if (perime) {
    return refuser(perime);
  }

  const sens = plan.accessCase.kind;
  const actuel = await calculerPlan(
    sens,
    plan.accessCase.person.id,
    plan.accessCase.person.username,
    maintenant,
    profilDeLaPolitique(plan.accessCase.profileKey),
  );

  const ecart = refusDEcart(plan.confirmedDigest, actuel.empreinte);
  if (ecart) {
    return refuser(ecart);
  }

  // Sur toutes les étapes du plan et non sur les seules restantes : la masse est une
  // propriété du plan, et la compter au fil des reprises laisserait un plan
  // anormalement gros passer en deux fois sans que personne ne l'ait relu en entier.
  const masse = masseDuPlan(
    actuel.etapes.map(({ etape }) => etape),
    policy().thresholds.maxPlanSteps,
  );

  const refusMasse = refusDeMasse(masse, masseConfirmee);
  if (refusMasse) {
    return refuser(refusMasse, masse);
  }

  const ctx: RunContext = { runId, now: maintenant, dryRun, audit };
  const aTraiter = ordreDExecution(rapprocher(plan.steps, actuel.etapes, plan.id));

  audit({
    ...traceDuPlan,
    after: {
      sens,
      empreinte: actuel.empreinte,
      masse,
      aTraiter: aTraiter.length,
      simulation: dryRun,
      ordre: aTraiter.map(({ label }) => label),
    },
    result: "SUCCESS",
  });

  let executees = 0;
  let soldees = 0;
  let echecs = 0;
  const etats = new Map(plan.steps.map((etape) => [etape.id, etape.state as EtatEtape]));

  for (const { id, label, etape } of aTraiter) {
    const systeme = connecteur(etape.systemKey);
    // Le tier dit ce qui a été approuvé, la présence d'`execute` dit ce que le
    // connecteur sait faire aujourd'hui : les deux sont nécessaires, et une étape
    // automatique dont le connecteur ne sait pas encore exécuter reste une étape que
    // la main d'un opérateur soldera.
    const executable = estExecutable(etape) && systeme?.execute !== undefined;

    const trace = {
      actorKind: "HUMAN" as const,
      actorUsername: operateur,
      action: "plan.etape.execution",
      targetType: "planStep",
      targetId: id,
      correlationId: runId,
    };
    const contexte = {
      etape: label,
      systeme: etape.systemKey,
      tier: etape.tier,
      attendu: etape.expectedState,
      simulation: dryRun,
    };

    // Avant le premier appel, et sans attendre : le journal précède l'action, et une
    // panne du journal ne doit jamais faire échouer l'action qu'il documente.
    audit({ ...trace, after: contexte, result: "SUCCESS" });

    let precheck: PrecheckResult | null = null;
    let echecDeLecture: IssueDEtape | null = null;

    if (systeme?.precheck) {
      try {
        precheck = await systeme.precheck(etape, ctx);
      } catch (cause) {
        echecDeLecture = issueDUneException(cause);
      }
    }

    // Un précheck qui lève n'est pas une action manquée : rien n'a été tenté, l'étape
    // garde son état, et la cause est consignée pour que la reprise sache quoi
    // regarder. Poser FAILED dirait qu'on a essayé d'écrire.
    if (echecDeLecture) {
      echecs += 1;
      await prisma.planStep.update({
        where: { id },
        data: { lastError: `Précheck : ${echecDeLecture.erreur ?? echecDeLecture.motif}` },
      });
      audit({
        ...trace,
        after: { ...contexte, motif: `Le précheck a levé : ${echecDeLecture.motif}` },
        result: "FAILURE",
      });
      continue;
    }

    const decision = decider(precheck, dryRun, executable);
    let issue: IssueDEtape | null = null;

    if (decision.geste === "executer" && systeme?.execute) {
      executees += 1;
      try {
        issue = issueDeLEtape(await systeme.execute(etape, ctx));
      } catch (cause) {
        issue = issueDUneException(cause);
      }
    }

    const etat = issue?.etat ?? decision.etat;
    const appele = issue !== null;

    if (etat !== null || appele) {
      const data: Prisma.PlanStepUpdateInput = {
        ...(etat === null ? {} : { state: etat }),
        ...(appele
          ? {
              attempts: { increment: 1 },
              executedAt: maintenant,
              lastError: issue?.erreur ?? null,
            }
          : // L'état bouge sans qu'aucun appel ait eu lieu : le motif de la décision est
            // tout ce que l'opérateur aura pour comprendre, et une étape retenue en écart
            // qui n'affiche ni l'attendu ni le constaté est une étape bloquée sans raison.
            { lastError: decision.motif }),
        ...(issue?.reversibleUntil ? { reversibleUntil: issue.reversibleUntil } : {}),
      };

      await prisma.planStep.update({ where: { id }, data });
      if (etat !== null) {
        etats.set(id, etat);
      }
    }

    if (etat === "SUCCEEDED" || etat === "ALREADY_PRESENT" || etat === "ALREADY_ABSENT") {
      soldees += 1;
    }
    if (etat === "FAILED") {
      echecs += 1;
    }

    audit({
      ...trace,
      after: { ...contexte, motif: issue?.motif ?? decision.motif, etat: etat ?? "inchangé" },
      result: issue?.resultat ?? decision.resultat,
    });
  }

  // L'état du plan se déduit de ses étapes et ne se pose jamais à la main. En
  // simulation, rien n'a bougé, donc il ne bouge pas non plus.
  const etatDuPlan = etatApresPointage([...etats.values()]);
  if (etatDuPlan !== plan.state) {
    await prisma.plan.update({ where: { id: plan.id }, data: { state: etatDuPlan } });
  }

  return { masse, simulation: dryRun, executees, soldees, echecs };
}
