import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  CollectResult,
  Connector,
  ObservedGrant,
  ObservedResource,
  RunContext,
} from "@/core/connector";
import { executerCollecte } from "@/lib/sync/collecte";
import { politiqueJetable } from "@/test/politique-jetable";

/**
 * La politique se lit sur le disque, et `config/` ne contient que des modèles. Le
 * seuil de chute vient donc d'un répertoire jetable, où seul le fichier des comptes
 * est requis : les réglages, eux, ont tous un défaut.
 */
politiqueJetable("collecte");

interface IdentiteEnBase {
  id: string;
  provider: string;
  externalId: string;
  handle: string;
  vanishedAt: Date | null;
}

interface RunEnBase {
  id: string;
  provider: string;
  capability: string;
  status: string;
  startedAt: Date;
  error: unknown;
}

interface RessourceEnBase {
  id: string;
  externalId: string;
  parentId: string | null;
}

interface AutorisationEnBase {
  provider: string;
  famille: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
  consumedAt: Date | null;
  consumedRunId: string | null;
}

const base = vi.hoisted(() => ({
  identites: [] as IdentiteEnBase[],
  runs: [] as RunEnBase[],
  autorisations: [] as AutorisationEnBase[],
  ressources: [] as RessourceEnBase[],
  /**
   * Ce que la base tient pour vivant côté ressources, c'est-à-dire celles qui portent
   * encore un accès : la seule chose à laquelle le garde-fou des ressources se compare.
   * Posé par le scénario, parce que rien dans un relevé ne le fabrique.
   */
  ressourcesVivantes: 0,
  /** Chaque pose de contenance, pour dire si le second passage n'écrit que ce qui diffère. */
  contenances: [] as { ressource: string; parentId: string | null }[],
  /** Toute écriture qui date une disparition, pour dire si elle a eu lieu. */
  datations: [] as { cible: string; count: number }[],
  journal: [] as { action: string; result: string }[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    syncRun: {
      create: ({ data }: { data: Omit<RunEnBase, "id" | "error"> }) => {
        const run: RunEnBase = { id: `run-${base.runs.length + 1}`, error: null, ...data };
        base.runs.push(run);
        return Promise.resolve(run);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string; error?: unknown };
      }) => {
        const run = base.runs.find((candidat) => candidat.id === where.id);
        if (run) {
          run.status = data.status;
          run.error = data.error ?? null;
        }
        return Promise.resolve(run);
      },
      // Le sens et la profondeur de la fenêtre sont demandés par la requête, et un
      // double qui les rejouerait à sa façon ferait lire au code un autre passage que
      // celui qu'il a demandé : le dernier refus enregistré deviendrait le plus ancien.
      findMany: ({
        where,
        orderBy,
        take,
      }: {
        where: { provider: string; capability: string; id: { not: string } };
        orderBy: { startedAt: "asc" | "desc" };
        take: number;
      }) =>
        Promise.resolve(
          base.runs
            .filter(
              (run) =>
                run.provider === where.provider &&
                run.capability === where.capability &&
                run.id !== where.id.not,
            )
            .sort((a, b) =>
              orderBy.startedAt === "asc"
                ? a.startedAt.getTime() - b.startedAt.getTime()
                : b.startedAt.getTime() - a.startedAt.getTime(),
            )
            .slice(0, take),
        ),
    },
    externalIdentity: {
      findUnique: ({
        where,
      }: {
        where: { provider_externalId: { provider: string; externalId: string } };
      }) =>
        Promise.resolve(
          base.identites.find(
            (identite) =>
              identite.provider === where.provider_externalId.provider &&
              identite.externalId === where.provider_externalId.externalId,
          ) ?? null,
        ),
      update: ({ where, data }: { where: { id: string }; data: { handle: string } }) => {
        const identite = base.identites.find((candidat) => candidat.id === where.id);
        if (identite) {
          identite.handle = data.handle;
          identite.vanishedAt = null;
        }
        return Promise.resolve(identite);
      },
      create: ({ data }: { data: { provider: string; externalId: string; handle: string } }) => {
        const identite: IdentiteEnBase = {
          id: `identite-${base.identites.length + 1}`,
          provider: data.provider,
          externalId: data.externalId,
          handle: data.handle,
          vanishedAt: null,
        };
        base.identites.push(identite);
        return Promise.resolve(identite);
      },
      count: ({ where }: { where: { provider: string; vanishedAt: null } }) =>
        Promise.resolve(
          base.identites.filter(
            (identite) =>
              identite.provider === where.provider && identite.vanishedAt === where.vanishedAt,
          ).length,
        ),
      updateMany: ({
        where,
        data,
      }: {
        where: { provider: string; externalId: { notIn: readonly string[] }; vanishedAt: null };
        data: { vanishedAt: Date };
      }) => {
        const parties = base.identites.filter(
          (identite) =>
            identite.provider === where.provider &&
            identite.vanishedAt === where.vanishedAt &&
            !where.externalId.notIn.includes(identite.externalId),
        );
        for (const identite of parties) {
          identite.vanishedAt = data.vanishedAt;
        }
        base.datations.push({ cible: "identites", count: parties.length });
        return Promise.resolve({ count: parties.length });
      },
    },
    accessGrant: {
      findUnique: () => Promise.resolve(null),
      create: () => Promise.resolve({ id: "acces" }),
      update: () => Promise.resolve({ id: "acces" }),
      updateMany: () => {
        base.datations.push({ cible: "acces", count: 0 });
        return Promise.resolve({ count: 0 });
      },
    },
    // La ligne rendue est une copie et non la ligne vivante : le second passage relit le
    // contenant tel que le premier l'a lu pour décider s'il écrit, et un double qui lui
    // rendrait sa propre écriture en cours ferait disparaître cette décision.
    resource: {
      upsert: ({ where }: { where: { provider_externalId: { externalId: string } } }) => {
        const externalId = where.provider_externalId.externalId;
        const connue = base.ressources.find((ligne) => ligne.externalId === externalId);
        if (connue) {
          return Promise.resolve({ ...connue });
        }
        const posee: RessourceEnBase = {
          id: `ressource-${externalId}`,
          externalId,
          parentId: null,
        };
        base.ressources.push(posee);
        return Promise.resolve({ ...posee });
      },
      update: ({ where, data }: { where: { id: string }; data: { parentId: string | null } }) => {
        const ligne = base.ressources.find((candidate) => candidate.id === where.id);
        if (ligne) {
          ligne.parentId = data.parentId;
          base.contenances.push({ ressource: ligne.externalId, parentId: data.parentId });
        }
        return Promise.resolve(ligne);
      },
      count: () => Promise.resolve(base.ressourcesVivantes),
    },
    // Une autorisation n'est éligible que si elle attend encore et si elle a été posée
    // avant que ce passage ne commence : la seconde condition est ce qui empêche un
    // clic pendant une collecte d'autoriser celle qui tourne déjà, et un double qui
    // l'oublierait rendrait le test vert sur une garantie que le code ne donne pas.
    scopeDropOverride: {
      findFirst: ({ where }: { where: AttenteDAutorisation }) =>
        Promise.resolve(base.autorisations.filter((posee) => attendue(posee, where))[0] ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: AttenteDAutorisation;
        data: { consumedAt: Date; consumedRunId: string };
      }) => {
        const prises = base.autorisations.filter((posee) => attendue(posee, where));
        for (const autorisation of prises) {
          autorisation.consumedAt = data.consumedAt;
          autorisation.consumedRunId = data.consumedRunId;
        }
        return Promise.resolve({ count: prises.length });
      },
    },
    auditEvent: {
      create: ({ data }: { data: { action: string; result: string } }) => {
        base.journal.push(data);
        return Promise.resolve(data);
      },
    },
  },
}));

