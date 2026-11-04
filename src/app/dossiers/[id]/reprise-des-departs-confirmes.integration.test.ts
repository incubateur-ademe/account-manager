import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { CaseKind, CaseState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/**
 * La reprise des départs confirmés avant que la confirmation ne les décide, jouée
 * contre une vraie base.
 *
 * La reprise est du SQL : elle se joue, elle ne se relit pas. Le fichier de migration
 * est lu tel quel, si bien qu'un filtre qui se tromperait de sens ou d'état le dirait
 * ici plutôt qu'au déploiement.
 */

const REPRISE = resolve(
  process.cwd(),
  "prisma/migrations/20261104120000_un_depart_se_decide_a_la_confirmation/migration.sql",
);

async function dossier(
  numero: number,
  sens: CaseKind,
  etat: CaseState,
  plan: "confirme" | "brouillon" | null,
): Promise<string> {
  const personne = await prisma.person.create({
    data: {
      username: `personne.exemple${numero}`,
      fullname: `Personne Exemple ${numero}`,
      source: "BETA",
    },
  });
  const cas = await prisma.accessCase.create({
    data: { kind: sens, personId: personne.id, state: etat },
  });
  if (plan !== null) {
    await prisma.plan.create({
      data: {
        kind: sens,
        createdBy: "operatrice.exemple",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
        planDigest: "empreinte",
        accessCaseId: cas.id,
        confirmedAt: plan === "confirme" ? new Date("2026-10-01T09:00:00Z") : null,
      },
    });
  }
  return cas.id;
}

describe("un départ confirmé avant la règle se reprend comme décidé", () => {
  it("ne passe à CONFIRMED que les départs vivants dont le plan a été confirmé, une seule fois", async () => {
    const dossiers = {
      candidatConfirme: await dossier(1, "OFFBOARDING", "CANDIDATE", "confirme"),
      veilleConfirmee: await dossier(2, "OFFBOARDING", "WATCH", "confirme"),
      candidatEnBrouillon: await dossier(3, "OFFBOARDING", "CANDIDATE", "brouillon"),
      candidatSansPlan: await dossier(4, "OFFBOARDING", "CANDIDATE", null),
      clos: await dossier(5, "OFFBOARDING", "DONE", "confirme"),
      annule: await dossier(6, "OFFBOARDING", "CANCELLED", "confirme"),
      arrivee: await dossier(7, "ONBOARDING", "CANDIDATE", "confirme"),
    };
    const sql = readFileSync(REPRISE, "utf8");

    expect(await prisma.$executeRawUnsafe(sql)).toBe(2);

    const etats = Object.fromEntries(
      await Promise.all(
        Object.entries(dossiers).map(async ([nom, id]) => [
          nom,
          (await prisma.accessCase.findUniqueOrThrow({ where: { id }, select: { state: true } }))
            .state,
        ]),
      ),
    );
    expect(etats).toEqual({
      candidatConfirme: "CONFIRMED",
      veilleConfirmee: "CONFIRMED",
      candidatEnBrouillon: "CANDIDATE",
      candidatSansPlan: "CANDIDATE",
      clos: "DONE",
      annule: "CANCELLED",
      arrivee: "CANDIDATE",
    });

    expect(await prisma.$executeRawUnsafe(sql)).toBe(0);
  });
});
