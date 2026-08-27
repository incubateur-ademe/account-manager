import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AuditInput } from "@/core/audit";
import type {
  Connector,
  Intent,
  PlannedStep,
  PrecheckResult,
  RunContext,
  StepOutcome,
  SubjectRef,
} from "@/core/connector";
import { type EtatEtape, type EtatValidation, estSoldee, etatApresPointage } from "@/core/dossier";
import type { Profil } from "@/core/policy";
import { calculerPlan } from "@/lib/dossier";
import { executerPlan } from "@/lib/execution";

interface IdentiteEnBase {
  provider: string;
  handle: string;
  matchMethod: string;
}

interface EtapeEnBase {
  id: string;
  label: string;
  state: string;
  ordre: number;
  riskLevel: string;
  idempotencyKey: string;
  grantExpiresAt: Date | null;
  attempts: number;
  executedAt: Date | null;
  lastError: string | null;
  reversibleUntil: Date | null;
  validation: string;
  declaredBy: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
  validationNote: string | null;
}

interface PlanEnBase {
  id: string;
  state: string;
  confirmedDigest: string | null;
  expiresAt: Date;
  accessCaseId: string;
  accessCase: {
    kind: string;
    state: string;
    profileKey: string | null;
    person: { id: string; username: string };
  };
  steps: EtapeEnBase[];
}

const base = vi.hoisted(() => ({
  connecteurs: [] as Connector[],
  identites: [] as IdentiteEnBase[],
  githubLogin: null as string | null,
  profils: [] as Profil[],
  seuil: 20,
  /** Ce que l'environnement autorise. Jamais forcé depuis le code exercé, seulement ici. */
  actionsAutorisees: false,
  jetonForge: true,
  plan: null as PlanEnBase | null,
  journal: [] as AuditInput[],
  /** Les gestes dans l'ordre où ils ont eu lieu, journal et appels mêlés. */
  chronologie: [] as string[],
  ecritures: [] as { id: string; data: Record<string, unknown> }[],
  etatsDePlanEcrits: [] as string[],
  prechecks: {} as Record<string, PrecheckResult>,
  issues: {} as Record<string, StepOutcome>,
  sujets: [] as SubjectRef[],
  intentions: [] as string[],
  echeancesRecues: {} as Record<string, Date | undefined>,
  /** Les rôles de la forge dont le plan exige qu'un autre opérateur relise le geste. */
  relectureExigee: [] as string[],
  /**
   * Ce qui s'intercale entre la lecture du plan et l'écriture de l'étape visée, une
   * fois. C'est la seule façon de jouer un contrôle simultané sur un faux dépôt
   * séquentiel : sans ce point, la boucle verrait toujours ce que le contrôleur a déjà
   * écrit. Clé par identifiant, sans quoi il partirait sur la première écriture du
   * passage, c'est-à-dire avant que le connecteur de l'étape en cause ait agi.
   */
  pendantLEcritureDeLEtape: null as { etape: string; jouer: () => void } | null,
}));

vi.mock("@/lib/env", () => ({
  env: {
    get ACTIONS_ENABLED() {
      return base.actionsAutorisees;
    },
  },
}));

vi.mock("@/lib/policy", () => ({
  policy: () => ({ thresholds: { maxPlanSteps: base.seuil }, profiles: base.profils }),
}));

vi.mock("@/lib/audit", () => ({
  audit: (evenement: AuditInput) => {
    base.journal.push(evenement);
    base.chronologie.push(`journal:${evenement.targetId ?? evenement.targetType}`);
  },
}));

vi.mock("@/connectors", () => ({
  CONNECTEURS: base.connecteurs,
  connecteur: (key: string) => base.connecteurs.find((candidat) => candidat.contract.key === key),
  catalogueDOctroi: () =>
    base.connecteurs.map(({ contract }) => ({
      key: contract.key,
      scopeSchema: contract.scopeSchema,
      octroiDeclare: contract.capabilities.grant !== undefined,
    })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: () =>
        Promise.resolve({
          githubLogin: base.githubLogin,
          startups: [],
          startupAssignments: [],
        }),
    },
    externalIdentity: {
      findMany: () =>
        Promise.resolve(base.identites.map((identite) => ({ ...identite, vanishedAt: null }))),
    },
    planTemplate: { findMany: () => Promise.resolve([]) },
    plan: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(base.plan?.id === where.id ? base.plan : null),
      update: ({ where, data }: { where: { id: string }; data: { state: string } }) => {
        if (base.plan?.id === where.id) {
          base.plan.state = data.state;
        }
        base.etatsDePlanEcrits.push(data.state);
        return Promise.resolve({ id: where.id });
      },
      // La boucle repose l'état par une relecture suivie d'une écriture conditionnée,
      // pour qu'un pointage survenu pendant qu'elle interrogeait les connecteurs ne
      // soit pas écrasé par sa photo de départ.
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; state: string };
        data: { state: string };
      }) => {
        if (base.plan?.id !== where.id || base.plan.state !== where.state) {
          return Promise.resolve({ count: 0 });
        }
        if (base.plan.state !== data.state) {
          base.plan.state = data.state;
          base.etatsDePlanEcrits.push(data.state);
        }
        return Promise.resolve({ count: 1 });
      },
    },
    planStep: {
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string } & Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        intercaler(where.id);

        const etape = base.plan?.steps.find((candidate) => correspond(candidate, where));

        if (!etape) {
          return Promise.resolve({ count: 0 });
        }

        ecrire(etape, where.id, data);
        return Promise.resolve({ count: 1 });
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        intercaler(where.id);

        const etape = base.plan?.steps.find((candidate) => candidate.id === where.id);
        if (!etape) {
          return Promise.reject(new Error(`étape inconnue : ${where.id}`));
        }

        ecrire(etape, where.id, data);
        return Promise.resolve(etape);
      },
    },
  },
}));

