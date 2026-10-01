import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Où part la clé de l'espace-membre.
 *
 * Elle voyage dans un en-tête que fetch recopie sur une redirection, et l'adresse se
 * configure. Une réponse 3xx suivie l'enverrait ailleurs, en clair si la cible est en
 * HTTP : le client doit refuser de suivre, et le dire comme une panne de la source.
 */

const { appels } = vi.hoisted(() => ({
  appels: [] as { adresse: string; init: RequestInit | undefined }[],
}));

vi.mock("@/lib/env", () => ({
  env: { ESPACE_MEMBRE_URL: "https://espace-membre.exemple.invalid", ESPACE_MEMBRE_API_KEY: "cle" },
}));

const { EspaceMembreError, fetchIncubatorStartups } = await import("./espace-membre");

beforeEach(() => {
  appels.length = 0;
});

describe("la clé de l'espace-membre", () => {
  it("ne suit aucune redirection, et un refus de suivre se lit comme une panne de la source", async () => {
    // Given une source qui répond
    vi.stubGlobal("fetch", (adresse: string, init?: RequestInit) => {
      appels.push({ adresse, init });
      return Promise.resolve(Response.json([]));
    });

    // When la collecte lit les startups de l'incubateur
    await fetchIncubatorStartups("ademe");

    // Then la clé part vers l'adresse configurée, et la requête refuse toute redirection
    expect(appels).toHaveLength(1);
    expect(appels[0]?.adresse).toBe(
      "https://espace-membre.exemple.invalid/api/protected/incubators/ademe/startups",
    );
    expect(new Headers(appels[0]?.init?.headers).get("X-Api-Key")).toBe("cle");
    expect(appels[0]?.init?.redirect).toBe("error");

    // Given une source qui redirige, ce que fetch rend en levant
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed: redirect")));

    // Then la lecture échoue comme une panne de la source, chemin nommé, et non en silence
    const echec = await fetchIncubatorStartups("ademe").catch((erreur: unknown) => erreur);
    expect(echec).toBeInstanceOf(EspaceMembreError);
    expect((echec as InstanceType<typeof EspaceMembreError>).path).toBe(
      "/api/protected/incubators/ademe/startups",
    );
  });
});
