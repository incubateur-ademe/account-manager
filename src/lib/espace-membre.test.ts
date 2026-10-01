import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Où part la clé de l'espace-membre.
 *
 * Elle voyage dans un en-tête que `fetch` recopie sur une redirection, et l'ancienne
 * adresse du service redirige encore vers la nouvelle. Le client suit donc une redirection,
 * une seule, et seulement vers HTTPS.
 */

vi.mock("@/lib/env", () => ({
  env: { ESPACE_MEMBRE_URL: "https://ancienne.exemple.invalid", ESPACE_MEMBRE_API_KEY: "cle" },
}));

const { EspaceMembreError, fetchIncubatorStartups } = await import("./espace-membre");

const CHEMIN = "/api/protected/incubators/ademe/startups";

/** Les appels reçus, avec la clé que chacun portait. Le transport est doublé. */
function transport(reponses: Record<string, () => Response>) {
  const appels: { adresse: string; cle: string | null; redirect: string | undefined }[] = [];
  vi.stubGlobal("fetch", (adresse: string, init?: RequestInit) => {
    appels.push({
      adresse,
      cle: new Headers(init?.headers).get("X-Api-Key"),
      redirect: init?.redirect,
    });
    const reponse = reponses[adresse];
    return Promise.resolve(reponse ? reponse() : new Response(null, { status: 404 }));
  });
  return appels;
}

function vers(location: string): () => Response {
  return () => new Response(null, { status: 301, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la clé de l'espace-membre face à une redirection", () => {
  it("suit une redirection vers HTTPS, une seule, et refuse celle qui descend en HTTP", async () => {
    // Given l'ancienne adresse, qui redirige vers la nouvelle en HTTPS
    const suivie = transport({
      [`https://ancienne.exemple.invalid${CHEMIN}`]: vers(
        `https://nouvelle.exemple.invalid${CHEMIN}`,
      ),
      [`https://nouvelle.exemple.invalid${CHEMIN}`]: () => Response.json([]),
    });

    // When la collecte lit les startups
    await expect(fetchIncubatorStartups("ademe")).resolves.toEqual({ items: [], erreurs: [] });

    // Then fetch ne suit rien seul, et la clé atteint la nouvelle adresse, après un détour
    expect(suivie).toEqual([
      { adresse: `https://ancienne.exemple.invalid${CHEMIN}`, cle: "cle", redirect: "manual" },
      { adresse: `https://nouvelle.exemple.invalid${CHEMIN}`, cle: "cle", redirect: "manual" },
    ]);

    // Given une redirection vers HTTP
    const descendue = transport({
      [`https://ancienne.exemple.invalid${CHEMIN}`]: vers(
        `http://ailleurs.exemple.invalid${CHEMIN}`,
      ),
    });

    // Then la lecture échoue comme une panne de la source, et la clé ne part pas en clair
    const refus = await fetchIncubatorStartups("ademe").catch((erreur: unknown) => erreur);
    expect(refus).toBeInstanceOf(EspaceMembreError);
    expect(descendue.map(({ adresse }) => adresse)).toEqual([
      `https://ancienne.exemple.invalid${CHEMIN}`,
    ]);

    // Given deux redirections en chaîne, toutes deux en HTTPS
    const chainee = transport({
      [`https://ancienne.exemple.invalid${CHEMIN}`]: vers(
        `https://relais.exemple.invalid${CHEMIN}`,
      ),
      [`https://relais.exemple.invalid${CHEMIN}`]: vers(`https://fin.exemple.invalid${CHEMIN}`),
    });

    // Then la seconde est refusée, et la clé n'atteint jamais la troisième adresse
    await expect(fetchIncubatorStartups("ademe")).rejects.toBeInstanceOf(EspaceMembreError);
    expect(chainee).toHaveLength(2);
  });
});
