import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { notion } from "@/connectors/notion";
import type { Connector, Intent } from "@/core/connector";
import type {
  Acteur,
  EtatDossier,
  EtatEtape,
  EtatPlan,
  EtatValidation,
  SensDossier,
} from "@/core/dossier";
import { peutClore } from "@/core/dossier";
import { calculerPlan, enregistrerPlan } from "@/lib/dossier";

import { cloreDossier, confirmerPlan, pointerEtape, validerEtape } from "./actions";

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
  template: unknown;
  reponse: string | null;
  attempts: number;
  expectedActor: Acteur;
  validationBy: Acteur | null;
  validation: EtatValidation;
  declaredBy: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
  validationNote: string | null;
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
  actorUsername: string | null;
  result: string;
  before: unknown;
  after: unknown;
}

const base = vi.hoisted(() => ({
  /** Qui est devant l'écran. Mutable : le contrôle d'une déclaration demande un autre nom. */
  operateur: "operatrice.exemple",
  identites: [] as IdentiteEnBase[],
  dossiers: [] as DossierEnBase[],
  plans: [] as PlanEnBase[],
  etapes: [] as EtapeEnBase[],
  journal: [] as TraceEnBase[],
  /** L'ordre réel des écritures, pour dire si la trace a bien précédé l'action. */
  gestes: [] as string[],
  /**
   * Ce qui s'intercale entre la lecture d'une étape et son écriture, une seule fois.
   * C'est la seule façon de jouer deux validations simultanées sur un faux dépôt
   * séquentiel : sans ce point, chacune verrait toujours ce que l'autre a déjà écrit.
   */
  pendantLEcritureDeLEtape: null as (() => Promise<void>) | null,
  connecteurs: [] as Connector[],
  modeles: [] as {
    ownerKey: string;
    kind: string;
    startupsMayExtend: boolean;
    steps: readonly Record<string, unknown>[];
  }[],
}));

