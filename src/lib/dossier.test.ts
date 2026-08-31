import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { creerGithub } from "@/connectors/github";
import { notion } from "@/connectors/notion";
import type { Connector, Intent, PlannedStep, RunContext } from "@/core/connector";
import type { Acteur, EtatDossier } from "@/core/dossier";
import { peutClore, peutConfirmer, systemesDuDepart } from "@/core/dossier";
import { CLE_INCUBATEUR } from "@/core/modele-plan";
import { empreinteDuPlan } from "@/core/plan";
import { Prisma } from "@/generated/prisma/client";
import {
  calculerPlan,
  enregistrerPlan,
  enregistrerPlanDOuverture,
  ouvrirDossier,
} from "@/lib/dossier";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/inutilise";
process.env["ESPACE_MEMBRE_API_KEY"] ??= "inutilisee";

interface IdentiteEnBase {
  personId: string;
  provider: string;
  matchMethod: string;
  vanishedAt: Date | null;
}

interface DossierEnBase {
  id: string;
  personId: string;
  kind: string;
  state: string;
  effectiveDate: Date | null;
}

interface EtapeEcrite {
  systemKey: string;
  tier: string;
  capability: string;
  action: string;
  label: string;
  ordre: number;
  params: object;
  riskLevel: string;
  expectedState: object;
  idempotencyKey: string;
  manual?: object;
  template?: object;
  expectedActor?: string;
  validationBy?: string;
}

interface EtapeDeModeleEnBase {
  key: string;
  position: number;
  title: string;
  runbook: string | null;
  deeplink: string | null;
  doneWhen: string;
  input: unknown;
  riskLevel: string;
  /**
   * Les deux colonnes de la répartition, requises ici comme en base : facultatives,
   * ce double cesserait de décrire une ligne réelle sans que rien ne le dise, et
   * `etapePlanifiee` émettrait `undefined` là où Prisma rend toujours une valeur.
   */
  expectedActor: Acteur;
  validationBy: Acteur | null;
}

interface ModeleEnBase {
  ownerKey: string;
  kind: string;
  startupsMayExtend: boolean;
  steps: EtapeDeModeleEnBase[];
}

interface PlanEnBase {
  id: string;
  accessCaseId: string;
  kind: string;
  state: string;
  planDigest: string;
  createdBy: string;
  expiresAt: Date;
  steps: readonly EtapeEcrite[];
}

const base = vi.hoisted(() => ({
  identites: [] as IdentiteEnBase[],
  dossiers: [] as DossierEnBase[],
  plans: [] as PlanEnBase[],
  modeles: [] as ModeleEnBase[],
  startupsCollectees: [] as string[],
  rattachements: [] as { startupGhid: string; until: Date; endedAt: Date | null }[],
  lecturesDeModeles: 0,
  connecteurs: [] as Connector[],
  lecturesDIdentites: 0,
  collisionAuProchainCreate: null as Error | null,
  collisionAuProchainPlan: null as Error | null,
  planGagnantEcritParLaCollision: true,
  /** Faux quand la collision ne vient pas d'une course, donc sans dossier a rendre. */
  gagnantEcritParLaCollision: true,
}));

vi.mock("@/connectors", () => ({ CONNECTEURS: base.connecteurs }));

vi.mock("@/lib/db", () => ({
  prisma: {
    externalIdentity: {
      findMany: ({ where }: { where: { personId: string } }) => {
        base.lecturesDIdentites += 1;
        return Promise.resolve(
          base.identites.filter(
            (identite) => identite.personId === where.personId && identite.vanishedAt === null,
          ),
        );
      },
    },
    person: {
      findUnique: () =>
        Promise.resolve({
          startups: base.startupsCollectees,
          startupAssignments: base.rattachements.filter(
            (rattachement) => rattachement.endedAt === null,
          ),
        }),
    },
    planTemplate: {
      findMany: ({ where }: { where: { ownerKey: { in: readonly string[] }; kind: string } }) => {
        base.lecturesDeModeles += 1;
        return Promise.resolve(
          base.modeles.filter(
            (modele) => where.ownerKey.in.includes(modele.ownerKey) && modele.kind === where.kind,
          ),
        );
      },
    },
    accessCase: {
      findFirst: ({
        where,
      }: {
        where: { personId: string; kind: string; state: { in: readonly string[] } };
      }) =>
        Promise.resolve(
          base.dossiers.find(
            (dossier) =>
              dossier.personId === where.personId &&
              dossier.kind === where.kind &&
              where.state.in.includes(dossier.state),
          ) ?? null,
        ),
      create: ({
        data,
      }: {
        data: { personId: string; kind: string; state: string; effectiveDate?: Date };
      }) => {
        const collision = base.collisionAuProchainCreate;
        if (collision) {
          base.collisionAuProchainCreate = null;
          if (base.gagnantEcritParLaCollision) {
            base.dossiers.push({
              id: "dossier-concurrent",
              personId: data.personId,
              kind: data.kind,
              state: data.state,
              effectiveDate: null,
            });
          }
          return Promise.reject(collision);
        }

        const dossier: DossierEnBase = {
          id: `dossier-${base.dossiers.length + 1}`,
          personId: data.personId,
          kind: data.kind,
          state: data.state,
          effectiveDate: data.effectiveDate ?? null,
        };
        base.dossiers.push(dossier);
        return Promise.resolve(dossier);
      },
    },
    plan: {
      create: ({
        data,
      }: {
        data: Omit<PlanEnBase, "steps"> & { steps: { create: readonly EtapeEcrite[] } };
      }) => {
        const collision = base.collisionAuProchainPlan;
        if (collision) {
          base.collisionAuProchainPlan = null;
          if (base.planGagnantEcritParLaCollision) {
            const { steps, ...entete } = data;
            base.plans.push({ ...entete, id: "plan-concurrent", steps: steps.create });
          }
          return Promise.reject(collision);
        }

        const { steps, ...entete } = data;
        base.plans.push({ ...entete, steps: steps.create });
        return Promise.resolve({ id: data.id });
      },
      count: ({ where }: { where: { accessCaseId: string } }) =>
        Promise.resolve(
          base.plans.filter((plan) => plan.accessCaseId === where.accessCaseId).length,
        ),
    },
  },
}));

const PERSONNE = "personne-1";
const USERNAME = "camille.exemple";
const MAINTENANT = new Date("2026-08-24T09:00:00Z");

