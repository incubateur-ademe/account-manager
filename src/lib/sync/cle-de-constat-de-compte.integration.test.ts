import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { IdentiteConstatable } from "@/core/constat";
import { prisma } from "@/lib/db";
import { syncConstats } from "@/lib/sync/constats";

/**
 * La clé d'un constat de compte, contre une vraie base.
 *
 * Deux choses ne se tiennent que là. `dedupKey` est unique sur toute la table, ouverts
 * et fermés confondus, et c'est cette contrainte qui décidait du défaut : un nom
 * recyclé levait la clé de son ancien porteur, donc son verrou de clôture, et l'écart
 * du nouveau ne remontait jamais. Un double qui n'honore pas l'unicité rendrait la
 * garantie vraie par construction.
 *
 * Et la reprise elle-même est du SQL : elle se joue, elle ne se relit pas. Le fichier
 * de migration est lu ici tel quel, si bien qu'une reprise qui se tromperait de ligne
 * le dirait plutôt que d'attendre un déploiement pour le montrer.
 */

const PROVIDER = "github";
const NUIT_1 = new Date("2026-09-01T02:00:00Z");
const NUIT_2 = new Date("2026-09-08T02:00:00Z");
const JUIN = new Date("2026-06-02T02:00:00Z");

const REPRISE = resolve(
  process.cwd(),
  "prisma/migrations/20260920090000_un_constat_de_compte_se_deduplique_sur_l_identifiant/migration.sql",
);

function personneSortie(username: string, fullname: string) {
  return prisma.person.create({
    data: { username, fullname, source: "BETA", vanishedAt: NUIT_1 },
  });
}

function compte(externalId: string, handle: string, personId?: string) {
  return prisma.externalIdentity.create({
    data: {
      provider: PROVIDER,
      externalId,
      handle,
      matchMethod: personId ? "GITHUB_LOGIN" : "NONE",
      ...(personId ? { personId } : {}),
    },
  });
}

function constatable(
  identite: { id: string; provider: string; handle: string; externalId: string },
  personneUsername: string | null,
): IdentiteConstatable {
  return {
    id: identite.id,
    provider: identite.provider,
    handle: identite.handle,
    externalId: identite.externalId,
    rattachementSur: personneUsername !== null,
    personneUsername,
    personneSortie: personneUsername !== null,
    compteDeService: false,
  };
}

function collecter(identites: readonly IdentiteConstatable[], now: Date) {
  return syncConstats([], [], identites, [], now, `collecte-${now.toISOString()}`, {
    perimetreComplet: true,
    maxNewPersonShare: 0.5,
    derogations: [],
  });
}

const cleDe = async (id: string) =>
  (await prisma.finding.findUniqueOrThrow({ where: { id }, select: { dedupKey: true } })).dedupKey;

describe("un constat de compte se déduplique sur l'identifiant du fournisseur", () => {
  it("laisse remonter l'écart du nouveau porteur d'un login rendu par le fournisseur", async () => {
    // Given le compte d'une personne sortie du référentiel, signalé puis jugé traité et
    // clos à la main par une opératrice, ce qui pose le verrou.
    const partie = await personneSortie("nour.exemple", "Nour Exemple");
    const ancien = await compte("1042", "jdupont", partie.id);
    await collecter([constatable(ancien, partie.username)], NUIT_1);

    const pose = await prisma.finding.findFirstOrThrow({ where: { kind: "ORPHAN" } });
    expect(pose.dedupKey).toBe("ORPHAN:github:1042");
    await prisma.finding.update({
      where: { id: pose.id },
      data: {
        closedAt: NUIT_1,
        closeReason: "compte repris par l'équipe",
        closedBy: "operatrice.exemple",
      },
    });

    // When le compte disparaît, le fournisseur rend le même login à quelqu'un d'autre,
    // et cette personne quitte à son tour le référentiel.
    await prisma.externalIdentity.update({
      where: { id: ancien.id },
      data: { vanishedAt: NUIT_2 },
    });
    const autre = await personneSortie("camille.exemple", "Camille Exemple");
    const nouveau = await compte("9077", "jdupont", autre.id);

    const resultat = await collecter([constatable(nouveau, autre.username)], NUIT_2);

    // Then l'écart du nouveau porteur remonte, sous sa propre clé et sur son compte.
    expect(resultat.ouverts).toBe(1);
    expect(
      await prisma.finding.findMany({
        where: { kind: "ORPHAN", closedAt: null },
        select: { dedupKey: true, externalIdentityId: true },
      }),
    ).toEqual([{ dedupKey: "ORPHAN:github:9077", externalIdentityId: nouveau.id }]);

    // Then l'épisode de l'ancien porteur reste le sien, clos et sur son compte. Son
    // verrou tombe, comme celui de toute situation qui a cessé d'être constatée : c'est
    // la levée du verrou, pas son transfert.
    const ancienConstat = await prisma.finding.findUniqueOrThrow({ where: { id: pose.id } });
    expect(ancienConstat.dedupKey).toBe("ORPHAN:github:1042");
    expect(ancienConstat.closedAt).not.toBeNull();
    expect(ancienConstat.externalIdentityId).toBe(ancien.id);
    expect(ancienConstat.closedBy).toBeNull();
  });

  it("reprend la clé du constat qui vaut encore et laisse où il est l'épisode clos sous un ancien nom", async () => {
    // Given la base d'avant, dont les clés nomment le compte par son nom d'usage : deux
    // épisodes du même compte, le premier clos sous le nom qu'il portait alors, et le
    // constat d'un compte que personne ne réclame.
    const partie = await personneSortie("nour.exemple", "Nour Exemple");
    const suivi = await compte("1042", "jdupont", partie.id);
    const isole = await compte("9077", "atelier-bot");

    const clos = await prisma.finding.create({
      data: {
        kind: "ORPHAN",
        dedupKey: "ORPHAN:github:n.exemple",
        severity: "HIGH",
        personId: partie.id,
        externalIdentityId: suivi.id,
        openedAt: JUIN,
        closedAt: NUIT_1,
        closeReason: "ne se vérifie plus à la collecte",
      },
    });
    const vivant = await prisma.finding.create({
      data: {
        kind: "ORPHAN",
        dedupKey: "ORPHAN:github:jdupont",
        severity: "HIGH",
        personId: partie.id,
        externalIdentityId: suivi.id,
        openedAt: NUIT_1,
      },
    });
    const sansDetenteur = await prisma.finding.create({
      data: {
        kind: "UNREGISTERED",
        dedupKey: "UNREGISTERED:github:atelier-bot",
        externalIdentityId: isole.id,
        openedAt: NUIT_1,
      },
    });

    // When la reprise passe.
    await prisma.$executeRawUnsafe(readFileSync(REPRISE, "utf8"));

    // Then chaque constat qui vaut encore porte l'identifiant de son compte.
    expect(await cleDe(vivant.id)).toBe("ORPHAN:github:1042");
    expect(await cleDe(sansDetenteur.id)).toBe("UNREGISTERED:github:9077");
    // Then l'épisode clos garde la sienne : la clé est unique sur toute la table, et
    // c'est celui qui vaut encore qui doit la prendre.
    expect(await cleDe(clos.id)).toBe("ORPHAN:github:n.exemple");

    // Then la collecte suivante retrouve le constat repris au lieu d'en rouvrir un
    // second sur le même compte.
    const resultat = await collecter([constatable(suivi, partie.username)], NUIT_2);
    expect(resultat.ouverts).toBe(0);
    expect(await prisma.finding.count({ where: { kind: "ORPHAN", closedAt: null } })).toBe(1);
  });
});