vi.mock("@/connectors", () => ({ CONNECTEURS: base.connecteurs }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () => Promise.resolve({ username: base.operateur, email: null, nom: null }),
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

/**
 * Une lecture rend des copies et non les lignes elles-mêmes, comme le ferait une vraie
 * base : sans cela, ce qu'une action a lu changerait sous ses pieds dès qu'une autre
 * écrit, et aucune course ne serait jouable ici.
 */
function planComplet(plan: PlanEnBase) {
  return {
    ...plan,
    accessCase: dossierDuPlan(plan),
    steps: base.etapes.filter((etape) => etape.planId === plan.id).map((etape) => ({ ...etape })),
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
          steps: {
            create: readonly {
              systemKey: string;
              label: string;
              ordre: number;
              template?: unknown;
              expectedActor?: Acteur;
              validationBy?: Acteur;
            }[];
          };
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
            template: etape.template ?? null,
            reponse: null,
            attempts: 0,
            // Les défauts de la colonne, et non ceux du test : une étape muette est
            // « à faire par l'opérateur, sans contrôle », ce qu'elle a toujours été.
            expectedActor: etape.expectedActor ?? "OPERATOR",
            validationBy: etape.validationBy ?? null,
            validation: "NONE",
            declaredBy: null,
            validatedBy: null,
            validatedAt: null,
            validationNote: null,
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
      // Deux formes, la confirmation et la repose de l'état : toutes deux
      // conditionnées sur l'état lu, la première ajoutant la vivacité du dossier.
      updateMany: ({
        where,
        data,
      }: {
        where: {
          id: string;
          state: EtatPlan;
          accessCase?: { state: { in: readonly string[] } };
        };
        data: { state: EtatPlan; confirmedDigest?: string; confirmedBy?: string };
      }) => {
        const plan = base.plans.find(
          (candidat) => candidat.id === where.id && candidat.state === where.state,
        );
        const dossier = plan && dossierDuPlan(plan);

        if (!plan || !dossier) {
          return Promise.resolve({ count: 0 });
        }
        if (where.accessCase && !where.accessCase.state.in.includes(dossier.state)) {
          return Promise.resolve({ count: 0 });
        }

        base.gestes.push(`plan:${data.state}`);
        plan.state = data.state;
        plan.confirmedDigest = data.confirmedDigest ?? plan.confirmedDigest;
        plan.confirmedBy = data.confirmedBy ?? plan.confirmedBy;
        return Promise.resolve({ count: 1 });
      },
    },
    person: {
      findUnique: () => Promise.resolve({ startups: [], startupAssignments: [] }),
    },
    accessCase: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const dossier = base.dossiers.find((candidat) => candidat.id === where.id);
        if (!dossier) {
          return Promise.resolve(null);
        }

        // Le dernier plan écrit, celui que `orderBy createdAt desc` puis `take: 1`
        // ramène : les plans se poussent dans l'ordre où ils sont enregistrés.
        const dernier = base.plans.filter((plan) => plan.accessCaseId === dossier.id).at(-1);

        return Promise.resolve({
          id: dossier.id,
          kind: dossier.kind,
          state: dossier.state,
          person: { username: USERNAME },
          plans: dernier
            ? [
                {
                  id: dernier.id,
                  state: dernier.state,
                  _count: {
                    steps: base.etapes.filter((etape) => etape.planId === dernier.id).length,
                  },
                },
              ]
            : [],
        });
      },
      update: ({ where, data }: { where: { id: string }; data: { state: EtatDossier } }) => {
        const dossier = base.dossiers.find((candidat) => candidat.id === where.id);
        if (dossier) {
          base.gestes.push(`dossier:${data.state}`);
          dossier.state = data.state;
        }
        return Promise.resolve(dossier);
      },
    },
    planTemplate: {
      findMany: () => Promise.resolve(base.modeles),
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
        data: {
          state: EtatEtape;
          lastError?: string;
          reponse?: string | null;
          attempts?: { increment: number };
          declaredBy?: string;
          validation?: EtatValidation;
          validatedBy?: string | null;
          validatedAt?: Date | null;
          validationNote?: string | null;
        };
      }) => {
        const etape = base.etapes.find((candidat) => candidat.id === where.id);
        if (etape) {
          base.gestes.push(`etape:${data.state}`);
          etape.state = data.state;
          etape.lastError = data.lastError ?? etape.lastError;
          etape.attempts += data.attempts?.increment ?? 0;
          // Une colonne absente du `data` se tait, une colonne à `null` efface : c'est
          // ce que fait Prisma, et c'est ce qui se joue quand un pointage se corrige.
          if ("reponse" in data) {
            etape.reponse = data.reponse ?? null;
          }
          if (data.declaredBy !== undefined) {
            etape.declaredBy = data.declaredBy;
          }
          if (data.validation !== undefined) {
            etape.validation = data.validation;
          }
          if ("validatedBy" in data) {
            etape.validatedBy = data.validatedBy ?? null;
          }
          if ("validatedAt" in data) {
            etape.validatedAt = data.validatedAt ?? null;
          }
          if ("validationNote" in data) {
            etape.validationNote = data.validationNote ?? null;
          }
        }
        return Promise.resolve(etape);
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          validation: EtatValidation;
          state: EtatEtape;
          declaredBy: string | null;
        };
        data: {
          validation: EtatValidation;
          state: EtatEtape;
          validatedBy: string;
          validatedAt: Date;
          validationNote: string | null;
        };
      }) => {
        const pendant = base.pendantLEcritureDeLEtape;
        base.pendantLEcritureDeLEtape = null;
        await pendant?.();

        const etape = base.etapes.find(
          (candidat) =>
            candidat.id === where.id &&
            candidat.validation === where.validation &&
            candidat.state === where.state &&
            candidat.declaredBy === where.declaredBy,
        );

        if (!etape) {
          return Promise.resolve({ count: 0 });
        }

        base.gestes.push(`etape:${data.state}:${data.validation}`);
        etape.validation = data.validation;
        etape.state = data.state;
        etape.validatedBy = data.validatedBy;
        etape.validatedAt = data.validatedAt;
        etape.validationNote = data.validationNote;
        return Promise.resolve({ count: 1 });
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
  base.operateur = "operatrice.exemple";
  base.identites.length = 0;
  base.dossiers.length = 0;
  base.plans.length = 0;
  base.etapes.length = 0;
  base.journal.length = 0;
  base.gestes.length = 0;
  base.pendantLEcritureDeLEtape = null;
  base.modeles.length = 0;
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

/**
 * Une étape déclarée peut réclamer une valeur, et c'est tout ce qui la distingue à
 * l'écran d'une case à cocher. La consigner sans cette valeur ferait dire au journal
 * qu'un geste a été fait sans dire lequel, ce que le critère de complétion existe
 * précisément pour empêcher.
 */
describe("pointer une étape qui réclame une valeur", () => {
  it("refuse « fait » sans la valeur, sans rien écrire, et la consigne quand elle vient", async () => {
    // Given un plan d'arrivée qui porte une étape déclarée par l'incubateur, avec
    // une saisie obligatoire
    base.modeles.push({
      ownerKey: "*incubateur",
      kind: "ONBOARDING",
      startupsMayExtend: false,
      steps: [
        {
          key: "signer-la-charte",
          position: 0,
          title: "Signer la charte",
          runbook: null,
          deeplink: null,
          doneWhen: "La charte signée est au dossier.",
          input: { libelle: "Date de signature", obligatoire: true },
          riskLevel: "LOW",
        },
      ],
    });

    const { plan } = await dossierAvecPlan("ONBOARDING");
    plan.state = "EXECUTING";
    const etape = base.etapes.find((candidat) => candidat.systemKey === "modele");
    expect(etape?.label).toBe("Signer la charte");

    // When on la déclare faite sans rien renseigner
    const muette = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "fait" }),
    );

    // Then le refus nomme ce qu'on attend, et rien n'a bougé : ni l'étape, ni le
    // journal, le refus se jouant avant que la trace ne soit posée
    expect(muette.erreur).toContain("Date de signature");
    expect(etape?.state).toBe("PENDING");
    expect(etape?.reponse).toBeNull();
    expect(base.journal).toHaveLength(0);

    // When la valeur vient
    const pointee = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "fait", reponse: "24 août 2026" }),
    );

    // Then l'étape est soldée, la valeur est en base, et la trace la porte : le
    // journal doit pouvoir redire dans deux ans ce qui a été déclaré
    expect(pointee.erreur).toBeUndefined();
    expect(etape?.state).toBe("SUCCEEDED");
    expect(etape?.reponse).toBe("24 août 2026");
    expect(base.journal.at(-1)?.after).toMatchObject({
      sens: "ONBOARDING",
      etat: "SUCCEEDED",
      reponse: "24 août 2026",
    });

    // Then la trace a précédé l'écriture, comme pour tout geste de cet outil
    expect(base.gestes[0]).toBe("journal:dossier.pointage:SUCCESS");

    // When l'opératrice se reprend et écarte finalement l'étape
    const corrigee = await pointerEtape(
      null,
      formulaire({
        etapeId: etape?.id ?? "",
        pointage: "ignoree",
        note: "La charte a été signée avant l'arrivée.",
      }),
    );

    // Then la valeur saisie disparaît avec le « fait » qu'elle documentait : la garder
    // afficherait une date de signature sous une étape que personne n'a faite.
    expect(corrigee.erreur).toBeUndefined();
    expect(etape?.state).toBe("SKIPPED");
    expect(etape?.reponse).toBeNull();
    expect(base.journal.at(-1)?.after).toMatchObject({
      etat: "SKIPPED",
      note: "La charte a été signée avant l'arrivée.",
    });
    expect(base.journal.at(-1)?.after).not.toHaveProperty("reponse");
  });

  it("tient le constat pour un aveu que le geste a eu lieu, et lui réclame la même valeur", async () => {
    // Given le même plan d'arrivée, porteur d'une étape à saisie obligatoire
    base.modeles.push({
      ownerKey: "*incubateur",
      kind: "ONBOARDING",
      startupsMayExtend: false,
      steps: [
        {
          key: "signer-la-charte",
          position: 0,
          title: "Signer la charte",
          runbook: null,
          deeplink: null,
          doneWhen: "La charte signée est au dossier.",
          input: { libelle: "Date de signature", obligatoire: true },
          riskLevel: "LOW",
        },
      ],
    });

    const { plan } = await dossierAvecPlan("ONBOARDING");
    plan.state = "EXECUTING";
    const etape = base.etapes.find((candidat) => candidat.systemKey === "modele");

    // When on constate que quelqu'un est passé avant, sans rien renseigner
    const muet = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "deja-present" }),
    );

    // Then le refus est celui de « c'est fait » : le constat solde l'étape autant que
    // lui, il ne peut donc pas se dispenser de ce que lui doit fournir
    expect(muet.erreur).toContain("Date de signature");
    expect(etape?.state).toBe("PENDING");
    expect(etape?.reponse).toBeNull();

    // When la valeur vient avec le constat
    const constate = await pointerEtape(
      null,
      formulaire({
        etapeId: etape?.id ?? "",
        pointage: "deja-present",
        reponse: "12 mars 2026, avant son arrivée",
      }),
    );

    // Then l'étape est soldée en constat, et la valeur y reste
    expect(constate.erreur).toBeUndefined();
    expect(etape?.state).toBe("ALREADY_PRESENT");
    expect(etape?.reponse).toBe("12 mars 2026, avant son arrivée");

    // When l'opératrice se reprend et déclare l'échec
    const echec = await pointerEtape(
      null,
      formulaire({
        etapeId: etape?.id ?? "",
        pointage: "echec",
        note: "La charte n'a jamais été signée.",
      }),
    );

    // Then la valeur s'efface avec le constat qu'elle documentait : elle ne survit
    // qu'aux pointages qui affirment que le geste a eu lieu
    expect(echec.erreur).toBeUndefined();
    expect(etape?.state).toBe("FAILED");
    expect(etape?.reponse).toBeNull();
  });

  it("laisse une étape de connecteur se pointer sans rien réclamer", async () => {
    // Given un plan dont les étapes viennent des connecteurs, sans origine déclarée
    const { plan } = await dossierAvecPlan("ONBOARDING");
    plan.state = "EXECUTING";
    const etape = base.etapes[0];
    expect(etape?.template).toBeNull();

    // When on la déclare faite, sans valeur
    const pointee = await pointerEtape(
      null,
      formulaire({ etapeId: etape?.id ?? "", pointage: "fait" }),
    );

    // Then rien ne s'y oppose, et aucune réponse n'est inventée
    expect(pointee.erreur).toBeUndefined();
    expect(etape?.state).toBe("SUCCEEDED");
    expect(etape?.reponse).toBeNull();
  });
});