const identite = (over: Partial<IdentiteEnBase>): IdentiteEnBase => ({
  personId: PERSONNE,
  provider: "github",
  matchMethod: "GITHUB_LOGIN",
  vanishedAt: null,
  ...over,
});

const contextes: RunContext[] = [];

/**
 * Un connecteur qui sait ouvrir un accès. Aucun n'en déclare dans le dépôt : la
 * capacité d'octroi appartient à un autre lot, et le mécanisme d'arrivée doit
 * pourtant se prouver aujourd'hui, sans quoi rien ne dirait qu'il se remplira le
 * jour où un vrai connecteur déclarera `grant`.
 */
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
  plan: (intent: Intent, ctx: RunContext) => {
    contextes.push(ctx);

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

/**
 * Le calcul d'un plan de départ tel qu'il s'écrivait avant que le dossier porte un
 * sens, transcrit ici et non importé : c'est un témoin de non-régression, il doit
 * survivre à la disparition du code d'origine.
 */
async function ancienCalcul(): Promise<{ etapes: PlannedStep[]; empreinte: string }> {
  const constates = systemesDuDepart(
    base.identites
      .filter((entree) => entree.personId === PERSONNE && entree.vanishedAt === null)
      .map((entree) => ({ provider: entree.provider, methode: entree.matchMethod })),
  );
  const presente = new Set(constates.revocables);

  const ctx: RunContext = {
    runId: "ancien",
    now: MAINTENANT,
    dryRun: true,
    audit: () => undefined,
  };

  const etapes: PlannedStep[] = [];
  for (const connecteur of base.connecteurs) {
    if (!presente.has(connecteur.contract.key)) {
      continue;
    }
    etapes.push(
      ...(await connecteur.plan(
        { kind: "revoke", subject: { kind: "person", username: USERNAME } },
        ctx,
      )),
    );
  }

  return { etapes, empreinte: empreinteDuPlan(etapes) };
}

/**
 * Un connecteur qui ne sait que retirer. Il tient le filtre d'une arrivée : sans lui
 * dans le registre, « seuls les connecteurs qui déclarent l'octroi sont interrogés »
 * s'affirmerait sans que rien ne puisse le démentir.
 */
const SANS_OCTROI: Connector = {
  contract: {
    key: "coffre",
    label: "Coffre",
    criticality: "low",
    runbook: "Retirer la personne des collections du coffre.",
    credentials: [],
    capabilities: { revoke: [{ requires: [], tier: "manual" }] },
    scopeSchema: z.object({}),
  },
  probe: () => Promise.resolve([]),
  plan: (_intent: Intent, ctx: RunContext) => {
    contextes.push(ctx);
    return Promise.resolve([]);
  },
};

const GITHUB = creerGithub(() => ({ organisations: ["incubateur-ademe", "betagouv"] }));

function registre(...connecteurs: readonly Connector[]): void {
  base.connecteurs.length = 0;
  base.connecteurs.push(...connecteurs);
}

beforeEach(() => {
  base.identites.length = 0;
  base.modeles.length = 0;
  base.startupsCollectees.length = 0;
  base.rattachements.length = 0;
  base.lecturesDeModeles = 0;
  base.dossiers.length = 0;
  base.plans.length = 0;
  base.lecturesDIdentites = 0;
  base.collisionAuProchainCreate = null;
  base.gagnantEcritParLaCollision = true;
  base.collisionAuProchainPlan = null;
  base.planGagnantEcritParLaCollision = true;
  contextes.length = 0;
  registre(GITHUB, notion);
});

/**
 * Le dossier a gagné un sens, et le départ ne devait rien y perdre : c'est le seul
 * mouvement de ce lot dont un utilisateur pourrait constater la régression dès
 * demain matin, sur l'écran où se décide une coupure d'accès.
 */
describe("un plan de départ, après que le dossier a gagné un sens", () => {
  it("propose les mêmes étapes et la même empreinte que le calcul qui le précédait", async () => {
    // Given une personne observée sur les deux systèmes que l'outil sait traiter, et
    // sur un troisième qu'aucun connecteur ne couvre
    base.identites.push(
      identite({ provider: "github", matchMethod: "GITHUB_LOGIN" }),
      identite({ provider: "notion", matchMethod: "EMAIL_EXACT" }),
      identite({ provider: "mattermost", matchMethod: "DECLARED" }),
    );

    // When on calcule son départ, et qu'on rejoue le calcul d'avant
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    const ancien = await ancienCalcul();

    // Then les étapes sont les mêmes, dans le même ordre, à la lettre près
    expect(calcule.etapes.map(({ etape }) => etape)).toEqual(ancien.etapes);
    expect(ancien.etapes).toHaveLength(3);
    expect(calcule.etapes.map(({ etape }) => etape.idempotencyKey)).toEqual([
      "github:incubateur-ademe:revoke:camille.exemple",
      "github:betagouv:revoke:camille.exemple",
      "notion:revoke:camille.exemple",
    ]);

    // Then l'empreinte est la même : un plan déjà confirmé ne se découvre pas
    // obsolète du seul fait que le code a changé de forme.
    expect(calcule.empreinte).toBe(ancien.empreinte);
    expect(calcule.empreinte).toBe(empreinteDuPlan(ancien.etapes));

    // Then ce que le plan dit des systèmes ne bouge pas davantage : celui qu'aucun
    // connecteur ne traite continue de se dire, son silence passerait sinon pour
    // une absence de compte.
    expect(calcule.systemes).toEqual(["github", "notion"]);
    expect(calcule.sansConnecteur).toEqual(["mattermost"]);
    expect(calcule.nonConfirmes).toEqual([]);

    // Then ce que le sens ajoute par-dessus, sans rien retrancher : chaque étape
    // porte son origine et un rang de lecture strictement croissant, et rien n'a
    // été écarté en chemin.
    expect(calcule.sens).toBe("OFFBOARDING");
    expect(calcule.etapes.map(({ origine }) => origine)).toEqual([
      "connecteur",
      "connecteur",
      "connecteur",
    ]);
    expect(calcule.etapes.map(({ ordre }) => ordre)).toEqual([0, 1, 2]);
    expect(calcule.ecartees).toEqual([]);
  });

  it("fige en base ce qui a été calculé, et rien d'autre", async () => {
    // Given un départ calculé pour une personne observée sur un seul système
    base.identites.push(identite({ provider: "notion", matchMethod: "DECLARED" }));
    const dossier = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // When on l'enregistre
    const planId = await enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT);

    // Then le plan porte le sens de son dossier, et non plus un sens écrit en dur
    const plan = base.plans[0];
    expect(base.plans).toHaveLength(1);
    expect(plan?.id).toBe(planId);
    expect(plan?.kind).toBe("OFFBOARDING");
    expect(plan?.state).toBe("DRAFT");
    expect(plan?.accessCaseId).toBe(dossier.id);
    expect(plan?.createdBy).toBe("operatrice.exemple");

    // Then l'empreinte enregistrée est celle des étapes nues : la suffixer d'abord
    // rendrait incomparables deux plans successifs du même dossier.
    expect(plan?.planDigest).toBe(calcule.empreinte);
    expect(plan?.steps.map((etape) => etape.idempotencyKey)).toEqual([
      `notion:revoke:${USERNAME}:${planId}`,
    ]);
    expect(empreinteDuPlan(calcule.etapes.map(({ etape }) => etape))).toBe(plan?.planDigest);

    // Then le rang de lecture est figé dans la ligne, au même titre que le libellé
    expect(plan?.steps.map((etape) => etape.ordre)).toEqual([0]);
    expect(plan?.steps[0]?.label).toBe(`Retirer ${USERNAME} du workspace Notion`);
    expect(plan?.steps[0]?.manual).toBeDefined();

    // Then la validité reste de sept jours, elle ne dépend pas du sens
    expect(plan?.expiresAt).toEqual(new Date("2026-08-31T09:00:00Z"));
  });
});

