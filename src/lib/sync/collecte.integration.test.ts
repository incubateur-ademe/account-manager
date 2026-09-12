import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { viderLaBase } from "@test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { CollectResult, Connector } from "@/core/connector";
import { deconnecter, prisma } from "@/lib/db";
import { executerCollecte, nouvelleExecution } from "@/lib/sync/collecte";

/**
 * Le garde-fou de chute, exercé contre une vraie base.
 *
 * Il décide de la seule écriture irréversible de cet outil : poser une date de
 * disparition sur un compte, c'est déclarer que quelqu'un est parti. Trois lectures
 * décident, et les trois sont des requêtes qu'un double écrit à la main ne peut pas
 * honorer sans réécrire un moteur. Le harnais unitaire voisin les rejoue donc de son
 * côté, et l'une d'elles, `resource.count`, y rend zéro en dur : comme
 * `chuteExcessive` sort faux dès que la référence est nulle, le second verrou est
 * désarmé dans les quatre scénarios de ce fichier-là, sans qu'aucune assertion ne le
 * dise. Ce scénario est le seul endroit du dépôt où ce verrou existe.
 *
 * Une seule histoire, deux nuits, parce que la garantie est une suite : ce qu'une nuit
 * refuse de conclure, la suivante doit pouvoir le conclure sans que le refus d'hier ne
 * gèle quoi que ce soit.
 */

const REPERTOIRE = mkdtempSync(join(tmpdir(), "collecte-integration-"));
copyFileSync(
  resolve(process.cwd(), "config/accounts.exemple.yaml"),
  join(REPERTOIRE, "accounts.yaml"),
);
process.env["POLICY_DIR"] = REPERTOIRE;

const PROVIDER = "atelier";
/** Les départs d'un autre âge, que rien de ce qui suit ne doit redater. */
const MARS = new Date("2026-03-01T02:00:00Z");
const NUIT_1 = new Date("2026-08-24T02:00:00Z");
const NUIT_2 = new Date("2026-08-25T02:00:00Z");

/** Un connecteur dont la lecture est décidée par le scénario, et rien d'autre. */
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
    list: () => Promise.resolve(releve()),
  };
}

function compte(externalId: string) {
  return { externalId, idKind: "opaque" as const, handle: externalId };
}

/**
 * Dix comptes, quatre équipes, et de quoi distinguer les deux façons de compter.
 *
 * Aucune fiche de personne : `personId` est nullable et aucune des trois tables ne
 * pointe vers `Person`, si bien que ce scénario n'a besoin d'inventer personne. C'est
 * ce qui le rend le moins cher de tous ceux que le relevé des doubles a proposés.
 *
 * La quatrième équipe est le cœur du semis : elle existe, mais son unique accès est
 * daté depuis mars. Comptée par son existence elle vaudrait un de plus, comptée par
 * les accès qu'elle porte encore elle ne vaut rien, et c'est toute la différence entre
 * un garde-fou qui se déclenche et un garde-fou qui dort.
 */
async function semer(): Promise<void> {
  for (const rang of [1, 2, 3, 4, 5, 6]) {
    await prisma.externalIdentity.create({
      data: {
        provider: PROVIDER,
        externalId: `parti-${rang}`,
        handle: `parti-${rang}`,
        vanishedAt: MARS,
      },
    });
  }
  for (const rang of [1, 2, 3, 4]) {
    await prisma.externalIdentity.create({
      data: { provider: PROVIDER, externalId: `compte-${rang}`, handle: `compte-${rang}` },
    });
    await prisma.resource.create({
      data: { provider: PROVIDER, externalId: `equipe-${rang}`, label: `Équipe ${rang}` },
    });
  }

  for (const rang of [1, 2, 3]) {
    await prisma.accessGrant.create({
      data: {
        role: "membre",
        externalIdentity: {
          connect: { provider_externalId: { provider: PROVIDER, externalId: `compte-${rang}` } },
        },
        resource: {
          connect: { provider_externalId: { provider: PROVIDER, externalId: `equipe-${rang}` } },
        },
      },
    });
  }
  await prisma.accessGrant.create({
    data: {
      role: "membre",
      vanishedAt: MARS,
      externalIdentity: {
        connect: { provider_externalId: { provider: PROVIDER, externalId: "compte-1" } },
      },
      resource: {
        connect: { provider_externalId: { provider: PROVIDER, externalId: "equipe-4" } },
      },
    },
  });
}

const dateDe = async (externalId: string): Promise<Date | null> =>
  (
    await prisma.externalIdentity.findUniqueOrThrow({
      where: { provider_externalId: { provider: PROVIDER, externalId } },
      select: { vanishedAt: true },
    })
  ).vanishedAt;

const accesVivants = () => prisma.accessGrant.count({ where: { vanishedAt: null } });

