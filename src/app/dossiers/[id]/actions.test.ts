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
  /**
   * Nul quand le dossier a disparu : `Plan.accessCase` est en `SetNull`, donc
   * supprimer une fiche laisse des plans vivants que plus aucun dossier ne porte.
   */
  accessCaseId: string | null;
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

/** Un droit de participer, tel que la garde le relit à chaque geste. */
interface DroitEnBase {
  accessCaseId: string;
  personId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Une étape de modèle telle qu'une ligne réelle la donne. Typée et non
 * `Record<string, unknown>` : sous ce dernier, `modeleDeLaLigne` lisait `undefined`
 * pour la répartition, `enregistrerPlan` sautait la colonne et l'empreinte retombait
 * sur son défaut, le tout sans que le typecheck ni un test ne le dise.
 */
interface EtapeDeModeleEnBase {
  key: string;
  position: number;
  title: string;
  runbook: string | null;
  deeplink: string | null;
  doneWhen: string;
  input: unknown;
  riskLevel: string;
  expectedActor: Acteur;
  validationBy: Acteur | null;
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
  /**
   * Ce que la session dit d'elle, au-delà du nom. Mutable pour la même raison : un
   * participant est une session comme une autre, à ceci près qu'elle ne porte aucune
   * qualité d'opérateur et qu'elle désigne une fiche.
   */
  sessionOperateur: true,
  sessionPersonId: null as string | null,
  droits: [] as DroitEnBase[],
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
    steps: readonly EtapeDeModeleEnBase[];
  }[],
}));