/** Ce que le contrôleur simultané écrit, s'il porte bien sur l'étape qu'on écrit. */
function intercaler(id: string): void {
  const pendant = base.pendantLEcritureDeLEtape;
  if (pendant?.etape !== id) {
    return;
  }
  base.pendantLEcritureDeLEtape = null;
  pendant.jouer();
}

/** Une condition d'écriture, colonne par colonne : ce qui n'y figure pas ne filtre rien. */
function correspond(etape: EtapeEnBase, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([colonne, attendu]) => {
    const valeur = etape[colonne as keyof EtapeEnBase];
    if (attendu !== null && typeof attendu === "object" && "not" in attendu) {
      return valeur !== (attendu as { not: unknown }).not;
    }
    return valeur === attendu;
  });
}

/** Ce qu'une écriture pose sur la ligne, `null` effaçant et une colonne absente se taisant. */
function ecrire(etape: EtapeEnBase, id: string, data: Record<string, unknown>): void {
  base.ecritures.push({ id, data });

  if (typeof data["state"] === "string") {
    etape.state = data["state"];
  }
  if (data["attempts"] !== undefined) {
    etape.attempts += 1;
  }
  if (data["executedAt"] instanceof Date) {
    etape.executedAt = data["executedAt"];
  }
  if (typeof data["validation"] === "string") {
    etape.validation = data["validation"];
  }
  if (typeof data["declaredBy"] === "string") {
    etape.declaredBy = data["declaredBy"];
  }
  if ("lastError" in data) {
    etape.lastError = (data["lastError"] as string | null) ?? null;
  }
  if (data["reversibleUntil"] instanceof Date) {
    etape.reversibleUntil = data["reversibleUntil"];
  }
  if ("validatedBy" in data) {
    etape.validatedBy = (data["validatedBy"] as string | null) ?? null;
  }
  if ("validatedAt" in data) {
    etape.validatedAt = (data["validatedAt"] as Date | null) ?? null;
  }
  if ("validationNote" in data) {
    etape.validationNote = (data["validationNote"] as string | null) ?? null;
  }
}

const PERSONNE = "personne-1";
const USERNAME = "camille.exemple";
const OPERATEUR = "operatrice.exemple";
const CONTROLEUR = "autre.exemple";
const DOSSIER = "dossier-1";
const PLAN = "plan-1";
const MAINTENANT = new Date("2026-08-24T09:00:00Z");
const PLUS_TARD = new Date("2026-08-25T11:00:00Z");
const JOUR = 24 * 60 * 60_000;

const RISQUE = { low: "LOW", medium: "MEDIUM", high: "HIGH" } as const;

const CLE_LECTEUR = "forge:grant:lecteur";
const CLE_MEMBRE = "forge:grant:membre";
const CLE_ADMIN = "forge:grant:admin";
const CLE_ATELIER = `atelier:grant:${USERNAME}`;

/** La clé telle que le connecteur la reçoit, débarrassée du suffixe de plan. */
function cle(step: PlannedStep): string {
  return step.idempotencyKey.replace(`:${PLAN}`, "");
}

const REVERSIBILITE: Readonly<Record<string, number | undefined>> = {
  lecteur: 30,
  membre: 7,
  admin: undefined,
};

const RISQUE_DU_ROLE: Readonly<Record<string, "low" | "medium" | "high">> = {
  lecteur: "low",
  membre: "medium",
  admin: "high",
};

/**
 * Un système qui sait donner et qui sait décrire ce qu'il donne. Une doublure et non un
 * connecteur du dépôt, parce qu'elle porte plusieurs rôles aux réversibilités et aux
 * risques distincts : c'est ce qui rend observable l'ordre d'exécution, que le seul
 * octroi de GitHub ne suffirait pas à départager.
 */
const FORGE: Connector = {
  contract: {
    key: "forge",
    label: "Forge",
    criticality: "medium",
    runbook: "Console de la forge, onglet Membres, Inviter.",
    credentials: [],
    capabilities: {
      grant: [
        { requires: ["jeton-forge"], tier: "auto", reversibleForDays: 30 },
        { requires: [], tier: "manual" },
      ],
    },
    scopeSchema: z.strictObject({ role: z.string() }),
  },
  probe: () =>
    Promise.resolve([{ id: "jeton-forge", available: base.jetonForge, checkedAt: MAINTENANT }]),
  plan: (intent: Intent) => {
    base.intentions.push(`forge:${intent.kind}`);
    return Promise.resolve([]);
  },
  planifierOctroi: (scope: unknown, sujet: SubjectRef): readonly PlannedStep[] => {
    base.sujets.push(sujet);

    const role = (scope as { role: string }).role;
    const compte = sujet.kind === "person" ? (sujet.handles?.["forge"] ?? null) : null;
    const reversibilite = REVERSIBILITE[role];

    return [
      {
        systemKey: "forge",
        capability: "grant",
        // Sans identifiant sûr, c'est le connecteur qui dégrade, et non la résolution
        // de capacité : ce qui manque est une donnée, pas un credential.
        tier: compte === null ? "manual" : "auto",
        action: "inviter",
        label: `Donner le rôle ${role} de la forge à ${compte ?? USERNAME}`,
        params: { compte, role },
        riskLevel: RISQUE_DU_ROLE[role] ?? "medium",
        expectedState: { role },
        idempotencyKey: `forge:grant:${role}`,
        ...(base.relectureExigee.includes(role) ? { validationBy: "OPERATOR" as const } : {}),
        ...(reversibilite === undefined ? {} : { reversibleForDays: reversibilite }),
        ...(compte === null
          ? {
              manual: {
                title: `Inviter ${USERNAME} dans la forge en rôle ${role}`,
                runbook: "Console de la forge, onglet Membres, Inviter.",
                doneWhen: `${USERNAME} figure parmi les membres de la forge, ou parmi les invitations en attente : une invitation en attente est un accès accordé.`,
              },
            }
          : {}),
      },
    ];
  },
  precheck: (step: PlannedStep) => {
    base.chronologie.push(`precheck:${cle(step)}`);
    return Promise.resolve(base.prechecks[cle(step)] ?? { state: "READY" });
  },
  execute: (step: PlannedStep) => {
    base.chronologie.push(`execute:${cle(step)}`);
    base.echeancesRecues[cle(step)] = step.grantExpiresAt;
    return Promise.resolve(
      base.issues[cle(step)] ?? { state: "SUCCEEDED", evidence: "invitation envoyée" },
    );
  },
};