/**
 * Un connecteur qui confie ses gestes à qui on lui dit, et les fait contrôler par qui
 * on lui dit. Aucun connecteur du dépôt ne nomme encore d'acteur : sans celui-ci, la
 * validation n'aurait rien sur quoi se jouer.
 */
function connecteurQuiRepartit(
  ...repartitions: readonly { acteur?: Acteur; valideur?: Acteur }[]
): Connector {
  return {
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

      return Promise.resolve(
        repartitions.map((repartition, rang) => ({
          systemKey: "atelier",
          capability: "grant" as const,
          tier: "manual" as const,
          action: "inviter",
          label: `Geste n°${rang + 1} de l'atelier`,
          params: { rang },
          riskLevel: "low" as const,
          expectedState: {},
          idempotencyKey: `atelier:${rang}:grant:${USERNAME}`,
          ...(repartition.acteur ? { expectedActor: repartition.acteur } : {}),
          ...(repartition.valideur ? { validationBy: repartition.valideur } : {}),
        })),
      );
    },
  };
}

function etapeEnBase(rang: number): EtapeEnBase {
  const etape = base.etapes[rang];
  if (!etape) {
    throw new Error(`aucune étape au rang ${rang}`);
  }
  return etape;
}

/** Une arrivée confirmée, dont les gestes se répartissent comme on le demande. */
async function arriveeRepartie(
  ...repartitions: readonly { acteur?: Acteur; valideur?: Acteur }[]
): Promise<{ dossier: DossierEnBase; plan: PlanEnBase }> {
  base.connecteurs.length = 0;
  base.connecteurs.push(connecteurQuiRepartit(...repartitions));

  const ouvert = await dossierAvecPlan("ONBOARDING");
  await confirmerPlan(null, formulaire({ planId: ouvert.plan.id }));
  return ouvert;
}

