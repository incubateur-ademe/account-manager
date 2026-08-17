import { describe, expect, it } from "vitest";

import { chuteExcessive, fraicheurDe } from "./collecte";

const SEUIL = 48;
const MAINTENANT = new Date("2026-08-11T09:00:00.000Z");

describe("fraîcheur de la collecte", () => {
  it("se tait tant que le traitement quotidien a tourné", () => {
    // Une nuit sautée arrive : tant qu'on reste sous le seuil, rien à dire, sinon
    // l'avertissement deviendrait le fond d'écran et ne serait plus lu.
    const hier = new Date("2026-08-10T04:30:00.000Z");

    expect(fraicheurDe(hier, MAINTENANT, SEUIL)).toEqual({ perimee: false, heures: 28 });
  });

  it("prévient dès que le silence dure plus que le seuil", () => {
    // Deux nuits de suite sans collecte : ce n'est plus un aléa, et les écrans
    // continueraient d'afficher des échéances tenues pour celles du jour.
    const avantHier = new Date("2026-08-09T04:30:00.000Z");

    const fraicheur = fraicheurDe(avantHier, MAINTENANT, SEUIL);
    expect(fraicheur.perimee).toBe(true);
    expect(fraicheur.heures).toBe(52);
  });

  it("traite l'absence totale de collecte comme le pire des cas", () => {
    // Rien n'a jamais été observé : l'outil ne sait rien, ce qui ne veut surtout pas
    // dire qu'il n'y a rien à couper.
    expect(fraicheurDe(null, MAINTENANT, SEUIL)).toEqual({ perimee: true, heures: null });
  });

  it("ne rend jamais un âge négatif si l'horloge du serveur a bougé", () => {
    const futur = new Date("2026-08-11T10:00:00.000Z");

    expect(fraicheurDe(futur, MAINTENANT, SEUIL)).toEqual({ perimee: false, heures: 0 });
  });
});

describe("chute d'une collecte d'un relevé à l'autre", () => {
  const PART_MAX = 0.2;

  it("laisse passer les départs ordinaires", () => {
    // Quelques personnes s'en vont d'un mois sur l'autre : c'est la vie normale de
    // l'incubateur, et refuser de la constater rendrait l'outil muet. Le plancher
    // lui-même passe, le doute ne commence qu'en dessous.
    expect(chuteExcessive(208, 200, PART_MAX)).toBe(false);
    expect(chuteExcessive(208, 166, PART_MAX)).toBe(false);
  });

  it("retient le bras quand la collecte perd plus d'un cinquième d'un coup", () => {
    // Une réponse tronquée mais valide ressemble trait pour trait à un départ
    // collectif. Les dater reviendrait à couper les accès de gens en poste.
    expect(chuteExcessive(208, 165, PART_MAX)).toBe(true);
    expect(chuteExcessive(208, 0, PART_MAX)).toBe(true);
  });

  it("ne soupçonne rien faute de point de comparaison", () => {
    // Premier relevé : tout est nouveau, rien n'a disparu.
    expect(chuteExcessive(0, 0, PART_MAX)).toBe(false);
    expect(chuteExcessive(0, 208, PART_MAX)).toBe(false);
  });

  it("ne bronche pas quand la collecte grossit", () => {
    expect(chuteExcessive(100, 500, PART_MAX)).toBe(false);
  });
});