/**
 * Un système qui déclare savoir donner mais ne sait pas décrire l'octroi d'un profil,
 * et qu'aucune voie automatique ne porte. Il tient deux règles à lui seul : l'étape
 * sort quand même, et la boucle ne coche jamais à la place de l'opérateur.
 */
const ATELIER: Connector = {
  contract: {
    key: "atelier",
    label: "Atelier",
    criticality: "low",
    runbook: "Inviter la personne depuis la console de l'atelier.",
    credentials: [],
    capabilities: { grant: [{ requires: [], tier: "manual" }] },
    scopeSchema: z.strictObject({}),
  },
  probe: () => Promise.resolve([]),
  plan: (intent: Intent) => {
    base.intentions.push(`atelier:${intent.kind}`);
    return Promise.resolve([]);
  },
  precheck: (step: PlannedStep) => {
    base.chronologie.push(`precheck:${cle(step)}`);
    return Promise.resolve(base.prechecks[cle(step)] ?? { state: "READY" });
  },
};

/**
 * Un système qui ne sait que retirer. Sans lui dans le registre, « une arrivée
 * interroge tous ceux qui déclarent l'octroi, et eux seuls » s'affirmerait sans que
 * rien ne puisse le démentir.
 */
const COFFRE: Connector = {
  contract: {
    key: "coffre",
    label: "Coffre",
    criticality: "low",
    runbook: "Retirer la personne des collections du coffre.",
    credentials: [],
    capabilities: { revoke: [{ requires: [], tier: "manual" }] },
    scopeSchema: z.strictObject({}),
  },
  probe: () => Promise.resolve([]),
  plan: (intent: Intent, _ctx: RunContext) => {
    base.intentions.push(`coffre:${intent.kind}`);
    return Promise.resolve([]);
  },
};

const PROFIL: Profil = {
  key: "developpeur",
  label: "Développeuse d'une startup d'État",
  accesses: [
    // Le terme n'est pas décoratif : la forge rend une étape à risque élevé sur ce rôle,
    // et un accès élevé sans échéance ne se construit pas.
    { system: "forge", scope: { role: "admin" }, expiresInDays: 180 },
    { system: "atelier", scope: {} },
    { system: "forge", scope: { role: "membre" } },
    { system: "forge", scope: { role: "lecteur" }, expiresInDays: 90 },
  ],
};

const SEPT_JOURS = 7 * 24 * 60 * 60_000;

async function figerLePlan(
  profileKey: string | null = "developpeur",
  expiresAt: Date = new Date(MAINTENANT.getTime() + SEPT_JOURS),
): Promise<void> {
  const profil = base.profils.find((candidat) => candidat.key === profileKey);
  const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT, profil);

  base.plan = {
    id: PLAN,
    state: "EXECUTING",
    confirmedDigest: calcule.empreinte,
    expiresAt,
    accessCaseId: DOSSIER,
    accessCase: {
      kind: "ONBOARDING",
      state: "CONFIRMED",
      profileKey,
      person: { id: PERSONNE, username: USERNAME },
    },
    steps: calcule.etapes.map(({ etape, ordre }) => ({
      id: `etape-${ordre}`,
      label: etape.label,
      state: "PENDING",
      ordre,
      riskLevel: RISQUE[etape.riskLevel],
      // Le suffixe de plan est posé à l'enregistrement, jamais à l'assemblage : la
      // boucle doit rapprocher le figé du recalculé à travers lui.
      idempotencyKey: `${etape.idempotencyKey}:${PLAN}`,
      grantExpiresAt: etape.grantExpiresAt ?? null,
      attempts: 0,
      executedAt: null,
      lastError: null,
      reversibleUntil: null,
      validation: "NONE",
      declaredBy: null,
      validatedBy: null,
      validatedAt: null,
      validationNote: null,
    })),
  };

  base.journal.length = 0;
  base.chronologie.length = 0;
  base.ecritures.length = 0;
  base.etatsDePlanEcrits.length = 0;
  base.echeancesRecues = {};
}

function etape(cleNue: string): EtapeEnBase {
  const trouvee = base.plan?.steps.find(
    (candidate) => candidate.idempotencyKey === `${cleNue}:${PLAN}`,
  );
  if (!trouvee) {
    throw new Error(`aucune étape figée sous ${cleNue}`);
  }
  return trouvee;
}

function lancer(masseConfirmee = false) {
  return executerPlan(PLAN, { operateur: OPERATEUR, masseConfirmee, maintenant: PLUS_TARD });
}

const appels = () =>
  base.chronologie.filter((geste) => !geste.startsWith("journal:")).map((geste) => geste);

