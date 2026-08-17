import { describe, expect, it } from "vitest";

import {
  constatsDe,
  constatsDIdentites,
  type PersonneConstatable,
  verrousDeCloture,
} from "./constat";

const AUJOURDHUI = new Date("2026-08-08T00:00:00Z");

const TERMINALES = ["abandon", "abandon-investigation", "transfere", "alumni"];

// Un jeu de phases représentatif : deux vivantes, trois terminales.
const PHASES = new Map<string, string | null>([
  ["produit-gamma", "consolidation"],
  ["produit-delta", "construction"],
  ["produit-epsilon", "abandon"],
  ["produit-zeta", "abandon-investigation"],
  ["produit-beta", "transfere"],
]);

const personne = (over: Partial<PersonneConstatable> = {}): PersonneConstatable => ({
  username: "jean.dupont",
  fullname: "Jean Dupont",
  attachment: "STARTUPS",
  startups: ["produit-gamma"],
  missionEnd: new Date("2027-01-01T00:00:00Z"),
  vanishedAt: null,
  ...over,
});

describe("constats levés sur le périmètre", () => {
  it("signale en priorité haute une personne sortie du référentiel", () => {
    const constats = constatsDe(
      [personne({ username: "nina.bertrand", vanishedAt: new Date("2026-08-08") })],
      PHASES,
      TERMINALES,
      AUJOURDHUI,
    );
    expect(constats).toHaveLength(1);
    expect(constats[0]).toMatchObject({
      kind: "SCOPE_EXIT",
      severity: "HIGH",
      dedupKey: "SCOPE_EXIT:nina.bertrand",
    });
  });

  it("signale une personne dont toutes les startups sont terminées", () => {
    const constats = constatsDe(
      [personne({ startups: ["produit-epsilon", "produit-zeta"] })],
      PHASES,
      TERMINALES,
      AUJOURDHUI,
    );
    expect(constats[0]).toMatchObject({ kind: "INACTIVE_STARTUP", severity: "MEDIUM" });
  });

  it("ne signale rien tant qu'une seule startup reste vivante", () => {
    expect(
      constatsDe(
        [personne({ startups: ["produit-epsilon", "produit-delta"] })],
        PHASES,
        TERMINALES,
        AUJOURDHUI,
      ),
    ).toHaveLength(0);
  });

  it("ne conclut jamais sur une phase inconnue", () => {
    // Une startup absente du référentiel local pourrait être vivante : signaler
    // reviendrait à proposer une coupure sur une supposition.
    expect(
      constatsDe([personne({ startups: ["startup.jamais.vue"] })], PHASES, TERMINALES, AUJOURDHUI),
    ).toHaveLength(0);
  });

  it("épargne l'équipe transverse, dont le rattachement ne dépend d'aucune startup", () => {
    const transverse = personne({ attachment: "DECLARED", startups: [] });
    expect(constatsDe([transverse], PHASES, TERMINALES, AUJOURDHUI)).toHaveLength(0);
  });

  it("ne cumule pas deux constats sur la même personne", () => {
    // Sortie du référentiel ET startups terminées : le premier suffit, les deux
    // appellent la même action et deux lignes pour un cas font du bruit.
    const cumul = personne({ startups: ["produit-epsilon"], vanishedAt: new Date("2026-08-08") });
    const constats = constatsDe([cumul], PHASES, TERMINALES, AUJOURDHUI);
    expect(constats).toHaveLength(1);
    expect(constats[0]?.kind).toBe("SCOPE_EXIT");
  });

  it("traite le transfert comme une fin, au même titre que l'abandon", () => {
    // Une startup transférée a quitté l'incubateur : ses accès n'ont plus lieu d'être.
    const constats = constatsDe(
      [personne({ startups: ["produit-beta"] })],
      PHASES,
      TERMINALES,
      AUJOURDHUI,
    );
    expect(constats[0]?.kind).toBe("INACTIVE_STARTUP");
  });

  it("se tait quand la mission est déjà finie, l'échéance le dit mieux", () => {
    // Trente et un des trente-deux cas réels étaient dans cette situation : lever
    // le constat les aurait tous remontés pour rien.
    const partie = personne({
      startups: ["produit-epsilon"],
      missionEnd: new Date("2024-01-01T00:00:00Z"),
    });
    expect(constatsDe([partie], PHASES, TERMINALES, AUJOURDHUI)).toHaveLength(0);
  });
});

