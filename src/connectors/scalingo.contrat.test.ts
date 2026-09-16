import { beforeAll, describe, expect, it } from "vitest";

/**
 * Ce que ce test surveille, et ce qu'il ne surveille pas.
 *
 * Il ne vérifie aucun champ requis par un schéma du connecteur : leur disparition fait
 * écarter la fiche, donc rend le run non `ok`, donc n'efface personne. La collecte s'en
 * charge seule, et le redire ici reviendrait à éprouver Scalingo plutôt que notre
 * lecture.
 *
 * Il ne garde que ce qu'aucun autre étage ne peut attraper : un champ facultatif dont la
 * disparition dérive en silence, et une forme dont dépend une décision de conception. La
 * documentation de Scalingo s'étant déjà révélée fausse sur ce parc, ce qu'on croit
 * savoir de cette API vient d'ici, pas d'elle.
 *
 * Il lit `process.env` et jamais `env` : passer par le schéma exigerait une base de
 * données pour vérifier la forme d'une réponse distante.
 */
const JETON = process.env["SCALINGO_API_TOKEN"];

const AUTH = "https://auth.scalingo.com";

let porteur = "";

async function lire(url: string): Promise<Record<string, unknown>> {
  const reponse = await fetch(url, {
    headers: { authorization: `Bearer ${porteur}`, accept: "application/json" },
  });

  // Nomme la cause : sans elle, une route disparue ferait tomber les assertions suivantes
  // sur `undefined` sans dire pourquoi.
  expect(reponse.ok, `${url} a répondu ${reponse.status}`).toBe(true);
  return (await reponse.json()) as Record<string, unknown>;
}

async function regions(): Promise<{ name: string; api: string }[]> {
  return (await lire(`${AUTH}/v1/regions`))["regions"] as { name: string; api: string }[];
}

// S'ignore proprement sans jeton, de sorte que `pnpm test` reste exécutable sans secret,
// en local comme sur une contribution externe.
describe.skipIf(!JETON)("la forme de ce que rend l'API Scalingo n'a pas changé", () => {
  beforeAll(async () => {
    const reponse = await fetch(`${AUTH}/v1/tokens/exchange`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`:${JETON}`).toString("base64")}` },
    });

    expect(reponse.ok, `l'échange du jeton a répondu ${reponse.status}`).toBe(true);
    porteur = ((await reponse.json()) as { token: string }).token;
  });

  it("ne sert aucune région en clair", async () => {
    for (const region of await regions()) {
      // Le schéma du connecteur n'exige qu'une adresse, et `z.url()` accepte `http://` :
      // un hôte régional servi en clair passerait sans un mot, et le porteur partirait
      // en clair avec lui.
      expect(String(region.api), region.name).toMatch(/^https:\/\//);
    }
  });

  it("dit encore d'où sort une application, et qui la possède", async () => {
    // Toutes les régions et non la première : le connecteur les lit toutes, et une dérive
    // propre à l'une d'elles resterait invisible ici.
    for (const region of await regions()) {
      const corps = await lire(`${region.api}/v1/apps`);
      const applications = corps["apps"] as Record<string, unknown>[];

      // Aucune de ces routes ne pagine, et rien chez Scalingo ne l'écrit : le connecteur
      // lit donc ces listes d'un coup. Son propre garde-fou ne connaît que `next_page` ;
      // celui-ci voit n'importe quelle pagination sous `meta`, quel que soit son nom.
      expect(corps["meta"]).toBeUndefined();

      for (const application of applications) {
        // Le schéma n'exige qu'une chaîne non vide, jamais une adresse. Or elle part telle
        // quelle dans le rapprochement d'identité : un identifiant opaque à sa place
        // casserait le rattachement du propriétaire sur un run parfaitement vert.
        expect(String((application["owner"] as Record<string, unknown>)["email"])).toContain("@");

        // Le champ décide seul de l'appartenance au périmètre, et il est facultatif : sa
        // disparition ne casserait rien et ferait entrer tout le parc éphémère dans les
        // constats. C'est sa présence qu'on épingle, et non l'existence d'un environnement
        // de revue : ceux-ci se détruisent en deux jours, et l'exiger rendrait ce test
        // instable pour une raison qui n'a rien à voir avec une dérive d'API.
        expect(Object.hasOwn(application, "parent_app_name"), String(application["name"])).toBe(
          true,
        );
      }
    }
  });

  it("rend la même forme par application que dans la vue consolidée", async () => {
    for (const { api } of await regions()) {
      const applications = (await lire(`${api}/v1/apps`))["apps"] as { name: string }[];
      const uneApplication = applications.find((application) => application.name);

      // Les deux routes, parce que le relevé par application est le seul chemin complet et
      // que le recoupement suppose qu'elles partagent le même identifiant de collaboration.
      // Leurs formes peuvent diverger seules.
      for (const url of [
        `${api}/v1/apps/${uneApplication?.name}/collaborators`,
        `${api}/v1/collaborators`,
      ]) {
        const corps = await lire(url);
        expect(corps["meta"], url).toBeUndefined();

        for (const collaboration of corps["collaborators"] as Record<string, unknown>[]) {
          // Seul rattachement possible d'une invitation en attente, qui n'a ni compte ni
          // nom d'utilisateur exploitable. Le schéma n'exige qu'une chaîne non vide.
          expect(String(collaboration["email"]), url).toContain("@");

          // La clé d'identité en dépend : le connecteur prend le compte quand il existe et
          // la collaboration sinon. Un identifiant de compte apparu sur une invitation, ou
          // disparu d'un compte accepté, re-clérait les identités, ferait disparaître les
          // anciennes et apparaître les nouvelles sur un run vert, et rendrait illisible
          // toute tolérance posée dessus.
          if (collaboration["status"] === "pending") {
            expect(collaboration["user_id"] ?? null, url).toBeNull();
          } else {
            expect(typeof collaboration["user_id"], url).toBe("string");
          }
        }
      }
    }
  });
});
