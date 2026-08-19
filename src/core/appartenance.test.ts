import { describe, expect, it } from "vitest";

import {
  type Appartenance,
  appartenanceDe,
  type EtatAppartenance,
  libelleAppartenance,
  surchargeSuperflue,
} from "./appartenance";

const TERMINALES = ["abandon", "abandon-investigation", "transfere", "alumni"];

const PHASES = new Map<string, string | null>([
  ["produit-alpha", "acceleration"],
  ["produit-delta", "construction"],
  ["produit-omega", "abandon"],
  ["produit-sigma", "transfere"],
]);

const etat = (over: Partial<EtatAppartenance> = {}): EtatAppartenance => ({
  attachment: "NONE",
  startupsCollectees: [],
  startupsManuelles: [],
  surcharge: null,
  ...over,
});

const derive = (over: Partial<EtatAppartenance> = {}): Appartenance =>
  appartenanceDe(etat(over), PHASES, TERMINALES);

describe("l'ordre de lecture décide de l'appartenance", () => {
  it("distingue les cinq titres, et réunit les startups sans doublon", () => {
    const parStartup = derive({ attachment: "STARTUPS", startupsCollectees: ["produit-alpha"] });
    const parEquipe = derive({ attachment: "DECLARED" });
    const parLesDeux = derive({ attachment: "BOTH", startupsCollectees: ["produit-alpha"] });
    const parRattachement = derive({ startupsManuelles: ["produit-delta"] });
    const parRien = derive();

    expect([parStartup, parEquipe, parLesDeux, parRattachement].every((a) => a.dans)).toBe(true);
    expect(parRien.dans).toBe(false);

    expect([
      parStartup.motif,
      parEquipe.motif,
      parLesDeux.motif,
      parRattachement.motif,
      parRien.motif,
    ]).toEqual(["STARTUP", "EQUIPE", "EQUIPE_ET_STARTUP", "STARTUP_MANUELLE", "AUCUN"]);

    // Une même startup collectée et rattachée à la main ne paraît qu'une fois.
    const union = derive({
      attachment: "STARTUPS",
      startupsCollectees: ["produit-alpha", "produit-delta"],
      startupsManuelles: ["produit-delta", "produit-omega"],
    });
    expect(union.startups).toEqual(["produit-alpha", "produit-delta", "produit-omega"]);

    const libelles = [parStartup, parEquipe, parLesDeux, parRattachement, parRien].map(
      (appartenance) => libelleAppartenance(appartenance).libelle,
    );
    expect(new Set(libelles).size).toBe(5);
  });

  it("compte un rattachement manuel au même rang qu'une startup collectée", () => {
    // Sinon le motif reste « Équipe transverse », dont la précision affirme
    // qu'aucune startup ne porte son rattachement, pendant que la fiche affiche la
    // startup juste en dessous. C'est le libellé qui contredit les données, ce que
    // le ticket interdit.
    const transverseEtRattachee = derive({
      attachment: "DECLARED",
      startupsManuelles: ["produit-delta"],
    });

    expect(transverseEtRattachee.motif).toBe("EQUIPE_ET_STARTUP");
    expect(transverseEtRattachee.startups).toEqual(["produit-delta"]);
    expect(libelleAppartenance(transverseEtRattachee).precision).not.toContain(
      "aucune startup ne porte son rattachement",
    );

    // Sans rattachement, rien ne change : le motif reste celui de l'équipe seule.
    expect(derive({ attachment: "DECLARED" }).motif).toBe("EQUIPE");
  });

  it("ne fait sortir personne d'un rattachement annoncé sans startup connue", () => {
    // La liste est vide parce que la collecte n'a rien trouvé, et une collecte peut
    // être tronquée : conclure à une sortie ici reviendrait à couper sur du vide.
    const annoncee = derive({ attachment: "STARTUPS" });

    expect(annoncee.dans).toBe(true);
    expect(annoncee.motif).toBe("STARTUP");
    expect(annoncee.sansStartupConnue).toBe(true);
    expect(libelleAppartenance(annoncee).precision).toContain("Aucune startup connue");
  });
});

