import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { notion } from "@/connectors/notion";
import type { Connector, Intent } from "@/core/connector";
import type { EtatDossier, EtatEtape, EtatPlan, SensDossier } from "@/core/dossier";
import { peutClore } from "@/core/dossier";
import { calculerPlan, enregistrerPlan } from "@/lib/dossier";

import { confirmerPlan, pointerEtape } from "./actions";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/inutilise";
process.env["ESPACE_MEMBRE_API_KEY"] ??= "inutilisee";

interface IdentiteEnBase {
  personId: string;
  provider: string;
  matchMethod: string;
  vanishedAt: Date | null;
}

interface EtapeEnBase {
  id: string;
  planId: string;
  systemKey: string;
  label: string;
  ordre: number;
  state: EtatEtape;
  lastError: string | null;
}

interface PlanEnBase {
  id: string;
  accessCaseId: string;
  kind: SensDossier;
  state: EtatPlan;
  planDigest: string;
  confirmedDigest: string | null;
  confirmedBy: string | null;
  expiresAt: Date;
}

interface DossierEnBase {
  id: string;
  personId: string;
  kind: SensDossier;
  state: EtatDossier;
}

interface TraceEnBase {
  action: string;
  result: string;
  after: unknown;
}

const base = vi.hoisted(() => ({
  identites: [] as IdentiteEnBase[],
  dossiers: [] as DossierEnBase[],
  plans: [] as PlanEnBase[],
  etapes: [] as EtapeEnBase[],
  journal: [] as TraceEnBase[],
  /** L'ordre réel des écritures, pour dire si la trace a bien précédé l'action. */
  gestes: [] as string[],
  connecteurs: [] as Connector[],
}));

vi.mock("@/connectors", () => ({ CONNECTEURS: base.connecteurs }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () =>
    Promise.resolve({ username: "operatrice.exemple", email: null, nom: null }),
}));

function dossierDuPlan(plan: PlanEnBase) {
  const dossier = base.dossiers.find((candidat) => candidat.id === plan.accessCaseId);
  if (!dossier) {
    return null;
  }
  return {
    kind: dossier.kind,
    state: dossier.state,
    person: { id: dossier.personId, username: USERNAME },
  };
}

function planComplet(plan: PlanEnBase) {
  return {
    ...plan,
    accessCase: dossierDuPlan(plan),
    steps: base.etapes.filter((etape) => etape.planId === plan.id),
  };
}

vi.mock("@/lib/db", () => ({
  prisma: {
    externalIdentity: {
      findMany: ({ where }: { where: { personId: string } }) =>
        Promise.resolve(
          base.identites.filter(
            (identite) => identite.personId === where.personId && identite.vanishedAt === null,
          ),
        ),
    },
    auditEvent: {
      create: ({ data }: { data: TraceEnBase }) => {
        base.gestes.push(`journal:${data.action}:${data.result}`);
        base.journal.push(data);
        return Promise.resolve(data);
      },
    },
    plan: {
      create: ({
        data,
      }: {
        data: PlanEnBase & {
          steps: { create: readonly { systemKey: string; label: string; ordre: number }[] };
        };
      }) => {
        const { steps, ...entete } = data;
        base.plans.push({ ...entete, confirmedDigest: null, confirmedBy: null });
        steps.create.forEach((etape, rang) => {
          base.etapes.push({
            id: `etape-${base.etapes.length + 1}-${rang}`,
            planId: data.id,
            systemKey: etape.systemKey,
            label: etape.label,
            ordre: etape.ordre,
            state: "PENDING",
            lastError: null,
          });
        });
        return Promise.resolve({ id: data.id });
      },
      findUnique: ({ where }: { where: { id: string } }) => {
        const plan = base.plans.find((candidat) => candidat.id === where.id);
        return Promise.resolve(plan ? planComplet(plan) : null);
      },
      update: ({ where, data }: { where: { id: string }; data: { state: EtatPlan } }) => {
        const plan = base.plans.find((candidat) => candidat.id === where.id);
        if (plan) {
          base.gestes.push(`plan:${data.state}`);
          plan.state = data.state;
        }
        return Promise.resolve(plan);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; state: EtatPlan; accessCase: { state: { in: readonly string[] } } };
        data: { state: EtatPlan; confirmedDigest: string; confirmedBy: string };
      }) => {
        const plan = base.plans.find(
          (candidat) => candidat.id === where.id && candidat.state === where.state,
        );
        const dossier = plan && dossierDuPlan(plan);

        if (!plan || !dossier || !where.accessCase.state.in.includes(dossier.state)) {
          return Promise.resolve({ count: 0 });
        }

        base.gestes.push(`plan:${data.state}`);
        plan.state = data.state;
        plan.confirmedDigest = data.confirmedDigest;
        plan.confirmedBy = data.confirmedBy;
        return Promise.resolve({ count: 1 });
      },
    },
    planStep: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const etape = base.etapes.find((candidat) => candidat.id === where.id);
        const plan = etape && base.plans.find((candidat) => candidat.id === etape.planId);

        if (!etape || !plan) {
          return Promise.resolve(null);
        }

        return Promise.resolve({ ...etape, plan: planComplet(plan) });
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { state: EtatEtape; lastError?: string };
      }) => {
        const etape = base.etapes.find((candidat) => candidat.id === where.id);
        if (etape) {
          base.gestes.push(`etape:${data.state}`);
          etape.state = data.state;
          etape.lastError = data.lastError ?? etape.lastError;
        }
        return Promise.resolve(etape);
      },
    },
  },
}));