interface AttenteDAutorisation {
  provider: string;
  famille: string;
  consumedAt?: null;
  createdAt?: { lt: Date };
}

function attendue(posee: AutorisationEnBase, where: AttenteDAutorisation): boolean {
  return (
    posee.provider === where.provider &&
    posee.famille === where.famille &&
    (where.consumedAt === undefined || posee.consumedAt === where.consumedAt) &&
    (where.createdAt === undefined || posee.createdAt.getTime() < where.createdAt.lt.getTime())
  );
}

/**
 * Les refus tels que la trace du passage les porte, sans les recomposer : c'est
 * l'écriture brute qui doit être vérifiée, un lecteur qui reconstruit champ par champ
 * rendrait un champ de trop invisible.
 */
function traceDuRefus(error: unknown): Record<string, unknown>[] | undefined {
  if (!error || typeof error !== "object" || !("refus" in error)) {
    return undefined;
  }
  const refus = (error as { refus: unknown }).refus;
  return Array.isArray(refus) ? refus : undefined;
}

const MAINTENANT = new Date("2026-08-24T02:00:00Z");
const PROVIDER = "atelier";

const contextes: RunContext[] = [];

/** Un connecteur dont la lecture est décidée par le test, et rien d'autre. */
function connecteurQuiLit(releve: () => CollectResult): Connector {
  return {
    contract: {
      key: PROVIDER,
      label: "Atelier",
      criticality: "low",
      runbook: "Lire la console de l'atelier.",
      accountSlug: ({ handle }) => handle,
      credentials: [],
      capabilities: { list: [{ requires: [], tier: "auto" }] },
      scopeSchema: z.object({}),
    },
    probe: () => Promise.resolve([]),
    plan: () => Promise.resolve([]),
    list: (ctx: RunContext) => {
      contextes.push(ctx);
      return Promise.resolve(releve());
    },
  };
}

