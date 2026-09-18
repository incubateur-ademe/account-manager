import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * L'adresse que l'émission appelle, composée depuis une variable saisie à la main.
 *
 * Ce qui est en jeu n'est pas le chemin, que le proxy fixe, mais ce qu'une coquille
 * coûte : sans route de révocation ni d'introspection là-bas, un appel qui part sur une
 * adresse fausse ne se diagnostique que par un 404 qui ne nomme rien, et l'échec arrive
 * au premier usage d'un jeton qu'on croyait émis.
 */

const { configuration } = vi.hoisted(() => ({
  configuration: { FGP_URL: undefined as string | undefined },
}));

vi.mock("@/lib/env", () => ({ env: configuration }));

const { emettreUnJeton, ErreurFgp } = await import("./fgp");

/** Les adresses appelées, dans l'ordre. Le transport est doublé : rien ne sort d'ici. */
const appelees: string[] = [];

const DEMANDE = {
  jeton: "jeton-de-compte-inutilise",
  cible: "https://api.exemple.invalid",
  scopes: ["GET:/apps"] as [string],
  secondes: 3600,
  nom: "jeton d'inventaire",
};

beforeEach(() => {
  appelees.length = 0;
  configuration.FGP_URL = undefined;
  vi.stubGlobal("fetch", (adresse: string) => {
    appelees.push(adresse);
    return Promise.resolve(
      new Response(JSON.stringify({ blob: "blob-opaque", key: "cle-cliente" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
});

describe("l'adresse d'émission d'un jeton restreint", () => {
  it("se compose sans doubler le slash et sans avaler un chemin configuré", async () => {
    // Given l'adresse telle que la documentation de déploiement la prescrit, sans chemin
    configuration.FGP_URL = "https://proxy.exemple.invalid";

    // Then l'émission part sur la route du proxy, et le jeton revient en deux moitiés
    await expect(emettreUnJeton(DEMANDE)).resolves.toEqual({
      blob: "blob-opaque",
      cle: "cle-cliente",
    });
    expect(appelees).toEqual(["https://proxy.exemple.invalid/api/generate"]);

    // Given la même adresse avec le slash final qu'un champ de formulaire invite à
    // laisser, et qui rendait `//api/generate`
    appelees.length = 0;
    configuration.FGP_URL = "https://proxy.exemple.invalid//";

    // Then elle mène au même endroit : un routeur qui ne normalise pas rendait 404, et le
    // message ne nommait pas la cause
    await emettreUnJeton(DEMANDE);
    expect(appelees).toEqual(["https://proxy.exemple.invalid/api/generate"]);

    // Given une adresse qui porte un chemin, ce qu'un proxy monté derrière un préfixe
    // impose
    appelees.length = 0;
    configuration.FGP_URL = "https://exemple.invalid/fgp/";

    // Then le chemin survit : c'est pourquoi le slash final se coupe plutôt que de se
    // faire résoudre contre la racine, qui l'aurait avalé en silence
    await emettreUnJeton(DEMANDE);
    expect(appelees).toEqual(["https://exemple.invalid/fgp/api/generate"]);

    // Then sans adresse, rien ne part : le refus précède l'appel, et il exclut qu'un blob
    // ait pu naître là-bas
    appelees.length = 0;
    configuration.FGP_URL = undefined;
    await expect(emettreUnJeton(DEMANDE)).rejects.toThrow(ErreurFgp);
    expect(appelees).toEqual([]);
  });
});
