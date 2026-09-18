import { describe, expect, it } from "vitest";

import { LIENS_OPERATEUR } from "./Navigation";

/**
 * L'ordre du menu est une décision, pas un reste de l'ordre d'écriture des écrans.
 *
 * Il a été rangé par objet métier pendant un an : les cinq premières entrées ne portaient aucun
 * geste, et la première file de travail arrivait au sixième rang. Rien ne tenait ce choix, et rien
 * n'aurait signalé qu'il se défaisait au lot suivant.
 */
const FILES_DE_TRAVAIL = ["/constats", "/comptes-isoles", "/dossiers", "/comptes-de-service"];
const MACHINERIE = ["/systemes", "/collectes", "/journal", "/configuration"];

describe("ce que le menu range en premier", () => {
  it("met ce qu'il y a à faire avant ce qu'on consulte, et la machinerie en dernier", () => {
    // Given le menu tel qu'un opérateur le voit.
    const chemins: string[] = LIENS_OPERATEUR.map(({ href }) => href);

    // Then le tableau de bord ouvre le menu : c'est l'écran d'où l'on part.
    expect(chemins[0]).toBe("/");

    // Then les quatre files de travail suivent immédiatement, dans l'ordre où elles coûtent.
    expect(chemins.slice(1, 1 + FILES_DE_TRAVAIL.length)).toEqual(FILES_DE_TRAVAIL);

    // Then la machinerie ferme le menu, entière et sans rien après elle : elle se consulte quand on
    // la cherche, jamais parce qu'elle est passée devant les yeux.
    expect(chemins.slice(-MACHINERIE.length)).toEqual(MACHINERIE);

    // Then aucune file de travail ne se retrouve après un référentiel, ce qui est la dérive que ce
    // test existe pour voir : elle se produit en ajoutant une entrée à la fin, sans y penser.
    const dernierTravail = Math.max(...FILES_DE_TRAVAIL.map((href) => chemins.indexOf(href)));
    const premierReferentiel = Math.min(
      ...["/personnes", "/startups", "/modeles"].map((href) => chemins.indexOf(href)),
    );
    expect(dernierTravail).toBeLessThan(premierReferentiel);
  });
});