vi.mock("@/connectors", () => ({ CONNECTEURS: base.connecteurs }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/session", () => {
  const session = () =>
    Promise.resolve({
      username: base.operateur,
      email: null,
      nom: null,
      personId: base.sessionPersonId,
      voie: base.sessionOperateur ? "ESPACE_MEMBRE" : "ADRESSE",
      operateur: base.sessionOperateur,
    });

  return {
    requireUtilisateur: session,
    // Elle redirige plutôt que de rendre une session sans qualité d'opérateur : une
    // action réservée à l'équipe qu'un participant atteindrait doit casser ici, et
    // non rendre un verdict que le test lirait comme une règle métier.
    requireOperateur: () =>
      base.sessionOperateur
        ? session()
        : Promise.reject(new Error("redirection vers /moi : session sans qualité d'opérateur")),
  };
});

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
    caseParticipation: {
      findUnique: ({
        where,
      }: {
        where: { accessCaseId_personId: { accessCaseId: string; personId: string } };
      }) => {
        const cle = where.accessCaseId_personId;
        const droit = base.droits.find(
          (candidat) =>
            candidat.accessCaseId === cle.accessCaseId && candidat.personId === cle.personId,
        );
        const dossier =
          droit && base.dossiers.find((candidat) => candidat.id === droit.accessCaseId);

        return Promise.resolve(
          droit && dossier
            ? {
                expiresAt: droit.expiresAt,
                revokedAt: droit.revokedAt,
                accessCase: { state: dossier.state },
              }
            : null,
        );
      },
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
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          state: EtatEtape;
          validation: EtatValidation;
          declaredBy: string | null;
          attempts?: number;
        };
        data: {
          state: EtatEtape;
          validation: EtatValidation;
          executedAt?: Date;
          attempts?: { increment: number };
          lastError?: string;
          reponse?: string | null;
          declaredBy?: string;
          validatedBy?: string | null;
          validatedAt?: Date | null;
          validationNote?: string | null;
        };
      }) => {
        const pendant = base.pendantLEcritureDeLEtape;
        base.pendantLEcritureDeLEtape = null;
        await pendant?.();

        const etape = base.etapes.find(
          (candidat) =>
            candidat.id === where.id &&
            candidat.state === where.state &&
            candidat.validation === where.validation &&
            candidat.declaredBy === where.declaredBy &&
            (where.attempts === undefined || candidat.attempts === where.attempts),
        );

        if (!etape) {
          return Promise.resolve({ count: 0 });
        }

        base.gestes.push(`etape:${data.state}:${data.validation}`);
        etape.state = data.state;
        etape.validation = data.validation;
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
        if ("validatedBy" in data) {
          etape.validatedBy = data.validatedBy ?? null;
        }
        if ("validatedAt" in data) {
          etape.validatedAt = data.validatedAt ?? null;
        }
        if ("validationNote" in data) {
          etape.validationNote = data.validationNote ?? null;
        }
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
  base.sessionOperateur = true;
  base.sessionPersonId = null;
  base.droits.length = 0;
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
      "etape:ALREADY_PRESENT:NONE",
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
          expectedActor: "OPERATOR",
          validationBy: null,
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
          expectedActor: "OPERATOR",
          validationBy: null,
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

  it("réclame un second regard sur l'écart, qui solde, et aucun sur l'échec, qui ne solde rien", async () => {
    // Given quatre gestes sous le regard d'un opérateur : trois confiés à la personne
    // concernée, un confié à l'équipe
    const { dossier, plan } = await arriveeRepartie(
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      { acteur: "OPERATOR", valideur: "OPERATOR" },
      { acteur: "SUBJECT", valideur: "OPERATOR" },
    );
    const ecartee = etapeEnBase(0);
    const tentee = etapeEnBase(1);
    const dEquipe = etapeEnBase(2);
    const substituee = etapeEnBase(3);
    base.operateur = USERNAME;

    // When la porteuse, opératrice de surcroît, raye le premier et échoue au second
    await pointerEtape(
      null,
      formulaire({ etapeId: ecartee.id, pointage: "ignoree", note: "L'outil a été résilié." }),
    );
    await pointerEtape(
      null,
      formulaire({ etapeId: tentee.id, pointage: "echec", note: "La console a refusé." }),
    );

    // Then l'écart attend le regard que le plan lui désignait : c'est la seule issue
    // qui solde une étape sans qu'aucun geste ait eu lieu, donc la seule qui pouvait
    // fermer le dossier sur un mot. Ce regard ne juge pas un geste que personne
    // n'affirme, il juge la décision de ne pas le faire, laquelle a bien un objet.
    expect(ecartee.state).toBe("SKIPPED");
    expect(ecartee.validation).toBe("AWAITING");
    expect(ecartee.declaredBy).toBe(USERNAME);

    // Then l'échec n'attend rien : il ne solde rien, l'étape reste à reprendre et le
    // plan retombe en partiellement exécuté. Y exiger un contrôle bloquerait le dossier
    // au nom d'une preuve qui, elle, n'a pas d'objet.
    expect(tentee.state).toBe("FAILED");
    expect(tentee.validation).toBe("NONE");

    // When elle tente de signer l'écart qu'elle vient de poser
    const sienne = await validerEtape(
      null,
      formulaire({ etapeId: ecartee.id, verdict: "accepter" }),
    );

    // Then refusé : devant son propre dossier elle est la personne concernée, et rayer
    // une étape ne se croit pas davantage sur parole que la déclarer faite.
    expect(sienne.erreur).toContain("La personne concernée ne contrôle pas");
    expect(ecartee.validation).toBe("AWAITING");

    // When l'étape en échec est reprise et déclarée faite
    await pointerEtape(null, formulaire({ etapeId: tentee.id, pointage: "fait" }));

    // Then le contrôle commence à ce moment-là, et pas avant
    expect(tentee.state).toBe("SUCCEEDED");
    expect(tentee.validation).toBe("AWAITING");

    // When elle raye le geste que le plan confiait à l'équipe sur son propre dossier
    await pointerEtape(
      null,
      formulaire({
        etapeId: dEquipe.id,
        pointage: "ignoree",
        note: "Cet accès n'a jamais été ouvert.",
      }),
    );

    // Then il attend lui aussi : elle pointe tout son dossier et n'en signe rien, la
    // sortie qui le soldait d'un mot est fermée.
    expect(dEquipe.state).toBe("SKIPPED");
    expect(dEquipe.validation).toBe("AWAITING");

    // Then rien n'est clôturable tant que ces regards n'ont pas eu lieu
    expect(plan.state).toBe("EXECUTING");
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toMatchObject({
      possible: false,
    });

    // When l'opératrice, qui ne porte pas ce dossier, raye le dernier geste confié à la
    // personne concernée
    base.operateur = "operatrice.exemple";
    await pointerEtape(
      null,
      formulaire({
        etapeId: substituee.id,
        pointage: "ignoree",
        note: "Ce compte n'a jamais été ouvert.",
      }),
    );

    // Then celui-là est soldé d'un geste : elle s'est substituée à la personne
    // concernée tout en tenant le rôle qui contrôle, exactement comme sur un « c'est
    // fait ». Rien ne se coince de plus qu'avant pour qui raye l'étape d'un autre.
    expect(substituee.state).toBe("SKIPPED");
    expect(substituee.validation).toBe("ACCEPTED");
    expect(substituee.validatedBy).toBe("operatrice.exemple");

    // When elle porte les trois regards que la porteuse ne pouvait pas porter
    const surLEcart = await validerEtape(
      null,
      formulaire({ etapeId: ecartee.id, verdict: "accepter" }),
    );
    const surLaReprise = await validerEtape(
      null,
      formulaire({ etapeId: tentee.id, verdict: "accepter" }),
    );
    const surLEquipe = await validerEtape(
      null,
      formulaire({ etapeId: dEquipe.id, verdict: "accepter" }),
    );

    // Then le plan est exécuté et le dossier se clôt, aucune étape ne s'étant soldée
    // sans qu'un second nom l'ait vue.
    expect([surLEcart.erreur, surLaReprise.erreur, surLEquipe.erreur]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(plan.state).toBe("EXECUTED");
    expect(base.etapes.map((etape) => etape.declaredBy)).toEqual([
      USERNAME,
      USERNAME,
      USERNAME,
      "operatrice.exemple",
    ]);
    expect(base.etapes.every((etape) => etape.validatedBy === "operatrice.exemple")).toBe(true);
    expect(peutClore("ONBOARDING", dossier.state, plan.state, base.etapes.length)).toEqual({
      possible: true,
    });
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

    // When la personne concernée, opératrice de surcroît, pointe ce geste d'équipe sur
    // son propre dossier
    base.operateur = USERNAME;
    const porteuse = await pointerEtape(
      null,
      formulaire({ etapeId: controlee.id, pointage: "fait" }),
    );

    // Then rien ne s'y oppose, et sa déclaration attend un regard : porter le dossier
    // ne retire pas à qui est de l'équipe les gestes de l'équipe, cela lui retire la
    // signature. Le lui refuser laissait l'unique mainteneur sans une seule case à
    // cocher sur son propre départ, là où rien ne l'empêchait de confirmer ce plan, de
    // l'exécuter, de l'annuler ni de le clore.
    expect(porteuse.erreur).toBeUndefined();
    expect(controlee.validation).toBe("AWAITING");
    expect(controlee.declaredBy).toBe(USERNAME);
    expect(controlee.validatedBy).toBeNull();

    // When elle tente de signer ce qu'elle vient de déclarer sur son propre dossier
    const sienne = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );

    // Then refusé : devant son dossier elle est la personne concernée, et porter le
    // rôle d'opératrice ailleurs n'y change rien.
    expect(sienne.erreur).toContain("La personne concernée ne contrôle pas");
    expect(controlee.validation).toBe("AWAITING");

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

  it("refuse le pointage qui effacerait un verdict, et le verdict qui signerait un autre geste", async () => {
    // Given une arrivée dont un geste revient à la personne concernée sous le regard
    // d'un opérateur, déclarée une première fois
    const { plan } = await arriveeRepartie({ acteur: "SUBJECT", valideur: "OPERATOR" }, {});
    const controlee = etapeEnBase(0);

    base.operateur = USERNAME;
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));
    expect(controlee.validation).toBe("AWAITING");

    // When la personne repointe pendant que l'opératrice refuse : le refus s'intercale
    // entre la lecture du repointage et son écriture
    base.pendantLEcritureDeLEtape = async () => {
      base.operateur = "operatrice.exemple";
      await validerEtape(
        null,
        formulaire({
          etapeId: controlee.id,
          verdict: "refuser",
          note: "La capture ne montre pas le compte.",
        }),
      );
      base.operateur = USERNAME;
    };

    // Then le repointage ne passe pas : écrire par le seul identifiant remettrait
    // l'étape en attente, effacerait le motif et la signature, et la personne referait
    // son geste sans avoir jamais lu ce qu'on lui reprochait.
    await expect(
      pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" })),
    ).rejects.toThrow("Cette étape a changé pendant le pointage.");
    expect(controlee.state).toBe("PENDING");
    expect(controlee.validation).toBe("REFUSED");
    expect(controlee.validationNote).toBe("La capture ne montre pas le compte.");
    expect(controlee.validatedBy).toBe("operatrice.exemple");

    // Then le journal porte l'entrelacement lui-même : l'intention du pointage, le
    // refus qui s'est glissé au milieu, puis l'échec du pointage. Sans cette dernière
    // trace, l'intention y resterait comme un fait accompli.
    expect(base.journal.slice(-3).map((ligne) => `${ligne.action}:${ligne.result}`)).toEqual([
      "dossier.pointage:SUCCESS",
      "dossier.validation:SUCCESS",
      "dossier.pointage:FAILURE",
    ]);

    // When la personne refait le geste, le motif lu cette fois, puis le repointe une
    // seconde fois pendant que l'opératrice signe
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));
    const tentatives = controlee.attempts;

    base.pendantLEcritureDeLEtape = async () => {
      base.operateur = USERNAME;
      await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));
      base.operateur = "operatrice.exemple";
    };
    base.operateur = "operatrice.exemple";

    // Then le verdict ne passe pas davantage : un même déclarant qui repointe le même
    // choix repose l'état, la validation et son nom à l'identique, si bien que seule
    // la tentative distingue la déclaration signée de celle qui a été lue.
    await expect(
      validerEtape(null, formulaire({ etapeId: controlee.id, verdict: "accepter" })),
    ).rejects.toThrow("Cette étape a changé pendant la validation.");
    expect(controlee.validation).toBe("AWAITING");
    expect(controlee.validatedBy).toBeNull();
    expect(controlee.attempts).toBe(tentatives + 1);

    // Then rien n'est soldé, et le point d'entrelacement a servi une fois par course
    expect(plan.state).toBe("EXECUTING");
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
  it("ne clôt que lorsque plus rien n'attend, et laisse la signature à un autre nom", async () => {
    // Given une arrivée dont un geste revient à la personne concernée sous le regard
    // d'un opérateur, et dont l'autre revient à l'opérateur seul
    const { dossier, plan } = await arriveeRepartie(
      { acteur: "SUBJECT", valideur: "OPERATOR" },
      {},
    );
    const controlee = etapeEnBase(0);
    const parLOperateur = etapeEnBase(1);

    // When la personne concernée, opératrice de surcroît, pointe le geste d'équipe de
    // son propre dossier
    base.operateur = USERNAME;
    const sien = await pointerEtape(
      null,
      formulaire({ etapeId: parLOperateur.id, pointage: "fait" }),
    );

    // Then il est soldé sur-le-champ : rien ne le contrôlait, et le refuser murait le
    // départ de l'unique mainteneur au pointage seul.
    expect(sien.erreur).toBeUndefined();
    expect(parLOperateur.state).toBe("SUCCEEDED");
    expect(parLOperateur.validation).toBe("NONE");
    expect(parLOperateur.declaredBy).toBe(USERNAME);

    // When elle pointe ensuite ce qui lui revient en propre, sous le regard d'un
    // opérateur
    await pointerEtape(null, formulaire({ etapeId: controlee.id, pointage: "fait" }));

    // Then sa déclaration attend, et ne s'accepte surtout pas d'elle-même : lui faire
    // porter le rôle d'opératrice pour lui ouvrir le pointage l'aurait fait passer
    // pour l'opératrice substituée à la personne concernée, et son départ se serait
    // signé tout seul.
    expect(controlee.validation).toBe("AWAITING");
    expect(controlee.declaredBy).toBe(USERNAME);
    expect(controlee.validatedBy).toBeNull();

    // When elle tente de signer sa propre déclaration
    const soi = await validerEtape(
      null,
      formulaire({ etapeId: controlee.id, verdict: "accepter" }),
    );

    // Then refusé : personne n'instruit son propre départ de bout en bout.
    expect(soi.erreur).toContain("La personne concernée ne contrôle pas");

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
    base.operateur = "operatrice.exemple";
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
      "etape:SUCCEEDED:AWAITING",
      "plan:EXECUTING",
      "journal:dossier.validation:SUCCESS",
      "etape:SUCCEEDED:ACCEPTED",
      "plan:EXECUTED",
    ]);
    expect(plan.state).toBe("EXECUTED");
  });
});