beforeEach(() => {
  base.connecteurs.length = 0;
  base.connecteurs.push(FORGE, ATELIER, COFFRE);
  base.identites.length = 0;
  base.identites.push(
    { provider: "forge", handle: "camille-forge", matchMethod: "EMAIL_EXACT" },
    { provider: "atelier", handle: "cam", matchMethod: "HEURISTIC" },
    { provider: "coffre", handle: "camille", matchMethod: "DECLARED" },
  );
  base.githubLogin = "camille-exemple";
  base.profils.length = 0;
  base.profils.push(PROFIL);
  base.seuil = 20;
  base.actionsAutorisees = false;
  base.jetonForge = true;
  base.plan = null;
  base.journal.length = 0;
  base.chronologie.length = 0;
  base.ecritures.length = 0;
  base.etatsDePlanEcrits.length = 0;
  base.prechecks = {};
  base.issues = {};
  base.sujets.length = 0;
  base.intentions.length = 0;
  base.echeancesRecues = {};
  base.relectureExigee.length = 0;
  base.pendantLEcritureDeLEtape = null;
});

describe("la simulation lit tout et n'écrit rien", () => {
  it("fait tourner le précheck sur chaque étape, solde ce qui est déjà fait, et laisse le reste intact", async () => {
    // Given ACTIONS_ENABLED absent, qui est le défaut, et un plan confirmé dont l'un
    // des accès est déjà ouvert : quelqu'un est passé avant
    expect(base.actionsAutorisees).toBe(false);
    base.prechecks[CLE_ATELIER] = { state: "ALREADY_PRESENT" };
    await figerLePlan();

    // When on lance l'exécution
    const resultat = await lancer();

    // Then rien n'a été exécuté, et le résultat dit lui-même qu'on simulait
    expect(resultat.simulation).toBe(true);
    expect(resultat.refus).toBeUndefined();
    expect(resultat.executees).toBe(0);
    expect(appels().filter((geste) => geste.startsWith("execute:"))).toEqual([]);

    // Then le précheck a pourtant tourné sur les quatre étapes, l'étape manuelle
    // comprise : c'est une lecture, et n'envoyer personne faire ce qui est déjà fait
    // est son meilleur usage
    expect(appels().filter((geste) => geste.startsWith("precheck:")).length).toBe(4);
    expect(appels()).toContain(`precheck:${CLE_ATELIER}`);

    // Then l'étape que le précheck a soldée l'est en base, en simulation comme hors
    expect(etape(CLE_ATELIER).state).toBe("ALREADY_PRESENT");
    expect(resultat.soldees).toBe(1);

    // Then aucune étape prête n'a bougé : « fait » ferait mentir le dossier,
    // « écartée » ferait croire qu'un humain l'a jugée, et le seul état honnête est
    // l'absence de changement
    for (const cleNue of [CLE_ADMIN, CLE_MEMBRE, CLE_LECTEUR]) {
      expect(etape(cleNue).state).toBe("PENDING");
      expect(etape(cleNue).attempts).toBe(0);
      expect(etape(cleNue).executedAt).toBeNull();
    }
    expect(base.ecritures.map(({ id }) => id)).toEqual([etape(CLE_ATELIER).id]);

    // Then le plan se déduit de ses étapes et n'a donc pas bougé non plus
    expect(base.plan?.state).toBe("EXECUTING");
    expect(base.etatsDePlanEcrits).toEqual([]);

    // Then le journal dit qu'on simulait, sur le plan comme sur les étapes prêtes
    const surLEtape = base.journal.filter((trace) => trace.targetId === etape(CLE_ADMIN).id);
    expect(surLEtape).toHaveLength(2);
    expect(JSON.stringify(surLEtape[1]?.after)).toContain("ACTIONS_ENABLED");
    expect(surLEtape[1]?.result).toBe("SKIPPED");
  });
});

