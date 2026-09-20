import { randomUUID } from "node:crypto";

import { connecteur } from "@/connectors";
import type { AuditInput } from "@/core/audit";
import type {
  CredentialRemis,
  PlannedStep,
  PrecheckResult,
  RiskLevel,
  RunContext,
} from "@/core/connector";
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
import { ancrageLu, intentionDUnGeste } from "@/core/geste";
import type { Voie } from "@/core/participation";
import { estExecutable, type Masse, masseDuPlan, refusDeMasse } from "@/core/plan";
import { periodiciteDUnTerme } from "@/core/revue";
import type { Prisma } from "@/generated/prisma/client";
import { profilDeLaPolitique } from "@/lib/arrivee";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { calculerPlan, type PlanCalcule, reposerLEtatDuPlan } from "@/lib/dossier";
import { env } from "@/lib/env";
import {
  calculerGeste,
  departOuvertSur,
  REFUS_DEPART_OUVERT,
  REFUS_INTENTION_ILLISIBLE,
} from "@/lib/geste";
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

/**
 * Qui a lancé, et par quelle porte il l'a prouvé.
 *
 * Les deux dans un même objet plutôt que côte à côte dans les options : le nom
 * n'autorise rien par lui-même, la voie dit ce qu'il vaut, et l'appelant a alors une
 * session entière à passer plutôt que deux champs à prélever dessus. Réduit à ce que ce
 * module emploie, ce qui rend une session assignable telle quelle sans faire dépendre
 * l'exécution d'un plan de la forme de cette session.
 *
 * Ce que la forme ne fait pas : elle n'interdit pas de recomposer le couple. Un objet
 * littéral satisfait cette interface aussi bien qu'une session, le typage étant
 * structurel, et aucune signature ne dira jamais d'où viennent ces deux valeurs. Ce qui
 * le tient est du côté de l'appelant, et s'y teste : le seul du dépôt passe la session
 * que `requireOperateur` a résolue, entière, et son scénario l'épingle ainsi.
 */
export interface Operateur {
  username: string;
  voie: Voie;
}

/**
 * La moitié périssable d'un credential qu'une étape vient d'émettre, remontée jusqu'à
 * l'écran.
 *
 * Elle ne s'écrit nulle part : ni en base, où l'ADR-0001 a refusé de faire de cette base le
 * coffre des credentials du parc, ni dans `evidence`, qui devient le motif journalisé de
 * l'étape dans un journal en écriture seule à rétention indéfinie, ni dans aucune valeur de
 * formulaire que la revalidation rejouerait. Elle se lit, elle se recopie, elle disparaît au
 * rechargement.
 */