function membres(nombre: number, depuis = 1) {
  return Array.from({ length: nombre }, (_, rang) => ({
    externalId: `compte-${rang + depuis}`,
    idKind: "opaque" as const,
    handle: `compte-${rang + depuis}`,
  }));
}

function peupler(nombre: number): void {
  for (const membre of membres(nombre)) {
    base.identites.push({
      id: `identite-${membre.externalId}`,
      provider: PROVIDER,
      externalId: membre.externalId,
      handle: membre.handle,
      vanishedAt: null,
    });
  }
}

const vivantes = () =>
  base.identites.filter((identite) => identite.vanishedAt === null).map((i) => i.externalId);

beforeEach(() => {
  base.identites.length = 0;
  base.runs.length = 0;
  base.autorisations.length = 0;
  base.ressources.length = 0;
  base.contenances.length = 0;
  base.ressourcesVivantes = 0;
  base.datations.length = 0;
  base.journal.length = 0;
  contextes.length = 0;
});

/**
 * La règle qui protège tout le reste : dater une disparition finit par couper un
 * accès, et une collecte incomplète ne se distingue pas d'un départ collectif. Un
 * run qui n'est pas `ok` ne fait donc disparaître personne, il conserve le dernier
 * état constaté.
 */
describe("ce qu'une collecte a le droit de faire disparaître", () => {
  it("date les comptes absents d'une lecture complète, et eux seuls", async () => {
    // Given dix comptes connus, dont un a réellement quitté le système
    peupler(10);
    const connecteur = connecteurQuiLit(() => ({
      status: "ok",
      itemsSeen: 9,
      identities: membres(9),
      resources: [],
      grants: [],
    }));

    // When la lecture se passe bien
    const resultat = await executerCollecte(connecteur, MAINTENANT, "execution-1");

    // Then le compte absent est daté, et lui seul
    expect(resultat.status).toBe("OK");
    expect(resultat.identites.disparues).toBe(1);
    expect(vivantes()).toHaveLength(9);
    expect(
      base.identites.find((identite) => identite.externalId === "compte-10")?.vanishedAt,
    ).toEqual(MAINTENANT);
    expect(resultat.erreurs).toEqual([]);

    // Then la lecture s'est faite en simulation : l'interrupteur général est la seule
    // chose qui autorise une écriture sur un système tiers, et il est fermé.
    expect(contextes[0]?.dryRun).toBe(true);
    expect(contextes[0]?.now).toBe(MAINTENANT);

    // Then le passage laisse une trace de réussite, et le relevé le dit
    expect(base.runs[0]?.status).toBe("OK");
    expect(base.journal.at(-1)).toMatchObject({ action: `sync.${PROVIDER}`, result: "SUCCESS" });
  });

  it("ne fait disparaître personne quand la lecture a avalé une erreur, ni quand elle a échoué", async () => {
    // Given les mêmes dix comptes connus
    peupler(10);
    const partielle = connecteurQuiLit(() => ({
      status: "partial",
      itemsSeen: 9,
      identities: membres(9),
      resources: [],
      grants: [],
      errors: [{ scope: "list", message: "une page n'a pas répondu" }],
    }));

    // When la lecture rapporte neuf comptes mais reconnaît avoir manqué quelque chose
    const partiel = await executerCollecte(partielle, MAINTENANT, "execution-2");

    // Then ce qu'elle a vu est bien enregistré, mais rien n'est daté : le compte
    // manquant est peut-être seulement celui que la page tombée n'a pas rendu.
    expect(partiel.status).toBe("PARTIAL");
    expect(partiel.identites.disparues).toBe(0);
    expect(base.datations).toEqual([]);
    expect(vivantes()).toHaveLength(10);
    expect(partiel.erreurs).toEqual(["list : une page n'a pas répondu"]);

    // When la lecture suivante échoue entièrement
    const echouee = connecteurQuiLit(() => ({
      status: "failed",
      errors: [{ scope: "list", message: "jeton refusé" }],
    }));
    const echec = await executerCollecte(echouee, MAINTENANT, "execution-3");

    // Then rien n'est daté davantage, et le dernier état constaté tient toujours :
    // une absence d'observation n'est pas une absence de compte.
    expect(echec.status).toBe("FAILED");
    expect(echec.identites).toEqual({ creees: 0, revues: 0, disparues: 0 });
    expect(base.datations).toEqual([]);
    expect(vivantes()).toHaveLength(10);

    // Then les deux passages laissent chacun leur trace, avec ce qui a cloché
    expect(base.runs.map((run) => run.status)).toEqual(["PARTIAL", "FAILED"]);
    expect(base.journal.map((trace) => trace.result)).toEqual(["FAILURE", "FAILURE"]);
  });

  it("suspend la datation quand une lecture complète perd trop de monde d'un coup", async () => {
    // Given dix comptes connus, et une lecture qui n'en rapporte plus que cinq sans
    // se plaindre de quoi que ce soit
    peupler(10);
    const chute = connecteurQuiLit(() => ({
      status: "ok",
      itemsSeen: 5,
      identities: membres(5),
      resources: [],
      grants: [],
    }));

    // When la collecte tourne
    const resultat = await executerCollecte(chute, MAINTENANT, "execution-4");

    // Then rien n'est daté : une chute de cette ampleur ne se distingue pas d'un
    // départ collectif, et dans le doute on refuse d'en tirer des disparitions.
    expect(resultat.identites.disparues).toBe(0);
    expect(base.datations).toEqual([]);
    expect(vivantes()).toHaveLength(10);

    // Then le passage cesse d'être annoncé comme réussi, et dit ce qu'il a refusé
    expect(resultat.status).toBe("PARTIAL");
    expect(resultat.erreurs[0]).toContain("chute de la collecte");
    expect(resultat.erreurs[0]).toContain("aucune disparition datée");
    expect(resultat.refus).toEqual([{ famille: "identites", observe: 5, reference: 10 }]);

    // Then le refus est dans la trace du passage, de sorte que le suivant saura
    // depuis combien de temps il retombe à l'identique.
    expect(base.runs[0]?.status).toBe("PARTIAL");
    expect(base.runs[0]?.error).toMatchObject({
      refus: [{ famille: "identites", observe: 5, reference: 10 }],
    });

    // Then rien de ce refus ne nomme un côté. Ce garde-fou compare déjà ce qu'une
    // lecture rend à un décompte de lignes tenues pour vivantes : il a donc déjà le
    // déclencheur que le plancher du périmètre vient d'ajouter, et il n'en a qu'un.
    // Sa trace n'a pas de côté à porter, et sa phrase n'a pas de côté à dire.
    expect(resultat.refus?.[0]).not.toHaveProperty("cote");
    expect(traceDuRefus(base.runs[0]?.error)?.[0]).not.toHaveProperty("cote");
    expect(resultat.erreurs[0]).toBe(
      "chute de la collecte : 5 éléments contre 10 tenus pour vivants, aucune disparition datée",
    );
  });
});

