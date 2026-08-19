import { describe, expect, it } from "vitest";

import {
  echeanceEffective,
  enCours,
  prolongeLaMission,
  type RattachementManuel,
  startupsEffectives,
} from "./rattachement-startup";

const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

// L'instant courant porte une heure, l'échéance non : c'est exactement l'écart qui
// fait couper un accès un jour trop tôt quand on compare deux `Date` brutes.
const AUJOURDHUI = le("2026-08-19").getTime() + 15 * 60 * 60 * 1000;
const MAINTENANT = new Date(AUJOURDHUI);

const rattachement = (over: Partial<RattachementManuel> = {}): RattachementManuel => ({
  startupGhid: "produit-omega",
  until: le("2026-11-30"),
  endedAt: null,
  ...over,
});

describe("un rattachement manuel traverse une collecte, puis expire", () => {
  it("survit à la réécriture des champs collectés, et sort de lui-même à la date dite", () => {
    // camille.exemple est collectée sur produit-alpha, mission jusqu'au 30 septembre.
    const collectees = ["produit-alpha"];
    const missionEnd = le("2026-09-30");
    const manuels = [rattachement()];

    expect(startupsEffectives(collectees, manuels, MAINTENANT)).toEqual([
      "produit-alpha",
      "produit-omega",
    ]);
    expect(echeanceEffective(missionEnd, manuels, MAINTENANT)).toEqual(le("2026-11-30"));

    // Une collecte repasse : `Person.startups` et `Person.missionEnd` sont recalculées
    // depuis l'amont, à l'identique. Le rattachement manuel n'appartient pas aux
    // champs réécrits, il n'a donc pas bougé.
    const apresCollecte = {
      startups: startupsEffectives(collectees, manuels, MAINTENANT),
      echeance: echeanceEffective(missionEnd, manuels, MAINTENANT),
    };
    expect(apresCollecte).toEqual({
      startups: ["produit-alpha", "produit-omega"],
      echeance: le("2026-11-30"),
    });

    // Le 1er décembre, personne n'a rien écrit et pourtant le rattachement a cessé.
    const apresExpiration = le("2026-12-01");
    expect(startupsEffectives(collectees, manuels, apresExpiration)).toEqual(["produit-alpha"]);
    expect(echeanceEffective(missionEnd, manuels, apresExpiration)).toEqual(le("2026-09-30"));
  });
});

describe("l'échéance effective ne raccourcit jamais rien, et se clôt de deux façons", () => {
  it("prend la plus lointaine, et retombe dès qu'un rattachement cesse", () => {
    // Un rattachement court ne rogne pas une mission longue.
    expect(
      echeanceEffective(le("2026-12-31"), [rattachement({ until: le("2026-09-30") })], MAINTENANT),
    ).toEqual(le("2026-12-31"));

    // Une fiche créée à la main n'a aucune échéance : elle en a une dès qu'elle porte
    // un rattachement daté, ce que le ticket amende explicitement dans l'architecture.
    const pose = [rattachement()];
    expect(echeanceEffective(null, [], MAINTENANT)).toBeNull();
    expect(echeanceEffective(null, pose, MAINTENANT)).toEqual(le("2026-11-30"));

    // Retiré à la main avant sa date de fin : la fermeture prime, sans attendre.
    const retire = [rattachement({ endedAt: le("2026-08-19") })];
    expect(echeanceEffective(null, retire, MAINTENANT)).toBeNull();
    expect(startupsEffectives([], retire, MAINTENANT)).toEqual([]);

    // Le dernier jour est inclusif, comme une fin de mission. La comparaison tronque
    // au jour : elle ne met pas en balance deux instants.
    const aujourdHui = [rattachement({ until: le("2026-08-19") })];
    expect(enCours(aujourdHui[0] as RattachementManuel, MAINTENANT)).toBe(true);
    expect(enCours(rattachement({ until: le("2026-08-18") }), MAINTENANT)).toBe(false);

    // Deux rattachements ouverts sur la même startup restent possibles, faute
    // d'index unique partiel : l'union dédoublonne et l'échéance prend le maximum.
    const doublon = [rattachement(), rattachement({ until: le("2027-01-31") })];
    expect(startupsEffectives([], doublon, MAINTENANT)).toEqual(["produit-omega"]);
    expect(echeanceEffective(null, doublon, MAINTENANT)).toEqual(le("2027-01-31"));
  });

  it("ne parle de prolongation que là où il y a une mission à prolonger", () => {
    expect(prolongeLaMission(le("2026-09-30"), le("2026-11-30"))).toBe(true);
    expect(prolongeLaMission(le("2026-09-30"), le("2026-09-30"))).toBe(false);
    expect(prolongeLaMission(le("2026-09-30"), le("2026-08-31"))).toBe(false);

    // Sans échéance, rien ne déclenchait de coupure : poser une date de fin borne
    // l'accès au lieu de l'étendre, et n'a donc pas à être confirmé comme une
    // prolongation.
    expect(prolongeLaMission(null, le("2027-12-31"))).toBe(false);
  });
});