describe("une surcharge d'entrée porte un nom et une date, et n'efface pas les faits", () => {
  it("place dans le périmètre quelqu'un qu'aucun rattachement ne porte", () => {
    const forcee = derive({
      surcharge: {
        sens: "INCLUDE",
        par: "alex.martin",
        depuis: new Date("2026-03-03T09:00:00Z"),
        raison: "coach de l'incubateur, sur aucun produit précis",
      },
    });

    expect(forcee.dans).toBe(true);
    expect(forcee.motif).toBe("INCLUSION_FORCEE");
    expect(forcee.surcharge).toMatchObject({
      par: "alex.martin",
      raison: "coach de l'incubateur, sur aucun produit précis",
    });
    expect(forcee.sansSurcharge).toBe("AUCUN");
    expect(libelleAppartenance(forcee).libelle).toBe("Dans l'incubateur, forcé");

    // Les faits et la décision disent des choses différentes : la surcharge sert
    // encore à quelque chose.
    expect(surchargeSuperflue(forcee)).toBe(false);
  });
});

describe("une surcharge de sortie l'emporte sur la collecte, et le dit", () => {
  it("sort du périmètre sans masquer ce que la collecte constate", () => {
    const sortie = derive({
      attachment: "BOTH",
      startupsCollectees: ["produit-alpha"],
      surcharge: {
        sens: "EXCLUDE",
        par: "camille.roux",
        depuis: new Date("2026-03-03T09:00:00Z"),
        raison: "partie de l'incubateur, la politique n'a pas encore suivi",
      },
    });

    expect(sortie.dans).toBe(false);
    expect(sortie.motif).toBe("EXCLUSION_FORCEE");
    expect(sortie.sansSurcharge).toBe("EQUIPE_ET_STARTUP");
    // Les startups restent rendues telles quelles : une surcharge dit
    // l'appartenance, elle n'efface aucune donnée.
    expect(sortie.startups).toEqual(["produit-alpha"]);

    const titre = libelleAppartenance(sortie);
    expect(titre.libelle).toBe("Hors incubateur, forcé");
    expect(titre.precision).toContain("Équipe et startup");
  });
});

describe("une startup terminale ne fait sortir personne, mais le libellé cesse d'affirmer", () => {
  it("garde les trois dans le périmètre et ne conclut que sur du constaté", () => {
    const toutesFinies = derive({
      attachment: "STARTUPS",
      startupsCollectees: ["produit-omega", "produit-sigma"],
    });
    const uneVivante = derive({
      attachment: "STARTUPS",
      startupsCollectees: ["produit-omega", "produit-alpha"],
    });
    const phaseInconnue = derive({
      attachment: "STARTUPS",
      startupsCollectees: ["startup.jamais.vue"],
    });

    for (const appartenance of [toutesFinies, uneVivante, phaseInconnue]) {
      expect(appartenance.dans).toBe(true);
      expect(appartenance.motif).toBe("STARTUP");
    }

    expect(toutesFinies.toutesStartupsTerminees).toBe(true);
    expect(uneVivante.toutesStartupsTerminees).toBe(false);
    // Une phase qu'on ne connaît pas interdit de conclure.
    expect(phaseInconnue.toutesStartupsTerminees).toBe(false);

    expect(libelleAppartenance(toutesFinies).libelle).toBe("Par startup, toutes terminées");
    expect(libelleAppartenance(uneVivante).libelle).toBe("Par startup");
    expect(libelleAppartenance(phaseInconnue).libelle).toBe("Par startup");
  });
});

describe("une surcharge que la collecte a rattrapée se signale comme superflue", () => {
  it("reste posée avec son auteur, et rien ne la retire tout seul", () => {
    const surcharge = {
      sens: "EXCLUDE" as const,
      par: "camille.roux",
      depuis: new Date("2026-03-03T09:00:00Z"),
      raison: "partie de l'incubateur, la politique n'a pas encore suivi",
    };

    // La collecte a cessé de la rattacher : les faits disent maintenant la même
    // chose que la décision.
    const rattrapee = derive({ surcharge });

    expect(rattrapee.dans).toBe(false);
    expect(rattrapee.sansSurcharge).toBe("AUCUN");
    expect(surchargeSuperflue(rattrapee)).toBe(true);
    expect(rattrapee.surcharge).toMatchObject({ par: "camille.roux" });

    // Le libellé ne va pas raconter une contradiction qui n'existe plus.
    expect(libelleAppartenance(rattrapee).precision).not.toContain("Sans cette décision");

    // Le cas symétrique : une inclusion forcée que la collecte finit par porter.
    const inclusionRattrapee = derive({
      attachment: "DECLARED",
      surcharge: { ...surcharge, sens: "INCLUDE" },
    });
    expect(surchargeSuperflue(inclusionRattrapee)).toBe(true);
    expect(surchargeSuperflue(derive())).toBe(false);
  });
});
