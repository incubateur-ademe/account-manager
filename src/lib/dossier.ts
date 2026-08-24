import { randomUUID } from "node:crypto";

import { CONNECTEURS } from "@/connectors";
import type { Connector, Intent, PlannedStep, RunContext } from "@/core/connector";
import {
  ETATS_VIVANTS,
  etatDeNaissance,
  type SensDossier,
  type SystemesDuDepart,
  systemesDuDepart,
} from "@/core/dossier";
import { assembler, type EtapeAssemblee, type EtapeEcartee, empreinteDuPlan } from "@/core/plan";
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

/** Ce qu'un plan demande aux connecteurs, dans un sens comme dans l'autre. */
const INTENTION: Record<SensDossier, Intent["kind"]> = {
  ONBOARDING: "grant",
  OFFBOARDING: "revoke",
};

const AUCUN_SYSTEME: SystemesDuDepart = { revocables: [], observes: [], nonConfirmes: [] };

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

/**
 * Les connecteurs qu'un plan interroge, et ce ne sont pas les mêmes dans les deux
 * sens.
 *
 * Pour un départ, seuls ceux où la personne est observée avec un rattachement sûr :
 * une ressemblance ne coupe rien, et un système où elle n'a pas de compte n'appelle
 * aucun geste.
 *
 * Pour une arrivée, tous ceux qui savent donner un accès, sans regarder ce qui est
 * déjà là : un compte déjà ouvert se pointe « déjà présent », il ne fait pas
 * disparaître l'étape qui l'exigeait. Aucune identité n'entre donc dans ce filtre,
 * et une ressemblance n'y produit pas davantage d'étape que dans l'autre sens.
 */
function interroge(
  sens: SensDossier,
  connecteur: Connector,
  presente: ReadonlySet<string>,
): boolean {
  if (sens === "OFFBOARDING") {
    return presente.has(connecteur.contract.key);
  }
  return connecteur.contract.capabilities.grant !== undefined;
}

export interface PlanCalcule {
  sens: SensDossier;
  /** Les étapes retenues, chacune avec son origine et son rang de lecture. */
  etapes: readonly EtapeAssemblee[];
  /** Ce que l'assemblage a écarté, et pourquoi. Rien n'est écarté en silence. */
  ecartees: readonly EtapeEcartee[];
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
 * Ce qu'il faudrait faire pour donner ou pour retirer ses accès à quelqu'un, tel que
 * les connecteurs le disent aujourd'hui. Ne touche à rien, ni ici ni ailleurs.
 *
 * Un plan d'arrivée sort vide tant qu'aucun connecteur ne déclare `grant` : le
 * mécanisme est là, la substance viendra des modèles et des octrois.
 */
export async function calculerPlan(
  sens: SensDossier,
  personId: string,
  username: string,
  maintenant: Date,
): Promise<PlanCalcule> {
  // Les comptes observés ne disent rien de ce qu'il faut donner : les lire pour une
  // arrivée serait une requête pour rien, et les afficher ferait passer un accès
  // existant pour un manque.
  const constates = sens === "OFFBOARDING" ? await systemesDeLaPersonne(personId) : AUCUN_SYSTEME;
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

  const proposees: PlannedStep[] = [];
  const systemes: string[] = [];

  for (const connecteur of CONNECTEURS) {
    if (!interroge(sens, connecteur, presente)) {
      continue;
    }

    systemes.push(connecteur.contract.key);
    proposees.push(
      ...(await connecteur.plan(
        { kind: INTENTION[sens], subject: { kind: "person", username } },
        ctx,
      )),
    );
  }

  // Une seule origine aujourd'hui, celle des connecteurs. Les deux autres, les
  // modèles de l'incubateur et ceux des startups, se branchent ici sans que rien
  // d'autre ne bouge.
  const assemblage = assembler({ origines: [{ origine: "connecteur", etapes: proposees }] });

  const couverts = new Set(CONNECTEURS.map((connecteur) => connecteur.contract.key));

  return {
    sens,
    etapes: assemblage.etapes,
    ecartees: assemblage.ecartees,
    // Sur les étapes nues, avant que l'enregistrement ne suffixe leurs clés
    // d'idempotence : hacher après suffixage donnerait à deux plans du même dossier
    // des empreintes incomparables, et un plan confirmé se dirait obsolète tout seul.
    empreinte: empreinteDuPlan(assemblage.etapes.map(({ etape }) => etape)),
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
 * Un seul dossier vivant par personne et par sens : deux dossiers concurrents pour
 * un même départ produiraient deux plans, deux approbations, et deux façons de
 * croire que l'affaire est réglée. Par sens, parce qu'une arrivée et un départ ne se
 * gênent pas : quelqu'un qui revient a un départ clos derrière lui, et rien
 * n'interdit qu'on prépare son retour pendant qu'on solde sa sortie.
 *
 * L'unicité reste applicative, cette lecture avant création : aucune contrainte en
 * base ne l'impose sous concurrence.
 */
export async function ouvrirDossier(
  personId: string,
  sens: SensDossier,
  effectiveDate: Date | null,
): Promise<{ id: string; deja: boolean }> {
  const ouvert = await prisma.accessCase.findFirst({
    where: { personId, kind: sens, state: { in: [...ETATS_VIVANTS] } },
    select: { id: true },
  });

  if (ouvert) {
    return { id: ouvert.id, deja: true };
  }

  const cree = await prisma.accessCase.create({
    data: {
      personId,
      kind: sens,
      state: etatDeNaissance(sens),
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
  accessCaseId: string,
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
      accessCaseId,
      kind: calcule.sens,
      state: "DRAFT",
      planDigest: calcule.empreinte,
      createdBy,
      expiresAt,
      steps: {
        create: calcule.etapes.map(({ etape, ordre }) => ({
          systemKey: etape.systemKey,
          tier: etape.tier,
          capability: etape.capability,
          action: etape.action,
          label: etape.label,
          ordre,
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
