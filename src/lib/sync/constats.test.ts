import { beforeEach, describe, expect, it, vi } from "vitest";

import { FOURNISSEUR_PERIMETRE } from "@/core/collecte";
import { MISE_EN_SERVICE_DES_ARRIVEES } from "@/core/constat";
import type { IncubatorStartup } from "@/lib/espace-membre";
import { type PersonneAvantArrivee, syncConstats } from "@/lib/sync/constats";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/inutilise";
process.env["ESPACE_MEMBRE_API_KEY"] ??= "inutilisee";

interface ConstatEnBase {
  id: string;
  kind: string;
  dedupKey: string;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  closedBy: string | null;
}

interface PlanEnBase {
  kind: string;
  state: string;
  caseKind: string;
  username: string;
  confirmedAt: Date | null;
  steps: { executedAt: Date | null }[];
}

interface DossierEnBase {
  kind: string;
  state: string;
  closedAt: Date | null;
  username: string;
}

interface RunEnBase {
  provider: string;
  capability: string;
  startedAt: Date;
  itemsSeen: number;
}

interface FiltreConstats {
  kind: { in: string[] };
  closedAt?: null | { not: null };
  closedBy?: { not: null };
}

const base = vi.hoisted(() => ({
  constats: [] as ConstatEnBase[],
  plans: [] as PlanEnBase[],
  dossiers: [] as DossierEnBase[],
  runs: [] as RunEnBase[],
  journal: [] as { action: string; targetId: string | null }[],
}));

vi.mock("@/lib/db", () => {
  const correspond = (constat: ConstatEnBase, where: FiltreConstats): boolean => {
    if (!where.kind.in.includes(constat.kind)) {
      return false;
    }
    if (where.closedAt === null && constat.closedAt !== null) {
      return false;
    }
    if (where.closedAt !== null && where.closedAt !== undefined && constat.closedAt === null) {
      return false;
    }
    if (where.closedBy !== undefined && constat.closedBy === null) {
      return false;
    }
    return true;
  };

  return {
    prisma: {
      finding: {
        findMany: ({ where }: { where: FiltreConstats }) =>
          Promise.resolve(base.constats.filter((constat) => correspond(constat, where))),
        updateMany: ({ where }: { where: { id: { in: string[] } } }) => {
          for (const constat of base.constats) {
            if (where.id.in.includes(constat.id)) {
              constat.closedBy = null;
            }
          }
          return Promise.resolve({ count: where.id.in.length });
        },
        upsert: ({
          where,
          create,
        }: {
          where: { dedupKey: string };
          create: { kind: string; severity: string; openedAt: Date };
        }) => {
          const existant = base.constats.find((constat) => constat.dedupKey === where.dedupKey);
          if (existant) {
            existant.kind = create.kind;
            existant.openedAt = create.openedAt;
            existant.closedAt = null;
            existant.closeReason = null;
            return Promise.resolve(existant);
          }
          const constat: ConstatEnBase = {
            id: `f-${base.constats.length + 1}`,
            kind: create.kind,
            dedupKey: where.dedupKey,
            openedAt: create.openedAt,
            closedAt: null,
            closeReason: null,
            closedBy: null,
          };
          base.constats.push(constat);
          return Promise.resolve(constat);
        },
        update: ({
          where,
          data,
        }: {
          where: { id: string };
          data: { closedAt: Date; closeReason: string };
        }) => {
          const constat = base.constats.find((candidat) => candidat.id === where.id);
          if (constat) {
            constat.closedAt = data.closedAt;
            constat.closeReason = data.closeReason;
          }
          return Promise.resolve(constat);
        },
      },
      person: {
        findUnique: ({ where }: { where: { username: string } }) =>
          Promise.resolve({ id: `p-${where.username}` }),
      },
      plan: {
        findMany: ({ where }: { where: { kind: string; state: string } }) =>
          Promise.resolve(
            base.plans
              .filter(
                (plan) =>
                  plan.kind === where.kind &&
                  plan.state === where.state &&
                  plan.caseKind === where.kind,
              )
              .map((plan) => ({
                confirmedAt: plan.confirmedAt,
                steps: plan.steps,
                accessCase: { person: { username: plan.username } },
              })),
          ),
      },
      accessCase: {
        findMany: ({ where }: { where: { kind: string; state: string } }) =>
          Promise.resolve(
            base.dossiers
              .filter(
                (dossier) =>
                  dossier.kind === where.kind &&
                  dossier.state === where.state &&
                  dossier.closedAt !== null,
              )
              .map((dossier) => ({
                closedAt: dossier.closedAt,
                person: { username: dossier.username },
              })),
          ),
      },
      planStep: { findMany: () => Promise.resolve([]) },
      syncRun: {
        findFirst: ({ where }: { where: { provider: string; itemsSeen: { gt: number } } }) => {
          const candidats = base.runs
            .filter((run) => run.provider === where.provider && run.itemsSeen > where.itemsSeen.gt)
            .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
          return Promise.resolve(candidats[0] ?? null);
        },
        findMany: () => Promise.resolve([]),
      },
      auditEvent: {
        create: ({ data }: { data: { action: string; targetId: string | null } }) => {
          base.journal.push({ action: data.action, targetId: data.targetId });
          return Promise.resolve(data);
        },
      },
    },
  };
});

