import { describe, expect, it } from "vitest";

import {
  champsConstates,
  chuteExcessive,
  fraicheurDe,
  type ReleveSysteme,
  systemesMuets,
} from "./collecte";

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
    // La référence est ce que la base tient pour vivant, non ce qu'un run passé a
    // vu : zéro ne veut donc plus dire « pas d'historique », mais « rien à perdre ».
    // Premier relevé : tout est nouveau, rien n'a disparu.
    expect(chuteExcessive(0, 0, PART_MAX)).toBe(false);
    expect(chuteExcessive(0, 208, PART_MAX)).toBe(false);
  });

  it("ne bronche pas quand la collecte grossit", () => {
    expect(chuteExcessive(100, 500, PART_MAX)).toBe(false);
  });
});

/**
 * L'écran d'une personne ne distingue pas « aucun compte » de « pas regardé ». Un
 * système qui a cessé d'être lu laisse donc les fiches affirmer, sur l'écran même où
 * se décide une coupure, quelque chose que plus rien ne vérifie.
 */
describe("systèmes cibles dont on ne peut plus dire qu'on les regarde", () => {
  const MAINTENANT = new Date("2026-08-18T09:00:00Z");
  const SEUIL = 48;
  const ATTENDUS = ["github", "notion"];

  const releve = (over: Partial<ReleveSysteme> = {}): ReleveSysteme => ({
    provider: "github",
    startedAt: new Date("2026-08-18T03:00:00Z"),
    status: "OK",
    ...over,
  });

  it("se tait quand tous les systèmes ont été lus cette nuit", () => {
    const releves = [releve(), releve({ provider: "notion" })];

    expect(systemesMuets(releves, ATTENDUS, MAINTENANT, SEUIL)).toEqual([]);
  });

  it("signale l'échec, le silence prolongé, le jamais-lu et le non-lu, chacun pour ce qu'il est", () => {
    // Given github qui échoue, notion lu il y a cinq jours, et un troisième système
    // attendu dont aucune trace n'existe
    const releves = [
      releve({ status: "FAILED" }),
      releve({ provider: "notion", startedAt: new Date("2026-08-13T03:00:00Z") }),
    ];

    // When on demande l'état de trois systèmes attendus
    const muets = systemesMuets(releves, [...ATTENDUS, "ovh"], MAINTENANT, SEUIL);

    // Then chacun est signalé avec sa raison, sans être confondu avec les autres
    expect(muets).toEqual([
      { provider: "github", raison: "echec", heures: null },
      { provider: "notion", raison: "perime", heures: 126 },
      { provider: "ovh", raison: "non-lu", heures: null },
    ]);
  });

  it("compte un système annoncé comme non lu, plutôt que de le tenir pour sain", () => {
    // Un credential absent produit une trace SKIPPED : elle dit qu'on n'a pas
    // regardé, ce qui est précisément ce que l'écran doit reprendre. La taire
    // reviendrait à traiter l'absence d'observation comme une absence d'écart.
    const muets = systemesMuets([releve({ status: "SKIPPED" })], ["github"], MAINTENANT, SEUIL);

    expect(muets).toEqual([{ provider: "github", raison: "non-lu", heures: null }]);
  });

  it("tolère un relevé partiel récent, qui reste une observation", () => {
    // Un run partiel a vu quelque chose et l'a dit : il n'a simplement pas conclu
    // sur les disparitions. Le signaler ici doublerait un avertissement déjà donné.
    expect(systemesMuets([releve({ status: "PARTIAL" })], ["github"], MAINTENANT, SEUIL)).toEqual(
      [],
    );
  });
});

/**
 * Ce qu'une identité laisse en base est une liste courte et délibérée. Ce test la
 * fixe, y compris ce qu'elle ne contient pas : sans lui, un champ collecté puis jeté
 * se découvre le jour où quelqu'un compte dessus.
 */
describe("ce qu'une identité collectée laisse en base", () => {
  const MAINTENANT = new Date("2026-08-21T09:00:00Z");

  it("garde les métadonnées dans leur ordre, et laisse dehors ce qui n'est pas persisté", () => {
    const constates = champsConstates(
      {
        externalId: "42",
        idKind: "opaque",
        handle: "camille.rivet",
        emails: ["camille.rivet@exemple.org"],
        lastActivityAt: new Date("2026-08-01T00:00:00Z"),
        details: [
          { label: "Type de compte", value: "robot" },
          { label: "Invitée par", value: "alex.dupuis" },
        ],
      },
      MAINTENANT,
    );

    expect(constates.details).toEqual([
      { label: "Type de compte", value: "robot" },
      { label: "Invitée par", value: "alex.dupuis" },
    ]);
    expect(constates.handle).toBe("camille.rivet");
    expect(constates.idKind).toBe("OPAQUE");
    expect(constates.lastSeenAt).toBe(MAINTENANT);
    expect(constates.vanishedAt).toBeNull();

    // Collectés et non persistés, délibérément : écrire les adresses changerait
    // l'issue du rapprochement sur le parc, une ressemblance devenant une
    // correspondance, donc une identité révocable.
    expect(constates).not.toHaveProperty("emails");
    expect(constates).not.toHaveProperty("lastActivityAt");

    // Le dernier état constaté écrase, absence comprise : une métadonnée que le
    // connecteur ne sait plus écrire ne survit pas à la collecte qui l'a tue.
    const sansRien = champsConstates(
      { externalId: "42", idKind: "opaque", handle: "camille.rivet" },
      MAINTENANT,
    );

    expect(sansRien.details).toBeNull();
  });

  it("tient une chute de ressources pour aussi suspecte qu'une chute de comptes", () => {
    // Un accès porte sur une ressource : une liste d'équipes rendue vide par un
    // incident du fournisseur emporterait tous les accès qu'elles portaient, sur un
    // run par ailleurs vert, et le décompte des comptes ne verrait rien.
    expect(chuteExcessive(20, 1, 0.2)).toBe(true);
    expect(chuteExcessive(20, 0, 0.2)).toBe(true);
    expect(chuteExcessive(20, 19, 0.2)).toBe(false);

    // Une première collecte n'est pas une chute, ici comme pour les comptes.
    expect(chuteExcessive(0, 0, 0.2)).toBe(false);
  });
});