/**
 * Deux dimensions orthogonales : l'état dit ce qui a été déclaré, la validation dit où
 * en est le contrôle de cette déclaration. Une case « j'ai signé la charte » se croit
 * sur parole, un « j'ai retiré l'accès administrateur » ne se croit pas.
 */
describe("le contrôle d'une déclaration, étape par étape", () => {
  it("suit une étape confiée à la personne concernée jusqu'au bout, refus compris", async () => {
    // Given une arrivée dont un geste revient à la personne concernée sous le regard
    // d'un opérateur, et dont un autre se croit sur parole
    const { dossier, plan } = await arriveeRepartie(
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      { acteur: "SUBJECT" },
    );
    const controlee = etapeEnBase(0);
    const surParole = etapeEnBase(1);

    // When la personne concernée, opératrice de surcroît, pointe les deux
    base.operateur = USERNAME;
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));
    await pointerEtape(null, formulaire({ etapeId: surParole.id, pointage: "fait" }));

    // Then celle qui se croit sur parole est soldée sans que personne n'ait à parler :
    // la validation reste à « aucune » tant qu'aucun contrôle n'est attendu.
    expect(surParole.validation).toBe("NONE");
    expect(surParole.validatedBy).toBeNull();

    // Then l'autre attend un second regard, et porte le nom de qui a déclaré : c'est
    // sur le username que « personne ne valide sa propre déclaration » se comparera.
    expect(controlee.state).toBe("SUCCEEDED");
    expect(controlee.validation).toBe("AWAITING");
    expect(controlee.declaredBy).toBe(USERNAME);

    // Then le plan ne se dit pas exécuté pour autant : tout est coché, et quelque
    // chose bouge encore. Le dossier ne se clôt donc pas.
    expect(plan.state).toBe("EXECUTING");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toMatchObject({
      possible: false,
    });

    // When l'opératrice refuse sans dire ce qui manque
    base.operateur = "operatrice.exemple";
    const muet = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "refuser" }),
    );

    // Then le refus du refus : sans motif, l'étape repartirait à faire sans dire quoi
    expect(muet.erreur).toContain("Dites ce qui manque");
    expect(controlee.validation).toBe("AWAITING");

    // When elle refuse en le disant
    const refus = await validerEtape(
      null,
      formulaire({
        etapeId: controlee.id,
        verdict: "refuser",
        note: "La capture ne montre pas le compte.",
      }),
    );

    // Then l'étape redevient à faire, et jamais en échec : « échoué » dirait que le
    // geste a été tenté et que l'accès est resté ce qu'il était, un refus dit
    // seulement que la preuve n'est pas faite.
    expect(refus.erreur).toBeUndefined();
    expect(controlee.state).toBe("PENDING");
    expect(controlee.validation).toBe("REFUSED");
    expect(controlee.validationNote).toBe("La capture ne montre pas le compte.");
    expect(controlee.validatedBy).toBe("operatrice.exemple");

    // Then il ne compte pas pour une tentative : `attempts` mesure les gestes de
    // l'acteur, pas les avis du contrôleur.
    expect(controlee.attempts).toBe(1);

    // Then il se journalise en succès, ce champ disant si l'action a eu lieu et non
    // quel avis elle portait, et la trace précède l'écriture.
    expect(base.journal.at(-1)).toMatchObject({ action: "dossier.validation", result: "SUCCESS" });
    expect(base.gestes.slice(-3)).toEqual([
      "journal:dossier.validation:SUCCESS",
      "etape:PENDING:REFUSED",
      "plan:EXECUTING",
    ]);

    // Then un second clic sur le même formulaire ne repasse pas : l'écriture est
    // conditionnée sur la déclaration qui a été lue, si bien qu'une course ne tranche
    // pas deux fois la même parole.
    const rejoue = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );
    expect(rejoue.erreur).toBe("Cette étape n'attend aucune validation.");
    expect(controlee.validation).toBe("REFUSED");

    // When la personne refait le geste et le repointe
    base.operateur = USERNAME;
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));

    // Then l'avis d'hier ne reste pas affiché sous le geste d'aujourd'hui, et la
    // seconde tentative se compte, elle.
    expect(controlee.validation).toBe("AWAITING");
    expect(controlee.validationNote).toBeNull();
    expect(controlee.validatedBy).toBeNull();
    expect(controlee.attempts).toBe(2);

    // When l'opératrice accepte
    base.operateur = "operatrice.exemple";
    const accepte = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );

    // Then plus rien n'attend : le plan est exécuté et le dossier se clôt
    expect(accepte.erreur).toBeUndefined();
    expect(controlee.validation).toBe("ACCEPTED");
    expect(controlee.validatedBy).toBe("operatrice.exemple");
    expect(plan.state).toBe("EXECUTED");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toEqual({
      possible: true,
    });
  });

  it("n'attend aucun contrôle sur un geste que personne n'affirme avoir fait", async () => {
    // Given deux gestes confiés à la personne concernée sous le regard d'un opérateur
    const { plan } = await arriveeRepartie(
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      { acteur: "SUBJECT", valideur: "OPERATOR" },
    );
    const ecartee = etapeEnBase(0);
    const tentee = etapeEnBase(1);
    base.operateur = USERNAME;

    // When le premier est déclaré impossible, et le second tenté sans aboutir
    await pointerEtape(
      null,
      formulaire({ etapeId: ecartee.id, pointage: "ignoree", note: "L'outil a été résilié." }),
    );
    await pointerEtape(
      null,
      formulaire({ etapeId: tentee.id, pointage: "echec", note: "La console a refusé." }),
    );

    // Then ni l'un ni l'autre n'attend un second regard : contrôler la parole de
    // quelqu'un qui n'affirme rien n'aurait pas d'objet, et l'attente empêcherait la
    // clôture au nom d'une preuve qui n'a rien à prouver.
    expect(ecartee.state).toBe("SKIPPED");
    expect(ecartee.validation).toBe("NONE");
    expect(tentee.state).toBe("FAILED");
    expect(tentee.validation).toBe("NONE");

    // When celui qui a échoué est repris et déclaré fait
    await pointerEtape(null, formulaire({ etapeId: tentee.id, pointage: "fait" }));

    // Then le contrôle commence à ce moment-là, et pas avant
    expect(tentee.state).toBe("SUCCEEDED");
    expect(tentee.validation).toBe("AWAITING");
    expect(tentee.declaredBy).toBe(USERNAME);

    // Then le plan attend ce regard, et rien d'autre
    expect(plan.state).toBe("EXECUTING");
  });

  it("refuse à chacun de valider sa propre déclaration, sans bloquer le dossier", async () => {
    // Given une arrivée dont le geste revient à la personne concernée sous le regard
    // d'un délégué, et qu'aucun délégué n'existe encore
    const { plan } = await arriveeRepartie({ acteur: "SUBJECT", valideur: "DELEGATE" });
    const etape = etapeEnBase(0);

    // When une opératrice pointe à la place de la personne, en substitution
    await pointerEtape(null, formulaire({ etapeId: etape.id, pointage: "fait" }));

    // Then l'étape attend : celle qui a déclaré n'est pas celle qu'on attendait
    expect(etape.validation).toBe("AWAITING");
    expect(etape.declaredBy).toBe("operatrice.exemple");

    // When elle tente de valider ce qu'elle vient de déclarer
    const soi = await validerEtape(null, formulaire({ etapeId: etape.id, verdict: "accepter" }));

    // Then refusé sur le nom et non sur le rôle : sans `declaredBy`, la règle serait
    // déclarative et fausse, un opérateur pouvant pointer puis valider la même étape.
    expect(soi.erreur).toContain("Personne ne valide sa propre déclaration");
    expect(etape.validation).toBe("AWAITING");

    // When la personne concernée, opératrice elle aussi, tente de valider son dossier
    base.operateur = USERNAME;
    const porteuse = await validerEtape(
      null,
      formulaire({ etapeId: etape.id, verdict: "accepter" }),
    );

    // Then refusé : le porteur passe avant l'opérateur, sans quoi quelqu'un
    // instruirait son propre dossier et validerait ses propres cases.
    expect(porteuse.erreur).toContain("La personne concernée ne contrôle pas");

    // When un second opérateur regarde
    base.operateur = "autre.exemple";
    const tiers = await validerEtape(null, formulaire({ etapeId: etape.id, verdict: "accepter" }));

    // Then un opérateur fait ce qu'un délégué aurait dû faire, et l'inverse ne serait
    // pas vrai : le contraire coincerait le dossier dès que le délégué s'évapore.
    expect(tiers.erreur).toBeUndefined();
    expect(etape.validation).toBe("ACCEPTED");
    expect(etape.validatedBy).toBe("autre.exemple");
    expect(plan.state).toBe("EXECUTED");
  });

  it("fait relire par un second opérateur le geste qu'un opérateur déclare", async () => {
    // Given une arrivée dont un geste revient à l'opérateur sous le regard d'un
    // opérateur, l'exemple qui a fait naître tout ceci : « j'ai retiré l'accès
    // administrateur » est un geste d'opérateur, et c'est justement celui qui ne se
    // croit pas sur parole. À côté, un geste d'opérateur ordinaire.
    const { dossier, plan } = await arriveeRepartie(
      { acteur: "OPERATOR", valideur: "OPERATOR" },
      {},
    );
    const controlee = etapeEnBase(0);
    const ordinaire = etapeEnBase(1);

    // When la personne concernée tente de pointer ce qui ne lui revient pas
    base.operateur = USERNAME;
    const porteuse = await pointerEtape(
      null,
      formulaire({ etapeId: controlee.id, pointage: "fait" }),
    );

    // Then refusé : la répartition n'ouvre rien de nouveau au porteur, le geste reste
    // celui de l'équipe transverse.
    expect(porteuse.erreur).toContain("Cette étape ne vous revient pas");
    expect(controlee.validation).toBe("NONE");

    // When une opératrice pointe les deux
    base.operateur = "operatrice.exemple";
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));
    await pointerEtape(null, formulaire({ etapeId: ordinaire.id, pointage: "fait" }));

    // Then celui qui se croit sur parole est soldé, l'autre attend : elle a fait le
    // geste, elle ne l'a pas contrôlé. Porter le rôle qui contrôle ne suffit pas quand
    // c'est son propre geste, sans quoi la répartition ne demanderait jamais rien.
    expect(ordinaire.validation).toBe("NONE");
    expect(controlee.state).toBe("SUCCEEDED");
    expect(controlee.validation).toBe("AWAITING");
    expect(controlee.declaredBy).toBe("operatrice.exemple");
    expect(controlee.validatedBy).toBeNull();

    // Then le plan reste en cours et le dossier ne se clôt pas : un accès
    // d'administration déclaré retiré et que personne n'a revu n'est qu'une parole.
    expect(plan.state).toBe("EXECUTING");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toMatchObject({
      possible: false,
    });

    // When elle tente de contrôler ce qu'elle vient de déclarer
    const soi = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );

    // Then refusé sur le nom : c'est cette règle, et elle seule, qui rend la
    // répartition tenable entre deux personnes du même rôle.
    expect(soi.erreur).toContain("Personne ne valide sa propre déclaration");
    expect(controlee.validation).toBe("AWAITING");

    // When un second opérateur regarde
    base.operateur = "autre.exemple";
    const tiers = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );

    // Then la preuve est faite, le plan est exécuté et le dossier se clôt
    expect(tiers.erreur).toBeUndefined();
    expect(controlee.validation).toBe("ACCEPTED");
    expect(controlee.validatedBy).toBe("autre.exemple");
    expect(plan.state).toBe("EXECUTED");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toEqual({
      possible: true,
    });
  });

  it("ne pose pas un état faux quand deux validations tombent en même temps", async () => {
    // Given une arrivée dont les deux gestes reviennent à la personne concernée sous
    // le regard d'un opérateur, tous deux déclarés faits et en attente
    const { dossier, plan } = await arriveeRepartie(
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      { acteur: "SUBJECT", valideur: "OPERATOR" },
    );
    const premiere = etapeEnBase(0);
    const seconde = etapeEnBase(1);

    base.operateur = USERNAME;
    await pointerEtape(null, formulaire({ etapeId: premiere.id, pointage: "fait" }));
    await pointerEtape(null, formulaire({ etapeId: seconde.id, pointage: "fait" }));
    expect(plan.state).toBe("EXECUTING");

    // When deux opérateurs valident les deux étapes en même temps : le second
    // s'intercale entre la lecture du premier et son écriture, si bien que chacun
    // calcule sur un plan où l'étape de l'autre attend encore
    base.operateur = "operatrice.exemple";
    base.pendantLEcritureDeLEtape = async () => {
      base.operateur = "autre.exemple";
      await validerEtape(null, formulaire({ etapeId: seconde.id, verdict: "accepter" }));
      base.operateur = "operatrice.exemple";
    };

    const premier = await validerEtape(
      null,
      formulaire({ etapeId: premiere.id, verdict: "accepter" }),
    );

    // Then les deux validations sont passées, chacune signée de son contrôleur
    expect(premier.erreur).toBeUndefined();
    expect(premiere.validation).toBe("ACCEPTED");
    expect(premiere.validatedBy).toBe("operatrice.exemple");
    expect(seconde.validation).toBe("ACCEPTED");
    expect(seconde.validatedBy).toBe("autre.exemple");

    // Then l'état du plan dit ce que ses étapes disent, et non ce que l'un des deux
    // calculs avait sous les yeux : la relecture suit l'écriture, et l'écriture est
    // conditionnée sur l'état relu. Sans cela, le dernier arrivé posait « en cours »
    // sur un plan dont plus rien n'attend, et le dossier ne se serait jamais clos.
    expect(plan.state).toBe("EXECUTED");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toEqual({
      possible: true,
    });

    // Then le point d'entrelacement a bien servi une fois, et une seule
    expect(base.pendantLEcritureDeLEtape).toBeNull();
  });

  it("tient pour validé ce que le contrôleur attendu pointe lui-même", async () => {
    // Given une arrivée dont le geste revient à la personne concernée sous le regard
    // d'un opérateur, et dont un second geste reste à faire
    const { plan } = await arriveeRepartie({ acteur: "SUBJECT", valideur: "OPERATOR" }, {});
    const etape = etapeEnBase(0);

    // When l'opératrice le pointe en substitution : elle est justement le regard
    // qu'on attendait
    const pointee = await pointerEtape(null, formulaire({ etapeId: etape.id, pointage: "fait" }));

    // Then la validation est acquise du même coup, et signée : exiger qu'un second
    // opérateur confirme bloquerait un outil à un seul mainteneur, qui est le cas
    // nominal ici.
    expect(pointee.erreur).toBeUndefined();
    expect(etape.validation).toBe("ACCEPTED");
    expect(etape.declaredBy).toBe("operatrice.exemple");
    expect(etape.validatedBy).toBe("operatrice.exemple");

    // Then le plan reste en cours, l'autre geste n'ayant pas été fait : rien n'attend
    // plus sur celui-ci, ce qui n'est pas la même chose que tout avoir soldé.
    expect(plan.state).toBe("EXECUTING");

    // Then le journal du pointage dit les deux dimensions, et non le seul état
    expect(base.journal.at(-1)?.after).toMatchObject({
      etat: "SUCCEEDED",
      validation: "ACCEPTED",
    });

    // Then il n'y a plus rien à contrôler, et le dire est le refus
    const rien = await validerEtape(null, formulaire({ etapeId: etape.id, verdict: "accepter" }));
    expect(rien.erreur).toBe("Cette étape n'attend aucune validation.");

    // Then un verdict que personne ne connaît ne touche à rien
    const inconnu = await validerEtape(
      null,
      formulaire({ etapeId: etape.id, verdict: "peut-etre" }),
    );
    expect(inconnu.erreur).toBe("Verdict inconnu.");
  });
});