const TERMINALES = ["abandon", "transfere"];

const STARTUPS: IncubatorStartup[] = [
  { ghid: "produit-alpha", name: "Alpha", currentPhase: "acceleration", phaseStart: null },
  { ghid: "produit-omega", name: "Omega", currentPhase: "abandon", phaseStart: null },
];

/** Quinze jours avant la mise en service : c'est la constante qui fait l'amorçage. */
const PREMIERE_COLLECTE = new Date("2026-08-10T02:00:00Z");
const APRES_AMORCAGE = new Date("2026-08-26T02:00:00Z");
const AUJOURDHUI = new Date("2026-08-28T02:00:00Z");

const PART = 0.2;

const personne = (over: Partial<PersonneAvantArrivee> = {}): PersonneAvantArrivee => ({
  username: "camille.rivet",
  fullname: "Camille Rivet",
  attachment: "STARTUPS",
  startups: ["produit-alpha"],
  rattachementsManuels: [],
  missionEnd: new Date("2027-06-30T00:00:00Z"),
  vanishedAt: null,
  firstSeenAt: PREMIERE_COLLECTE,
  returnedAt: null,
  source: "BETA",
  ...over,
});

const lancer = (personnes: readonly PersonneAvantArrivee[], perimetreComplet: boolean) =>
  syncConstats(personnes, STARTUPS, [], TERMINALES, AUJOURDHUI, "correlation-1", {
    perimetreComplet,
    maxNewPersonShare: PART,
  });

const cle = (dedupKey: string) => base.constats.find((constat) => constat.dedupKey === dedupKey);

beforeEach(() => {
  base.constats.length = 0;
  base.plans.length = 0;
  base.dossiers.length = 0;
  base.runs.length = 0;
  base.journal.length = 0;
  base.runs.push({
    provider: FOURNISSEUR_PERIMETRE,
    capability: "list",
    startedAt: PREMIERE_COLLECTE,
    itemsSeen: 12,
  });
});

describe("la levée des arrivées, première des trois portes", () => {
  it("lève l'arrivée que personne n'a accueillie, et se tait dès que le périmètre est tronqué", async () => {
    // Ce que valent les dates de ce fichier tient à leur position autour de la mise en
    // service : la première collecte lui est antérieure, l'arrivée postérieure.
    expect(PREMIERE_COLLECTE < MISE_EN_SERVICE_DES_ARRIVEES).toBe(true);
    expect(APRES_AMORCAGE > MISE_EN_SERVICE_DES_ARRIVEES).toBe(true);

    const arrivante = personne({ firstSeenAt: APRES_AMORCAGE });
    const ancienne = personne({ username: "alex.dupuis", fullname: "Alex Dupuis" });

    const complet = await lancer([arrivante, ancienne], true);

    expect(complet.arrivees).toEqual({ conclu: true, levees: 1 });
    expect(complet.ouverts).toBe(1);
    expect(cle("SCOPE_ENTRY:camille.rivet")).toMatchObject({ kind: "SCOPE_ENTRY", closedAt: null });
    expect(base.journal).toContainEqual({
      action: "finding.open",
      targetId: "SCOPE_ENTRY:camille.rivet",
    });

    // Même situation, périmètre partiel : les fiches qui manquent à une réponse
    // amputée sont exactement celles qu'on prendrait pour des arrivées.
    base.constats.length = 0;
    base.journal.length = 0;
    const partiel = await lancer([arrivante, ancienne], false);

    expect(partiel.arrivees).toEqual({
      conclu: false,
      cause: "perimetre-incomplet",
      message: "périmètre incomplet, aucune arrivée conclue",
    });
    expect(partiel.ouverts).toBe(0);
    expect(base.constats).toEqual([]);

    // Une instance qui n'a encore vu personne n'a pas de borne : une première vue n'y
    // dit pas qu'on vient d'arriver, elle dit que l'outil vient d'ouvrir les yeux.
    base.runs.length = 0;
    const sansAmorcage = await lancer([arrivante, ancienne], true);

    expect(sansAmorcage.arrivees).toMatchObject({ conclu: false, cause: "amorcage-inconnu" });
    expect(base.constats).toEqual([]);
  });
});

