import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { CollectResult, Connector, RunContext } from "@/core/connector";
import { executerCollecte } from "@/lib/sync/collecte";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/inutilise";
process.env["ESPACE_MEMBRE_API_KEY"] ??= "inutilisee";

/**
 * La politique se lit sur le disque, et `config/` ne contient que des modèles. Le
 * seuil de chute vient donc d'un répertoire jetable, où seul le fichier des comptes
 * est requis : les réglages, eux, ont tous un défaut.
 */
const REPERTOIRE = mkdtempSync(join(tmpdir(), "collecte-"));
copyFileSync(
  resolve(process.cwd(), "config/accounts.exemple.yaml"),
  join(REPERTOIRE, "accounts.yaml"),
);
process.env["POLICY_DIR"] = REPERTOIRE;

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

const base = vi.hoisted(() => ({
  identites: [] as IdentiteEnBase[],
  runs: [] as RunEnBase[],
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
      findMany: ({ where }: { where: { provider: string; id: { not: string } } }) =>
        Promise.resolve(
          base.runs.filter((run) => run.provider === where.provider && run.id !== where.id.not),
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
      count: ({ where }: { where: { provider: string } }) =>
        Promise.resolve(
          base.identites.filter(
            (identite) => identite.provider === where.provider && identite.vanishedAt === null,
          ).length,
        ),
      updateMany: ({
        where,
        data,
      }: {
        where: { provider: string; externalId: { notIn: readonly string[] } };
        data: { vanishedAt: Date };
      }) => {
        const parties = base.identites.filter(
          (identite) =>
            identite.provider === where.provider &&
            identite.vanishedAt === null &&
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
    resource: {
      upsert: ({ where }: { where: { provider_externalId: { externalId: string } } }) =>
        Promise.resolve({ id: `ressource-${where.provider_externalId.externalId}` }),
      count: () => Promise.resolve(0),
    },
    scopeDropOverride: {
      findFirst: () => Promise.resolve(null),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    auditEvent: {
      create: ({ data }: { data: { action: string; result: string } }) => {
        base.journal.push(data);
        return Promise.resolve(data);
      },
    },
  },
}));

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
  });
});