/**
 * Un dossier clos affirme que l'affaire est réglée. Tant qu'une déclaration attend
 * d'être contrôlée, l'affaire ne l'est pas : elle ne repose que sur une parole que
 * personne n'a vérifiée, et c'est exactement ce qu'un dossier ne peut pas taire.
 */
describe("la clôture d'un dossier, quand tout est coché mais que quelqu'un attend", () => {
  it("ne clôt que lorsque plus rien n'attend, et laisse le geste de l'opérateur à l'opérateur", async () => {
    // Given une arrivée dont un geste revient à la personne concernée sous le regard
    // d'un opérateur, et dont l'autre revient à l'opérateur seul
    const { dossier, plan } = await arriveeRepartie(
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      {},
    );
    const controlee = etapeEnBase(0);
    const parLOperateur = etapeEnBase(1);

    // When la personne concernée, opératrice de surcroît, tente le geste qui ne lui
    // revient pas
    base.operateur = USERNAME;
    const usurpe = await pointerEtape(
      null,
      formulaire({ etapeId: parLOperateur.id, pointage: "fait" }),
    );

    // Then refusé, et rien n'a été écrit : le porteur passe avant l'opérateur, sans
    // quoi quelqu'un instruirait son propre dossier de bout en bout.
    expect(usurpe.erreur).toContain("Cette étape ne vous revient pas");
    expect(parLOperateur.state).toBe("PENDING");

    // When chacun pointe ce qui lui revient
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));
    base.operateur = "operatrice.exemple";
    await pointerEtape(null, formulaire({ etapeId: parLOperateur.id, pointage: "fait" }));

    // Then toutes les étapes sont pointées, et le plan ne se déclare pas exécuté pour
    // autant : une déclaration attend encore un second regard.
    expect(base.etapes.map((etape) => etape.state)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    expect(controlee.validation).toBe("AWAITING");
    expect(parLOperateur.validation).toBe("NONE");
    expect(plan.state).toBe("EXECUTING");

    // When on tente de clore le dossier
    const trop = await cloreDossier(null, formulaire({ dossierId: dossier.id }));

    // Then refus, et rien n'a bougé : ni le dossier, ni le journal, qui raconte des
    // gestes et non des tentatives refusées avant d'atteindre la base.
    expect(trop.erreur).toBe(
      "Toutes les étapes ne sont pas soldées : des accès n'ont pas été donnés.",
    );
    expect(dossier.state).toBe("CONFIRMED");
    expect(base.journal.map((trace) => trace.action)).not.toContain("dossier.cloture");

    // When l'opératrice porte le second regard
    const accepte = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );

    // Then plus rien n'attend, et le dossier se clôt
    expect(accepte.erreur).toBeUndefined();
    expect(plan.state).toBe("EXECUTED");

    const close = await cloreDossier(null, formulaire({ dossierId: dossier.id }));
    expect(close.erreur).toBeUndefined();
    expect(dossier.state).toBe("DONE");

    // Then la trace de la clôture porte le nom de qui l'a faite, et précède l'écriture
    expect(base.journal.at(-1)).toMatchObject({
      action: "dossier.cloture",
      actorUsername: "operatrice.exemple",
      result: "SUCCESS",
    });
    expect(base.gestes.slice(-2)).toEqual(["journal:dossier.cloture:SUCCESS", "dossier:DONE"]);
  });
});

