import { describe, expect, it, vi } from "vitest";

import type { TuileDeConnecteur } from "./contrat";
import { rendreTuile } from "./rendre-tuile";

const ECHEANCE = 120;

const JETON = "ghp_unJetonQuiNeDoitJamaisSAfficher";

function tuile(cle: string, charger: TuileDeConnecteur["charger"]): TuileDeConnecteur {
  return { cle, titre: cle, provenance: "systeme", charger };
}

describe("une tuile qui tombe, qui traîne ou qui ne revient jamais reste dans son cadre", () => {
  it("contient les trois sorts sans jamais jeter vers la page", async () => {
    // Sans cela, l'échec attendu de la deuxième tuile écrirait un pavé rouge au milieu
    // du rapport de test, et donnerait à lire une panne là où il y a un scénario.
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let signalDeLaMuette: AbortSignal | undefined;

    const sage = tuile("sage", () => Promise.resolve("42 comptes"));

    const bavarde = tuile("bavarde", () =>
      Promise.reject(
        new Error(`échec de GET https://api.example.org/orgs/incubateur/members?token=${JETON}`),
      ),
    );

    const muette = tuile("muette", (contexte) => {
      signalDeLaMuette = contexte.signal;
      return new Promise(() => undefined);
    });

    const juste = tuile(
      "juste",
      () => new Promise((resoudre) => setTimeout(() => resoudre("7 invités"), ECHEANCE / 3)),
    );

    const debut = Date.now();
    const maintenant = new Date("2026-08-23T09:00:00Z");

    const resultats = await Promise.all(
      [sage, bavarde, muette, juste].map((une) => rendreTuile(une, maintenant, ECHEANCE)),
    );
    const duree = Date.now() - debut;

    const [rendue, tombee, jamais, limite] = resultats;

    expect(rendue).toEqual({ etat: "ok", contenu: "42 comptes" });
    expect(limite).toEqual({ etat: "ok", contenu: "7 invités" });

    expect(tombee?.etat).toBe("echec");
    expect(jamais?.etat).toBe("echec");

    // Le point de tout l'exercice : rien de ce que la tuile a levé ne ressort à l'écran.
    const affiche = JSON.stringify(resultats);
    expect(affiche).not.toContain(JETON);
    expect(affiche).not.toContain("api.example.org");

    if (jamais?.etat === "echec") {
      expect(jamais.raison).toBe("delai");
    }
    if (tombee?.etat === "echec") {
      expect(tombee.raison).toBe("erreur");
    }

    // La tuile qui ne répond pas est abandonnée, sans quoi son appel courrait encore
    // après que la page a été servie.
    expect(signalDeLaMuette?.aborted).toBe(true);

    // Le temps total est borné par l'échéance, et non par la somme des tuiles : une
    // tuile en carafe ne retient pas celles qui savent répondre.
    expect(duree).toBeLessThan(ECHEANCE * 3);

    // Le détail, lui, est bien parti dans les journaux du serveur.
    expect(journal).toHaveBeenCalledTimes(2);
    journal.mockRestore();
  });

  it("donne à chaque échec une référence distincte, seul fil vers le journal", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const casse = tuile("casse", () => Promise.reject(new Error("boum")));
    const maintenant = new Date("2026-08-23T09:00:00Z");

    const premier = await rendreTuile(casse, maintenant, ECHEANCE);
    const second = await rendreTuile(casse, maintenant, ECHEANCE);

    if (premier.etat !== "echec" || second.etat !== "echec") {
      throw new Error("les deux rendus devaient échouer");
    }

    expect(premier.reference).not.toBe(second.reference);
    expect(journal.mock.calls.map(([ligne]) => ligne)).toEqual([
      `[tuile casse] échec, référence ${premier.reference}`,
      `[tuile casse] échec, référence ${second.reference}`,
    ]);

    journal.mockRestore();
  });
});