/**
 * L'arrivée emprunte le même mécanisme que le départ. Elle sort vide aujourd'hui :
 * les connecteurs déclarent l'octroi mais n'en rendent pas encore les étapes, et ce
 * vide est le résultat attendu plutôt qu'une panne. Ce qui se prouve ici, c'est que
 * le mécanisme se remplira tout seul le jour où l'un d'eux rendra quelque chose.
 */
describe("un plan d'arrivée", () => {
  it("s'instancie, assemble ce qui existe, et se laisse confirmer", async () => {
    // Given des connecteurs qui déclarent l'octroi, dont un seul en rend aujourd'hui
    // les étapes, un dernier qui ne sait que retirer, et une personne dont on ignore
    // tout des comptes
    registre(GITHUB, notion, ATELIER, SANS_OCTROI);

    // When on ouvre son arrivée et qu'on calcule son plan
    const dossier = await ouvrirDossier(PERSONNE, "ONBOARDING", new Date("2026-09-01"));
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then une arrivée naît confirmée : l'ouvrir est déjà la décision
    expect(base.dossiers[0]?.kind).toBe("ONBOARDING");
    expect(base.dossiers[0]?.state).toBe("CONFIRMED");

    // Then seuls les connecteurs qui déclarent l'octroi sont interrogés, et aucune
    // étape de retrait ne s'est glissée dans une arrivée
    expect(calcule.systemes).toEqual(["github", "notion", "atelier"]);
    expect(calcule.etapes.map(({ etape }) => etape.capability)).toEqual(["grant", "grant"]);
    expect(calcule.etapes.map(({ etape }) => etape.idempotencyKey)).toEqual([
      `atelier:lecture:grant:${USERNAME}`,
      `atelier:ecriture:grant:${USERNAME}`,
    ]);
    expect(calcule.etapes.map(({ ordre }) => ordre)).toEqual([0, 1]);
    expect(calcule.ecartees).toEqual([]);

    // Then les comptes observés n'ont pas même été lus : ils ne disent rien de ce
    // qu'il faut donner, et les afficher ferait passer un accès existant pour un
    // manque.
    expect(base.lecturesDIdentites).toBe(0);
    expect(calcule.sansConnecteur).toEqual([]);
    expect(calcule.nonConfirmes).toEqual([]);

    // Then le calcul ne s'autorise rien : simuler reste le défaut, et le contexte
    // le dit aux connecteurs qu'il interroge.
    expect(contextes).toHaveLength(1);
    expect(contextes[0]?.dryRun).toBe(true);

    // Then ce plan se confirme, puisqu'il demande quelque chose
    const planId = await enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT);
    const plan = base.plans[0];
    expect(plan?.id).toBe(planId);
    expect(plan?.kind).toBe("ONBOARDING");
    expect(plan?.steps.map((etape) => etape.ordre)).toEqual([0, 1]);
    expect(
      peutConfirmer("DRAFT", { perime: false, obsolete: false }, plan?.steps.length ?? 0),
    ).toEqual({ possible: true });
  });

  it("sort vide quand rien ne le remplit, et se clôt quand même", async () => {
    // Given le dépôt tel qu'il est aujourd'hui : deux connecteurs qui déclarent
    // l'octroi sans en rendre encore les étapes, et aucun modèle d'arrivée
    base.identites.push(identite({ provider: "github", matchMethod: "GITHUB_LOGIN" }));

    // When on calcule l'arrivée de la même personne
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then le plan est vide, et il l'est parce que personne ne rend encore d'étape
    // d'octroi, pas parce que la personne n'aurait besoin de rien : les deux systèmes
    // ont bien été interrogés
    expect(calcule.etapes).toEqual([]);
    expect(calcule.systemes).toEqual(["github", "notion"]);
    expect(calcule.ecartees).toEqual([]);

    // Then la confirmation le refuse, à raison : confirmer « rien à faire » donnerait
    // un dossier qui a l'air traité alors que personne n'a rien constaté.
    const vide = peutConfirmer("DRAFT", { perime: false, obsolete: false }, calcule.etapes.length);
    expect(vide.possible).toBe(false);

    // Then la clôture reste ouverte, sans quoi ce dossier n'aurait pour seule sortie
    // que l'annulation, qui inscrirait que l'arrivée n'aura pas lieu.
    expect(peutClore("ONBOARDING", "CONFIRMED", "DRAFT", calcule.etapes.length)).toEqual({
      possible: true,
    });
  });

  it("laisse une arrivée et un départ coexister, sans jamais en ouvrir deux du même sens", async () => {
    // Given une personne qui revient : son départ se solde pendant qu'on prépare son
    // retour
    const arrivee = await ouvrirDossier(PERSONNE, "ONBOARDING", null);
    const depart = await ouvrirDossier(PERSONNE, "OFFBOARDING", new Date("2026-09-30"));

    // Then deux dossiers vivants, un par sens, chacun dans son état de naissance
    expect(arrivee.deja).toBe(false);
    expect(depart.deja).toBe(false);
    expect(arrivee.id).not.toBe(depart.id);
    expect(base.dossiers.map((dossier) => [dossier.kind, dossier.state])).toEqual([
      ["ONBOARDING", "CONFIRMED"],
      ["OFFBOARDING", "CANDIDATE"],
    ]);

    // When on redemande le même sens
    const encore = await ouvrirDossier(PERSONNE, "ONBOARDING", null);

    // Then on retombe sur celui qui est ouvert : deux dossiers concurrents pour une
    // même arrivée produiraient deux plans et deux façons de croire que c'est réglé.
    expect(encore).toEqual({ id: arrivee.id, deja: true });
    expect(base.dossiers).toHaveLength(2);

    // Then un dossier clos ne bloque plus rien : le sens redevient ouvrable.
    const clos = base.dossiers.find((dossier) => dossier.id === arrivee.id);
    if (clos) {
      clos.state = "DONE" satisfies EtatDossier;
    }
    const seconde = await ouvrirDossier(PERSONNE, "ONBOARDING", null);
    expect(seconde.deja).toBe(false);
    expect(base.dossiers).toHaveLength(3);
  });

  it("rend le dossier gagnant quand deux ouvertures se croisent, sans doublon ni erreur", async () => {
    // Given deux opérateurs qui ouvrent la même arrivée en même temps : notre lecture
    // ne voit rien, et entre elle et notre écriture l'autre a écrit. L'index partiel
    // refuse la nôtre.
    base.collisionAuProchainCreate = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`personId`,`kind`)",
      { code: "P2002", clientVersion: "7.9.1" },
    );

    // When on ouvre le dossier
    const perdant = await ouvrirDossier(PERSONNE, "ONBOARDING", null);

    // Then le geste aboutit sur le dossier de l'autre, annoncé comme déjà ouvert : la
    // course se résout comme elle se serait résolue une milliseconde plus tôt.
    expect(perdant).toEqual({ id: "dossier-concurrent", deja: true });
    expect(base.dossiers).toHaveLength(1);

    // Then rien ne remonte à l'écran : une violation d'unicité affichée telle quelle
    // serait une erreur technique pour un geste qui a en réalité abouti.
    const suivant = await ouvrirDossier(PERSONNE, "ONBOARDING", null);
    expect(suivant).toEqual({ id: "dossier-concurrent", deja: true });
  });

  it("garde un seul plan quand deux ouvertures reprennent le même dossier sans plan", async () => {
    // Given un dossier ouvert dont le plan manque, parce qu'une ouverture s'était
    // interrompue entre ses deux écritures, et deux reprises simultanées : les deux
    // comptent zéro plan, les deux calculent, et l'index en base refuse la seconde.
    const dossier = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    base.collisionAuProchainPlan = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`accessCaseId`)",
      { code: "P2002", clientVersion: "7.9.1" },
    );

    // When la reprise perdante enregistre son plan
    await enregistrerPlanDOuverture(dossier.id, calcule, "operatrice.exemple", MAINTENANT);

    // Then le dossier ne porte que le plan gagnant : deux plans sur un même dossier ne
    // se départagent pas, et les écrans finiraient par en montrer un puis l'autre.
    expect(base.plans).toHaveLength(1);
    expect(base.plans[0]?.id).toBe("plan-concurrent");
  });

  it("laisse remonter une collision de plan qui ne vient pas d'une course", async () => {
    // Given une collision sans plan derrière : rien n'a été écrit, il n'y a donc aucun
    // plan gagnant à garder.
    const dossier = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    base.planGagnantEcritParLaCollision = false;
    base.collisionAuProchainPlan = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "7.9.1" },
    );

    // Then l'erreur n'est pas avalée : un dossier annoncé ouvert sans plan derrière est
    // exactement l'état que la reprise existe pour éviter.
    await expect(
      enregistrerPlanDOuverture(dossier.id, calcule, "operatrice.exemple", MAINTENANT),
    ).rejects.toThrow("Unique constraint failed");
    expect(base.plans).toHaveLength(0);
  });

  it("laisse remonter une violation d'unicité qui ne vient pas d'une course", async () => {
    // Given une collision sur une autre contrainte que celle du dossier vivant : rien
    // n'a été écrit, il n'y a donc aucun dossier gagnant à rendre.
    base.gagnantEcritParLaCollision = false;
    base.collisionAuProchainCreate = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "7.9.1" },
    );

    // Then l'erreur n'est pas avalée : la faire passer pour une course masquerait un
    // défaut d'écriture, et le geste serait annoncé comme abouti sans dossier derrière.
    await expect(ouvrirDossier(PERSONNE, "ONBOARDING", null)).rejects.toThrow(
      "Unique constraint failed",
    );
    expect(base.dossiers).toHaveLength(0);
  });
});

