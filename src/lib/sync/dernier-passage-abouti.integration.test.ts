import { describe, expect, it } from "vitest";

import { FOURNISSEUR_PERIMETRE } from "@/core/collecte";
import type { SyncStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { dernierPassageAbouti } from "@/lib/sync/perimetre";

/**
 * La date que les alertes de fraîcheur prêtent aux écrans, contre une vraie base.
 *
 * Un passage du périmètre en échec ne relit ni les personnes, ni les startups, ni les
 * constats. S'il datait les écrans, leur alerte se retirerait au moment même où plus
 * rien ne se recalcule.
 */

const LUNDI = new Date("2026-10-05T02:00:00Z");
const MARDI = new Date("2026-10-06T02:00:00Z");
const MERCREDI = new Date("2026-10-07T02:00:00Z");
const JEUDI = new Date("2026-10-08T02:00:00Z");
const VENDREDI = new Date("2026-10-09T02:00:00Z");

const passage = (startedAt: Date, status: SyncStatus, provider = FOURNISSEUR_PERIMETRE) =>
  prisma.syncRun.create({ data: { provider, capability: "list", status, startedAt } });

describe("les écrans se datent au dernier passage du périmètre qui a abouti", () => {
  it("ignore un échec du périmètre, compte un passage partiel, et ne lit aucun autre système", async () => {
    expect(await dernierPassageAbouti()).toBeNull();

    await passage(LUNDI, "FAILED");
    expect(await dernierPassageAbouti()).toBeNull();

    await passage(MARDI, "OK");
    await passage(MERCREDI, "FAILED");
    expect(await dernierPassageAbouti()).toEqual(MARDI);

    await passage(JEUDI, "PARTIAL");
    await passage(VENDREDI, "OK", "github");
    await passage(VENDREDI, "SKIPPED");
    expect(await dernierPassageAbouti()).toEqual(JEUDI);
  });
});