describe("le garde-fou de chute, contre une vraie base", () => {
  beforeEach(async () => {
    await viderLaBase();
    await semer();
  });
  afterAll(deconnecter);

  it("ne date personne la nuit où la moitié du parc manque, puis date les comptes sans toucher aux accès", async () => {
    // Given un système qui tient quatre comptes vivants et trois équipes encore
    // portées par un accès, plus six départs de mars et une équipe éteinte que
    // personne ne doit ressusciter.
    expect(await prisma.externalIdentity.count({ where: { vanishedAt: null } })).toBe(4);
    expect(await accesVivants()).toBe(3);

    // When une première nuit ne rend que deux des quatre comptes vivants. Le seuil de
    // chute vaut deux dixièmes, donc le plancher est à trois : deux passent dessous.
    const premiere = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: 2,
        identities: [compte("compte-1"), compte("compte-2")],
        resources: [1, 2, 3, 4].map((rang) => ({
          externalId: `equipe-${rang}`,
          label: `Équipe ${rang}`,
        })),
        grants: [1, 2].map((rang) => ({
          identityExternalId: `compte-${rang}`,
          resourceExternalId: `equipe-${rang}`,
          role: "membre",
        })),
      })),
      NUIT_1,
      nouvelleExecution(),
    );

    // Then elle refuse de conclure, et elle annonce la référence sur laquelle elle a
    // refusé : quatre, le nombre de comptes tenus pour vivants, et non dix, le nombre
    // de lignes du système. C'est cette lecture que le double voisin rejoue à la main.
    expect(premiere.status).toBe("PARTIAL");
    expect(premiere.refus).toEqual([{ famille: "identites", observe: 2, reference: 4 }]);

    // Then rien n'a été daté, ni les comptes ni les accès : un passage qui doute ne
    // conclut pas.
    expect(premiere.identites.disparues).toBe(0);
    expect(premiere.acces.disparus).toBe(0);
    expect(await dateDe("compte-3")).toBeNull();
    expect(await dateDe("compte-4")).toBeNull();

    // Then et il ne redate pas non plus ce qui l'était déjà : les six départs de mars
    // portent toujours mars. C'est la colonne qui dit depuis quand une personne est
    // partie, et l'écraser à chaque passage la rendrait muette.
    expect(await dateDe("parti-1")).toEqual(MARS);

    // Then le refus survit à l'aller-retour en base, sous la forme que le passage
    // suivant relit pour savoir si le même blocage retombe. Un double ne range qu'un
    // objet JavaScript : ici c'est du JSON, relu par Prisma.
    const traceDeLaPremiere = await prisma.syncRun.findFirstOrThrow({
      where: { provider: PROVIDER },
      orderBy: { startedAt: "desc" },
      select: { status: true, error: true },
    });
    expect(traceDeLaPremiere.status).toBe("PARTIAL");
    expect(traceDeLaPremiere.error).toMatchObject({
      refus: [{ famille: "identites", observe: 2, reference: 4 }],
    });

    // When la nuit suivante en rend trois sur quatre, ce qui touche le plancher sans
    // le franchir, mais ne rend plus qu'une équipe sur les trois encore portées.
    const seconde = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: 3,
        identities: [compte("compte-1"), compte("compte-2"), compte("compte-3")],
        resources: [{ externalId: "equipe-1", label: "Équipe 1" }],
        grants: [
          { identityExternalId: "compte-1", resourceExternalId: "equipe-1", role: "membre" },
        ],
      })),
      NUIT_2,
      nouvelleExecution(),
    );

    // Then les deux verrous se sont séparés, et c'est le comportement que rien
    // d'autre dans ce dépôt n'exerce. Celui des comptes s'ouvre, celui des accès se
    // ferme : une chute des équipes ne dit rien de la personne dont le compte vient de
    // s'éteindre, et les coupler laissait la seconde geler la première.
    expect(seconde.refus).toEqual([{ famille: "ressources", observe: 1, reference: 3 }]);

    // Then la référence des équipes vaut trois et non quatre : la quatrième existe
    // toujours, mais son dernier accès est daté depuis mars. Une ressource se compte
    // par ce qu'elle porte encore, sans quoi chaque équipe supprimée ferait grossir la
    // référence jusqu'à déclencher le garde-fou sur une collecte parfaitement saine.
    expect(seconde.status).toBe("PARTIAL");

    // Then le compte que la nuit n'a pas revu est daté, une fois, à la date de la nuit.
    expect(seconde.identites.disparues).toBe(1);
    expect(await dateDe("compte-4")).toEqual(NUIT_2);
    expect(await dateDe("compte-3")).toBeNull();

    // Then et aucun accès ne l'est, alors même que deux des trois n'ont pas été revus :
    // c'est le verrou des ressources qui les protège, et il tient.
    expect(seconde.acces.disparus).toBe(0);
    expect(await accesVivants()).toBe(3);

    // Then les six départs de mars portent toujours mars, après deux passages dont un
    // qui a daté. C'est la seule assertion qui tienne la clause de vie de l'écriture,
    // celle que le double voisin ajoute de son propre chef au lieu de la recevoir.
    const redates = await prisma.externalIdentity.count({
      where: {
        provider: PROVIDER,
        externalId: { startsWith: "parti-" },
        vanishedAt: { not: MARS },
      },
    });
    expect(redates).toBe(0);
  });
});