describe("la fermeture des constats ouverts, deuxième des trois portes", () => {
  it("ne referme aucune arrivée quand elle n'a pas conclu, et referme le reste", async () => {
    // Camille a été accueillie depuis : son arrivée ne se constate plus. Alex n'est
    // plus sur une startup terminée : son constat de startups ne se vérifie plus non
    // plus. Les deux sont ouverts en base.
    base.constats.push(
      {
        id: "f-1",
        kind: "SCOPE_ENTRY",
        dedupKey: "SCOPE_ENTRY:camille.rivet",
        openedAt: APRES_AMORCAGE,
        closedAt: null,
        closeReason: null,
        closedBy: null,
      },
      {
        id: "f-2",
        kind: "INACTIVE_STARTUP",
        dedupKey: "INACTIVE_STARTUP:alex.dupuis",
        openedAt: APRES_AMORCAGE,
        closedAt: null,
        closeReason: null,
        closedBy: null,
      },
    );
    base.plans.push({
      kind: "ONBOARDING",
      state: "EXECUTED",
      caseKind: "ONBOARDING",
      username: "camille.rivet",
      confirmedAt: APRES_AMORCAGE,
      steps: [{ executedAt: new Date("2026-08-27T09:00:00Z") }],
    });

    const personnes = [
      personne({ firstSeenAt: APRES_AMORCAGE }),
      personne({ username: "alex.dupuis", fullname: "Alex Dupuis" }),
    ];

    const partiel = await lancer(personnes, false);

    // Le constat d'arrivée n'est pas calculé, donc il ne se vérifie plus par
    // construction : le fermer serait effacer un écart qu'on n'a pas regardé.
    expect(cle("SCOPE_ENTRY:camille.rivet")?.closedAt).toBeNull();
    // Et rien d'autre n'est éteint au passage : le reste se réconcilie comme d'habitude.
    expect(cle("INACTIVE_STARTUP:alex.dupuis")?.closedAt).toEqual(AUJOURDHUI);
    expect(partiel.fermes).toBe(1);

    const complet = await lancer(personnes, true);

    expect(complet.fermes).toBe(1);
    expect(cle("SCOPE_ENTRY:camille.rivet")).toMatchObject({
      closedAt: AUJOURDHUI,
      closeReason: "ne se vérifie plus à la collecte",
      closedBy: null,
    });
  });
});