describe("l'exécution autorisée", () => {
  it("passe par ce qui se défait le plus facilement, trace avant d'appeler, et n'escalade jamais un rôle", async () => {
    // Given un environnement qui autorise l'écriture, et un plan dont le rang de
    // lecture range l'irréversible en premier
    base.actionsAutorisees = true;
    base.prechecks[CLE_ATELIER] = { state: "ALREADY_PRESENT" };
    // Le piège de l'octroi : le précheck constate un autre rôle que celui du plan, et
    // le refaire escaladerait le privilège sans que le système cible ne dise un mot
    base.prechecks[CLE_ADMIN] = {
      state: "STALE",
      expected: { role: "admin" },
      actual: { role: "membre" },
    };
    base.issues[CLE_MEMBRE] = { state: "FAILED", error: "403 forbidden", retryable: false };
    base.issues[CLE_LECTEUR] = {
      state: "SUCCEEDED",
      evidence: "invitation envoyée",
      reversibleUntil: new Date(PLUS_TARD.getTime() + 30 * JOUR),
    };
    await figerLePlan();
    expect(base.plan?.steps.map(({ ordre }) => ordre)).toEqual([0, 1, 2, 3]);

    // When on lance l'exécution
    const resultat = await lancer();

    // Then l'ordre est celui de la réversibilité décroissante, le risque départageant
    // à réversibilité égale : une exécution interrompue laisse derrière elle ce qu'on
    // sait le mieux défaire
    expect(appels().filter((geste) => geste.startsWith("precheck:"))).toEqual([
      `precheck:${CLE_LECTEUR}`,
      `precheck:${CLE_MEMBRE}`,
      `precheck:${CLE_ATELIER}`,
      `precheck:${CLE_ADMIN}`,
    ]);

    // Then le plan n'a pas été réécrit : le rang de lecture figé reste ce qu'il est
    expect(base.plan?.steps.map(({ ordre }) => ordre)).toEqual([0, 1, 2, 3]);

    // Then l'écart de rôle n'a rien exécuté, et l'étape porte l'écart
    expect(appels()).not.toContain(`execute:${CLE_ADMIN}`);
    expect(etape(CLE_ADMIN).state).toBe("STALE");
    const traceDeLEcart = base.journal.filter((trace) => trace.targetId === etape(CLE_ADMIN).id);
    expect(JSON.stringify(traceDeLEcart[1]?.after)).toContain("idempotent");

    // Then l'étape sans voie automatique reste à la main de l'opérateur, et le
    // précheck l'a quand même soldée
    expect(appels()).not.toContain(`execute:${CLE_ATELIER}`);
    expect(etape(CLE_ATELIER).state).toBe("ALREADY_PRESENT");

    // Then ce qui a été appelé l'a été après sa trace, jamais avant : le journal
    // précède l'action, étape par étape
    const trace = base.chronologie.indexOf(`journal:${etape(CLE_LECTEUR).id}`);
    expect(trace).toBeGreaterThanOrEqual(0);
    expect(trace).toBeLessThan(base.chronologie.indexOf(`precheck:${CLE_LECTEUR}`));
    expect(trace).toBeLessThan(base.chronologie.indexOf(`execute:${CLE_LECTEUR}`));

    // Then le succès pose l'état, la fenêtre de réversibilité et la tentative
    expect(etape(CLE_LECTEUR).state).toBe("SUCCEEDED");
    expect(etape(CLE_LECTEUR).attempts).toBe(1);
    expect(etape(CLE_LECTEUR).executedAt).toEqual(PLUS_TARD);
    expect(etape(CLE_LECTEUR).reversibleUntil).toEqual(new Date(PLUS_TARD.getTime() + 30 * JOUR));

    // Then l'échéance reçue est celle du plan figé et non celle du recalcul : la
    // reprendre au recalcul reconduirait le terme d'un accès du seul fait de
    // l'exécuter plus tard
    expect(base.echeancesRecues[CLE_LECTEUR]).toEqual(new Date(MAINTENANT.getTime() + 90 * JOUR));

    // Then l'échec porte sa cause, et une seconde trace le dit
    expect(etape(CLE_MEMBRE).state).toBe("FAILED");
    expect(etape(CLE_MEMBRE).lastError).toBe("403 forbidden");
    const traceDeLEchec = base.journal.filter((trace) => trace.targetId === etape(CLE_MEMBRE).id);
    expect(traceDeLEchec).toHaveLength(2);
    expect(traceDeLEchec[0]?.result).toBe("SUCCESS");
    expect(traceDeLEchec[1]?.result).toBe("FAILURE");
    expect(JSON.stringify(traceDeLEchec[1]?.after)).toContain("403 forbidden");

    // Then l'état du plan se déduit de ses étapes et ne se pose jamais à la main
    expect(base.etatsDePlanEcrits).toEqual(["PARTIALLY_EXECUTED"]);
    expect(resultat).toMatchObject({ simulation: false, executees: 2, soldees: 2, echecs: 1 });
  });

  it("ne solde pas ce que le plan a confié au regard d'un autre, même exécuté sans faute", async () => {
    // Given un plan dont le rôle d'administration de la forge demande qu'un autre
    // opérateur relise le geste, et dont tout le reste se solde
    base.actionsAutorisees = true;
    base.relectureExigee.push("admin");
    base.prechecks[CLE_ATELIER] = { state: "ALREADY_PRESENT" };
    await figerLePlan();

    // When on lance l'exécution, et que tout réussit
    const resultat = await lancer();

    // Then le geste a bien eu lieu, et l'étape n'est pas soldée pour autant : la
    // machine ne porte aucun second regard, et l'opérateur qui a lancé la reprise est
    // justement celui dont on attend qu'un autre relise ce qu'il a déclenché.
    expect(appels()).toContain(`execute:${CLE_ADMIN}`);
    expect(etape(CLE_ADMIN).state).toBe("SUCCEEDED");
    expect(etape(CLE_ADMIN).validation).toBe("AWAITING");
    expect(etape(CLE_ADMIN).declaredBy).toBe(OPERATEUR);

    // Then ce qui ne demandait aucune relecture reste muet : la colonne ne s'invente
    // pas sur les étapes que personne n'a confiées à un regard.
    expect(etape(CLE_LECTEUR).validation).toBe("NONE");
    expect(etape(CLE_LECTEUR).declaredBy).toBeNull();
    expect(etape(CLE_ATELIER).validation).toBe("NONE");

    // Then le plan reste en cours alors que ses quatre étapes ont été touchées sans
    // le moindre échec : sans cette attente, `validationBy` serait une colonne morte
    // sur la ligne, jamais à `AWAITING` donc jamais validable, et l'accès
    // d'administration serait soldé sans que personne ne l'ait revu.
    expect(resultat).toMatchObject({ simulation: false, echecs: 0 });
    expect(base.plan?.steps.every((etape) => etape.state !== "PENDING")).toBe(true);
    expect(base.etatsDePlanEcrits).toEqual([]);
    expect(base.plan?.state).toBe("EXECUTING");
  });

  it("laisse en place le verdict tombé pendant son passage, et repose l'attente quand rien n'a été signé", async () => {
    // Given un plan dont le rôle d'administration de la forge est confié au regard d'un
    // opérateur, et une étape que la boucle reprend
    base.actionsAutorisees = true;
    base.relectureExigee.push("admin");
    await figerLePlan();

    const controlee = etape(CLE_ADMIN);
    const tentatives = controlee.attempts;

    // When, pendant que la boucle interroge le connecteur, le porteur déclare l'étape
    // faite et un second opérateur refuse sa déclaration avec son motif : ce que
    // `pointerEtape` puis `validerEtape` écrivent, joué entre la lecture et l'écriture
    const dejaFait: string[] = [];

    base.pendantLEcritureDeLEtape = {
      etape: controlee.id,
      jouer: () => {
        dejaFait.push(...appels());

        controlee.state = "SUCCEEDED";
        controlee.validation = "AWAITING";
        controlee.declaredBy = USERNAME;
        controlee.attempts += 1;

        controlee.state = "PENDING";
        controlee.validation = "REFUSED";
        controlee.validatedBy = CONTROLEUR;
        controlee.validatedAt = PLUS_TARD;
        controlee.validationNote = "La capture ne montre pas le compte.";
      },
    };

    const resultat = await lancer();

    // Then le refus est intact : son motif, sa signature et sa date. Sans la garde,
    // l'étape repassait en attente sous le nom de celui qui a lancé la reprise, et le
    // porteur ne saurait jamais ce qu'on lui reprochait.
    expect(controlee.validation).toBe("REFUSED");
    expect(controlee.validatedBy).toBe(CONTROLEUR);
    expect(controlee.validationNote).toBe("La capture ne montre pas le compte.");
    expect(controlee.declaredBy).toBe(USERNAME);

    // Then la trace du geste s'écrit quand même : le connecteur avait déjà agi sur le
    // système cible quand le verdict est tombé, et un accès ouvert que rien
    // n'enregistre est pire qu'un avis perdu. C'est ce qui interdit de refuser cette
    // écriture, et donc de lever comme le font le pointage et le verdict de l'écran.
    expect(dejaFait).toContain(`execute:${CLE_ADMIN}`);
    expect(appels()).toContain(`execute:${CLE_ADMIN}`);
    expect(controlee.attempts).toBe(tentatives + 2);
    expect(controlee.executedAt).toEqual(PLUS_TARD);

    // Then l'état, lui, reste celui que le refus a posé : c'est le seul du geste qui
    // dise ce qu'il reste à faire, et le rendre à celui de la boucle laisserait l'étape
    // soldée sous un avis qui la refuse. Ce couple-là ferait lire un refus comme un
    // échec, et sortirait l'étape des états que la reprise reprend.
    expect(controlee.state).toBe("PENDING");

    // Then la déduction de l'état du plan lit bien un refus, et non un échec. L'autre
    // moitié de la première série le masquerait : l'étape manuelle y attend encore, et
    // son `PENDING` suffirait à rendre « en cours » quoi qu'il arrive à celle-ci.
    const suivie = {
      etat: controlee.state as EtatEtape,
      validation: controlee.validation as EtatValidation,
    };
    expect(estSoldee(suivie)).toBe(false);
    expect(etatApresPointage([suivie])).toBe("EXECUTING");

    // Then le conflit se lit dans le journal, il ne se tait pas, et il dit sur quelle
    // déclaration la boucle croyait écrire : un conflit sans son avant se lit comme un
    // fait sans cause
    const conflit = base.journal.filter(
      (ligne) => ligne.targetId === controlee.id && ligne.result === "SKIPPED",
    );
    expect(conflit).toHaveLength(1);
    expect(conflit[0]?.before).toEqual({
      etat: "PENDING",
      validation: "NONE",
      declaredBy: null,
      attempts: tentatives,
    });

    // Then les étapes suivantes du passage ne sont pas abandonnées : une seule d'entre
    // elles était en cause, et lever au milieu aurait laissé les autres en plan
    expect(resultat.refus).toBeUndefined();
    expect(resultat.executees).toBe(3);
    expect(etape(CLE_LECTEUR).state).toBe("SUCCEEDED");
    expect(etape(CLE_MEMBRE).state).toBe("SUCCEEDED");

    // Then l'état du plan se relit depuis les étapes et non depuis la photo du départ :
    // l'étape manuelle attend toujours la main d'un opérateur, et le compte rendu ne
    // solde pas ce qu'un contrôleur vient de refuser
    expect(resultat.soldees).toBe(2);
    expect(base.plan?.state).toBe("EXECUTING");
    expect(base.pendantLEcritureDeLEtape).toBeNull();

    // Given le même plan, et cette fois tout le reste déjà soldé : l'étape confiée au
    // regard d'un autre est la seule dont dépende l'état du plan
    base.prechecks[CLE_ATELIER] = { state: "ALREADY_PRESENT" };
    await figerLePlan();

    const seule = etape(CLE_ADMIN);

    // When c'est un pointage qui tombe pendant le passage, et non un verdict : un
    // opérateur écarte l'étape avec son motif, ce que `pointerEtape` écrit pour ce
    // choix, qui ne laisse aucune signature derrière lui
    base.pendantLEcritureDeLEtape = {
      etape: seule.id,
      jouer: () => {
        seule.state = "SKIPPED";
        seule.declaredBy = USERNAME;
        seule.attempts += 1;
        seule.lastError = "Le compte n'existe pas encore sur la forge.";
      },
    };

    const seconde = await lancer();

    // Then la déclaration lue n'est plus celle qui est en base, et l'attente est
    // reposée quand même : personne n'a signé, et y renoncer solderait un accès élevé
    // que le plan approuvé confiait à un second regard, sans que rien ne puisse plus
    // jamais l'ouvrir puisque le contrôle exige `AWAITING`
    expect(seule.state).toBe("SUCCEEDED");
    expect(seule.validation).toBe("AWAITING");
    expect(seule.declaredBy).toBe(OPERATEUR);
    expect(seule.validatedBy).toBeNull();

    // Then rien ne se journalise en conflit : il n'y a aucun avis à laisser en place,
    // et l'écrire affirmerait une chose que la ligne dément
    expect(
      base.journal.filter((ligne) => ligne.targetId === seule.id && ligne.result === "SKIPPED"),
    ).toEqual([]);

    // Then le plan ne se déclare pas exécuté sur un geste que personne n'a relu, alors
    // que ses trois autres étapes, elles, sont bien soldées
    expect(etape(CLE_ATELIER).state).toBe("ALREADY_PRESENT");
    expect(etape(CLE_LECTEUR).state).toBe("SUCCEEDED");
    expect(etape(CLE_MEMBRE).state).toBe("SUCCEEDED");
    expect(seconde.soldees).toBe(3);
    expect(base.etatsDePlanEcrits).toEqual([]);
    expect(base.plan?.state).toBe("EXECUTING");
  });

  it("reprend une étape retenue en écart, et lui laisse de quoi comprendre l'écart", async () => {
    // Given une simulation, qui est le défaut, et un précheck qui constate un autre rôle
    // que celui du plan
    expect(base.actionsAutorisees).toBe(false);
    base.prechecks[CLE_ADMIN] = {
      state: "STALE",
      expected: { role: "admin" },
      actual: { role: "membre" },
    };
    await figerLePlan();

    // When on lance l'exécution
    const simulee = await lancer();

    // Then l'écart est posé même en simulation : le précheck est une lecture, et son
    // verdict vaut dans les deux régimes
    expect(simulee.simulation).toBe(true);
    expect(etape(CLE_ADMIN).state).toBe("STALE");

    // Then l'étape porte l'attendu et le constaté : sans eux, l'opérateur voit une étape
    // bloquée sans savoir ce qui diffère, ni donc quoi aller regarder
    expect(etape(CLE_ADMIN).lastError).toContain("admin");
    expect(etape(CLE_ADMIN).lastError).toContain("membre");

    // Then rien n'a été tenté pour autant : l'écart n'est pas un échec d'écriture
    expect(etape(CLE_ADMIN).attempts).toBe(0);
    expect(etape(CLE_ADMIN).executedAt).toBeNull();
    expect(simulee.executees).toBe(0);

    // Given l'écart réglé sur le système, et l'écriture autorisée
    base.prechecks = {};
    base.actionsAutorisees = true;
    base.chronologie.length = 0;

    // When on relance le même plan
    const reprise = await lancer();

    // Then l'étape est reprise : rien ne l'avait exécutée, et un écart qui sortirait
    // définitivement de la portée de la boucle murerait l'étape pour toujours
    expect(appels()).toContain(`precheck:${CLE_ADMIN}`);
    expect(appels()).toContain(`execute:${CLE_ADMIN}`);
    expect(etape(CLE_ADMIN).state).toBe("SUCCEEDED");
    expect(reprise.executees).toBe(3);

    // Then ce qui était soldé n'a pas été retouché : la reprise ne rejoue que ce qui
    // attend encore
    expect(appels().filter((geste) => geste.startsWith("execute:"))).toHaveLength(3);
  });
});

