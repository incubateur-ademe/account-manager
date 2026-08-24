import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CONNECTEURS } from "@/connectors";
import type { ConnectorContract } from "@/core/connector";

import { aUnePage, clesAvecEcran, clesAvecTuiles, ecranDe, tuilesDe } from "./registre";

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

  it("n'enregistre aucune tuile de tableau de bord qu'aucun connecteur ne peut atteindre", () => {
    const declares = CONNECTEURS.map((connecteur) => connecteur.contract.key);

    for (const cle of clesAvecTuiles()) {
      expect(declares).toContain(cle);
    }

    expect(tuilesDe("github")).toBeDefined();

    // Une tuile n'est pas une page : un connecteur peut poser un chiffre sur le
    // tableau de bord sans avoir d'écran à lui, et l'inverse.
    expect(tuilesDe("nu")).toBeUndefined();
  });

  it("ne laisse pas deux tuiles d'un même connecteur porter la même clé", async () => {
    for (const cle of clesAvecTuiles()) {
      const chargeur = tuilesDe(cle);
      if (!chargeur) {
        throw new Error(`la clé ${cle} vient du registre et devrait s'y retrouver`);
      }

      const { tuiles } = await chargeur();
      const cles = tuiles.map((tuile) => tuile.cle);

      // Deux clés identiques donnent deux enfants React de même clé : l'un des deux
      // disparaît du tableau de bord sans erreur ni trace, et son auteur ne voit rien.
      expect(new Set(cles).size).toBe(cles.length);
    }
  });
});
