import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { creerGithub } from "@/connectors/github";
import { notion } from "@/connectors/notion";
import type { Connector, Intent, PlannedStep, RunContext } from "@/core/connector";
import type { EtatDossier } from "@/core/dossier";
import { peutClore, peutConfirmer, systemesDuDepart } from "@/core/dossier";
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

const GITHUB = creerGithub(() => ({ organisations: ["incubateur-ademe", "betagouv"] }));

function registre(...connecteurs: readonly Connector[]): void {
  base.connecteurs.length = 0;
  base.connecteurs.push(...connecteurs);
}

beforeEach(() => {
  base.identites.length = 0;
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
 * L'arrivée emprunte le même mécanisme que le départ. Elle sort vide aujourd'hui,
 * faute de connecteur qui sache ouvrir un accès, et ce vide est le résultat attendu
 * plutôt qu'une panne : ce qui se prouve ici, c'est que le mécanisme se remplira
 * tout seul le jour où l'un d'eux le déclarera.
 */
describe("un plan d'arrivée", () => {
  it("s'instancie, assemble ce qui existe, et se laisse confirmer", async () => {
    // Given un connecteur qui sait ouvrir un accès, aux côtés de ceux qui n'en
    // savent rien, et une personne dont on ignore tout des comptes
    registre(GITHUB, notion, ATELIER);

    // When on ouvre son arrivée et qu'on calcule son plan
    const dossier = await ouvrirDossier(PERSONNE, "ONBOARDING", new Date("2026-09-01"));
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then une arrivée naît confirmée : l'ouvrir est déjà la décision
    expect(base.dossiers[0]?.kind).toBe("ONBOARDING");
    expect(base.dossiers[0]?.state).toBe("CONFIRMED");

    // Then seuls les connecteurs qui déclarent l'octroi sont interrogés, et aucune
    // étape de retrait ne s'est glissée dans une arrivée
    expect(calcule.systemes).toEqual(["atelier"]);
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

  it("sort vide tant qu'aucun connecteur ne sait ouvrir un accès, et se clôt quand même", async () => {
    // Given le dépôt tel qu'il est aujourd'hui : deux connecteurs, aucune capacité
    // d'octroi déclarée
    base.identites.push(identite({ provider: "github", matchMethod: "GITHUB_LOGIN" }));

    // When on calcule l'arrivée de la même personne
    const calcule = await calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT);

    // Then le plan est vide, et il l'est parce que personne ne sait encore donner,
    // pas parce que la personne n'aurait besoin de rien
    expect(calcule.etapes).toEqual([]);
    expect(calcule.systemes).toEqual([]);
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
