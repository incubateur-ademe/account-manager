import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Connector } from "@/core/connector";

import { voieLisible, voiesDuJour } from "./voie";

const registre = vi.hoisted(() => ({ connecteurs: [] as Connector[] }));

vi.mock("@/connectors", () => ({ CONNECTEURS: registre.connecteurs }));

const ATELIER: Connector = {
  contract: {
    key: "atelier",
    label: "Atelier",
    criticality: "low",
    runbook: "Lire la console de l'atelier.",
    accountSlug: ({ handle }) => handle,
    credentials: [],
    capabilities: {
      revoke: [
        { requires: ["jeton"], tier: "auto" },
        { requires: [], tier: "manual" },
      ],
      reference: [{ requires: ["jeton"], tier: "auto" }],
    },
    scopeSchema: z.object({}),
  },
  probe: () =>
    Promise.resolve([{ id: "jeton", available: false, checkedAt: new Date("2026-10-03") }]),
  plan: () => Promise.resolve([]),
};

describe("la voie du jour d'une étape figée", () => {
  it("nomme le credential qui manque à un retrait, et ne promet rien à un geste sur un objet possédé", async () => {
    // Given un plan qui retire un compte et transfère un objet sur un système sans jeton
    registre.connecteurs.push(ATELIER);
    const voies = await voiesDuJour([
      { systemKey: "atelier", capability: "revoke" },
      { systemKey: "atelier", capability: "reference" },
    ]);

    // Then le retrait à la main dit ce qui le rendrait automatique
    expect(voieLisible("manual", "manual", voies.get("atelier:revoke"))).toBe(
      "Elle serait automatique si jeton était renseigné.",
    );

    // Then le transfert, toujours à la main, ne dit rien : sa capacité est celle de lire
    expect(voies.has("atelier:reference")).toBe(false);
    expect(voieLisible("manual", "manual", voies.get("atelier:reference"))).toBeNull();
  });
});
