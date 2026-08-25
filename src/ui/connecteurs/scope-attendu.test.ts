import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CONNECTEURS } from "@/connectors";

import { scopeAttendu } from "./scope-attendu";

describe("le scope attendu se lit sur le schéma qui validera la saisie, jamais à côté", () => {
  it("rend le scope de chaque connecteur du registre, avec ses valeurs admises et sa stricture", () => {
    for (const { contract } of CONNECTEURS) {
      // Un scope illisible ici serait un contrat non déclaratif, ce que le contrat
      // interdit précisément pour que cet écran et la saisie assistée en dérivent.
      const lu = scopeAttendu(contract.scopeSchema);
      expect(lu.etat).toBe("lu");

      // Et strict, y compris quand il n'attend aucun champ : c'est ce qui fait refuser
      // le scope d'un système recopié sur un autre. La règle vaut pour le registre
      // entier, sans quoi le prochain connecteur l'apprendrait en production.
      expect(lu.etat === "lu" && lu.clesInconnuesRefusees).toBe(true);
    }

    const github = CONNECTEURS.find(({ contract }) => contract.key === "github");
    const notion = CONNECTEURS.find(({ contract }) => contract.key === "notion");

    if (!github || !notion) {
      throw new Error("le registre devrait porter github et notion");
    }

    const lu = scopeAttendu(github.contract.scopeSchema);

    if (lu.etat !== "lu") {
      throw new Error("le scope de github devrait se lire");
    }

    expect(lu.champs).toEqual([
      {
        nom: "organisation",
        requis: true,
        attendu: "texte non vide",
        description: expect.stringContaining("connectors.github.organisations"),
        exemple: expect.any(String),
      },
      {
        nom: "role",
        requis: true,
        attendu: "l'une de : member, admin",
        description: expect.stringContaining("admin"),
        exemple: "member",
      },
    ]);

    // Une clé inconnue dans un profil écrit à la main est une faute de frappe : l'écran
    // doit pouvoir le dire, donc lire la stricture et ne pas la supposer.
    expect(lu.clesInconnuesRefusees).toBe(true);

    // Être membre du workspace, c'est l'être en entier : rien à découper, donc aucun
    // champ, ce qui n'est pas la même chose qu'un scope illisible.
    expect(scopeAttendu(notion.contract.scopeSchema)).toEqual({
      etat: "lu",
      champs: [],
      clesInconnuesRefusees: true,
    });
  });

  it("absorbe un schéma que JSON Schema ne sait pas représenter au lieu d'emporter l'écran", () => {
    // Cet écran montre tous les connecteurs d'un coup : un seul contrat fautif y ferait
    // disparaître l'état des credentials de tous les autres, au moment où on vient le lire.
    expect(scopeAttendu(z.object({ organisation: z.string() }).transform((lu) => lu))).toEqual({
      etat: "illisible",
    });

    expect(scopeAttendu(z.object({ ouvertJusquA: z.date() }))).toEqual({ etat: "illisible" });
  });
});
