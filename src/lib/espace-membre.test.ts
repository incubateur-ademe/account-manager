import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Ce que le client de l'espace-membre accepte de rendre à la collecte.
 *
 * La clé voyage dans un en-tête que `fetch` recopie sur une redirection, et l'ancienne
 * adresse du service redirige encore vers la nouvelle. Le client suit donc une redirection,
 * une seule, et seulement vers HTTPS.
 *
 * Le périmètre arrive paginé. Une page manquée ou une clé de périmètre trop étroit rendrait
 * un périmètre réduit sous un succès, et chaque absent passerait pour parti.
 */

vi.mock("@/lib/env", () => ({
  env: { ESPACE_MEMBRE_URL: "https://ancienne.exemple.invalid", ESPACE_MEMBRE_API_KEY: "em1_cle" },
}));

const { EspaceMembreError, fetchIncubatorMembers, fetchIncubatorStartups, fetchMemberDetail } =
  await import("./espace-membre");

const STARTUPS = "/api/v1/incubators/ademe/startups";
const MEMBRES = "/api/v1/incubators/ademe/members";

const page = (offset: number) => `?limit=100&offset=${offset}`;

/** Les appels reçus, avec l'en-tête d'autorisation que chacun portait. Le transport est doublé. */
function transport(reponses: Record<string, () => Response>) {
  const appels: { adresse: string; autorisation: string | null; redirect: string | undefined }[] =
    [];
  vi.stubGlobal("fetch", (adresse: string, init?: RequestInit) => {
    appels.push({
      adresse,
      autorisation: new Headers(init?.headers).get("authorization"),
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

function collection(
  data: unknown[],
  meta: { total: number; offset?: number; perimeter?: string },
): () => Response {
  return () =>
    Response.json({
      data,
      meta: { limit: 100, offset: 0, perimeter: "incubator/ademe", ...meta },
    });
}

function membre(index: number) {
  return {
    uuid: `uuid-${index}`,
    username: `personne-${index}.exemple`,
    fullname: `Personne ${index}`,
    github: null,
    primary_email: `personne-${index}@exemple.invalid`,
    secondary_email: null,
    missions: [],
    attachment: "startups",
    teams: [],
  };
}

const ADRESSE = "https://ancienne.exemple.invalid";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("la clé de l'espace-membre face à une redirection", () => {
  it("suit une redirection vers HTTPS, une seule, et refuse celle qui descend en HTTP", async () => {
    // Given l'ancienne adresse, qui redirige vers la nouvelle en HTTPS
    const suivie = transport({
      [`${ADRESSE}${STARTUPS}${page(0)}`]: vers(
        `https://nouvelle.exemple.invalid${STARTUPS}${page(0)}`,
      ),
      [`https://nouvelle.exemple.invalid${STARTUPS}${page(0)}`]: collection([], { total: 0 }),
    });

    // When la collecte lit les startups
    await expect(fetchIncubatorStartups("ademe")).resolves.toEqual({ items: [], erreurs: [] });

    // Then fetch ne suit rien seul, et la clé atteint la nouvelle adresse, après un détour
    expect(suivie).toEqual([
      {
        adresse: `${ADRESSE}${STARTUPS}${page(0)}`,
        autorisation: "Bearer em1_cle",
        redirect: "manual",
      },
      {
        adresse: `https://nouvelle.exemple.invalid${STARTUPS}${page(0)}`,
        autorisation: "Bearer em1_cle",
        redirect: "manual",
      },
    ]);

    // Given une redirection vers HTTP
    const descendue = transport({
      [`${ADRESSE}${STARTUPS}${page(0)}`]: vers(`http://ailleurs.exemple.invalid${STARTUPS}`),
    });

    // Then la lecture échoue comme une panne de la source, et la clé ne part pas en clair
    const refus = await fetchIncubatorStartups("ademe").catch((erreur: unknown) => erreur);
    expect(refus).toBeInstanceOf(EspaceMembreError);
    expect(descendue.map(({ adresse }) => adresse)).toEqual([`${ADRESSE}${STARTUPS}${page(0)}`]);

    // Given deux redirections en chaîne, toutes deux en HTTPS
    const chainee = transport({
      [`${ADRESSE}${STARTUPS}${page(0)}`]: vers(`https://relais.exemple.invalid${STARTUPS}`),
      [`https://relais.exemple.invalid${STARTUPS}`]: vers(`https://fin.exemple.invalid${STARTUPS}`),
    });

    // Then la seconde est refusée, et la clé n'atteint jamais la troisième adresse
    await expect(fetchIncubatorStartups("ademe")).rejects.toBeInstanceOf(EspaceMembreError);
    expect(chainee).toHaveLength(2);
  });
});

describe("le périmètre lu page après page", () => {
  it("rend toutes les pages, et refuse toute lecture qui en aurait perdu une partie", async () => {
    const tous = Array.from({ length: 150 }, (_, index) => membre(index));

    // Given un périmètre de 150 personnes, servi en deux pages
    const appels = transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection(tous.slice(0, 100), { total: 150 }),
      [`${ADRESSE}${MEMBRES}${page(100)}`]: collection(tous.slice(100), {
        total: 150,
        offset: 100,
      }),
    });

    // When la collecte lit les membres
    const lu = await fetchIncubatorMembers("ademe");

    // Then les deux pages sont demandées, et les 150 rendus dans l'ordre
    expect(appels.map(({ adresse }) => adresse)).toEqual([
      `${ADRESSE}${MEMBRES}${page(0)}`,
      `${ADRESSE}${MEMBRES}${page(100)}`,
    ]);
    expect(lu.erreurs).toEqual([]);
    expect(lu.items.map(({ username }) => username)).toEqual(tous.map(({ username }) => username));

    // Given une clé dont le périmètre est une seule startup, qui ne rend que ses membres
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection(tous.slice(0, 3), {
        total: 3,
        perimeter: "startup/produit-alpha",
      }),
    });

    // Then la lecture échoue au lieu de rendre trois personnes sur cent cinquante
    await expect(fetchIncubatorMembers("ademe")).rejects.toThrow(/startup\/produit-alpha/u);

    // Given une clé de périmètre global
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection([], { total: 0, perimeter: "global" }),
    });

    // Then elle lit l'incubateur entier, et un incubateur vide reste une réponse
    await expect(fetchIncubatorMembers("ademe")).resolves.toEqual({ items: [], erreurs: [] });

    // Given un total qui change entre deux pages
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection(tous.slice(0, 100), { total: 150 }),
      [`${ADRESSE}${MEMBRES}${page(100)}`]: collection(tous.slice(100, 149), {
        total: 149,
        offset: 100,
      }),
    });
    await expect(fetchIncubatorMembers("ademe")).rejects.toThrow(/150 puis 149/u);

    // Given une source qui ignore le décalage et rend la première page une seconde fois
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection(tous.slice(0, 100), { total: 150 }),
      [`${ADRESSE}${MEMBRES}${page(100)}`]: collection(tous.slice(0, 100), { total: 150 }),
    });
    await expect(fetchIncubatorMembers("ademe")).rejects.toThrow(/décalage 0 au lieu de 100/u);

    // Given un ordre qui change entre deux pages, la seconde rendant une personne déjà lue
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection(tous.slice(0, 100), { total: 150 }),
      [`${ADRESSE}${MEMBRES}${page(100)}`]: collection([...tous.slice(101), tous[0]], {
        total: 150,
        offset: 100,
      }),
    });

    // Then la lecture échoue, la personne sautée passant sinon pour partie
    await expect(fetchIncubatorMembers("ademe")).rejects.toThrow(/uuid-0 rendu deux fois/u);

    // Given une seconde page vide alors que le total en annonce cinquante de plus
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: collection(tous.slice(0, 100), { total: 150 }),
      [`${ADRESSE}${MEMBRES}${page(100)}`]: collection([], { total: 150, offset: 100 }),
    });
    await expect(fetchIncubatorMembers("ademe")).rejects.toThrow(/page vide/u);

    // Given une réponse encore à l'ancienne forme, une liste nue sans enveloppe
    transport({ [`${ADRESSE}${MEMBRES}${page(0)}`]: () => Response.json(tous) });
    await expect(fetchIncubatorMembers("ademe")).rejects.toThrow(/enveloppe/u);

    // Given une clé refusée, avec le détail que donne la RFC 9457
    transport({
      [`${ADRESSE}${MEMBRES}${page(0)}`]: () =>
        Response.json(
          { type: "about:blank", title: "Unauthorized", status: 401, detail: "clef révoquée" },
          { status: 401, statusText: "Unauthorized" },
        ),
    });

    // Then le refus porte ce détail, qui est ce que lira l'opérateur dans le compte rendu
    await expect(fetchIncubatorMembers("ademe")).rejects.toMatchObject({
      status: 401,
      message: "401 Unauthorized (clef révoquée)",
    });
  });
});