/**
 * Ce que #66 met en jeu tient dans une ligne de modèle, pas dans un connecteur : c'est
 * l'écran des modèles qui décide qu'une étape de départ réclame un second regard, et
 * la chaîne entière doit porter ce choix jusqu'à la garde du pointage.
 *
 * La paire de référence est « la personne concernée agit, un opérateur contrôle », et
 * non « un opérateur agit, un opérateur contrôle » : celle-ci bloquerait tous les
 * départs, y compris ceux que personne ne conteste, ce qui re-murerait un outil à un
 * seul mainteneur.
 */
describe("une étape de modèle qui nomme son contrôleur, jusqu'au dossier", () => {
  /** Le modèle de départ de l'incubateur, tel qu'un opérateur l'aurait écrit. */
  function modeleDeDepart(): void {
    base.modeles.push({
      ownerKey: "*incubateur",
      kind: "OFFBOARDING",
      startupsMayExtend: false,
      steps: [
        {
          key: "signer-la-decharge",
          position: 0,
          title: "Signer la décharge de matériel",
          runbook: null,
          deeplink: null,
          doneWhen: "La décharge signée est au dossier.",
          input: null,
          riskLevel: "LOW",
          expectedActor: "SUBJECT",
          validationBy: "OPERATOR",
        },
        {
          key: "prevenir-l-equipe",
          position: 1,
          title: "Prévenir l'équipe",
          runbook: null,
          deeplink: null,
          doneWhen: "Le message est parti.",
          input: null,
          riskLevel: "LOW",
          expectedActor: "OPERATOR",
          validationBy: null,
        },
      ],
    });
  }

  it("bloque l'opérateur qui mène son propre départ, du calcul du plan jusqu'à la clôture", async () => {
    // Given un modèle de départ dont une étape est confiée à la personne concernée
    // sous le regard d'un opérateur, et le dossier de départ de cet opérateur
    modeleDeDepart();
    const { dossier, plan } = await dossierAvecPlan("OFFBOARDING");

    // Then la répartition a survécu à toute la chaîne, de la colonne du modèle à
    // celle du plan : c'est le seul endroit où elle se relit, et un maillon muet la
    // ferait disparaître sans un mot.
    const decharge = etapeEnBase(0);
    const message = etapeEnBase(1);
    expect(decharge.label).toBe("Signer la décharge de matériel");
    expect(decharge.expectedActor).toBe("SUBJECT");
    expect(decharge.validationBy).toBe("OPERATOR");
    expect(message.validationBy).toBeNull();

    // When il confirme son plan, puis pointe les deux étapes
    base.operateur = USERNAME;
    await confirmerPlan(null, formulaire({ planId: plan.id }));
    await pointerEtape(null, formulaire({ etapeId: decharge.id, pointage: "fait" }));
    await pointerEtape(null, formulaire({ etapeId: message.id, pointage: "fait" }));

    // Then il a bien pu pointer : devant son propre dossier il est la personne
    // concernée, et c'est à elle que l'étape revenait. Rien ne se coince au pointage.
    expect(decharge.state).toBe("SUCCEEDED");
    expect(decharge.declaredBy).toBe(USERNAME);
    expect(message.state).toBe("SUCCEEDED");

    // Then celle que le modèle plaçait sous contrôle attend un second regard, et
    // l'autre est soldée sans que personne n'ait à parler
    expect(decharge.validation).toBe("AWAITING");
    expect(message.validation).toBe("NONE");

    // When il tente de signer sa propre déclaration
    const sienne = await validerEtape(
      null,
      formulaire({ etapeId: decharge.id, verdict: "accepter" }),
    );

    // Then refusé par son rôle sur ce dossier, avant même la règle du username : la
    // personne concernée ne contrôle pas ce qu'on déclare sur son propre dossier.
    expect(sienne.erreur).toContain("La personne concernée ne contrôle pas");
    expect(decharge.validation).toBe("AWAITING");
    expect(decharge.validatedBy).toBeNull();

    // When il tente de clore son dossier, tout étant coché
    const close = await cloreDossier(null, formulaire({ dossierId: dossier.id }));

    // Then la clôture refuse : le plan n'est pas exécuté tant qu'un regard manque, et
    // un dossier clos affirmerait que l'affaire est réglée sur une parole que personne
    // n'a vérifiée.
    expect(close.erreur).toBeDefined();
    expect(plan.state).toBe("EXECUTING");
    expect(dossier.state).toBe("CANDIDATE");
  });

  it("laisse le même modèle se solder d'un geste sur le dossier de quelqu'un d'autre", async () => {
    // Given le même modèle de départ, et le dossier de quelqu'un dont l'opératrice
    // n'est pas la porteuse
    modeleDeDepart();
    const { dossier, plan } = await dossierAvecPlan("OFFBOARDING");
    const decharge = etapeEnBase(0);
    const message = etapeEnBase(1);

    // When l'opératrice confirme le plan et pointe les deux étapes
    await confirmerPlan(null, formulaire({ planId: plan.id }));
    await pointerEtape(null, formulaire({ etapeId: decharge.id, pointage: "fait" }));
    await pointerEtape(null, formulaire({ etapeId: message.id, pointage: "fait" }));

    // Then l'étape contrôlée est soldée du même coup, et signée : elle s'est substituée
    // à la personne concernée tout en tenant le rôle qu'on attendait au contrôle, et
    // exiger un second opérateur bloquerait un outil à un seul mainteneur.
    expect(decharge.state).toBe("SUCCEEDED");
    expect(decharge.validation).toBe("ACCEPTED");
    expect(decharge.declaredBy).toBe("operatrice.exemple");
    expect(decharge.validatedBy).toBe("operatrice.exemple");
    expect(message.validation).toBe("NONE");

    // Then plus rien n'attend et le dossier se clôt : la paire retenue ne coûte rien
    // aux départs que personne ne conteste, ce qui est tout l'intérêt de l'avoir
    // préférée à « un opérateur agit, un opérateur contrôle ».
    expect(plan.state).toBe("EXECUTED");
    const close = await cloreDossier(null, formulaire({ dossierId: dossier.id }));
    expect(close.erreur).toBeUndefined();
    expect(dossier.state).toBe("DONE");
  });
});