const PERSONNE = "personne-1";
const USERNAME = "camille.exemple";

/** Un connecteur qui sait ouvrir un accès, faute qu'aucun du dépôt n'en déclare. */
const ATELIER: Connector = {
  contract: {
    key: "atelier",
    label: "Atelier",
    criticality: "low",
    runbook: "Inviter la personne depuis la console de l'atelier.",
    credentials: [],
    capabilities: { grant: [{ requires: [], tier: "manual" }] },
    scopeSchema: z.object({}),
  },
  probe: () => Promise.resolve([]),
  plan: (intent: Intent) => {
    if (intent.kind !== "grant" || intent.subject.kind !== "person") {
      return Promise.resolve([]);
    }

    const username = intent.subject.username;

    return Promise.resolve(
      ["lecture", "ecriture"].map((role) => ({
        systemKey: "atelier",
        capability: "grant" as const,
        tier: "manual" as const,
        action: "inviter",
        label: `Donner l'accès ${role} de l'atelier à ${username}`,
        params: { username, role },
        riskLevel: "medium" as const,
        expectedState: { membre: true },
        idempotencyKey: `atelier:${role}:grant:${username}`,
        manual: {
          title: `Inviter ${username} dans l'atelier`,
          runbook: "Console de l'atelier, onglet Membres, Inviter.",
          doneWhen: `${username} apparaît dans les membres de l'atelier.`,
        },
      })),
    );
  },
};

/** Le formulaire tel que l'écran le poste. */
function formulaire(champs: Record<string, string>): FormData {
  const donnees = new FormData();
  for (const [nom, valeur] of Object.entries(champs)) {
    donnees.set(nom, valeur);
  }
  return donnees;
}

async function dossierAvecPlan(sens: SensDossier): Promise<{
  dossier: DossierEnBase;
  plan: PlanEnBase;
}> {
  const dossier: DossierEnBase = {
    id: `dossier-${base.dossiers.length + 1}`,
    personId: PERSONNE,
    kind: sens,
    state: sens === "ONBOARDING" ? "CONFIRMED" : "CANDIDATE",
  };
  base.dossiers.push(dossier);

  const calcule = await calculerPlan(sens, PERSONNE, USERNAME, new Date());
  const planId = await enregistrerPlan(dossier.id, calcule, "operatrice.exemple", new Date());
  const plan = base.plans.find((candidat) => candidat.id === planId);

  if (!plan) {
    throw new Error("le plan n'a pas été enregistré");
  }

  return { dossier, plan };
}

beforeEach(() => {
  base.identites.length = 0;
  base.dossiers.length = 0;
  base.plans.length = 0;
  base.etapes.length = 0;
  base.journal.length = 0;
  base.gestes.length = 0;
  base.connecteurs.length = 0;
  base.connecteurs.push(notion, ATELIER);
});