describe("le réarmement des clôtures manuelles, troisième des trois portes", () => {
  it("ne lève aucun verrou d'arrivée quand elle n'a pas conclu, et lève les autres", async () => {
    base.constats.push(
      {
        id: "f-1",
        kind: "SCOPE_ENTRY",
        dedupKey: "SCOPE_ENTRY:camille.rivet",
        openedAt: APRES_AMORCAGE,
        closedAt: APRES_AMORCAGE,
        closeReason: "accès posés à la main avant l'outil",
        closedBy: "operateur.exemple",
      },
      {
        id: "f-2",
        kind: "INACTIVE_STARTUP",
        dedupKey: "INACTIVE_STARTUP:alex.dupuis",
        openedAt: APRES_AMORCAGE,
        closedAt: APRES_AMORCAGE,
        closeReason: "traité",
        closedBy: "operateur.exemple",
      },
    );
    // Les deux situations ont cessé : Camille a été accueillie, Alex a changé de
    // startup. Les deux verrous devraient donc se lever, si on a le droit de conclure.
    base.plans.push({
      kind: "ONBOARDING",
      state: "EXECUTED",
      caseKind: "ONBOARDING",
      username: "camille.rivet",
      confirmedAt: APRES_AMORCAGE,
      steps: [{ executedAt: new Date("2026-08-27T09:00:00Z") }],
    });

    const personnes = [
      personne({ firstSeenAt: APRES_AMORCAGE }),
      personne({ username: "alex.dupuis", fullname: "Alex Dupuis" }),
    ];

    await lancer(personnes, false);

    // Le jugement d'un opérateur ne se défait pas sur une collecte qui n'a rien
    // regardé : le verrou tient tant qu'on ne sait pas si la situation a cessé.
    expect(cle("SCOPE_ENTRY:camille.rivet")?.closedBy).toBe("operateur.exemple");
    expect(cle("INACTIVE_STARTUP:alex.dupuis")?.closedBy).toBeNull();

    await lancer(personnes, true);

    expect(cle("SCOPE_ENTRY:camille.rivet")).toMatchObject({
      closedBy: null,
      closedAt: APRES_AMORCAGE,
    });
  });
});

describe("la vague d'arrivées", () => {
  it("refuse d'en conclure quoi que ce soit, le dit avec ses nombres, et rend leurs constats aux personnes", async () => {
    // Trente arrivées d'un coup sur un périmètre de quatre-vingt-quinze : au-delà de la
    // part, la source ne se distingue plus d'une arrivée collective.
    const anciennes = Array.from({ length: 65 }, (_, rang) =>
      personne({ username: `ancien.${rang}`, fullname: `Ancien ${rang}` }),
    );
    const arrivantes = Array.from({ length: 30 }, (_, rang) =>
      personne({
        username: `arrivant.${rang}`,
        fullname: `Arrivant ${rang}`,
        firstSeenAt: APRES_AMORCAGE,
        // La dernière est aussi sur une startup abandonnée : sans elle, on ne verrait
        // pas que le refus rend son constat de startups à la personne.
        startups: rang === 29 ? ["produit-omega"] : ["produit-alpha"],
      }),
    );

    const resultat = await lancer([...anciennes, ...arrivantes], true);

    expect(resultat.arrivees).toEqual({
      conclu: false,
      cause: "vague",
      message: "vague d'arrivées : 30 pour un périmètre de 95, aucune arrivée conclue",
    });
    expect(base.constats.filter((constat) => constat.kind === "SCOPE_ENTRY")).toEqual([]);
    // La priorité par `continue` avait substitué l'arrivée au constat de startups : le
    // refus repasse par un calcul sans règle, sinon ce constat disparaîtrait avec elle.
    expect(cle("INACTIVE_STARTUP:arrivant.29")).toMatchObject({ kind: "INACTIVE_STARTUP" });
  });
});