describe("constats clos à la main puis revus par la collecte", () => {
  const CLOS = [
    { id: "f1", dedupKey: "SCOPE_EXIT:jean.dupont" },
    { id: "f2", dedupKey: "INACTIVE_STARTUP:marie.martin" },
  ];

  it("laisse clos ce qu'un opérateur a jugé traité et qui dure encore", () => {
    // Le cas courant : quelqu'un est sorti du référentiel, ses accès ont été
    // coupés, mais il restera sorti pour toujours. Rouvrir chaque nuit rendrait la
    // file illisible et ferait ignorer les vrais écarts avec.
    const encoreConstates = new Set(["SCOPE_EXIT:jean.dupont", "INACTIVE_STARTUP:marie.martin"]);

    const { verrouilles, aRearmer } = verrousDeCloture(CLOS, encoreConstates);

    expect([...verrouilles].sort()).toEqual([
      "INACTIVE_STARTUP:marie.martin",
      "SCOPE_EXIT:jean.dupont",
    ]);
    expect(aRearmer).toEqual([]);
  });

  it("rend réarmable un constat dont la situation a cessé", () => {
    // Marie est revenue sur une startup active : son constat n'a plus lieu d'être.
    // Le verrou doit tomber, sans quoi un futur épisode resterait muet.
    const encoreConstates = new Set(["SCOPE_EXIT:jean.dupont"]);

    const { verrouilles, aRearmer } = verrousDeCloture(CLOS, encoreConstates);

    expect([...verrouilles]).toEqual(["SCOPE_EXIT:jean.dupont"]);
    expect(aRearmer.map((constat) => constat.id)).toEqual(["f2"]);
  });

  it("libère tout quand plus rien ne se constate", () => {
    const { verrouilles, aRearmer } = verrousDeCloture(CLOS, new Set());

    expect(verrouilles.size).toBe(0);
    expect(aRearmer).toHaveLength(2);
  });
});

describe("constats levés par la lecture d'un système cible", () => {
  const base = {
    id: "i1",
    provider: "github",
    handle: "jdupont",
    rattachementSur: true,
    personneUsername: null,
    personneSortie: false,
    compteDeService: false,
  };

  it("signale le compte d'une personne partie comme un accès à couper", () => {
    // C'est le cas qui justifie tout l'outil : la personne n'est plus réclamée par
    // aucune source, et son compte est toujours actif sur le système.
    const [constat] = constatsDIdentites([
      { ...base, personneUsername: "jean.dupont", personneSortie: true },
    ]);

    expect(constat?.kind).toBe("ORPHAN");
    expect(constat?.severity).toBe("HIGH");
    expect(constat?.username).toBe("jean.dupont");
    expect(constat?.identiteId).toBe("i1");
  });

  it("ne conclut pas au départ sur une simple ressemblance", () => {
    // Le rattachement n'est pas prouvé : proposer une coupure reviendrait à agir sur
    // une supposition, et à couper peut-être le compte de quelqu'un d'autre.
    expect(
      constatsDIdentites([
        { ...base, rattachementSur: false, personneUsername: "jean.dupont", personneSortie: true },
      ]),
    ).toEqual([]);
  });

  it("distingue le compte sans détenteur, qui appelle une fiche et non une coupure", () => {
    const [constat] = constatsDIdentites([base]);

    expect(constat?.kind).toBe("UNREGISTERED");
    expect(constat?.severity).toBe("MEDIUM");
    expect(constat?.username).toBeUndefined();
  });

  it("se tait sur un compte machine déclaré et sur une personne en poste", () => {
    // La déclaration existe précisément pour que ces comptes cessent de revenir.
    expect(
      constatsDIdentites([
        { ...base, compteDeService: true },
        { ...base, id: "i2", personneUsername: "marie.martin", personneSortie: false },
      ]),
    ).toEqual([]);
  });
});