describe("les gardes qui précèdent la moindre lecture", () => {
  it("refuse un plan dont la date est passée, avant même de regarder quoi que ce soit", async () => {
    // Given un plan confirmé sur des accès constatés il y a longtemps : sa date de
    // validité est derrière nous, mais son empreinte, elle, correspond toujours
    await figerLePlan("developpeur", new Date(PLUS_TARD.getTime() - 60_000));

    // When on lance l'exécution
    const refuse = await lancer();

    // Then le refus nomme la date et la sortie réellement ouverte : un plan confirmé
    // ne se recalcule plus, l'issue est de pointer, clôturer, puis rouvrir
    expect(refuse.refus).toContain("valait jusqu'au");
    expect(refuse.refus).toContain("clôturez ce dossier");

    // Then rien n'a été lu ni écrit, précheck compris : ce refus précède le calcul,
    // là où le précheck, lui, tourne même en simulation
    expect(appels()).toEqual([]);
    expect(base.ecritures).toEqual([]);
    expect(base.plan?.state).toBe("EXECUTING");
    expect(base.plan?.steps.every((etape) => etape.state === "PENDING")).toBe(true);

    // Then le refus est au journal, sous le plan
    expect(base.journal).toHaveLength(1);
    expect(base.journal[0]?.result).toBe("SKIPPED");
    expect(base.journal[0]?.targetId).toBe(PLAN);

    // Given le même plan, encore dans sa date
    await figerLePlan();

    // Then il repart : c'est bien la date qui l'arrêtait, et rien d'autre
    const passe = await lancer();
    expect(passe.refus).toBeUndefined();
  });

  it("refuse en bloc un plan qui n'est plus celui qu'on a approuvé, et un plan que personne n'a relu", async () => {
    // Given un plan confirmé, puis un profil qui change : le plan recalculé ne décrit
    // plus la liste qui a été relue
    await figerLePlan();
    base.profils[0] = {
      ...PROFIL,
      accesses: [...PROFIL.accesses, { system: "forge", scope: { role: "auditeur" } }],
    };

    // When on lance l'exécution
    const refuse = await lancer();

    // Then le refus est en bloc : exécuter les lignes inchangées reviendrait à laisser
    // quelqu'un approuver une liste dont on retirerait ensuite les gênantes
    expect(refuse.refus).toContain("plus ce qui a été approuvé");
    expect(refuse.refus).toContain("Rien n'a été exécuté");

    // Then rien n'a été ni lu ni écrit sur un système : aucun précheck, aucun appel
    expect(appels()).toEqual([]);
    expect(base.ecritures).toEqual([]);
    expect(base.plan?.state).toBe("EXECUTING");

    // Then le refus est au journal, sous le plan, et il dit ce qu'il refuse
    expect(base.journal).toHaveLength(1);
    expect(base.journal[0]?.result).toBe("SKIPPED");
    expect(base.journal[0]?.targetId).toBe(PLAN);

    // Given le profil retrouvé mais un plan que personne n'a confirmé
    base.profils[0] = PROFIL;
    await figerLePlan();
    if (base.plan) {
      base.plan.state = "DRAFT";
    }

    // Then un brouillon ne part pas : personne n'a répondu de cette liste
    expect((await lancer()).refus).toContain("doit d'abord être confirmé");
    expect(appels()).toEqual([]);

    // Given un plan engagé mais sans empreinte confirmée
    await figerLePlan();
    if (base.plan) {
      base.plan.confirmedDigest = null;
    }

    // Then il n'y a rien à comparer, donc rien à exécuter
    expect((await lancer()).refus).toContain("aucune empreinte confirmée");
    expect(appels()).toEqual([]);
  });
});

