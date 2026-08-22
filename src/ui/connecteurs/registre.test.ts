import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CONNECTEURS } from "@/connectors";
import type { ConnectorContract } from "@/core/connector";

import { aUnePage, clesAvecEcran, ecranDe } from "./registre";

function contrat(key: string, ajouts: Partial<ConnectorContract> = {}): ConnectorContract {
  return {
    key,
    label: key,
    criticality: "low",
    runbook: "à la main",
    credentials: [],
    capabilities: {},
    scopeSchema: z.object({}),
    ...ajouts,
  };
}

describe("une page de connecteur n'existe que quand il a quelque chose à montrer", () => {
  it("distingue le connecteur nu de celui qui se règle, porte une fonctionnalité ou tient un écran", () => {
    expect(aUnePage(contrat("nu"))).toBe(false);

    expect(aUnePage(contrat("reglable", { configSchema: z.object({ source: z.string() }) }))).toBe(
      true,
    );

    expect(
      aUnePage(
        contrat("avec-fonctionnalite", {
          features: [{ key: "invites", label: "Invités", requires: [], entrypoint: "invites" }],
        }),
      ),
    ).toBe(true);

    // Une liste de fonctionnalités vide ne vaut pas une fonctionnalité : elle ne
    // donnerait qu'une page où il n'y a rien à lire.
    expect(aUnePage(contrat("liste-vide", { features: [] }))).toBe(false);

    expect(aUnePage(contrat("github"))).toBe(true);
    expect(ecranDe("github")).toBeDefined();
    expect(ecranDe("nu")).toBeUndefined();
  });

  it("n'enregistre aucun écran qu'aucun connecteur ne peut atteindre", () => {
    const declares = CONNECTEURS.map((connecteur) => connecteur.contract.key);

    for (const cle of clesAvecEcran()) {
      expect(declares).toContain(cle);
    }

    // Le sens inverse n'est pas une faute : un connecteur peut n'avoir qu'une
    // configuration, et se contenter du socle commun de la page.
    expect(CONNECTEURS.filter((connecteur) => aUnePage(connecteur.contract))).not.toHaveLength(0);
  });
});