/**
 * La règle la plus lourde de conséquences du produit, et elle vaut dans les deux
 * sens : un compte rattaché sur une ressemblance de nom appartient peut-être à
 * quelqu'un d'autre. Le retrait couperait un homonyme, l'octroi ouvrirait un accès
 * à quelqu'un qui n'a rien demandé.
 */
describe("ce qu'un plan a le droit de viser, dans un sens comme dans l'autre", () => {
  it("ne fait naître aucune étape d'une identité devinée ou non rattachée", async () => {
    // Given une personne dont les deux comptes connus ne sont rattachés que sur une
    // ressemblance, ou pas rattachés du tout
    registre(GITHUB, notion, ATELIER);
    base.identites.push(
      identite({ provider: "github", matchMethod: "HEURISTIC" }),
      identite({ provider: "notion", matchMethod: "NONE" }),
    );

    // When on calcule son départ
    const depart = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then aucune étape, et surtout pas le silence : les deux systèmes se disent,
    // avec ce qui les empêche d'être visés.
    expect(depart.etapes).toEqual([]);
    expect(depart.systemes).toEqual([]);
    expect(depart.nonConfirmes).toEqual(["github", "notion"]);
    expect(depart.sansConnecteur).toEqual([]);

    // When on calcule son arrivée avec les mêmes identités douteuses
    const arrivee = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then aucune de ces identités n'a produit d'étape non plus : ce qui est proposé
    // vient de ce qu'un connecteur sait donner à un `username`, jamais d'un compte
    // que personne n'a tranché.
    expect(arrivee.etapes.map(({ etape }) => etape.systemKey)).toEqual(["atelier", "atelier"]);
    expect(arrivee.etapes.every(({ etape }) => etape.capability === "grant")).toBe(true);

    // Then le plan d'arrivée est exactement celui d'une personne sans aucun compte
    // observé : une ressemblance ne pèse rien, ni dans un sens ni dans l'autre.
    base.identites.length = 0;
    const sansCompte = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);
    expect(sansCompte.etapes).toEqual(arrivee.etapes);
    expect(sansCompte.empreinte).toBe(arrivee.empreinte);
  });

  it("laisse un compte sûr produire son étape, et le compte deviné du même système ne rien ajouter", async () => {
    // Given deux comptes sur le même système, l'un reconnu, l'autre deviné
    base.identites.push(
      identite({ provider: "notion", matchMethod: "EMAIL_EXACT" }),
      identite({ provider: "notion", matchMethod: "HEURISTIC" }),
      identite({
        provider: "github",
        matchMethod: "GITHUB_LOGIN",
        vanishedAt: new Date("2026-08-01"),
      }),
    );

    // When on calcule le départ
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then le système est visé une fois, et il reste dit qu'un compte y attend une
    // décision humaine
    expect(calcule.etapes.map(({ etape }) => etape.systemKey)).toEqual(["notion"]);
    expect(calcule.nonConfirmes).toEqual(["notion"]);

    // Then l'identité disparue ne compte pas : on ne l'observe plus, il n'y a plus
    // rien à y couper.
    expect(calcule.systemes).toEqual(["notion"]);
    expect(calcule.etapes.every(({ etape }) => etape.systemKey !== "github")).toBe(true);
  });
});

