import { describe, expect, it } from "vitest";

import {
  emailDeContact,
  jourParis,
  type MembreIncubateur,
  rattachementDe,
  rattachementDeclare,
} from "./membre";

/** Le périmètre du jour, tel que le rend la liste des startups de l'incubateur. */
const ADEME = new Set(["produit-alpha", "produit-beta"]);

describe("lecture des dates de l'espace-membre", () => {
  it("rend le jour parisien, pas le jour UTC", () => {
    // Cas réel : une fin de startup au 31 décembre est stockée à 23h00 UTC la veille.
    // Tronquer la chaîne donnerait le 30 et couperait un accès un jour trop tôt.
    expect(jourParis("2023-12-30T23:00:00.000Z")).toBe("2023-12-31");
  });

  it("ne décale pas les dates déjà à minuit UTC", () => {
    // Cas réel : les fins de mission arrivent sous cette forme.
    expect(jourParis("2027-01-31T00:00:00.000Z")).toBe("2027-01-31");
  });

  it("traite l'absence de date et les valeurs illisibles comme une absence", () => {
    expect(jourParis(null)).toBeNull();
    expect(jourParis("pas une date")).toBeNull();
  });
});

describe("rattachement d'un membre rendu par l'espace-membre", () => {
  it("retient les startups du périmètre et date la fin sur les missions rendues", () => {
    // Les missions arrivent déjà restreintes à l'incubateur, mais une mission peut
    // porter plusieurs produits, dont certains d'un autre incubateur.
    const membre: MembreIncubateur = {
      username: "jean.dupont",
      attachment: "startups",
      missions: [
        {
          end: "2026-12-30T23:00:00.000Z",
          startups: [{ ghid: "produit-alpha" }, { ghid: "produit-hors-perimetre" }],
        },
      ],
    };

    expect(rattachementDe(membre, ADEME)).toEqual({
      attachment: "STARTUPS",
      startups: ["produit-alpha"],
      missionEnd: "2026-12-31",
    });
  });

  it("retient la fin la plus lointaine quand les missions se succèdent", () => {
    const membre: MembreIncubateur = {
      username: "plusieurs.missions",
      attachment: "startups",
      missions: [
        { end: "2025-06-30T00:00:00.000Z", startups: [{ ghid: "produit-alpha" }] },
        { end: "2027-01-31T00:00:00.000Z", startups: [{ ghid: "produit-beta" }] },
      ],
    };

    const rattachement = rattachementDe(membre, ADEME);
    expect(rattachement.missionEnd).toBe("2027-01-31");
    expect(rattachement.startups).toEqual(["produit-alpha", "produit-beta"]);
  });

  it("traite une mission sans fin comme un rattachement sans échéance", () => {
    const membre: MembreIncubateur = {
      username: "sans.fin",
      attachment: "startups",
      missions: [
        { end: "2025-06-30T00:00:00.000Z", startups: [{ ghid: "produit-alpha" }] },
        { end: null, startups: [{ ghid: "produit-beta" }] },
      ],
    };

    expect(rattachementDe(membre, ADEME).missionEnd).toBeNull();
  });

  it("date le rattachement par équipe sur la fiche complète, faute de mission scopée", () => {
    // L'espace-membre ne rattache aucune mission à qui relève d'une équipe : sans sa
    // fiche, cette personne n'aurait aucune échéance et ne sortirait jamais.
    const membre: MembreIncubateur = {
      username: "samir.benali",
      attachment: "teams",
      teams: ["ademe-transverse"],
      missions: [],
    };

    expect(
      rattachementDe(membre, ADEME, {
        username: "samir.benali",
        missions: [{ end: "2029-12-31T00:00:00.000Z" }],
      }),
    ).toEqual({ attachment: "DECLARED", startups: [], missionEnd: "2029-12-31" });
  });

  it("fait primer la fiche complète sur les missions scopées quand les deux voies coexistent", () => {
    // Rattachée par une startup et par une équipe : son appartenance à l'incubateur
    // survit à la fin de son produit, c'est donc sa fin de mission qui fait foi.
    const membre: MembreIncubateur = {
      username: "paul.riviere",
      attachment: "both",
      teams: ["ademe-transverse"],
      missions: [{ end: "2026-05-01T00:00:00.000Z", startups: [{ ghid: "produit-beta" }] }],
    };

    expect(
      rattachementDe(membre, ADEME, {
        username: "paul.riviere",
        missions: [{ end: "2027-06-15T00:00:00.000Z" }],
      }),
    ).toEqual({ attachment: "BOTH", startups: ["produit-beta"], missionEnd: "2027-06-15" });
  });

  it("ne date rien quand la fiche complète manque, sur les deux voies qui en dépendent", () => {
    // Ce test disait l'inverse : mieux valait une échéance approchée qu'aucune. Elle
    // n'est pas approchée, elle est fausse et toujours dans le même sens. La liste
    // scopée ne porte que les missions de startup : elle raccourcit l'échéance quand la
    // mission beta.gouv va plus loin, et en invente une quand la fiche n'en portait
    // aucune. Les deux font proposer un départ trop tôt.
    const deuxVoies: MembreIncubateur = {
      username: "detail.indisponible",
      attachment: "both",
      missions: [{ end: "2026-05-01T00:00:00.000Z", startups: [{ ghid: "produit-beta" }] }],
    };

    const sansFiche = rattachementDe(deuxVoies, ADEME, null);
    expect(sansFiche.missionEnd).toBeUndefined();
    // Le silence ne s'étend pas au-delà de l'échéance : le reste vient de la liste
    // scopée, qui a bien été lue.
    expect(sansFiche.startups).toEqual(["produit-beta"]);
    expect(sansFiche.attachment).toBe("BOTH");

    // Et sur la voie de l'équipe seule, que rien ne testait : `null` rendrait cette
    // personne sans échéance, donc jamais à traiter, ce qui est exactement ce que la
    // lecture de sa fiche existe pour éviter.
    const parEquipe: MembreIncubateur = {
      username: "transverse.pur",
      attachment: "teams",
      teams: ["ademe-transverse"],
      missions: [],
    };

    expect(rattachementDe(parEquipe, ADEME, null).missionEnd).toBeUndefined();
  });

  it("rattache un transverse déclaré sur sa seule fiche", () => {
    expect(
      rattachementDeclare({
        username: "ines.morel",
        missions: [{ end: "2026-07-31T00:00:00.000Z" }],
      }),
    ).toEqual({ attachment: "DECLARED", startups: [], missionEnd: "2026-07-31" });
  });
});

describe("choix de l'adresse de contact", () => {
  it("suit la préférence déclarée par le membre", () => {
    expect(
      emailDeContact({
        username: "x",
        communication_email: "secondary",
        primary_email: "x@beta.gouv.fr",
        secondary_email: "perso@example.org",
      }),
    ).toBe("perso@example.org");
  });

  it("retombe sur l'adresse principale quand la secondaire manque", () => {
    expect(
      emailDeContact({
        username: "x",
        communication_email: "secondary",
        primary_email: "x@beta.gouv.fr",
      }),
    ).toBe("x@beta.gouv.fr");
  });
});