describe("le plafond de masse", () => {
  it("retient un plan anormalement gros tant qu'un humain n'a pas dit une seconde fois qu'il en répond", async () => {
    // Given un plafond que ce plan dépasse : trois étapes exécutables pour deux
    base.seuil = 2;
    await figerLePlan();

    // When on lance l'exécution sans le geste supplémentaire, qui est le cas nominal
    const refuse = await lancer();

    // Then le plan ne part pas, et le refus nomme ce qu'il refuse et ce qu'il faut
    // faire
    expect(refuse.refus).toContain("3 étapes");
    expect(refuse.refus).toContain("plafond de 2");
    expect(refuse.refus).toContain("relisez la liste");
    expect(refuse.masse).toEqual({ executables: 3, seuil: 2, depasse: true });

    // Then la masse est mesurée avant toute lecture : rien n'a été interrogé, rien
    // n'a été écrit
    expect(appels()).toEqual([]);
    expect(base.ecritures).toEqual([]);

    // Then l'étape manuelle n'entre pas dans le compte : elle est déjà bornée par la
    // main qui la coche, la boucle ne la touche pas
    expect(base.plan?.steps).toHaveLength(4);

    // When le même plan repart avec la confirmation de masse, qui est un geste et non
    // un défaut
    base.chronologie.length = 0;
    const passe = await lancer(true);

    // Then il part, et le précheck tourne enfin
    expect(passe.refus).toBeUndefined();
    expect(passe.masse?.depasse).toBe(true);
    expect(appels().filter((geste) => geste.startsWith("precheck:")).length).toBe(4);

    // Then sous le plafond, aucun geste supplémentaire n'est demandé
    base.seuil = 20;
    base.chronologie.length = 0;
    const sousLePlafond = await lancer();
    expect(sousLePlafond.refus).toBeUndefined();
    expect(sousLePlafond.masse).toEqual({ executables: 3, seuil: 20, depasse: false });
  });
});

