import { describe, expect, it } from "vitest";

import { declaresManquants } from "./perimetre";

const TRANSVERSE = ["samir.benali", "nina.bertrand", "ines.morel"];

describe("déclarations transverses de la politique", () => {
  it("ne signale rien quand la collecte a résolu tout le monde", () => {
    const resolus = ["jean.dupont", ...TRANSVERSE];
    expect(declaresManquants(resolus, TRANSVERSE)).toEqual([]);
  });

  it("signale un déclaré que la collecte n'a pas résolu, sans le confondre avec un départ", () => {
    // Une faute de frappe dans la politique et une fiche jamais créée se ressemblent :
    // les deux doivent remonter plutôt que de laisser quelqu'un hors du périmètre en
    // silence. Le tri rend la liste comparable d'une collecte à l'autre.
    const resolus = ["jean.dupont", "nina.bertrand"];
    expect(declaresManquants(resolus, [...TRANSVERSE, "typo.dans.le.yaml"])).toEqual([
      "ines.morel",
      "samir.benali",
      "typo.dans.le.yaml",
    ]);
  });
});