describe("la fiche complète d'une personne", () => {
  it("distingue une fiche absente d'une fiche hors du périmètre de la clé", async () => {
    const chemin = "/api/v1/members/personne-1.exemple";

    // Given une fiche rendue dans son enveloppe
    transport({ [`${ADRESSE}${chemin}`]: () => Response.json({ data: membre(1) }) });

    // Then elle se lit
    await expect(fetchMemberDetail("personne-1.exemple")).resolves.toMatchObject({
      username: "personne-1.exemple",
      primary_email: "personne-1@exemple.invalid",
    });

    // Given une fiche qui n'existe pas
    transport({});

    // Then elle est absente, et seulement absente
    await expect(fetchMemberDetail("personne-1.exemple")).resolves.toBeNull();

    // Given une fiche hors du périmètre de la clé, que l'API refuse en 403
    transport({
      [`${ADRESSE}${chemin}`]: () => new Response(null, { status: 403, statusText: "Forbidden" }),
    });

    // Then la lecture échoue, et la personne ne passe pas pour introuvable
    await expect(fetchMemberDetail("personne-1.exemple")).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/hors du périmètre de la clé/u),
    });

    // Given une fiche rendue nue, sans son enveloppe
    transport({ [`${ADRESSE}${chemin}`]: () => Response.json(membre(1)) });

    // Then elle est illisible plutôt que lue de travers
    await expect(fetchMemberDetail("personne-1.exemple")).rejects.toThrow(/fiche illisible/u);
  });
});