/**
 * Ce qu'un droit par dossier ouvre, et surtout ce qu'il n'ouvre pas.
 *
 * Le point du scénario n'est pas qu'un délégué puisse pointer, c'est que le refus soit
 * relu en base à chaque geste : une session reste valide des semaines, et un droit
 * retiré doit mordre au geste suivant sans attendre son expiration.
 */
describe("un délégué entre, agit, et son droit s'éteint sous lui", () => {
  const DELEGUE = "lead.exemple";
  const FICHE_DU_DELEGUE = "personne-lead";

  const dans = (jours: number) => new Date(Date.now() + jours * 24 * 60 * 60 * 1000);

  /** Un modèle de départ dont une étape revient à un délégué, à côté d'une autre non. */
  function modeleAvecDelegue(): void {
    base.modeles.push({
      ownerKey: "*incubateur",
      kind: "OFFBOARDING",
      startupsMayExtend: false,
      steps: [
        {
          key: "recuperer-les-documents",
          position: 0,
          title: "Récupérer les documents partagés",
          runbook: null,
          deeplink: null,
          doneWhen: "Les documents sont chez l'équipe.",
          input: null,
          riskLevel: "LOW",
          expectedActor: "DELEGATE",
          validationBy: "OPERATOR",
        },
        {
          key: "prevenir-l-equipe",
          position: 1,
          title: "Prévenir l'équipe",
          runbook: null,
          deeplink: null,
          doneWhen: "Le message est parti.",
          input: null,
          riskLevel: "LOW",
          expectedActor: "OPERATOR",
          validationBy: null,
        },
      ],
    });
  }

  function sessionDuDelegue(): void {
    base.operateur = DELEGUE;
    base.sessionOperateur = false;
    base.sessionPersonId = FICHE_DU_DELEGUE;
  }

  function sessionDeLEquipe(nom: string): void {
    base.operateur = nom;
    base.sessionOperateur = true;
    base.sessionPersonId = null;
  }

  it("pointe ce qui le nomme, jamais l'écart, et perd tout à la révocation", async () => {
    // Given un dossier de départ confirmé, dont une étape revient à un délégué
    modeleAvecDelegue();
    const { dossier, plan } = await dossierAvecPlan("OFFBOARDING");
    await confirmerPlan(null, formulaire({ planId: plan.id }));

    const documents = etapeEnBase(0);
    const message = etapeEnBase(1);
    expect(documents.expectedActor).toBe("DELEGATE");
    expect(message.expectedActor).toBe("OPERATOR");

    // Given un droit vivant accordé à lead.exemple sur ce dossier-là, et sa session
    const droit: DroitEnBase = {
      accessCaseId: dossier.id,
      personId: FICHE_DU_DELEGUE,
      expiresAt: dans(7),
      revokedAt: null,
    };
    base.droits.push(droit);
    sessionDuDelegue();
    base.journal.length = 0;
    base.gestes.length = 0;

    // When il pointe l'étape qui le nomme
    expect(
      await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "fait" })),
    ).toEqual({});

    // Then elle est déclarée sous son nom, et elle attend le regard que le modèle a
    // prévu : rien de ce qu'il est ne l'établit comme le contrôleur attendu.
    expect(documents.state).toBe("SUCCEEDED");
    expect(documents.declaredBy).toBe(DELEGUE);
    expect(documents.validation).toBe("AWAITING");
    expect(documents.validatedBy).toBeNull();

    // Then la trace précède l'écriture, elle porte son identifiant de fiche en acteur,
    // et elle dit par quelle porte son identité a été prouvée : c'est la seule chose
    // qui sépare au journal un username beta.gouv d'un identifiant fabriqué ici.
    expect(base.gestes[0]).toBe("journal:dossier.pointage:SUCCESS");
    expect(base.journal[0]).toMatchObject({
      actorUsername: DELEGUE,
      action: "dossier.pointage",
      result: "SUCCESS",
    });
    expect(base.journal[0]?.after).toMatchObject({ etat: "SUCCEEDED", voie: "ADRESSE" });

    // Then l'étape que le modèle confie à l'équipe lui reste fermée, et rien n'a bougé
    expect(
      await pointerEtape(null, formulaire({ etapeId: message.id, pointage: "fait" })),
    ).toMatchObject({ erreur: expect.stringContaining("ne vous revient pas") });
    expect(message.state).toBe("PENDING");

    // Then écarter une étape ne lui appartient pas : ce n'est pas déclarer un geste,
    // c'est décider qu'un geste prévu n'aura pas lieu. L'écran ne le propose pas, et
    // l'action le refuse aussi, parce que c'est elle qui fait foi.
    expect(
      await pointerEtape(
        null,
        formulaire({ etapeId: documents.id, pointage: "ignoree", note: "sans objet" }),
      ),
    ).toEqual({ erreur: "Écarter une étape appartient à l'équipe transverse." });
    expect(documents.state).toBe("SUCCEEDED");

    // Then le constat qu'un autre est passé avant lui reste offert : il déclare le
    // geste au même titre que « c'est fait », et sans lui un délégué qui trouve l'accès
    // déjà retiré n'aurait plus qu'à mentir ou à téléphoner.
    expect(
      await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "deja-absent" })),
    ).toEqual({});
    expect(documents.state).toBe("ALREADY_ABSENT");

    // When son droit est révoqué alors que sa session est encore parfaitement valide
    droit.revokedAt = new Date();
    const traces = base.journal.length;

    // Then le geste suivant est refusé, sans déconnexion, sans attendre l'expiration
    // d'un jeton, et sans qu'une ligne de journal soit écrite : la garde tombe avant
    // le passage tracé.
    expect(
      await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "fait" })),
    ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
    expect(base.journal).toHaveLength(traces);
    expect(documents.state).toBe("ALREADY_ABSENT");

    // Then une échéance passée se comporte exactement comme une révocation
    droit.revokedAt = null;
    droit.expiresAt = dans(-1);
    expect(
      await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "fait" })),
    ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });

    // Then un dossier qui n'est plus ouvert ferme aussi, et il le dit de la même
    // façon : son état meurt avec le droit qu'il portait, et ce que le dossier est
    // devenu ne se dit plus à qui n'y a plus rien. L'équipe, elle, garde le refus qui
    // nomme l'obstacle, son rôle n'étant jamais nul sur un dossier qui existe.
    droit.expiresAt = dans(7);
    for (const etat of ["DONE", "CANCELLED"] as const) {
      dossier.state = etat;
      expect(
        await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "fait" })),
      ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });

      base.operateur = "operatrice.exemple";
      base.sessionOperateur = true;
      base.sessionPersonId = null;
      expect(
        await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "fait" })),
      ).toEqual({ erreur: "Ce dossier n'est plus ouvert." });
      sessionDuDelegue();
    }

    // Then l'étape confiée au délégué reste pointable par un opérateur en substitution :
    // aucun dossier ne se bloque parce que celui qui devait agir s'est évaporé.
    dossier.state = "CANDIDATE";
    base.operateur = "operatrice.exemple";
    base.sessionOperateur = true;
    base.sessionPersonId = null;
    expect(
      await pointerEtape(null, formulaire({ etapeId: documents.id, pointage: "fait" })),
    ).toEqual({});
    expect(documents.declaredBy).toBe("operatrice.exemple");
  });

  it("signe ce qu'une étape lui confie, et rien tant qu'aucun droit ne le nomme", async () => {
    // Given un modèle qui confie une étape à la personne concernée sous le regard d'un
    // délégué : la répartition que le lot 5 prévoyait sans que rien ne l'atteigne. La
    // seconde étape n'est là que pour garder le plan ouvert : sans elle, la première
    // signature le solderait et la suite du scénario buterait sur un plan clos.
    base.modeles.push({
      ownerKey: "*incubateur",
      kind: "OFFBOARDING",
      startupsMayExtend: false,
      steps: [
        {
          key: "rendre-le-materiel",
          position: 0,
          title: "Rendre le matériel",
          runbook: null,
          deeplink: null,
          doneWhen: "Le matériel est revenu.",
          input: null,
          riskLevel: "LOW",
          expectedActor: "SUBJECT",
          validationBy: "DELEGATE",
        },
        {
          key: "prevenir-l-equipe",
          position: 1,
          title: "Prévenir l'équipe",
          runbook: null,
          deeplink: null,
          doneWhen: "Le message est parti.",
          input: null,
          riskLevel: "LOW",
          expectedActor: "OPERATOR",
          validationBy: null,
        },
      ],
    });
    const { dossier, plan } = await dossierAvecPlan("OFFBOARDING");
    await confirmerPlan(null, formulaire({ planId: plan.id }));
    const materiel = etapeEnBase(0);

    // When un opérateur pointe en substitution, la personne concernée n'ayant rien fait
    await pointerEtape(null, formulaire({ etapeId: materiel.id, pointage: "fait" }));

    // Then l'étape attend : le contrôleur que le modèle nomme est un délégué, et rien
    // n'établit cet opérateur-là comme lui. Sans cette règle, il aurait signé d'emblée
    // une déclaration que personne d'attendu n'a vue.
    expect(materiel.validation).toBe("AWAITING");
    expect(materiel.validatedBy).toBeNull();

    // When quelqu'un sans droit sur ce dossier tente de la signer
    sessionDuDelegue();
    expect(
      await validerEtape(null, formulaire({ etapeId: materiel.id, verdict: "accepter" })),
    ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
    expect(materiel.validation).toBe("AWAITING");

    // When un droit vivant lui est accordé, et lui seul change
    base.droits.push({
      accessCaseId: dossier.id,
      personId: FICHE_DU_DELEGUE,
      expiresAt: dans(7),
      revokedAt: null,
    });

    // Then contrôler cette étape ne la lui ouvre pas : sa route la lui montre pour
    // qu'il la signe, et le geste reste celui de la personne concernée. C'est l'action
    // qui fait foi, l'écran ne faisant que se taire là où elle refuse.
    expect(
      await pointerEtape(null, formulaire({ etapeId: materiel.id, pointage: "fait" })),
    ).toEqual({ erreur: "Cette étape ne vous revient pas : elle attend quelqu'un d'autre." });
    expect(materiel.declaredBy).toBe("operatrice.exemple");

    base.journal.length = 0;
    base.gestes.length = 0;

    // Then il signe, et le second regard a bien eu lieu : la garde ne lui oppose que
    // le contrôle attendu d'un opérateur, et elle refuse de toute façon le déclarant
    // par son nom.
    expect(
      await validerEtape(
        null,
        formulaire({ etapeId: materiel.id, verdict: "accepter", note: "Le matériel est là." }),
      ),
    ).toEqual({});
    expect(materiel.validation).toBe("ACCEPTED");
    expect(materiel.validatedBy).toBe(DELEGUE);

    // Then la trace précède l'écriture, elle porte son nom et sa voie d'identification
    expect(base.gestes[0]).toBe("journal:dossier.validation:SUCCESS");
    expect(base.journal[0]).toMatchObject({
      actorUsername: DELEGUE,
      action: "dossier.validation",
      before: { declarePar: "operatrice.exemple" },
    });
    expect(base.journal[0]?.after).toMatchObject({ validation: "ACCEPTED", voie: "ADRESSE" });

    // Given qu'un opérateur reprend cette étape en écart, avec sa raison : elle attend
    // de nouveau le regard du délégué, et l'identifiant que sa route lui avait remis
    // est toujours celui de son formulaire
    sessionDeLEquipe("operatrice.exemple");
    expect(
      await pointerEtape(
        null,
        formulaire({
          etapeId: materiel.id,
          pointage: "ignoree",
          note: "Le matériel a été racheté.",
        }),
      ),
    ).toEqual({});
    expect(materiel.state).toBe("SKIPPED");
    expect(materiel.validation).toBe("AWAITING");

    // Then il ne le signe pas, et c'est le serveur qui le tient : la raison de l'écart
    // vit dans une note libre qu'aucun écran ne lui montre, et signer une décision dont
    // on tait le motif serait signer à l'aveugle. Le refus est celui d'un contrôle qui
    // ne lui revient pas, et il n'apprend rien de plus.
    sessionDuDelegue();
    expect(
      await validerEtape(null, formulaire({ etapeId: materiel.id, verdict: "accepter" })),
    ).toEqual({ erreur: "Cette étape attend le regard d'un opérateur." });
    expect(materiel.validation).toBe("AWAITING");
    expect(materiel.validatedBy).toBeNull();

    // Then un opérateur, lui, continue de le signer : l'écran de l'équipe lui montre
    // l'écart avec sa raison, et la règle ferme l'écart à qui ne peut pas le lire, pas
    // à tout le monde
    sessionDeLEquipe("autre.operatrice.exemple");
    expect(
      await validerEtape(null, formulaire({ etapeId: materiel.id, verdict: "accepter" })),
    ).toEqual({});
    expect(materiel.validation).toBe("ACCEPTED");
    expect(materiel.validatedBy).toBe("autre.operatrice.exemple");
  });

  it("ne voit rien du dossier voisin, même en le nommant dans le formulaire", async () => {
    // Given deux dossiers de départ, et un droit sur le premier seulement
    modeleAvecDelegue();
    const premier = await dossierAvecPlan("OFFBOARDING");
    await confirmerPlan(null, formulaire({ planId: premier.plan.id }));
    const sien = etapeEnBase(0);

    const voisin = await dossierAvecPlan("OFFBOARDING");
    await confirmerPlan(null, formulaire({ planId: voisin.plan.id }));
    const etapeDuVoisin = base.etapes.find(
      (etape) => etape.planId === voisin.plan.id && etape.expectedActor === "DELEGATE",
    );
    if (!etapeDuVoisin) {
      throw new Error("le second dossier n'a aucune étape confiée à un délégué");
    }

    base.droits.push({
      accessCaseId: premier.dossier.id,
      personId: FICHE_DU_DELEGUE,
      expiresAt: dans(7),
      revokedAt: null,
    });
    sessionDuDelegue();
    base.journal.length = 0;

    // When il pointe l'étape du dossier voisin en déclarant celui sur lequel il a un
    // droit, ce qui est exactement la requête forgée que ce refus existe pour arrêter
    expect(
      await pointerEtape(
        null,
        formulaire({
          etapeId: etapeDuVoisin.id,
          pointage: "fait",
          dossierId: premier.dossier.id,
        }),
      ),
    ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });

    // Then rien n'a bougé et rien n'est entré au journal : le dossier se dérive de
    // l'étape relue en base, jamais du formulaire.
    expect(etapeDuVoisin.state).toBe("PENDING");
    expect(base.journal).toHaveLength(0);

    // Then le sien, lui, s'ouvre normalement
    expect(await pointerEtape(null, formulaire({ etapeId: sien.id, pointage: "fait" }))).toEqual(
      {},
    );
    expect(sien.declaredBy).toBe(DELEGUE);

    // Given un plan dont le dossier a disparu : `Plan.accessCase` est en `SetNull`,
    // donc supprimer une fiche laisse des plans vivants que plus aucun dossier ne
    // porte, et l'acteur attendu de leurs étapes est le défaut de la colonne.
    base.plans.push({
      id: "plan-orphelin",
      accessCaseId: null,
      kind: "OFFBOARDING",
      state: "EXECUTING",
      planDigest: "0".repeat(64),
      confirmedDigest: "0".repeat(64),
      confirmedBy: "operatrice.exemple",
      expiresAt: dans(30),
    });
    const orpheline: EtapeEnBase = {
      id: "etape-orpheline",
      planId: "plan-orphelin",
      systemKey: "atelier",
      label: "Retirer l'accès de l'atelier",
      ordre: 0,
      state: "PENDING",
      lastError: null,
      template: null,
      reponse: null,
      attempts: 0,
      expectedActor: "OPERATOR",
      validationBy: null,
      validation: "NONE",
      declaredBy: null,
      validatedBy: null,
      validatedAt: null,
      validationNote: null,
    };
    base.etapes.push(orpheline);

    // When le délégué y pointe, aucun dossier n'étant là pour le situer
    // Then il est refusé comme partout ailleurs : son droit porte sur un dossier, et
    // ce plan n'en a plus. Sans ce refus il y prendrait le rôle de l'équipe, faute de
    // porteur devant qui se situer, et sa déclaration s'écrirait sous son nom.
    expect(
      await pointerEtape(null, formulaire({ etapeId: orpheline.id, pointage: "fait" })),
    ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
    expect(orpheline.state).toBe("PENDING");
    expect(orpheline.declaredBy).toBeNull();

    // Then l'équipe transverse, elle, y passe : c'est le seul chemin par lequel un plan
    // qu'aucun écran ne montre plus peut encore se solder.
    base.operateur = "operatrice.exemple";
    base.sessionOperateur = true;
    base.sessionPersonId = null;
    expect(
      await pointerEtape(null, formulaire({ etapeId: orpheline.id, pointage: "fait" })),
    ).toEqual({});
    expect(orpheline.declaredBy).toBe("operatrice.exemple");
  });
});