describe("les deux dates qui décident d'une arrivée", () => {
  it("tient un onboarding pour fait quand il suit la date de référence, et pour périmé quand il la précède", async () => {
    // Alex est arrivé après l'amorçage et son plan d'arrivée a été exécuté : rien à
    // signaler.
    const accueilDAlex: PlanEnBase = {
      kind: "ONBOARDING",
      state: "EXECUTED",
      caseKind: "ONBOARDING",
      username: "alex.dupuis",
      confirmedAt: APRES_AMORCAGE,
      steps: [{ executedAt: new Date("2026-08-27T09:00:00Z") }],
    };
    base.plans.push(accueilDAlex);

    // Camille est là depuis toujours, et son départ vient d'être soldé. Sa fiche est
    // pourtant toujours au référentiel, dont la liste des membres rend aussi les
    // missions terminées : aucune disparition n'est datée, et ce dossier clos est le
    // chemin normal du produit. Rien ne le lit ici, et c'est tout l'objet de sa
    // présence en base : le jour où une clôture reviendrait décider d'une arrivée,
    // elle souhaiterait la bienvenue à la personne qu'on vient d'offboarder.
    base.dossiers.push({
      kind: "OFFBOARDING",
      state: "DONE",
      closedAt: APRES_AMORCAGE,
      username: "camille.rivet",
    });
    // Son onboarding d'il y a deux semaines appartient au séjour d'avant.
    base.plans.push({
      kind: "ONBOARDING",
      state: "EXECUTED",
      caseKind: "ONBOARDING",
      username: "camille.rivet",
      confirmedAt: new Date("2026-08-12T09:00:00Z"),
      steps: [{ executedAt: new Date("2026-08-12T10:00:00Z") }],
    });

    const alex = personne({
      username: "alex.dupuis",
      fullname: "Alex Dupuis",
      firstSeenAt: APRES_AMORCAGE,
    });

    const soldee = await lancer([personne(), alex], true);

    expect(soldee.arrivees).toEqual({ conclu: true, levees: 0 });
    expect(cle("SCOPE_ENTRY:camille.rivet")).toBeUndefined();
    expect(cle("SCOPE_ENTRY:alex.dupuis")).toBeUndefined();

    // Elle finit par quitter le référentiel, et la collecte l'y revoit : sa première
    // vue ne bouge pas, mais ce retour daté rouvre un séjour, et son accueil d'il y a
    // deux semaines ne vaut pas pour celui-là.
    const resultat = await lancer([personne({ returnedAt: APRES_AMORCAGE }), alex], true);

    expect(resultat.arrivees).toEqual({ conclu: true, levees: 1 });
    expect(cle("SCOPE_ENTRY:camille.rivet")).toBeDefined();
    expect(cle("SCOPE_ENTRY:alex.dupuis")).toBeUndefined();

    // Un plan à moitié exécuté ne vaut pas accueil : il laisse la personne sans une
    // partie de ses accès.
    base.constats.length = 0;
    accueilDAlex.state = "PARTIALLY_EXECUTED";
    const partiellement = await lancer(
      [personne({ username: "alex.dupuis", fullname: "Alex Dupuis", firstSeenAt: APRES_AMORCAGE })],
      true,
    );

    expect(partiellement.arrivees).toEqual({ conclu: true, levees: 1 });
    expect(cle("SCOPE_ENTRY:alex.dupuis")).toBeDefined();
  });
});

describe("le verrou d'une clôture manuelle tient d'une collecte à l'autre", () => {
  it("laisse l'arrivée close tant qu'elle n'est pas traitée, sans jamais la rouvrir", async () => {
    // Un opérateur a jugé la situation : les accès de Camille avaient été posés à la
    // main avant l'outil, et il n'y a pas de dossier d'arrivée à ouvrir pour autant.
    base.constats.push({
      id: "f-1",
      kind: "SCOPE_ENTRY",
      dedupKey: "SCOPE_ENTRY:camille.rivet",
      openedAt: APRES_AMORCAGE,
      closedAt: APRES_AMORCAGE,
      closeReason: "accès posés à la main avant l'outil",
      closedBy: "operateur.exemple",
    });

    // Rien n'a bougé de son côté : aucun plan d'arrivée n'a été exécuté, et la
    // situation qu'elle a jugée dure encore.
    const personnes = [personne({ firstSeenAt: APRES_AMORCAGE })];

    const premier = await lancer(personnes, true);

    // Le passage a bel et bien conclu et levé le constat dans son calcul : c'est
    // justement parce qu'il le retrouve que le verrou tient, au lieu de sauter.
    expect(premier.arrivees).toEqual({ conclu: true, levees: 1 });
    expect(premier.ouverts).toBe(0);
    expect(premier.fermes).toBe(0);
    expect(cle("SCOPE_ENTRY:camille.rivet")).toMatchObject({
      closedAt: APRES_AMORCAGE,
      closeReason: "accès posés à la main avant l'outil",
      closedBy: "operateur.exemple",
    });
    expect(base.journal).not.toContainEqual({
      action: "finding.open",
      targetId: "SCOPE_ENTRY:camille.rivet",
    });

    // La nuit suivante ne change rien. Rouvrir chaque nuit un constat qu'un opérateur
    // a clos reviendrait à lui resservir un travail qu'il a déjà fait, et c'est ainsi
    // qu'une file cesse d'être lue.
    const second = await lancer(personnes, true);

    expect(second.ouverts).toBe(0);
    expect(base.constats).toHaveLength(1);
    expect(cle("SCOPE_ENTRY:camille.rivet")?.closedBy).toBe("operateur.exemple");
    expect(base.journal.filter((ligne) => ligne.targetId?.startsWith("SCOPE_ENTRY"))).toEqual([]);
  });
});