/**
 * L'assemblage réunit trois origines en une liste dont l'ordre ne dépend de
 * personne. Une seule est câblée dans ce lot, et c'est précisément parce que les
 * deux autres viendront qu'un doublon doit se dire plutôt que de disparaître.
 */
describe("ce que l'assemblage retient et ce qu'il écarte", () => {
  it("ne demande pas deux fois le même geste, et le dit tout haut", async () => {
    // Given un connecteur qui se répète, deux organisations portant le même nom
    // dans la configuration
    const bavard = creerGithub(() => ({ organisations: ["incubateur-ademe", "incubateur-ademe"] }));
    registre(bavard, notion);
    base.identites.push(
      identite({ provider: "github", matchMethod: "GITHUB_LOGIN" }),
      identite({ provider: "notion", matchMethod: "DECLARED" }),
    );

    // When on calcule le départ
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then le geste n'est demandé qu'une fois, et le rang reste strictement croissant
    expect(calcule.etapes.map(({ etape }) => etape.idempotencyKey)).toEqual([
      `github:incubateur-ademe:revoke:${USERNAME}`,
      `notion:revoke:${USERNAME}`,
    ]);
    expect(calcule.etapes.map(({ ordre }) => ordre)).toEqual([0, 1]);

    // Then l'étape écartée n'est pas perdue : elle porte son origine et sa raison,
    // parce qu'écarter en silence ce qu'un système a déclaré est la panne muette
    // que cet outil existe pour éviter.
    expect(calcule.ecartees).toHaveLength(1);
    expect(calcule.ecartees[0]?.origine).toBe("connecteur");
    expect(calcule.ecartees[0]?.raison).toBe("doublon");
    expect(calcule.ecartees[0]?.etape.idempotencyKey).toBe(
      `github:incubateur-ademe:revoke:${USERNAME}`,
    );

    // Then l'empreinte ne compte que ce qui est retenu : le doublon n'engage rien de
    // plus que le geste qu'il répète.
    expect(calcule.empreinte).toBe(empreinteDuPlan(calcule.etapes.map(({ etape }) => etape)));
  });
});

/**
 * Le sens d'un dossier n'est pas un libellé : c'est ce qui décide quelle intention
 * est présentée aux connecteurs. Se tromper ici ferait retirer ce qu'on voulait
 * donner.
 */
describe("l'intention portée aux connecteurs", () => {
  it("demande un octroi pour une arrivée et un retrait pour un départ", async () => {
    // Given un connecteur qui rend l'intention qu'on lui présente
    const intentions: Intent[] = [];
    const mouchard: Connector = {
      ...ATELIER,
      contract: {
        ...ATELIER.contract,
        key: "mouchard",
        capabilities: { grant: [{ requires: [], tier: "manual" }] },
      },
      plan: (intent: Intent) => {
        intentions.push(intent);
        return Promise.resolve([]);
      },
    };
    registre(mouchard);
    base.identites.push(identite({ provider: "mouchard", matchMethod: "DECLARED" }));

    // When on calcule les deux sens
    await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);
    await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then chacun demande ce que son sens veut dire, sur le même sujet
    expect(intentions.map((intent) => intent.kind)).toEqual(["grant", "revoke"]);
    expect(intentions.every((intent) => intent.subject.kind === "person")).toBe(true);
    expect(
      intentions.map((intent) =>
        intent.subject.kind === "person" ? intent.subject.username : null,
      ),
    ).toEqual([USERNAME, USERNAME]);
  });
});

function modele(
  ownerKey: string,
  startupsMayExtend: boolean,
  steps: readonly Partial<EtapeDeModeleEnBase>[],
): void {
  base.modeles.push({
    ownerKey,
    kind: "OFFBOARDING",
    startupsMayExtend,
    steps: steps.map((etape, position) => ({
      key: "cle",
      position,
      title: "Titre",
      runbook: null,
      deeplink: null,
      doneWhen: "C'est constaté.",
      input: null,
      riskLevel: "LOW",
      expectedActor: "OPERATOR",
      validationBy: null,
      ...etape,
    })),
  });
}

/**
 * Un plan ne se limite plus à ce que les connecteurs savent calculer. Ce qui se joue
 * ici est la jonction : les modèles se lisent sur les startups réellement en cours,
 * s'assemblent avec les connecteurs, et ce qui est écarté se dit.
 */
