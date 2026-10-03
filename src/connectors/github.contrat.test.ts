import { describe, expect, it } from "vitest";

/**
 * Le destin d'un dépôt se décide sur trois champs que la collecte ne vérifie pas : `archived`
 * sur le dépôt, `role_name` sur une équipe et sur un collaborateur, et `type` sur ce dernier.
 * Un champ disparu ne fait rien échouer, il fait proposer le transfert de chaque dépôt. Ce
 * test est le seul endroit où cela se verrait.
 *
 * Il lit `process.env` et jamais `env` : passer par le schéma exigerait une base de
 * données pour vérifier la forme d'une réponse distante.
 */
const JETON = process.env["GITHUB_TOKEN"];

const ORGANISATION = "incubateur-ademe";

async function lire(chemin: string): Promise<Record<string, unknown>[]> {
  const reponse = await fetch(`https://api.github.com${chemin}`, {
    headers: {
      authorization: `Bearer ${JETON}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });

  expect(reponse.ok, `${chemin} a répondu ${reponse.status}`).toBe(true);
  return (await reponse.json()) as Record<string, unknown>[];
}

// S'ignore proprement sans jeton, de sorte que `pnpm test` reste exécutable sans secret,
// en local comme sur une contribution externe.
describe.skipIf(!JETON)("la forme de ce que GitHub rend des dépôts n'a pas changé", () => {
  it("rend l'état d'archive d'un dépôt, et le rôle d'une équipe et d'un collaborateur direct", async () => {
    const depots = await lire(`/orgs/${ORGANISATION}/repos?per_page=5`);
    expect(depots.length).toBeGreaterThan(0);
    for (const depot of depots) {
      expect(typeof depot["id"]).toBe("number");
      expect(typeof depot["full_name"]).toBe("string");
      expect(typeof depot["html_url"]).toBe("string");
      expect(typeof depot["archived"]).toBe("boolean");
    }

    const [equipe] = await lire(`/orgs/${ORGANISATION}/teams?per_page=1`);
    const depotsDEquipe = await lire(`/orgs/${ORGANISATION}/teams/${equipe?.["slug"]}/repos`);
    for (const depot of depotsDEquipe) {
      expect(typeof depot["role_name"], String(depot["full_name"])).toBe("string");
    }

    const collaborateurs = (
      await Promise.all(
        depots.map((depot) =>
          lire(`/repos/${depot["full_name"]}/collaborators?affiliation=direct&per_page=5`),
        ),
      )
    ).flat();
    expect(collaborateurs.length).toBeGreaterThan(0);
    for (const collaborateur of collaborateurs) {
      expect(typeof collaborateur["id"]).toBe("number");
      expect(typeof collaborateur["login"]).toBe("string");
      expect(typeof collaborateur["type"]).toBe("string");
      expect(typeof collaborateur["role_name"]).toBe("string");
    }
  });
});