/**
 * Le plancher de chute s'entretient lui-même : son refus dégrade le passage, le
 * passage dégradé ne nettoie rien, et la même chute retombe. Une décision d'opérateur
 * est la seule issue, et elle n'en est une que si le passage suivant l'honore.
 *
 * Ici, rien ne périme une décision qu'un passage n'aurait pas levée : elle resterait
 * en attente, et l'écran refuse d'en poser une seconde tant que la première attend.
 * Une décision qui ne lèverait pas ne serait donc pas remise à demain, elle
 * enfermerait l'opératrice pour toutes les nuits qui suivent.
 */
describe("la sortie nominative d'un plancher de chute", () => {
  const NUITS = [
    new Date("2026-08-24T02:00:00Z"),
    new Date("2026-08-25T02:00:00Z"),
    new Date("2026-08-26T02:00:00Z"),
  ] as const;

  /** L'heure à laquelle on clique, c'est-à-dire avant que la nuit ne commence. */
  function autoriser(nuit: number, raison: string): void {
    base.autorisations.push({
      provider: PROVIDER,
      famille: "identites",
      reason: raison,
      createdBy: "capucine.exemple",
      createdAt: new Date((NUITS[nuit] ?? MAINTENANT).getTime() - 3_600_000),
      consumedAt: null,
      consumedRunId: null,
    });
  }

  const lecture = (comptes: number) => () =>
    ({
      status: "ok",
      itemsSeen: comptes,
      identities: membres(comptes),
      resources: [],
      grants: [],
    }) as const;

  const levees = () => base.journal.filter((trace) => trace.action === "sync.gardefou.leve");

  it("lève quelle que soit l'ampleur de la chute du soir, puis se referme derrière elle", async () => {
    // Given dix comptes connus, et une nuit où la lecture n'en rend plus que cinq sans
    // se plaindre de rien : le plancher refuse, et c'est ce refus que l'écran montre.
    peupler(10);
    const refus = await executerCollecte(
      connecteurQuiLit(lecture(5)),
      NUITS[0],
      "execution-plancher-1",
    );
    expect(refus.status).toBe("PARTIAL");
    expect(refus.refus).toEqual([{ famille: "identites", observe: 5, reference: 10 }]);
    expect(vivantes()).toHaveLength(10);

    // Given une opératrice qui tranche sur ces nombres-là, sous son nom.
    autoriser(1, "cinq comptes fermés par l'atelier, vérifiés un par un");

    // When la nuit suivante creuse encore : la lecture ne rend plus que quatre comptes,
    // c'est-à-dire une chute plus profonde que celle qu'on lui avait montrée.
    const leve = await executerCollecte(
      connecteurQuiLit(lecture(4)),
      NUITS[1],
      "execution-plancher-2",
    );

    // Then sa décision lève quand même, et le passage date. C'est la seule issue de ce
    // garde-fou : rien ici ne périme une décision qu'un passage aurait écartée, elle
    // resterait en attente et interdirait d'en poser une autre, si bien qu'une chute
    // qui se creuse chaque nuit enfermerait l'opératrice au lieu de la faire décider.
    expect(leve.status).toBe("OK");
    expect(leve.identites.disparues).toBe(6);
    expect(vivantes()).toEqual(["compte-1", "compte-2", "compte-3", "compte-4"]);
    expect(leve.erreurs[0]).toContain("datation autorisée à la main pour ce passage");

    // Then le journal nomme qui a décidé et sur quoi, et la décision est dépensée.
    expect(levees()).toHaveLength(1);
    expect(base.autorisations[0]).toMatchObject({
      consumedRunId: base.runs[1]?.id,
      createdBy: "capucine.exemple",
    });
    expect(base.autorisations[0]?.consumedAt).not.toBeNull();

    // When une troisième nuit creuse à son tour, sans que personne n'ait rien décidé.
    const apres = await executerCollecte(
      connecteurQuiLit(lecture(2)),
      NUITS[2],
      "execution-plancher-3",
    );

    // Then le garde-fou est de retour : une autorisation vaut un passage, celui qui
    // l'a prise, et rien après lui.
    expect(apres.status).toBe("PARTIAL");
    expect(apres.identites.disparues).toBe(0);
    expect(apres.refus).toEqual([{ famille: "identites", observe: 2, reference: 4 }]);
    expect(vivantes()).toHaveLength(4);
    expect(levees()).toHaveLength(1);
  });
});