/**
 * Deux gestes humains distincts, donc deux traces distinctes : le journal doit pouvoir
 * redire dans deux ans qui a déclaré et qui a contrôlé. Les confondre ferait
 * disparaître la signature qui donne sa valeur au second regard.
 */
describe("ce que le journal garde d'une déclaration et de son contrôle", () => {
  it("écrit deux traces nominatives, chacune avant l'écriture qu'elle documente", async () => {
    // Given une arrivée dont le geste revient à la personne concernée sous le regard
    // d'un opérateur, et un journal remis à zéro après la confirmation
    const { plan } = await arriveeRepartie({ acteur: "SUBJECT", valideur: "OPERATOR" });
    const etape = etapeEnBase(0);
    base.journal.length = 0;
    base.gestes.length = 0;

    // When la personne concernée déclare le geste fait
    base.operateur = USERNAME;
    await pointerEtape(null, formulaire({ etapeId: etape.id, pointage: "fait" }));

    // When un opérateur, qui n'est pas elle, porte le second regard
    base.operateur = "autre.exemple";
    await validerEtape(
      null,
      formulaire({ etapeId: etape.id, verdict: "accepter", note: "Le compte apparaît bien." }),
    );

    // Then deux traces, deux verbes, deux noms : ni le pointage ni la validation ne
    // s'écrit sous le nom de l'autre.
    expect(base.journal.map((trace) => trace.action)).toEqual([
      "dossier.pointage",
      "dossier.validation",
    ]);
    expect(base.journal.map((trace) => trace.actorUsername)).toEqual([USERNAME, "autre.exemple"]);
    expect(base.journal.every((trace) => trace.result === "SUCCESS")).toBe(true);

    // Then chacune dit les deux dimensions de l'étape, avant et après, et celle du
    // contrôle nomme de qui est la parole qu'elle juge.
    expect(base.journal[0]).toMatchObject({
      before: { etat: "PENDING", validation: "NONE" },
      after: { etat: "SUCCEEDED", validation: "AWAITING" },
    });
    expect(base.journal[1]).toMatchObject({
      before: { etat: "SUCCEEDED", validation: "AWAITING", declarePar: USERNAME },
      after: { etat: "SUCCEEDED", validation: "ACCEPTED", note: "Le compte apparaît bien." },
    });

    // Then chaque trace précède l'écriture qu'elle documente : une panne du journal ne
    // doit jamais faire échouer l'action, l'inverse n'étant pas vrai.
    expect(base.gestes).toEqual([
      "journal:dossier.pointage:SUCCESS",
      "etape:SUCCEEDED",
      "plan:EXECUTING",
      "journal:dossier.validation:SUCCESS",
      "etape:SUCCEEDED:ACCEPTED",
      "plan:EXECUTED",
    ]);
    expect(plan.state).toBe("EXECUTED");
  });
});