/**
 * Le rôle se décide devant le dossier, et le porteur s'y reconnaît à sa fiche. Tant que
 * `requireOperateur` murait ces actions, la branche était inatteignable ; ce lot y fait
 * entrer des sessions qui ne sont pas celles de l'équipe, dont le jeton porte un nom
 * figé à la connexion qu'un renommage déplace.
 */
describe("le porteur qui n'est pas de l'équipe, et son dossier qui ne tient qu'à son droit", () => {
  const dans = (jours: number) => new Date(Date.now() + jours * 24 * 60 * 60 * 1000);

  function sessionDuPorteur(): void {
    base.operateur = USERNAME;
    base.sessionOperateur = false;
    base.sessionPersonId = PERSONNE;
  }

  function sessionDeLEquipe(): void {
    base.operateur = "operatrice.exemple";
    base.sessionOperateur = true;
    base.sessionPersonId = null;
  }

  it("n'agit sur ses propres étapes que tant qu'un droit vivant l'y autorise", async () => {
    // Given une arrivée confirmée dont un geste revient à la personne concernée et
    // l'autre à l'équipe transverse
    const { dossier } = await arriveeRepartie({ acteur: "SUBJECT" }, { acteur: "OPERATOR" });
    const sienne = etapeEnBase(0);
    const celleDeLEquipe = etapeEnBase(1);

    // Given sa session à elle, qui porte son nom et sa fiche mais aucune qualité
    // d'opératrice, et pas la moindre ligne de droit
    sessionDuPorteur();
    base.journal.length = 0;
    base.gestes.length = 0;

    // When elle pointe son étape sans droit
    const sansDroit = await pointerEtape(
      null,
      formulaire({ etapeId: sienne.id, pointage: "fait" }),
    );

    // Then le nom ne suffit pas : porter le dossier qualifie un rôle, il ne l'ouvre
    // pas. Rien n'est entré en base, rien n'est entré au journal.
    expect(sansDroit).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
    expect(sienne.state).toBe("PENDING");
    expect(sienne.declaredBy).toBeNull();
    expect(base.journal).toHaveLength(0);

    // Given un droit vivant sur ce dossier-là
    const droit: DroitEnBase = {
      accessCaseId: dossier.id,
      personId: PERSONNE,
      expiresAt: dans(7),
      revokedAt: null,
    };
    base.droits.push(droit);

    // When elle repointe la même étape
    expect(await pointerEtape(null, formulaire({ etapeId: sienne.id, pointage: "fait" }))).toEqual(
      {},
    );

    // Then elle est déclarée sous son nom, et la trace précède l'écriture en disant par
    // quelle porte son identité a été prouvée
    expect(sienne.state).toBe("SUCCEEDED");
    expect(sienne.declaredBy).toBe(USERNAME);
    expect(base.gestes[0]).toBe("journal:dossier.pointage:SUCCESS");
    expect(base.journal[0]).toMatchObject({ actorUsername: USERNAME, result: "SUCCESS" });
    expect(base.journal[0]?.after).toMatchObject({ etat: "SUCCEEDED", voie: "ADRESSE" });

    // Then l'étape que le plan confie à l'équipe lui reste fermée, son droit ne la
    // faisant pas entrer dans l'équipe
    expect(
      await pointerEtape(null, formulaire({ etapeId: celleDeLEquipe.id, pointage: "fait" })),
    ).toMatchObject({ erreur: expect.stringContaining("ne vous revient pas") });
    expect(celleDeLEquipe.state).toBe("PENDING");

    // When son droit est révoqué, puis quand il périme, sa session restant valide dans
    // les deux cas : le jeton dit qui elle est, il ne dit pas ce qu'elle peut
    const traces = base.journal.length;
    for (const mort of [
      () => {
        droit.revokedAt = new Date();
      },
      () => {
        droit.revokedAt = null;
        droit.expiresAt = dans(-1);
      },
    ]) {
      mort();

      // Then la même phrase, sur son étape comme sur un identifiant qui ne désigne
      // rien : le refus ne distingue plus une étape connue d'une étape inconnue, sans
      // quoi il resterait à son ancienne titulaire une sonde d'existence sur les
      // identifiants qu'elle a légitimement appris pendant que son droit vivait.
      expect(
        await pointerEtape(null, formulaire({ etapeId: sienne.id, pointage: "fait" })),
      ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
      expect(
        await pointerEtape(
          null,
          formulaire({ etapeId: "etape-qui-n-existe-pas", pointage: "fait" }),
        ),
      ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
      expect(
        await validerEtape(null, formulaire({ etapeId: sienne.id, verdict: "accepter" })),
      ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });

      // Then aucune de ces reconnaissances n'a laissé de trace, la garde tombant avant
      // le passage tracé
      expect(base.journal).toHaveLength(traces);
      expect(sienne.state).toBe("SUCCEEDED");
    }

    // Then un dossier qui se clôt ne dit pas non plus ce qu'il est devenu, et les deux
    // actions le taisent de la même façon : sans ce cas, l'ordre des refus de
    // `validerEtape` resterait libre de remonter l'état du dossier au-dessus du rôle, et
    // le dossier de quelqu'un raconterait son sort à qui n'y a plus rien.
    dossier.state = "DONE";
    expect(
      await validerEtape(null, formulaire({ etapeId: sienne.id, verdict: "accepter" })),
    ).toEqual({ erreur: "Ce dossier ne vous concerne pas." });
    expect(await pointerEtape(null, formulaire({ etapeId: sienne.id, pointage: "fait" }))).toEqual({
      erreur: "Ce dossier ne vous concerne pas.",
    });
    expect(base.journal).toHaveLength(traces);

    // Then l'équipe, elle, garde ses refus détaillés : son rôle n'est jamais nul sur un
    // dossier qui existe, et c'est ce qui rend le refus unique supportable ailleurs.
    sessionDeLEquipe();
    expect(
      await pointerEtape(null, formulaire({ etapeId: "etape-qui-n-existe-pas", pointage: "fait" })),
    ).toEqual({ erreur: "Cette étape n'existe plus." });
  });

  it("reste le porteur quand sa fiche est renommée sous une session déjà ouverte", async () => {
    // Given une arrivée confirmée dont un geste lui revient et un autre revient à un
    // délégué, et son droit vivant sur ce dossier
    const { dossier } = await arriveeRepartie({ acteur: "SUBJECT" }, { acteur: "DELEGATE" });
    const sienne = etapeEnBase(0);
    const celleDuDelegue = etapeEnBase(1);
    base.droits.push({
      accessCaseId: dossier.id,
      personId: PERSONNE,
      expiresAt: dans(7),
      revokedAt: null,
    });

    // Given sa fiche renommée pendant que sa session est ouverte, seul renommage que ce
    // dépôt autorise : son jeton porte l'identifiant d'avant, sa fiche celui d'après
    sessionDuPorteur();
    base.operateur = "camille.exempl";

    // When il pointe l'étape que le plan lui confie
    expect(await pointerEtape(null, formulaire({ etapeId: sienne.id, pointage: "fait" }))).toEqual(
      {},
    );

    // Then il y est resté le porteur : c'est sa fiche qui l'y ancre, la même des deux
    // côtés, là où son nom a cessé de correspondre. Le geste s'écrit sous le nom que
    // porte son jeton, qui est le seul dont ce code dispose.
    expect(sienne.state).toBe("SUCCEEDED");
    expect(sienne.declaredBy).toBe("camille.exempl");

    // Then l'étape du délégué lui reste fermée, et le refus le dit comme à quelqu'un du
    // dossier : le renommage ne l'a pas fait glisser d'un rôle à l'autre
    expect(
      await pointerEtape(null, formulaire({ etapeId: celleDuDelegue.id, pointage: "fait" })),
    ).toMatchObject({ erreur: expect.stringContaining("ne vous revient pas") });
    expect(celleDuDelegue.state).toBe("PENDING");
  });
});
