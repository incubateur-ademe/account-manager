import { describe, expect, it } from "vitest";

import { FOURNISSEUR_PERIMETRE } from "@/core/collecte";
import type { SyncStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { dernierCalculDesConstats } from "@/lib/sync/constats";

/**
 * La date que l'alerte de fraîcheur prête à la file des constats, contre une vraie base.
 *
 * Un passage du périmètre en échec ne recalcule pas les constats. S'il datait la file,
 * l'alerte se retirerait au moment même où la file cesse d'être recalculée.
 */

const LUNDI = new Date("2026-10-05T02:00:00Z");
const MARDI = new Date("2026-10-06T02:00:00Z");
const MERCREDI = new Date("2026-10-07T02:00:00Z");
const JEUDI = new Date("2026-10-08T02:00:00Z");
const VENDREDI = new Date("2026-10-09T02:00:00Z");

const passage = (startedAt: Date, status: SyncStatus, provider = FOURNISSEUR_PERIMETRE) =>
  prisma.syncRun.create({ data: { provider, capability: "list", status, startedAt } });

describe("la file des constats se date au dernier passage qui l'a recalculée", () => {
  it("ignore un échec du périmètre, compte un passage partiel, et ne lit aucun autre système", async () => {
    expect(await dernierCalculDesConstats()).toBeNull();

    await passage(LUNDI, "FAILED");
    expect(await dernierCalculDesConstats()).toBeNull();

    await passage(MARDI, "OK");
    await passage(MERCREDI, "FAILED");
    expect(await dernierCalculDesConstats()).toEqual(MARDI);

    await passage(JEUDI, "PARTIAL");
    await passage(VENDREDI, "OK", "github");
    await passage(VENDREDI, "SKIPPED");
    expect(await dernierCalculDesConstats()).toEqual(JEUDI);
  });
});