describe("un plan qui porte ce qu'aucun système ne connaît", () => {
  it("assemble l'incubateur, les startups en cours et les connecteurs, puis fige leur origine", async () => {
    // Given une personne collectée sur une startup, rattachée à la main à une
    // seconde, et un modèle porté par une troisième dont elle n'est pas
    base.startupsCollectees.push("alpha");
    base.rattachements.push({
      startupGhid: "beta",
      until: new Date("2026-12-31"),
      endedAt: null,
    });
    base.identites.push(identite({ provider: "notion", matchMethod: "DECLARED" }));

    modele(CLE_INCUBATEUR, true, [
      { key: "rendre-le-materiel", title: "Rendre le matériel" },
      {
        key: "signer-la-decharge",
        title: "Signer la décharge",
        input: { libelle: "Numéro de la décharge", obligatoire: true },
      },
    ]);
    modele("alpha", false, [
      { key: "rendre-le-badge", title: "Rendre le badge alpha" },
      { key: "signer-la-decharge", title: "Signer la décharge" },
    ]);
    modele("beta", false, [{ key: "vider-le-casier", title: "Vider le casier beta" }]);
    modele("gamma", false, [{ key: "prevenir-le-lead", title: "Prévenir le lead gamma" }]);

    // When on calcule son départ
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then l'ordre suit les origines et non l'ordre d'appel : l'incubateur, puis les
    // startups par ghid croissant, puis les connecteurs
    expect(calcule.etapes.map(({ etape }) => etape.label)).toEqual([
      "Rendre le matériel",
      "Signer la décharge",
      "Rendre le badge alpha",
      "Vider le casier beta",
      `Retirer ${USERNAME} du workspace Notion`,
    ]);
    expect(calcule.etapes.map(({ origine }) => origine)).toEqual([
      "modele:incubateur",
      "modele:incubateur",
      "modele:startup:alpha",
      "modele:startup:beta",
      "connecteur",
    ]);
    expect(calcule.etapes.map(({ ordre }) => ordre)).toEqual([0, 1, 2, 3, 4]);

    // Then une startup à laquelle elle n'est pas rattachée ne dit rien : ni étape,
    // ni écartée. Les modèles ont été lus en une seule fois, quel que soit le
    // nombre de rattachements.
    expect(JSON.stringify(calcule)).not.toContain("gamma");
    expect(base.lecturesDeModeles).toBe(1);

    // Then le geste que deux modèles demandaient n'est demandé qu'une fois, et c'est
    // l'incubateur qui le porte : le premier arrivé gagne et garde sa place
    expect(calcule.ecartees).toHaveLength(1);
    expect(calcule.ecartees[0]?.raison).toBe("doublon");
    expect(calcule.ecartees[0]?.origine).toBe("modele:startup:alpha");
    expect(calcule.ecartees[0]?.etape.idempotencyKey).toBe("modele:signer-la-decharge");

    // Then une étape déclarée est une étape de plan ordinaire, remplie de façon
    // documentée : un système réservé, un tier manuel, la capacité du moment, et
    // aucun état attendu à relire
    const declaree = calcule.etapes[1]?.etape;
    expect(declaree?.systemKey).toBe("modele");
    expect(declaree?.tier).toBe("manual");
    expect(declaree?.capability).toBe("revoke");
    expect(declaree?.expectedState).toEqual({});
    expect(declaree?.manual?.doneWhen).toBe("C'est constaté.");
    expect(declaree?.template).toEqual({
      owner: CLE_INCUBATEUR,
      stepKey: "signer-la-decharge",
      saisie: { libelle: "Numéro de la décharge", obligatoire: true },
    });

    // When on fige ce plan
    const dossier = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    const planId = await enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT);

    // Then l'origine descend en base avec le reste : sans elle, l'écran du dossier
    // ne saurait plus dire qui a demandé quoi
    const etapes = base.plans[0]?.steps ?? [];
    expect(base.plans[0]?.id).toBe(planId);
    expect(etapes.map((etape) => etape.template)).toEqual([
      { owner: CLE_INCUBATEUR, stepKey: "rendre-le-materiel" },
      {
        owner: CLE_INCUBATEUR,
        stepKey: "signer-la-decharge",
        saisie: { libelle: "Numéro de la décharge", obligatoire: true },
      },
      { owner: "alpha", stepKey: "rendre-le-badge" },
      { owner: "beta", stepKey: "vider-le-casier" },
      undefined,
    ]);

    // Then les clés d'idempotence sont suffixées par le plan, sans quoi le retour de
    // cette personne des mois plus tard échouerait sur une violation d'unicité
    expect(etapes.map((etape) => etape.idempotencyKey)).toEqual([
      `modele:rendre-le-materiel:${planId}`,
      `modele:signer-la-decharge:${planId}`,
      `modele:rendre-le-badge:${planId}`,
      `modele:vider-le-casier:${planId}`,
      `notion:revoke:${USERNAME}:${planId}`,
    ]);
  });

  it("neutralise les étapes de startup que l'incubateur n'admet pas, sans rien leur retirer", async () => {
    // Given une startup qui déclare une étape, et un incubateur qui ne l'a pas admis
    base.startupsCollectees.push("alpha");
    modele(CLE_INCUBATEUR, false, [{ key: "rendre-le-materiel", title: "Rendre le matériel" }]);
    modele("alpha", false, [{ key: "rendre-le-badge", title: "Rendre le badge alpha" }]);

    // When on calcule son départ
    const ferme = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then seule l'étape de l'incubateur sort, et celle de la startup se dit tout
    // haut avec sa raison : neutralisée en silence, elle serait indiscernable d'une
    // étape que personne n'aurait écrite
    expect(ferme.etapes.map(({ etape }) => etape.label)).toEqual(["Rendre le matériel"]);
    expect(ferme.ecartees).toHaveLength(1);
    expect(ferme.ecartees[0]?.raison).toBe("non-autorise");
    expect(ferme.ecartees[0]?.origine).toBe("modele:startup:alpha");
    expect(ferme.ecartees[0]?.etape.label).toBe("Rendre le badge alpha");

    // When l'autorisation s'ouvre, sans qu'aucune étape n'ait été touchée
    const incubateur = base.modeles.find((entree) => entree.ownerKey === CLE_INCUBATEUR);
    if (incubateur) {
      incubateur.startupsMayExtend = true;
    }
    const ouvert = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then l'étape réapparaît à l'identique : refermer neutralise, rouvrir rend tout
    expect(ouvert.etapes.map(({ etape }) => etape.label)).toEqual([
      "Rendre le matériel",
      "Rendre le badge alpha",
    ]);
    expect(ouvert.ecartees).toEqual([]);

    // Then l'empreinte a bougé entre les deux : un brouillon calculé avant la
    // bascule se découvrira obsolète plutôt que de se confirmer sur un plan démenti
    expect(ouvert.empreinte).not.toBe(ferme.empreinte);

    // When le modèle de l'incubateur disparaît pour ce moment
    base.modeles.length = 0;
    modele("alpha", false, [{ key: "rendre-le-badge", title: "Rendre le badge alpha" }]);
    const sansIncubateur = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then l'étape de la startup est écartée de la même façon : l'absence de modèle
    // d'incubateur vaut absence d'autorisation, sinon un moment que personne n'a
    // ouvert serait le plus permissif de tous
    expect(sansIncubateur.etapes).toEqual([]);
    expect(sansIncubateur.ecartees.map(({ raison }) => raison)).toEqual(["non-autorise"]);
  });

  it("écarte une étape dont la saisie est illisible plutôt que de rendre le dossier inouvrable", async () => {
    // Given une personne rattachée à une startup, un modèle d'incubateur ouvert dont
    // une étape porte en base une valeur qui n'est pas une saisie attendue, et une
    // étape de startup dans le même état. Une telle valeur ne peut venir que d'une
    // écriture faite hors de cet outil.
    base.startupsCollectees.push("alpha");
    modele(CLE_INCUBATEUR, true, [
      { key: "rendre-le-materiel", title: "Rendre le matériel" },
      { key: "signer-la-decharge", title: "Signer la décharge", input: { obligatoire: true } },
    ]);
    modele("alpha", false, [
      { key: "rendre-le-badge", title: "Rendre le badge alpha", input: "n'importe quoi" },
    ]);

    // When on calcule le départ
    const ouvert = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then le calcul aboutit : faire lever la lecture fermerait l'ouverture, la
    // confirmation, le recalcul et l'affichage du dossier, sur un message que l'écran
    // d'erreur n'affiche même pas.
    expect(ouvert.etapes.map(({ etape }) => etape.label)).toEqual(["Rendre le matériel"]);

    // Then les deux étapes illisibles se disent tout haut, chacune avec le modèle qui
    // la porte : c'est cette liste qui dit à l'opérateur quoi aller réparer.
    expect(
      ouvert.ecartees.map(({ origine, raison, etape }) => [origine, raison, etape.label]),
    ).toEqual([
      ["modele:incubateur", "saisie-illisible", "Signer la décharge"],
      ["modele:startup:alpha", "saisie-illisible", "Rendre le badge alpha"],
    ]);

    // When l'incubateur referme l'autorisation donnée aux startups
    const incubateur = base.modeles.find((entree) => entree.ownerKey === CLE_INCUBATEUR);
    if (incubateur) {
      incubateur.startupsMayExtend = false;
    }
    const ferme = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then l'étape de la startup n'est plus qu'une étape neutralisée : refermer
    // neutralise, et une étape qu'aucun dossier ne portera n'a rien à réclamer.
    expect(ferme.ecartees.map(({ origine, raison }) => [origine, raison])).toEqual([
      ["modele:incubateur", "saisie-illisible"],
      ["modele:startup:alpha", "non-autorise"],
    ]);

    // Then une fois la saisie réécrite, l'étape revient à l'identique : elle n'a jamais
    // été supprimée, seulement écartée.
    const decharge = incubateur?.steps.find((etape) => etape.key === "signer-la-decharge");
    if (decharge) {
      decharge.input = { libelle: "Numéro de la décharge", obligatoire: true };
    }
    const repare = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    expect(repare.etapes.map(({ etape }) => etape.label)).toEqual([
      "Rendre le matériel",
      "Signer la décharge",
    ]);
    expect(repare.empreinte).not.toBe(ferme.empreinte);
  });

  it("s'applique autant de fois qu'il y a de dossiers, sans collision de clés", async () => {
    // Given un modèle d'incubateur, et quelqu'un qui part une première fois
    modele(CLE_INCUBATEUR, false, [{ key: "rendre-le-materiel", title: "Rendre le matériel" }]);
    const premier = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    const calculePremier = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    const planPremier = await enregistrerPlan(
      premier.id,
      calculePremier,
      "operatrice.exemple",
      MAINTENANT,
    );

    // When son départ est soldé, puis qu'elle revient et repart des mois plus tard
    const solde = base.dossiers.find((dossier) => dossier.id === premier.id);
    if (solde) {
      solde.state = "DONE" satisfies EtatDossier;
    }
    const second = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    const calculeSecond = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    const planSecond = await enregistrerPlan(
      second.id,
      calculeSecond,
      "operatrice.exemple",
      MAINTENANT,
    );

    // Then le même geste est redemandé, sous une clé distincte : le suffixe de plan
    // est ce qui rend un modèle réapplicable. Sans lui, la seconde écriture violerait
    // l'unicité, c'est-à-dire au retour de quelqu'un, des mois plus tard, dans un
    // chemin que personne n'aurait rejoué.
    expect(second.id).not.toBe(premier.id);
    expect(base.plans).toHaveLength(2);
    expect(base.plans[0]?.steps.map((etape) => etape.idempotencyKey)).toEqual([
      `modele:rendre-le-materiel:${planPremier}`,
    ]);
    expect(base.plans[1]?.steps.map((etape) => etape.idempotencyKey)).toEqual([
      `modele:rendre-le-materiel:${planSecond}`,
    ]);

    // Then les deux plans disent pourtant la même chose : l'empreinte se calcule sur
    // les étapes nues, et ne bouge pas d'un dossier à l'autre.
    expect(calculeSecond.empreinte).toBe(calculePremier.empreinte);
    expect(base.plans[1]?.planDigest).toBe(base.plans[0]?.planDigest);
  });
});