describe("l'arrivée vise les comptes dont on répond, et n'omet aucune ligne", () => {
  it("interroge tous ceux qui savent donner, ne passe que les identifiants sûrs, et n'écarte rien sur un doute", async () => {
    // Given une personne dont un compte est rattaché sûrement, un autre par
    // ressemblance, et un troisième sur un système qui ne sait que retirer
    await figerLePlan();

    // Then l'arrivée a interrogé tous les systèmes qui déclarent l'octroi, et eux
    // seuls : la source s'inverse d'un sens à l'autre, et le coffre où elle a pourtant
    // un compte sûr n'est pas interrogé, puisqu'il ne sait pas donner
    expect(base.intentions).toEqual(["forge:grant", "atelier:grant"]);

    // Then le connecteur a reçu les identifiants dont le socle répond, tous systèmes
    // confondus : ce qui décide des systèmes interrogés est le catalogue, jamais la
    // liste des comptes observés
    expect(base.sujets).toHaveLength(3);
    expect(base.sujets[0]).toEqual({
      kind: "person",
      username: USERNAME,
      handles: { github: "camille-exemple", forge: "camille-forge", coffre: "camille" },
    });

    // Then la ressemblance n'y est jamais entrée : accorder une administration au
    // compte d'un homonyme est plus grave que de couper le mauvais
    const sujet = base.sujets[0];
    expect(sujet?.kind === "person" && sujet.handles?.["atelier"]).toBeUndefined();

    // Then l'étape que personne ne sait décrire existe quand même, au tier de sa
    // capacité, et porte de quoi la faire à la main
    expect(etape(CLE_ATELIER).state).toBe("PENDING");
    expect(etape(CLE_ATELIER).riskLevel).toBe("MEDIUM");

    // Given la même personne sans aucun compte sûr sur la forge : plus rien ne dit
    // quel compte viser
    base.identites = base.identites.filter(({ provider }) => provider !== "forge");
    base.githubLogin = null;
    await figerLePlan();

    // Then l'étape d'octroi existe toujours : écarter un octroi sur un doute
    // d'identité priverait quelqu'un d'un accès sans que rien ne le signale, là où un
    // octroi de trop se solde d'un clic sur « déjà présent »
    expect(base.plan?.steps).toHaveLength(4);
    expect(etape(CLE_LECTEUR).state).toBe("PENDING");

    // Then c'est le connecteur qui a dégradé en manuel, et non la résolution de
    // capacité : le jeton est là, c'est la donnée qui manque
    expect(base.jetonForge).toBe(true);

    // When on lance l'exécution avec l'écriture autorisée
    base.actionsAutorisees = true;
    const resultat = await lancer();

    // Then la boucle ne coche à la place de personne : aucune étape n'est exécutée,
    // aucun état ne bouge, et le journal dit qu'elle attend la main d'un opérateur
    expect(appels().filter((geste) => geste.startsWith("execute:"))).toEqual([]);
    expect(resultat.executees).toBe(0);
    expect(etape(CLE_LECTEUR).state).toBe("PENDING");
    const surLEtape = base.journal.filter((trace) => trace.targetId === etape(CLE_LECTEUR).id);
    expect(JSON.stringify(surLEtape[1]?.after)).toContain("main");
    expect(surLEtape[1]?.result).toBe("SKIPPED");
  });
});