/**
 * Une contenance est une lecture du connecteur, pas un droit : personne n'a d'accès
 * parce qu'une application appartient à un projet. La contradiction se refuse donc sans
 * rien jeter, la ressource survivant toujours à sa contenance : la jeter la sortirait de
 * la table de résolution et ferait tomber chacun de ses accès dans « accès sur une
 * ressource absente de la collecte », c'est-à-dire qu'un contenant mal nommé effacerait
 * des accès réels.
 *
 * Et le relevé, lui, ne compte plus ses contenants. Un contenant ne porte souvent aucun
 * accès quand la référence à laquelle le garde-fou se compare ne retient que les
 * ressources qui en portent un : les compter gonflerait un seul des deux plateaux, donc
 * masquerait une chute réelle.
 */
describe("ce qu'une contenance impossible a le droit de faire perdre", () => {
  const ACCES: readonly ObservedGrant[] = [
    {
      identityExternalId: "compte-1",
      resourceExternalId: "service-annuaire",
      role: "collaborateur",
    },
  ];

  const nuit = (ressources: readonly ObservedResource[]) => () =>
    ({
      status: "ok",
      itemsSeen: 9,
      identities: membres(9),
      resources: ressources,
      grants: ACCES,
    }) as const;

  const CONTENANT_ABSENT: readonly ObservedResource[] = [
    { externalId: "service-annuaire", label: "Annuaire", parentExternalId: "produit-alpha" },
  ];

  const CONTENANT_PRESENT: readonly ObservedResource[] = [
    { externalId: "produit-alpha", label: "Produit alpha" },
    { externalId: "service-annuaire", label: "Annuaire", parentExternalId: "produit-alpha" },
  ];

  it("gèle la nuit sans rien effacer, et la datation reprend dès que le contenant est là", async () => {
    // Given dix comptes connus, et une nuit qui se dit complète tout en nommant un
    // contenant qu'elle n'a pas relevé : le connecteur se contredit lui-même.
    peupler(10);
    const gelee = await executerCollecte(
      connecteurQuiLit(nuit(CONTENANT_ABSENT)),
      MAINTENANT,
      "execution-contenance-1",
    );

    // Then le passage cesse d'être annoncé comme réussi et nomme la ressource fautive.
    // Une seule phrase, et c'est ce que la liste entière prouve : aucune ne dit qu'un
    // accès portait sur une ressource absente, la ressource ayant survécu à sa contenance.
    expect(gelee.status).toBe("PARTIAL");
    expect(gelee.erreurs).toEqual([
      "ressources (service-annuaire) : contenue par une ressource absente de la collecte : produit-alpha",
    ]);

    // Then l'accès que portait cette ressource est bien écrit : refuser la contenance ne
    // coûte rien, refuser la ressource aurait coûté ses accès.
    expect(gelee.acces).toEqual({ crees: 1, revus: 0, disparus: 0 });
    expect(gelee.ressources).toBe(1);

    // Then aucune datation n'a eu lieu, ni sur les comptes ni sur les accès : un passage
    // qui n'est pas complet conserve le dernier état constaté, et le compte absent du
    // relevé est peut-être seulement celui que la contradiction cache.
    expect(base.datations).toEqual([]);
    expect(gelee.identites.disparues).toBe(0);
    expect(vivantes()).toHaveLength(10);

    // Then rien n'a été écrit comme contenance : ce qui est refusé n'est pas posé à moitié.
    expect(base.contenances).toEqual([]);
    expect(base.ressources.find((ligne) => ligne.externalId === "service-annuaire")?.parentId).toBe(
      null,
    );
    expect(base.runs[0]?.status).toBe("PARTIAL");

    // When la nuit suivante rend le même relevé, contenant compris.
    const reprise = await executerCollecte(
      connecteurQuiLit(nuit(CONTENANT_PRESENT)),
      MAINTENANT,
      "execution-contenance-2",
    );

    // Then le passage est complet, la contenance est posée, et la datation reprend son
    // cours sur le compte réellement absent.
    expect(reprise.status).toBe("OK");
    expect(reprise.erreurs).toEqual([]);
    expect(base.contenances).toEqual([
      { ressource: "service-annuaire", parentId: "ressource-produit-alpha" },
    ]);
    expect(reprise.identites.disparues).toBe(1);
    expect(
      base.identites.find((identite) => identite.externalId === "compte-10")?.vanishedAt,
    ).toEqual(MAINTENANT);
    expect(base.datations.map((datation) => datation.cible)).toEqual(["identites", "acces"]);

    // When la même nuit se rejoue à l'identique.
    const rejouee = await executerCollecte(
      connecteurQuiLit(nuit(CONTENANT_PRESENT)),
      MAINTENANT,
      "execution-contenance-3",
    );

    // Then le second passage d'écriture n'écrit que ce qui diffère : réécrire une
    // contenance déjà posée serait une écriture par ressource et par nuit, sur une
    // colonne qui ne bouge presque jamais.
    expect(rejouee.status).toBe("OK");
    expect(base.contenances).toHaveLength(1);
  });

  it("compte le relevé sans ses contenants, de sorte qu'un projet ne masque pas une chute", async () => {
    // Given douze comptes connus, vingt ressources portant encore un accès, et une nuit
    // qui ne rend plus que douze applications, chacune rangée dans l'un des six projets
    // qui l'accompagnent. Les projets ne portent aucun accès : chez Scalingo, un projet
    // n'a pas de membres.
    peupler(12);
    base.ressourcesVivantes = 20;

    const projets: ObservedResource[] = Array.from({ length: 6 }, (_, rang) => ({
      externalId: `projet-${rang + 1}`,
      label: `Projet ${rang + 1}`,
    }));
    const applications: ObservedResource[] = Array.from({ length: 12 }, (_, rang) => ({
      externalId: `app-${rang + 1}`,
      label: `Application ${rang + 1}`,
      parentExternalId: `projet-${(rang % 6) + 1}`,
    }));
    const acces: ObservedGrant[] = applications.map((application, rang) => ({
      identityExternalId: `compte-${rang + 1}`,
      resourceExternalId: application.externalId,
      role: "collaborateur",
    }));

    // When la collecte tourne, sans que rien ne se plaigne
    const resultat = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: 12,
        identities: membres(12),
        resources: [...projets, ...applications],
        grants: acces,
      })),
      MAINTENANT,
      "execution-contenance-4",
    );

    // Then le garde-fou compte douze et non dix-huit : les six projets sont dans le
    // relevé sans être dans la référence, et les compter aurait fait passer la nuit
    // au-dessus du plancher de seize, donc daté les accès des huit applications parties.
    expect(resultat.status).toBe("PARTIAL");
    expect(resultat.refus).toEqual([{ famille: "ressources", observe: 12, reference: 20 }]);
    expect(resultat.erreurs).toEqual([
      "chute des ressources : 12 contre 20 connues, aucune disparition datée",
    ]);
    expect(traceDuRefus(base.runs[0]?.error)?.[0]).toMatchObject({
      famille: "ressources",
      observe: 12,
      reference: 20,
    });

    // Then les dix-huit ressources sont bien écrites, contenances comprises : ce que le
    // garde-fou refuse de compter, il ne refuse pas de l'enregistrer.
    expect(resultat.ressources).toBe(18);
    expect(base.contenances).toHaveLength(12);
    expect(resultat.acces).toEqual({ crees: 12, revus: 0, disparus: 0 });

    // Then aucun accès n'est daté, et c'est le seul verrou qui a joué : une chute des
    // ressources n'interdit que les accès, le sort des comptes étant lu ailleurs et
    // intact, si bien que la datation des comptes a eu lieu et n'a trouvé personne.
    expect(base.datations).toEqual([{ cible: "identites", count: 0 }]);
    expect(vivantes()).toHaveLength(12);
  });
});