/**
 * Un connecteur qui confie ses étapes à qui on lui dit, et les fait contrôler par qui
 * on lui dit. Aucun connecteur du dépôt ne nomme encore d'acteur : sans celui-ci, la
 * recopie de la répartition en base ne pourrait ni se prouver ni se démentir.
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

/**
 * Qui doit agir et qui doit contrôler se figent avec le reste de l'étape, et la
 * répartition impossible meurt là où elle est écrite : aucune contrainte de base ne
 * double cette garde, la combinaison n'étant produite qu'ici.
 */
describe("la répartition des rôles, au moment de figer les étapes", () => {
  it("recopie ce que l'étape nomme, laisse le défaut à ce qu'elle tait, et refuse l'impossible", async () => {
    // Given une arrivée dont les trois gestes se répartissent différemment : un que
    // l'opérateur fait et que personne ne contrôle, un que la personne concernée fait
    // sous le regard de l'opérateur, un qu'elle fait et qu'on croit sur parole.
    registre(
      connecteurQuiRepartit({}, { acteur: "SUBJECT", valideur: "OPERATOR" }, { acteur: "SUBJECT" }),
    );
    const dossier = await ouvrirDossier(PERSONNE, "ONBOARDING", null);
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // When on fige le plan
    await enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT);

    // Then chaque étape porte sa répartition, sans table de traduction : les valeurs
    // du cœur et celles de l'énumération Prisma sont les mêmes littéraux.
    const etapes = base.plans[0]?.steps ?? [];
    expect(etapes.map((etape) => etape.expectedActor)).toEqual([undefined, "SUBJECT", "SUBJECT"]);
    expect(etapes.map((etape) => etape.validationBy)).toEqual([undefined, "OPERATOR", undefined]);

    // Then ce qui ne nomme personne ne s'écrit pas : la colonne porte son défaut,
    // « à faire par l'opérateur, sans contrôle », et non une valeur recopiée à la main.
    expect(etapes[0]).not.toHaveProperty("expectedActor");

    // Then la répartition entre dans l'empreinte : elle fait partie de ce qu'un
    // opérateur approuve en confirmant.
    registre(connecteurQuiRepartit({}, { acteur: "SUBJECT" }, { acteur: "SUBJECT" }));
    const autre = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);
    expect(autre.empreinte).not.toBe(calcule.empreinte);
  });

  it("refuse net un plan qui confie le contrôle d'une déclaration à qui la fait", async () => {
    // Given une arrivée dont un geste se ferait contrôler par celui qui le fait
    registre(connecteurQuiRepartit({ acteur: "SUBJECT", valideur: "SUBJECT" }));
    const dossier = await ouvrirDossier(PERSONNE, "ONBOARDING", null);
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // When on tente de le figer
    // Then il meurt là où il est écrit, et le message nomme l'étape et sa répartition :
    // ce qui sort d'ici est un défaut de construction, et le corriger demande de savoir
    // laquelle des origines l'a proposé.
    await expect(
      enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT),
    ).rejects.toThrow(/Geste n°1 de l'atelier.*SUBJECT agit, SUBJECT contrôle/s);

    // Then rien n'a été écrit : un plan à moitié figé attendrait pour toujours un
    // validateur qui ne peut pas exister.
    expect(base.plans).toEqual([]);
  });

  it("refuse qu'un délégué relise un opérateur, et fige le geste d'opérateur qu'un opérateur relit", async () => {
    // Given une arrivée où un délégué relirait ce que l'opérateur a fait
    registre(connecteurQuiRepartit({ acteur: "OPERATOR", valideur: "DELEGATE" }));
    const dossier = await ouvrirDossier(PERSONNE, "ONBOARDING", null);
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then le plan ne se fige pas : faire contrôler l'équipe transverse par quelqu'un
    // d'extérieur au dossier inverse la responsabilité.
    await expect(
      enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT),
    ).rejects.toThrow(/OPERATOR agit, DELEGATE contrôle/);
    expect(base.plans).toEqual([]);

    // Given la même arrivée, mais relue par un opérateur : c'est « j'ai retiré l'accès
    // administrateur », le geste qui ne se croit pas sur parole
    registre(connecteurQuiRepartit({ acteur: "OPERATOR", valideur: "OPERATOR" }));
    const relu = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then il se fige, et l'étape porte les deux rôles : ce n'est pas une déclaration
    // que son auteur redirait, la règle qui l'interdit portant sur le username.
    await enregistrerPlan(dossier.id, relu, "operatrice.exemple", MAINTENANT);
    expect(base.plans[0]?.steps[0]).toMatchObject({
      expectedActor: "OPERATOR",
      validationBy: "OPERATOR",
    });
  });

  it("fait descendre la répartition d'une étape de modèle jusqu'à la colonne du plan", async () => {
    // Given un départ que deux étapes de modèle et un connecteur alimentent : la
    // première étape confie le geste à la personne concernée sous le regard d'un
    // opérateur, la seconde ne répartit rien.
    base.identites.push(identite({ provider: "notion", matchMethod: "DECLARED" }));
    modele(CLE_INCUBATEUR, false, [
      {
        key: "signer-la-decharge",
        title: "Signer la décharge",
        expectedActor: "SUBJECT",
        validationBy: "OPERATOR",
      },
      { key: "rendre-le-materiel", title: "Rendre le matériel" },
    ]);

    // When on calcule le plan
    const calcule = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    expect(calcule.etapes.map(({ etape }) => etape.label)).toEqual([
      "Signer la décharge",
      "Rendre le matériel",
      `Retirer ${USERNAME} du workspace Notion`,
    ]);

    // Then la répartition voyage hors de `params` : elle entre dans l'empreinte par
    // ses propres termes, et l'y remettre la compterait deux fois.
    const declaree = calcule.etapes[0]?.etape;
    expect(declaree?.expectedActor).toBe("SUBJECT");
    expect(declaree?.validationBy).toBe("OPERATOR");
    expect(declaree?.params).not.toHaveProperty("acteur");
    expect(declaree?.params).not.toHaveProperty("controleur");

    // When on fige le plan
    const dossier = await ouvrirDossier(PERSONNE, "OFFBOARDING", null);
    await enregistrerPlan(dossier.id, calcule, "operatrice.exemple", MAINTENANT);

    // Then la colonne porte ce que le modèle nommait, et l'assemblage n'a touché ni à
    // l'un ni à l'autre : c'est la chaîne entière, de la ligne éditée à l'écran
    // jusqu'à la valeur que la garde du pointage relira.
    const etapes = base.plans[0]?.steps ?? [];
    expect(etapes.map((etape) => etape.expectedActor)).toEqual(["SUBJECT", "OPERATOR", undefined]);
    expect(etapes.map((etape) => etape.validationBy)).toEqual(["OPERATOR", undefined, undefined]);

    // Then une étape de modèle qui ne répartit rien écrit quand même son acteur, là où
    // une étape de connecteur laisse la colonne à son défaut : le modèle répond
    // toujours à la question, le connecteur ne se la pose pas.
    expect(etapes[1]).toHaveProperty("expectedActor");
    expect(etapes[2]).not.toHaveProperty("expectedActor");

    // Then le contrôleur nommé déplace l'empreinte : qui doit relire fait partie de ce
    // qu'un opérateur approuve en confirmant.
    base.modeles.length = 0;
    modele(CLE_INCUBATEUR, false, [
      { key: "signer-la-decharge", title: "Signer la décharge", expectedActor: "SUBJECT" },
      { key: "rendre-le-materiel", title: "Rendre le matériel" },
    ]);
    const sansControle = await calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);
    expect(sansControle.empreinte).not.toBe(calcule.empreinte);
  });
});