/**
 * Confirmer, c'est démarrer l'exécution : le plan passe à `EXECUTING` et ses étapes
 * deviennent pointables. L'empreinte se recalcule donc à ce moment-là, et pas
 * seulement au moment où le plan a été écrit, sans quoi on exécuterait à partir
 * d'une photo que la collecte de cette nuit a démentie.
 */
describe("le geste qui engage : confirmer un plan", () => {
  it("recalcule l'empreinte au moment du clic, et refuse ce qu'une collecte a démenti", async () => {
    // Given un départ calculé pendant que la personne avait un compte Notion
    base.identites.push({
      personId: PERSONNE,
      provider: "notion",
      matchMethod: "DECLARED",
      vanishedAt: null,
    });
    const { plan } = await dossierAvecPlan("OFFBOARDING");
    const empreinteApprouvee = plan.planDigest;
    expect(base.etapes).toHaveLength(1);

    // When une collecte passe entre le calcul et le clic, et ne voit plus ce compte
    const compte = base.identites[0];
    if (compte) {
      compte.vanishedAt = new Date();
    }
    const dementi = await confirmerPlan(null, formulaire({ planId: plan.id }));

    // Then la confirmation refuse, et le dit par ce qui a changé plutôt que par une
    // phrase de péremption : les deux appellent des gestes différents.
    expect(dementi.erreur).toContain("Les accès observés ont changé");
    expect(plan.state).toBe("DRAFT");
    expect(plan.confirmedDigest).toBeNull();

    // Then rien n'a été écrit, donc rien n'a été journalisé : le journal raconte des
    // gestes, pas des tentatives refusées avant d'atteindre la base.
    expect(base.journal).toEqual([]);

    // When le compte réapparaît à la collecte suivante, et qu'on reclique
    if (compte) {
      compte.vanishedAt = null;
    }
    const confirme = await confirmerPlan(null, formulaire({ planId: plan.id }));

    // Then le plan démarre, et il fige l'empreinte dont quelqu'un répond
    expect(confirme.erreur).toBeUndefined();
    expect(plan.state).toBe("EXECUTING");
    expect(plan.confirmedDigest).toBe(empreinteApprouvee);
    expect(plan.confirmedBy).toBe("operatrice.exemple");

    // Then la trace précède l'écriture, et elle est nominative : une action dont la
    // trace serait posée après coup serait, en cas de panne, une action que personne
    // ne pourrait plus expliquer ni attribuer.
    expect(base.gestes).toEqual(["journal:dossier.confirmation:SUCCESS", "plan:EXECUTING"]);
    expect(base.journal[0]?.after).toMatchObject({ sens: "OFFBOARDING", etapes: 1 });
  });

  it("refuse un plan trop vieux, et un plan dont le dossier a été abandonné entre-temps", async () => {
    // Given un départ dont le plan a dépassé sa date de validité
    base.identites.push({
      personId: PERSONNE,
      provider: "notion",
      matchMethod: "DECLARED",
      vanishedAt: null,
    });
    const { dossier, plan } = await dossierAvecPlan("OFFBOARDING");
    plan.expiresAt = new Date("2026-01-01T00:00:00Z");

    // When on tente de le confirmer
    const perime = await confirmerPlan(null, formulaire({ planId: plan.id }));

    // Then le refus nomme la date, et non le contenu : ce qui a été constaté est trop
    // vieux pour qu'on agisse dessus sans regarder à nouveau.
    expect(perime.erreur).toContain("date de validité");
    expect(plan.state).toBe("DRAFT");

    // When le dossier est abandonné pendant qu'un brouillon frais l'accompagne
    plan.expiresAt = new Date(Date.now() + 86_400_000);
    dossier.state = "CANCELLED";
    const abandonne = await confirmerPlan(null, formulaire({ planId: plan.id }));

    // Then l'état du dossier est regardé avant celui du plan : sans cela, un dossier
    // annulé entre deux clics laissait son brouillon confirmable.
    expect(abandonne.erreur).toBe("Ce dossier n'est plus ouvert.");
    expect(plan.state).toBe("DRAFT");
    expect(base.journal).toEqual([]);

    // Then un plan qui n'existe plus le dit sans rien écrire.
    expect((await confirmerPlan(null, formulaire({ planId: "inconnu" }))).erreur).toBe(
      "Ce plan n'existe plus.",
    );
  });
});

