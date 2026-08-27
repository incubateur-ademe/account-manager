import { randomUUID } from "node:crypto";

import { connecteur } from "@/connectors";
import type { PlannedStep, PrecheckResult, RiskLevel, RunContext } from "@/core/connector";
import { dossierVivant, type EtatEtape, type EtatValidation, estSoldee } from "@/core/dossier";
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
import { calculerPlan, reposerLEtatDuPlan } from "@/lib/dossier";
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

/**
 * L'étape telle que ce passage l'a lue, avant d'interroger le moindre connecteur.
 *
 * Les quatre colonnes sur lesquelles la garde du contrôle se conditionne, et pas une
 * de moins : l'état, l'attente et le nom du déclarant disent quelle déclaration on a
 * lue, la tentative distingue deux déclarations identiques d'un même déclarant.
 */
interface DeclarationLue {
  etat: EtatEtape;
  validation: EtatValidation;
  declaredBy: string | null;
  attempts: number;
}

interface EtapeAExecuter {
  id: string;
  label: string;
  /** L'étape recalculée, celle que le connecteur reçoit. */
  etape: PlannedStep;
  ordre: number;
  riskLevel: RiskLevel;
  reversibleForDays?: number | undefined;
  lue: DeclarationLue;
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
          validation: true,
          declaredBy: true,
          attempts: true,
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
    validation: string;
    declaredBy: string | null;
    attempts: number;
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
        lue: {
          etat: stockee.state as EtatEtape,
          validation: stockee.validation as EtatValidation,
          declaredBy: stockee.declaredBy,
          attempts: stockee.attempts,
        },
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

  for (const { id, label, etape, lue } of aTraiter) {
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

    // Une étape que quelqu'un doit contrôler n'est pas soldée du seul fait que la
    // boucle l'a faite. La machine ne porte aucun second regard, et l'opérateur qui a
    // lancé la reprise est justement celui dont on attend qu'un autre relise le geste :
    // sans cette attente, `validationBy` serait une colonne morte sur la ligne, jamais
    // à `AWAITING` donc jamais validable, et l'étape se solderait au mépris de ce que
    // le plan approuvé demandait.
    const declare = etat === "SUCCEEDED" || etat === "ALREADY_PRESENT" || etat === "ALREADY_ABSENT";
    const validation: EtatValidation = etape.validationBy && declare ? "AWAITING" : lue.validation;

    if (etat !== null || appele) {
      // Ce que le geste constate, et qui s'écrit sans condition : quand cette écriture
      // part, le connecteur a déjà agi sur le système cible, et un accès ouvert ou
      // coupé sans que rien ne l'enregistre est plus grave que n'importe quel conflit.
      const geste: Prisma.PlanStepUpdateManyMutationInput = {
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

      // Ce que le contrôle juge, et qui porte sur une déclaration précise : la
      // signature du contrôleur précédent s'efface avec l'attente qu'on repose, sans
      // quoi son avis se lirait comme s'il jugeait celle-ci. Le journal, lui, garde tout.
      const controle =
        validation === "AWAITING"
          ? {
              validation,
              declaredBy: operateur,
              validatedBy: null,
              validatedAt: null,
              validationNote: null,
            }
          : null;

      if (controle === null) {
        await prisma.planStep.update({ where: { id }, data: geste });
      } else {
        // Conditionnée sur la déclaration lue, comme le pointage et le verdict de
        // l'écran : entre cette lecture et ici, les connecteurs ont été interrogés, et
        // un contrôleur a eu tout ce temps pour trancher.
        const { count } = await prisma.planStep.updateMany({
          where: {
            id,
            state: lue.etat,
            validation: lue.validation,
            declaredBy: lue.declaredBy,
            attempts: lue.attempts,
          },
          data: { ...geste, ...controle },
        });

        // La déclaration lue n'est plus celle qui est en base. Seule une signature
        // interdit d'y reposer l'attente : y renoncer sur un simple pointage
        // solderait en silence une étape que le plan approuvé confiait à un second
        // regard, et plus rien ne pourrait l'ouvrir puisque `peutValider` exige
        // `AWAITING`. Un verdict, lui, porte toujours son signataire.
        if (count === 0) {
          const { count: reposee } = await prisma.planStep.updateMany({
            where: { id, validatedBy: null },
            data: { ...geste, ...controle },
          });

          // Le refus ne lève pas : lever abandonnerait les étapes suivantes du
          // passage, alors qu'une seule d'entre elles est en cause. Le geste s'écrit
          // seul, l'avis signé reste en place, et `reposerLEtatDuPlan` reprend l'état
          // d'ensemble depuis les étapes elles-mêmes.
          if (reposee === 0) {
            await prisma.planStep.update({ where: { id }, data: geste });
            audit({
              ...trace,
              before: lue,
              after: {
                ...contexte,
                motif:
                  "Un avis signé portait sur cette étape à l'écriture : le geste est consigné, l'avis est laissé en place, et l'étape n'est pas remise en attente.",
              },
              result: "SKIPPED",
            });
          }
        }
      }
    }

    // Soldée au sens de `estSoldee` et non du seul état : une étape exécutée sans
    // faute mais confiée au regard d'un autre n'est pas finie, et l'annoncer soldée
    // ferait dire au compte rendu l'inverse de ce que l'écran montrera.
    if (etat !== null && estSoldee({ etat, validation })) {
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

  // L'état du plan se déduit de ses étapes et ne se pose jamais à la main. Il se relit
  // après coup plutôt que depuis la photo prise au début de ce passage : entre les deux,
  // les connecteurs ont été interrogés, et un opérateur a eu tout ce temps pour pointer
  // ou valider une étape que cette boucle ne verrait pas.
  await reposerLEtatDuPlan(plan.id);

  return { masse, simulation: dryRun, executees, soldees, echecs };
}
