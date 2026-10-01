import { beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";

import { type Lecture, lireChaque } from "@/core/lecture";
import { jourParis } from "@/core/membre";
import { membreIncubateurSchema, membreSchema, startupSchema } from "@/lib/espace-membre";

/**
 * Ce que ce test surveille, et ce qu'il ne surveille pas.
 *
 * Il éprouve chaque réponse avec les schémas mêmes que lit la collecte, si bien qu'une
 * route disparue ou un champ requis renommé se voit ici avant la nuit. La collecte l'aurait
 * vu seule : l'élément illisible est écarté, le run ne se dit pas complet, et personne
 * n'est daté comme parti.
 *
 * Ce qu'elle ne voit pas est une valeur facultative qui cesse de remonter partout à la
 * fois, et une date qui change de format, que `jourParis` lit comme une absence ou comme
 * une autre date. Tout le monde deviendrait sans échéance, ou en porterait une fausse, sur
 * un run vert.
 *
 * Il refuse de suivre une redirection : la clé part dans un en-tête que fetch recopie, et
 * une adresse qui redirige se corrige dans la configuration plutôt qu'elle ne se suit.
 *
 * Il lit `process.env` et jamais `env` : passer par le schéma exigerait une base de
 * données pour vérifier la forme d'une réponse distante.
 */
const CLE = process.env["ESPACE_MEMBRE_API_KEY"];

const ADRESSE = process.env["ESPACE_MEMBRE_URL"] || "https://espace-membre.beta.gouv.fr";

/**
 * Le défaut de `scope.incubator` dans `src/core/policy.ts`. La politique réelle vit hors
 * de ce dépôt, et ce test ne la lit pas.
 */
const INCUBATEUR = "ademe";

const INCONNU = "aucune-fiche.test-de-contrat";

async function lire(chemin: string, cle = CLE ?? ""): Promise<Response> {
  return fetch(`${ADRESSE}${chemin}`, {
    headers: { "X-Api-Key": cle, accept: "application/json" },
    redirect: "error",
  });
}

async function lireJson(chemin: string): Promise<unknown> {
  const reponse = await lire(chemin);

  // Nomme la cause : sans elle, une route disparue ferait tomber les assertions suivantes
  // sur une liste vide sans dire pourquoi.
  expect(reponse.ok, `${chemin} a répondu ${reponse.status}`).toBe(true);
  return reponse.json();
}

/** Au format ISO, parce qu'un jour et un mois inversés se lisent encore comme une date. */
function expectDateLisible(valeur: string | null | undefined, ou: string): void {
  if (valeur) {
    expect(valeur, ou).toMatch(/^\d{4}-\d{2}-\d{2}/u);
    expect(jourParis(valeur), `${ou} : ${valeur}`).not.toBeNull();
  }
}

// S'ignore proprement sans clé, de sorte que `pnpm test:contrat` reste exécutable sans
// secret, en local comme sur une contribution externe.
describe.skipIf(!CLE)("la forme de ce que rend l'espace-membre n'a pas changé", () => {
  let startups: Lecture<z.infer<typeof startupSchema>> = { items: [], erreurs: [] };
  let membres: Lecture<z.infer<typeof membreIncubateurSchema>> = { items: [], erreurs: [] };

  // Le périmètre arrive en un seul appel qui ramène tout, d'où une borne plus large que
  // celle d'un crochet ordinaire.
  beforeAll(async () => {
    startups = lireChaque(
      await lireJson(`/api/protected/incubators/${INCUBATEUR}/startups`),
      startupSchema,
      "startups de l'incubateur",
    );
    membres = lireChaque(
      await lireJson(`/api/protected/incubators/${INCUBATEUR}/members`),
      membreIncubateurSchema,
      "membres de l'incubateur",
    );
  }, 60_000);

  it("rend les startups de l'incubateur, avec des phases qui se lisent", () => {
    expect(startups.erreurs).toEqual([]);
    expect(startups.items.length).toBeGreaterThan(0);

    for (const startup of startups.items) {
      for (const phase of startup.phases ?? []) {
        expectDateLisible(phase.start, startup.ghid);
      }
    }

    // Une phase courante renommée ferait passer chaque startup pour une startup sans phase
    // connue, et plus aucune n'entrerait en phase terminale.
    expect(startups.items.some((startup) => startup.current_phase)).toBe(true);
    expect(
      startups.items.some((startup) => (startup.phases ?? []).some((phase) => phase.start)),
    ).toBe(true);
  });

  it("rend le périmètre avec ses échéances, partants compris", () => {
    expect(membres.erreurs).toEqual([]);
    expect(membres.items.length).toBeGreaterThan(0);

    // Une seule fin illisible efface l'échéance de toute la personne, et non celle de la
    // seule mission.
    for (const membre of membres.items) {
      for (const mission of membre.missions) {
        expectDateLisible(mission.end, membre.username);
      }
    }

    // Une fin manque légitimement à une mission en cours. Qu'elle manque à toutes ne se
    // verrait nulle part ailleurs.
    const fins = membres.items
      .flatMap((membre) => membre.missions.map((mission) => jourParis(mission.end)))
      .filter((jour): jour is string => jour !== null);
    expect(fins.length).toBeGreaterThan(0);

    // Le défaut de la route rend aussi les missions terminées, et la collecte ne demande
    // pas `status=active`. Un défaut qui masquerait les partants reviendrait à ne jamais
    // leur couper leurs accès.
    const aujourdHui = jourParis(new Date().toISOString()) ?? "";
    const partis = membres.items.filter(
      (membre) =>
        membre.missions.length > 0 &&
        membre.missions.every((mission) => {
          const fin = jourParis(mission.end);
          return fin !== null && fin < aujourdHui;
        }),
    );
    expect(partis.length).toBeGreaterThan(0);

    // Une mission peut porter des produits d'un autre incubateur, et la collecte ne retient
    // que ceux du périmètre. Un `ghid` renommé sous `startups` viderait ce rattachement
    // pour tout le monde.
    const duPerimetre = new Set(startups.items.map((startup) => startup.ghid));
    expect(
      membres.items.some((membre) =>
        membre.missions.some((mission) =>
          (mission.startups ?? []).some(
            (startup) => typeof startup.ghid === "string" && duPerimetre.has(startup.ghid),
          ),
        ),
      ),
    ).toBe(true);

    // Pour une personne collectée, le login GitHub ne vient que de ce champ facultatif.
    // Renommé, plus aucun compte GitHub ne se rattacherait par son login.
    expect(membres.items.some((membre) => membre.github)).toBe(true);

    // L'adresse principale est ce qui rattache un compte par son adresse exacte. Renommée,
    // tous les comptes Notion partiraient dans la file des isolés.
    expect(membres.items.some((membre) => membre.primary_email)).toBe(true);
  });

  it("rend la fiche complète d'une personne du périmètre, et un 404 pour une inconnue", async () => {
    // La collecte ne demande que la fiche de qui relève de l'incubateur par une équipe, la
    // liste scopée ne lui associant aucune mission. À défaut d'une telle personne, la forme
    // de la fiche se vérifie sur la première venue.
    const cible =
      membres.items.find((membre) => membre.attachment !== "startups") ?? membres.items[0];
    if (cible === undefined) {
      throw new Error("Le périmètre est vide, aucune fiche à demander.");
    }

    const fiche = membreSchema.safeParse(
      await lireJson(`/api/protected/members/${encodeURIComponent(cible.username)}`),
    );
    expect(fiche.error?.issues ?? []).toEqual([]);
    for (const mission of fiche.data?.missions ?? []) {
      expectDateLisible(mission.end, cible.username);
    }

    // Un 404 range la personne parmi les introuvables, toute autre réponse parmi les
    // lectures manquées, et les deux n'ont pas la même borne.
    const inconnue = await lire(`/api/protected/members/${INCONNU}`);
    expect(inconnue.status).toBe(404);
  });

  it("refuse une clé qui n'est pas la bonne", async () => {
    // Une redirection vers une page de connexion lève, ce que la collecte lit aussi comme
    // une panne de la source.
    const reponse = await lire(
      `/api/protected/incubators/${INCUBATEUR}/members`,
      "cle-volontairement-fausse",
    ).catch(() => null);

    // Ce qui compte est qu'une clé morte ne rende jamais un périmètre vide sous un succès.
    expect(reponse?.ok ?? false).toBe(false);
  });
});