/**
 * Pointer est une déclaration humaine, pas une exécution. Le constat « quelqu'un est
 * passé avant » existe donc dans les deux sens, et il n'en existe qu'un par sens :
 * consigner « déjà absent » sous une étape d'octroi ferait dire au journal l'inverse
 * de ce qui a été constaté, et l'écran le relirait ainsi dans deux ans.
 */
describe("pointer une étape, dans le sens du dossier", () => {
  it("consigne « déjà présent » sur une arrivée, refuse « déjà absent », et solde le plan", async () => {
    // Given une arrivée confirmée, dont deux étapes attendent
    const { dossier, plan } = await dossierAvecPlan("ONBOARDING");
    await confirmerPlan(null, formulaire({ planId: plan.id }));
    expect(plan.state).toBe("EXECUTING");
    expect(base.etapes).toHaveLength(2);
    base.gestes.length = 0;
    base.journal.length = 0;

    const premiere = base.etapes[0];
    const seconde = base.etapes[1];

    // When quelqu'un constate qu'un accès existait déjà
    const constat = await pointerEtape(
      null,
      formulaire({ etapeId: premiere?.id ?? "", pointage: "deja-present" }),
    );

    // Then l'étape est soldée, et le plan reste en cours puisque l'autre attend
    expect(constat.erreur).toBeUndefined();
    expect(premiere?.state).toBe("ALREADY_PRESENT");
    expect(plan.state).toBe("EXECUTING");
    expect(base.gestes).toEqual([
      "journal:dossier.pointage:SUCCESS",
      "etape:ALREADY_PRESENT",
      "plan:EXECUTING",
    ]);
    expect(base.journal[0]?.after).toMatchObject({
      sens: "ONBOARDING",
      etat: "ALREADY_PRESENT",
    });

    // When on tente le constat de l'autre sens sur la seconde étape
    const contresens = await pointerEtape(
      null,
      formulaire({ etapeId: seconde?.id ?? "", pointage: "deja-absent" }),
    );

    // Then il est refusé, et l'étape n'a pas bougé
    expect(contresens.erreur).toBe("Ce constat ne vaut pas dans le sens de ce dossier.");
    expect(seconde?.state).toBe("PENDING");

    // When la seconde étape est faite pour de bon
    await pointerEtape(null, formulaire({ etapeId: seconde?.id ?? "", pointage: "fait" }));

    // Then le plan est soldé, et le dossier devient clôturable : « déjà présent »
    // vaut réussite, c'est le cas nominal quand quelqu'un est passé avant.
    expect(plan.state).toBe("EXECUTED");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toEqual({
      possible: true,
    });
  });

  it("refuse « déjà présent » sur un départ, et exige une raison à ce qui est écarté", async () => {
    // Given un départ confirmé, dont l'unique étape attend
    base.identites.push({
      personId: PERSONNE,
      provider: "notion",
      matchMethod: "DECLARED",
      vanishedAt: null,
    });
    const { plan } = await dossierAvecPlan("OFFBOARDING");
    await confirmerPlan(null, formulaire({ planId: plan.id }));
    const etape = base.etapes[0];

    // When on propose le constat de l'arrivée
    const contresens = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "deja-present" }),
    );

    // Then il est refusé : « déjà présent » sous une étape de retrait dirait le
    // contraire de ce que le dossier prépare.
    expect(contresens.erreur).toBe("Ce constat ne vaut pas dans le sens de ce dossier.");
    expect(etape?.state).toBe("PENDING");

    // When on écarte l'étape sans dire pourquoi
    const muette = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "ignoree", note: "" }),
    );

    // Then le refus le dit : sans raison, une étape écartée devient un accès oublié
    expect(muette.erreur).toContain("Dites pourquoi");
    expect(etape?.state).toBe("PENDING");

    // When on constate que l'accès n'existait déjà plus
    const constat = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "deja-absent" }),
    );

    // Then l'étape est soldée dans les mots du départ, et le plan avec elle
    expect(constat.erreur).toBeUndefined();
    expect(etape?.state).toBe("ALREADY_ABSENT");
    expect(plan.state).toBe("EXECUTED");
    expect(base.journal.at(-1)?.after).toMatchObject({
      sens: "OFFBOARDING",
      etat: "ALREADY_ABSENT",
    });
  });
});