export interface RemiseDeCredential {
  key: string;
  label: string;
  /** Ce qui ne se garde pas. Sans lui, la moitié conservée ne vaut rien, et c'est voulu. */
  aRemettre: string;
  /**
   * Ce que le rangement n'a pas pu faire. Non nul, la fiche du compte machine n'existe pas,
   * et il n'y a alors aucun registre au monde de ce qui vient d'être émis.
   */
  echecDeRangement?: string;
  /** Rendu avec l'autre moitié, et seulement quand le rangement a échoué : c'est la seule copie. */
  blob?: string;
}

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
  /**
   * Ce que ce passage a émis et qui ne se relira jamais. Vide sur la quasi-totalité des
   * passages : seule une étape qui fabrique un credential en remet.
   */
  remises: readonly RemiseDeCredential[];
  /**
   * Ce qui a interrompu le passage après qu'il a commencé à agir. Non nul, des étapes
   * n'ont pas été traitées et l'état du plan n'a pas été reposé : ce que `remises` porte a
   * bien été émis, le reste de la page ne décrit plus rien de sûr.
   */
  passageIncomplet?: string;
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
      // L'instant dont l'ensemble de tolérances a produit `confirmedDigest`, et par
      // construction plutôt que par discipline : la confirmation écrit les deux dans la
      // même transaction, avec le « maintenant » qu'elle a passé au calcul.
      confirmedAt: true,
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
      subjectId: true,
      intent: true,
      subject: { select: { id: true, username: true } },
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
          engagementKey: true,
          retryable: true,
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
 * Ce que le connecteur reçoit est l'étape recalculée, à trois valeurs près qui viennent
 * du plan figé : sa clé, qui est celle qui vaut en base, son échéance d'octroi et sa clé
 * d'engagement, toutes deux hors empreinte et donc libres d'avoir bougé depuis la
 * confirmation. Prendre celle
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
    engagementKey: string | null;
    retryable: boolean | null;
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

    // Une étape dont le connecteur a dit que l'échec ne se reprend pas ne se représente
    // pas d'elle-même. `FAILED` est repris parce qu'une reprise sert précisément à
    // retenter ce qui a échoué, mais « retenter » suppose qu'un second appel puisse
    // aboutir là où le premier a manqué : une émission de jeton dont on ignore si un blob
    // est né en ajouterait un second, que rien ne liste et que rien ne révoque. Ce qui
    // reste ouvert à une telle étape est la main d'un opérateur, qui la pointe ou l'écarte
    // en ayant lu la cause. Nul se lit « rien n'a été dit », et l'étape est reprise.
    if (stockee.state === "FAILED" && stockee.retryable === false) {
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
      ...(stockee.engagementKey ? { engagementKey: stockee.engagementKey } : {}),
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
  options: { operateur: Operateur; masseConfirmee: boolean; maintenant: Date },
): Promise<ResultatDExecution> {
  const { operateur, masseConfirmee, maintenant } = options;
  const runId = randomUUID();
  const dryRun = !env.ACTIONS_ENABLED;

  /**
   * Toute trace de ce passage, la voie de l'opérateur comprise.
   *
   * Posée une fois plutôt que recopiée dans chaque charge utile : l'action qui appelle
   * ne journalise rien, exprès, si bien que ces lignes sont le seul endroit où la porte
   * de l'opérateur puisse figurer. Une charge utile qui l'oublierait ne serait pas
   * incomplète, elle serait muette pour toujours, le journal étant à rétention
   * indéfinie et une absence ne se distinguant pas d'une ligne écrite avant que le
   * champ existe.
   *
   * `after` est exigé et non facultatif : une ligne sans charge utile n'aurait aucun
   * endroit pour l'accueillir. Et il ne peut pas nommer sa propre voie, ce que le type
   * refuse : posée en dernier, elle écraserait celle de la charge utile sans bruit, et
   * « posée une fois » cesserait d'être vrai à la première qui s'en donnerait une.
   */
  const journaliser = ({
    after,
    ...evenement
  }: Omit<AuditInput, "after"> & {
    after: Record<string, unknown> & { voie?: never };
  }): void => {
    audit({ ...evenement, after: { ...after, voie: operateur.voie } });
  };

  const traceDuPlan = {
    actorKind: "HUMAN" as const,
    actorUsername: operateur.username,
    action: "plan.execution",
    targetType: "plan",
    targetId: planId,
    correlationId: runId,
  };

  const refuser = (raison: string, masse?: Masse): ResultatDExecution => {
    journaliser({
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
      remises: [],
      ...(masse ? { masse } : {}),
    };
  };

  const plan = await planEnBase(planId);

  // Un plan disparu et un plan sans dossier ne sont pas la même situation, et la garde qui
  // les confondait rendait la même phrase pour les deux.
  const ancrage = plan === null ? null : ancrageLu(plan.accessCase, plan.subject);

  if (plan === null || ancrage === null) {
    return refuser("Ce plan n'existe plus.");
  }

  if (ancrage.sorte === "dossier") {
    if (!dossierVivant(ancrage.dossier.state)) {
      return refuser("Ce dossier n'est plus ouvert.");
    }
    // Le pendant de cette garde pour un plan qui n'a pas de dossier : ce qui doit être vrai
    // au démarrage est qu'aucun départ ne soit ouvert sur le sujet. Ouvrir un accès pendant
    // qu'un départ court déplace l'empreinte de son plan, et un départ déjà confirmé n'a
    // plus de recalcul pour rattraper cet écart.
  } else if (await departOuvertSur(ancrage.sujet.id)) {
    return refuser(REFUS_DEPART_OUVERT);
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

  // Avant le calcul, et pour la même raison que la péremption : sans l'instant de sa
  // confirmation, les tolérances de ce plan ne se rejouent pas, et le recalculer au
  // présent rendrait autre chose que ce qui a été approuvé. Le cas ne se produit pas, la
  // confirmation écrivant l'instant et l'empreinte dans la même écriture, et c'est
  // précisément pourquoi il se refuse ici plutôt que de se replier en silence.
  if (plan.confirmedAt === null) {
    return refuser(
      "Ce plan ne porte pas l'instant de sa confirmation. Recalculez-le, puis confirmez-le.",
    );
  }

  /**
   * Ce que le recalcul d'un geste rejoue, et ce qu'il ne rejoue pas.
   *
   * Gelés, donc immobiles : la clé du système, le scope et le terme, tous trois lus dans
   * l'intention. Relus en base à chaque calcul : l'adresse dont le socle répond, et les
   * identifiants sûrs de la personne.
   *
   * La garde d'écart mord donc sur un geste dont le connecteur tire un paramètre de la
   * base, ce qui est le cas d'une collaboration Scalingo, dont le bénéficiaire est
   * l'adresse de la fiche. Elle est **tautologique** sur un geste dont tout vient de
   * l'intention, ce qui est le cas d'un jeton restreint : l'empreinte recalculée y est
   * égale à la confirmée par construction. Elle n'est pas fausse, elle ne dit rien, et ce
   * geste-là est protégé par le refus pendant un départ ouvert et par l'échéance
   * obligatoire, pas par l'empreinte.
   */
  let actuel: PlanCalcule;

  if (ancrage.sorte === "dossier") {
    actuel = await calculerPlan(
      ancrage.dossier.kind,
      ancrage.dossier.person.id,
      ancrage.dossier.person.username,
      maintenant,
      profilDeLaPolitique(ancrage.dossier.profileKey),
      // Les tolérances telles qu'elles étaient à la confirmation, et non celles du jour :
      // une pose ou une expiration survenue depuis déplacerait l'empreinte, et ce plan
      // deviendrait inexécutable sans issue, le recalcul n'étant ouvert qu'à un brouillon.
      plan.confirmedAt,
    );
  } else {
    // Par le refus tracé et non par une levée : `lancerExecution` n'attrape rien, et une
    // intention gelée illisible y sortait en erreur de serveur au lieu de se dire.
    const intention = intentionDUnGeste.safeParse(plan.intent);
    if (!intention.success) {
      return refuser(REFUS_INTENTION_ILLISIBLE);
    }

    actuel = await calculerGeste(
      intention.data,
      ancrage.sujet.id,
      ancrage.sujet.username,
      maintenant,
    );
  }

  const sens = actuel.sens;

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

  // `audit` tel quel et non la trace de ce passage : ce qu'un connecteur écrit est le
  // fait d'un système, et une voie collée dessus nommerait une porte que rien n'a
  // franchie.
  const ctx: RunContext = { runId, now: maintenant, dryRun, audit };
  const aTraiter = ordreDExecution(rapprocher(plan.steps, actuel.etapes, plan.id));

  journaliser({
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
  const remises: RemiseDeCredential[] = [];

  let passageIncomplet: string | undefined;

  // Ce qui a été émis vit alors dans `remises` et nulle part ailleurs : ni la base, ni le
  // journal, ni le proxy n'en gardent la moitié périssable. Laisser l'exception remonter
  // détruirait la seule copie au monde de la clé d'un jeton vivant que rien ne révoque, et
  // le passage n'a de toute façon plus rien à sauver une fois qu'une de ses écritures
  // refuse. Les étapes que la boucle n'a pas atteintes gardent leur état et se
  // représenteront à la reprise suivante.
  try {
    for (const { id, label, etape, lue } of aTraiter) {
      const systeme = connecteur(etape.systemKey);
      // Le tier dit ce qui a été approuvé, la présence d'`execute` dit ce que le
      // connecteur sait faire aujourd'hui : les deux sont nécessaires, et une étape
      // automatique dont le connecteur ne sait pas encore exécuter reste une étape que
      // la main d'un opérateur soldera.
      const executable = estExecutable(etape) && systeme?.execute !== undefined;

      const trace = {
        actorKind: "HUMAN" as const,
        actorUsername: operateur.username,
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
      journaliser({ ...trace, after: contexte, result: "SUCCESS" });

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
        journaliser({
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
          const rendu = await systeme.execute(etape, ctx);
          issue = issueDeLEtape(rendu);

          // Le rangement revient au socle et jamais au connecteur : aucun fichier de
          // `src/connectors/` n'importe `@/lib/db`, et leur en ouvrir l'accès ferait du
          // contrat une façade. Après l'appel, parce qu'il n'y a rien à ranger avant.
          if (rendu.state === "SUCCEEDED" && rendu.credential) {
            remises.push(
              await rangerLeCredential(
                rendu.credential,
                operateur.username,
                maintenant,
                journaliser,
              ),
            );
          }
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
      const declare =
        etat === "SUCCEEDED" || etat === "ALREADY_PRESENT" || etat === "ALREADY_ABSENT";
      const validation: EtatValidation =
        etape.validationBy && declare ? "AWAITING" : lue.validation;

      if (etat !== null || appele) {
        // Ce que le geste constate, et qui s'écrit sans condition : quand cette écriture
        // part, le connecteur a déjà agi sur le système cible, et un accès ouvert ou
        // coupé sans que rien ne l'enregistre est plus grave que n'importe quel conflit.
        //
        // L'état s'en détache, parce qu'il ne dit pas tout à fait la même chose que le
        // reste : la tentative, sa date et sa cause d'échec constatent ce qui a eu lieu,
        // l'état dit en plus ce qu'il reste à faire, et c'est à ce titre qu'un refus le
        // pose lui aussi.
        const traceDuGeste: Prisma.PlanStepUpdateManyMutationInput = {
          ...(appele
            ? {
                attempts: { increment: 1 },
                executedAt: maintenant,
                lastError: issue?.erreur ?? null,
                // Ce que le connecteur a dit de la reprise, et non ce qu'on en déduirait :
                // sans cette colonne, `retryable` ne formulait qu'un motif au journal, et
                // l'étape se représentait quand même au clic suivant.
                retryable: issue?.reprenable ?? null,
              }
            : // L'état bouge sans qu'aucun appel ait eu lieu : le motif de la décision est
              // tout ce que l'opérateur aura pour comprendre, et une étape retenue en écart
              // qui n'affiche ni l'attendu ni le constaté est une étape bloquée sans raison.
              { lastError: decision.motif }),
          ...(issue?.reversibleUntil ? { reversibleUntil: issue.reversibleUntil } : {}),
        };

        const geste: Prisma.PlanStepUpdateManyMutationInput = {
          ...(etat === null ? {} : { state: etat }),
          ...traceDuGeste,
        };

        // Ce que le contrôle juge, et qui porte sur une déclaration précise : la
        // signature du contrôleur précédent s'efface avec l'attente qu'on repose, sans
        // quoi son avis se lirait comme s'il jugeait celle-ci. Le journal, lui, garde tout.
        const controle =
          validation === "AWAITING"
            ? {
                validation,
                declaredBy: operateur.username,
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
            //
            // Un refus garde en revanche l'état qu'il a posé. Il renvoie l'étape à faire,
            // et lui rendre celui du geste la laisserait soldée sous un avis qui la
            // refuse : couple qu'aucun autre chemin ne produit, que l'état du plan lit
            // comme un échec au lieu d'un refus, et qui sortirait l'étape des états que
            // la reprise reprend, donc du seul chemin qui pouvait la rattraper.
            if (reposee === 0) {
              const { count: avecEtat } = await prisma.planStep.updateMany({
                where: { id, validation: { not: "REFUSED" } },
                data: geste,
              });

              if (avecEtat === 0) {
                await prisma.planStep.update({ where: { id }, data: traceDuGeste });
              }

              journaliser({
                ...trace,
                before: lue,
                after: {
                  ...contexte,
                  motif:
                    "Un avis signé portait sur cette étape à l'écriture. Le geste est consigné, l'avis est laissé en place, et l'étape n'est pas remise en attente.",
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

      journaliser({
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
  } catch (cause: unknown) {
    passageIncomplet = cause instanceof Error ? cause.message : String(cause);
    journaliser({
      ...traceDuPlan,
      after: { simulation: dryRun, interrompu: passageIncomplet, remises: remises.length },
      result: "FAILURE",
    });
  }

  return {
    masse,
    simulation: dryRun,
    executees,
    soldees,
    echecs,
    remises,
    ...(passageIncomplet === undefined ? {} : { passageIncomplet }),
  };
}

/**
 * Le compte machine d'un credential qu'une étape vient d'émettre.
 *
 * Une ligne de plus et jamais une ligne remplacée : la clé se dérive de la clé d'idempotence
 * stockée, qui porte l'identifiant du plan. Une réémission après un échec ambigu produit donc
 * une seconde fiche, et c'est voulu, deux blobs pouvant vivre là-bas sans que ni l'un ni
 * l'autre ne se révoque.
 *
 * La moitié à remettre ne descend pas jusqu'ici : elle ne traverse ni la base ni le journal.
 */
async function rangerLeCredential(
  remis: CredentialRemis,
  operateur: string,
  maintenant: Date,
  journaliser: (
    evenement: Omit<AuditInput, "after"> & {
      after: Record<string, unknown> & { voie?: never };
    },
  ) => void,
): Promise<RemiseDeCredential> {
  const rendu = { key: remis.key, label: remis.label, aRemettre: remis.aRemettre };
  const trace = {
    actorKind: "HUMAN" as const,
    actorUsername: operateur,
    action: "compte-de-service.emission",
    targetType: "service-account",
    targetId: remis.key,
  };

  try {
    await prisma.serviceAccount.create({
      data: {
        key: remis.key,
        label: remis.label,
        purpose: remis.purpose,
        provider: remis.provider,
        ownerUsername: remis.ownerUsername,
        // La périodicité vaut la durée du terme, si bien qu'aucune revue ne tombe avant que
        // le credential ne meure : demander de se prononcer sur un jeton qu'on ne peut ni
        // reprendre ni prolonger ne demande rien à personne.
        reviewEveryDays: periodiciteDUnTerme(maintenant, remis.expiresAt),
        expiresAt: remis.expiresAt,
        fgpBlob: remis.blob,
        fgpTarget: remis.target,
        fgpScopes: [...remis.scopes],
        issuedBy: operateur,
      },
    });

    journaliser({
      ...trace,
      after: {
        systeme: remis.provider,
        detenteur: remis.ownerUsername,
        cible: remis.target,
        scopes: [...remis.scopes],
        terme: remis.expiresAt.toISOString(),
      },
      result: "SUCCESS",
    });

    return rendu;
  } catch (cause: unknown) {
    const erreur = cause instanceof Error ? cause.message : String(cause);

    journaliser({ ...trace, after: { echec: erreur, cible: remis.target }, result: "FAILURE" });

    // L'étape reste réussie, parce qu'elle l'est : le credential existe là-bas, et le dire
    // échoué serait faux. Mais son registre n'existe pas, et le blob n'a alors aucune autre
    // copie au monde, le proxy n'en gardant rien et aucune route ne sachant le relire. Il se
    // rend donc avec l'autre moitié, faute de quoi il disparaît avec cette page.
    return { ...rendu, echecDeRangement: erreur, blob: remis.blob };
  }
}
