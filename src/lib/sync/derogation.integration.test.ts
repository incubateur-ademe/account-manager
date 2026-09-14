import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { RAISON_COUVERT } from "@/core/derogation";
import { prisma } from "@/lib/db";
import { derogationsApplicables } from "@/lib/derogation";
import { syncConstats } from "@/lib/sync/constats";

/**
 * Le mécanisme anti-pourrissement, contre une vraie base.
 *
 * C'est la promesse du lot, et elle est une suite de nuits plutôt qu'un calcul : un écart
 * toléré se tait, puis revient de lui-même le lendemain de son échéance, sans que
 * personne n'ait rien à faire. Aucun double ne sait la tenir. La fermeture puis la
 * réouverture passent par `dedupKey`, unique sur toute la table, et c'est cette unicité
 * qui décide si le constat qui revient est le même ou un autre.
 *
 * La survie du verrou d'une clôture manuelle n'est pas ici : elle se tient à l'étage
 * unitaire, où un double qui honore le `where` de `updateMany` suffit à l'exercer, et où
 * une mutation la fait tomber. La descendre d'un étage lui coûte une base pour la même
 * garantie.
 */

const REPERTOIRE = mkdtempSync(join(tmpdir(), "derogation-integration-"));
copyFileSync(
  resolve(process.cwd(), "config/accounts.exemple.yaml"),
  join(REPERTOIRE, "accounts.yaml"),
);
process.env["POLICY_DIR"] = REPERTOIRE;

const PARTIE = "nour.exemple";
const AUTRE = "sacha.exemple";

const NUIT_1 = new Date("2026-09-10T02:00:00Z");
const NUIT_2 = new Date("2026-09-11T02:00:00Z");
const DERNIER_JOUR = new Date("2026-09-11T00:00:00Z");
const NUIT_3 = new Date("2026-09-12T02:00:00Z");

const sortie = (username: string) => ({
  username,
  fullname: username,
  attachment: "STARTUPS" as const,
  startups: [],
  rattachementsManuels: [],
  missionEnd: null,
  vanishedAt: new Date("2026-09-01T00:00:00Z"),
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  returnedAt: null,
  source: "BETA" as const,
  arriveeTraiteeLe: null,
});

async function semer(): Promise<void> {
  for (const username of [PARTIE, AUTRE]) {
    await prisma.person.create({
      data: { username, fullname: username, source: "BETA", vanishedAt: new Date("2026-09-01") },
    });
  }
}

const passer = async (now: Date) => {
  const tolerances = await derogationsApplicables(now);
  return syncConstats(
    [sortie(PARTIE), sortie(AUTRE)],
    [],
    [],
    [],
    now,
    `correlation-${now.toISOString()}`,
    { perimetreComplet: true, maxNewPersonShare: 1, derogations: tolerances.applicables },
  );
};

const constat = (username: string) =>
  prisma.finding.findUnique({
    where: { dedupKey: `SCOPE_EXIT:${username}` },
    select: { openedAt: true, closedAt: true, closeReason: true, closedBy: true },
  });

describe("une tolérance tait un écart, puis le rend", () => {
  beforeEach(semer);

  it("ferme le constat couvert en le disant, et le rouvre le lendemain de l'échéance", async () => {
    // Given une première nuit sans aucune tolérance : les deux écarts remontent,
    const premiere = await passer(NUIT_1);
    expect(premiere).toMatchObject({ ouverts: 2, couverts: 0, fermes: 0 });
    const avant = await constat(PARTIE);
    expect(avant).toMatchObject({ closedAt: null, closedBy: null });

    // When une tolérance est posée sur l'un des deux, dont le dernier jour couvert est
    // celui de la nuit suivante,
    await prisma.derogation.create({
      data: {
        targetType: "personne",
        targetId: PARTIE,
        reason: "départ traité hors de l'outil, le temps de la reprise",
        createdBy: "operatrice.exemple",
        // Datée, et pas laissée au défaut de la colonne : une tolérance ne couvre pas
        // avant d'avoir été posée, et les nuits de ce scénario sont dans le passé.
        createdAt: NUIT_1,
        expiresAt: DERNIER_JOUR,
      },
    });

    // Then la nuit suivante ferme son constat en disant pourquoi, et sans nom : ce
    // n'est pas quelqu'un qui a jugé la situation traitée, c'est une tolérance qui court,
    const deuxieme = await passer(NUIT_2);
    expect(deuxieme).toMatchObject({ ouverts: 0, couverts: 1, fermes: 1, actifs: 1 });
    expect(await constat(PARTIE)).toMatchObject({
      closedAt: NUIT_2,
      closeReason: RAISON_COUVERT,
      closedBy: null,
    });

    // Then l'écart de l'autre personne n'a pas bougé d'un pouce,
    expect(await constat(AUTRE)).toMatchObject({ closedAt: null, closedBy: null });

    // Then et la nuit d'après, l'échéance passée, le même écart revient tout seul, avec
    // une date d'ouverture neuve : c'est tout le mécanisme anti-pourrissement, et il
    // n'exige de personne qu'il se souvienne d'y revenir.
    const troisieme = await passer(NUIT_3);
    expect(troisieme).toMatchObject({ ouverts: 1, couverts: 0 });
    const apres = await constat(PARTIE);
    expect(apres).toMatchObject({ closedAt: null, openedAt: NUIT_3 });
    expect(apres?.openedAt.getTime()).toBeGreaterThan(avant?.openedAt.getTime() ?? 0);
  });

  it("rend l'écart dès la collecte qui suit une levée, sans effacer la tolérance", async () => {
    // Given un écart toléré, donc tu,
    await passer(NUIT_1);
    const tolerance = await prisma.derogation.create({
      data: {
        targetType: "personne",
        targetId: PARTIE,
        reason: "départ traité hors de l'outil, le temps de la reprise",
        createdBy: "operatrice.exemple",
        createdAt: NUIT_1,
        expiresAt: new Date("2026-12-31T00:00:00Z"),
      },
    });
    await passer(NUIT_2);
    expect(await constat(PARTIE)).toMatchObject({ closedAt: NUIT_2, closedBy: null });

    // When quelqu'un la lève avant son terme,
    await prisma.derogation.update({
      where: { id: tolerance.id },
      data: { revokedAt: NUIT_2, revokedBy: "operatrice.exemple" },
    });

    // Then la collecte suivante rend l'écart, sans attendre l'échéance : c'est ce que
    // lever veut dire, et la lecture des tolérances doit relire la colonne pour le voir,
    const apres = await passer(NUIT_3);
    expect(apres).toMatchObject({ couverts: 0 });
    expect(await constat(PARTIE)).toMatchObject({ closedAt: null, openedAt: NUIT_3 });

    // Then et la tolérance est toujours là, datée et signée. Supprimer perdrait qui a
    // décidé d'arrêter de tolérer, et avancer l'échéance rendrait ce geste indiscernable
    // d'un simple écoulement du temps.
    expect(
      await prisma.derogation.findUnique({
        where: { id: tolerance.id },
        select: { revokedAt: true, revokedBy: true, expiresAt: true },
      }),
    ).toEqual({
      revokedAt: NUIT_2,
      revokedBy: "operatrice.exemple",
      expiresAt: new Date("2026-12-31T00:00:00Z"),
    });
  });
});
