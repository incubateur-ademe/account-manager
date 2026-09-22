import { describe, expect, it } from "vitest";

import { dateFr, dateLocale, instantLocal } from "./dates";

/**
 * Le fuseau des trois formateurs, et le jour qu'ils rendent.
 *
 * Ce qui se tient ici et nulle part ailleurs : qu'aucun d'eux ne dépende du fuseau de la
 * machine qui les joue. Sans fuseau déclaré, un composant serveur prend celui du
 * processus, UTC en production et le fuseau du poste en développement, si bien que deux
 * lectures du même instant donnent deux jours différents sans que rien ne le dise.
 */

/** Une demi-heure avant minuit UTC, donc déjà le lendemain à Paris. */
const AVANT_MINUIT_UTC = new Date("2026-03-05T23:30:00Z");

/** Un minuit UTC, tel qu'une colonne `@db.Date` le rend. */
const MINUIT_UTC = new Date("2026-03-05T00:00:00Z");

describe("les formateurs de dates rendent le jour de Paris", () => {
  it("portent tous les trois le fuseau, et ne le tiennent pas de la machine", () => {
    // Then le fuseau est déclaré, et c'est la seule assertion qui rend le même verdict
    // partout : comparer des chaînes passerait par accident sur un poste déjà à Paris.
    for (const format of [dateFr, dateLocale, instantLocal]) {
      expect(format.resolvedOptions().timeZone).toBe("Europe/Paris");
    }
  });

  it("rendent le lendemain d'un instant de fin de journée, et le même jour d'un minuit UTC", () => {
    // Given un instant à 23h30 UTC, qui est déjà le 6 à Paris,
    // Then les trois le rendent au 6, et c'est exactement ce que le domaine compare.
    expect(dateFr.format(AVANT_MINUIT_UTC)).toBe("6 mars 2026");
    expect(dateLocale.format(AVANT_MINUIT_UTC)).toBe("6 mars 2026");
    expect(instantLocal.format(AVANT_MINUIT_UTC)).toContain("6 mars 2026");

    // Given un minuit UTC, ce qu'est une colonne `@db.Date` une fois relue,
    // Then le jour ne bouge pas : Paris est en avance sur UTC toute l'année, donc un
    // minuit UTC y tombe à une ou deux heures du matin du même jour. C'est ce qui rend
    // ce changement sans effet sur les quatre colonnes de dates du schéma.
    expect(dateFr.format(MINUIT_UTC)).toBe("5 mars 2026");
    expect(dateLocale.format(MINUIT_UTC)).toBe("5 mars 2026");

    // Then l'heure rendue est celle de Paris, une heure de plus qu'UTC en mars.
    expect(instantLocal.format(MINUIT_UTC)).toContain("01:00");
  });
});
