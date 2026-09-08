import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireOperateur, requireUtilisateur, utilisateurCourant } from "./session";

interface SessionDeTest {
  user: {
    id?: string;
    username?: string;
    email?: string | null;
    name?: string | null;
    personId?: string | null;
    voie?: "ESPACE_MEMBRE" | "ADRESSE";
  };
}

const base = vi.hoisted(() => ({
  operateurs: [] as string[],
  breakGlass: [] as string[],
  session: null as unknown,
}));

vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(base.session) }));

vi.mock("@/lib/env", () => ({
  webEnv: {
    get OPERATORS() {
      return base.operateurs;
    },
    get BREAK_GLASS_USERNAMES() {
      return base.breakGlass;
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (chemin: string) => {
    const digest = `NEXT_REDIRECT;replace;${chemin};307;`;
    const erreur = new Error(digest);
    Object.assign(erreur, { digest });
    throw erreur;
  },
}));

function connecte(user: SessionDeTest["user"]): void {
  base.session = { user };
}

beforeEach(() => {
  base.operateurs = [];
  base.breakGlass = [];
  base.session = null;
});

describe("la session, et ce que la porte d'entrée décide encore une fois entrée", () => {
  it("ne calcule la qualité d'opérateur que sur un identifiant venu de la voie espace-membre", async () => {
    // Given une opératrice nommée dans l'environnement.
    base.operateurs = ["operatrice.exemple"];

    // When sa session vient de la voie espace-membre.
    connecte({ id: "u1", username: "operatrice.exemple", voie: "ESPACE_MEMBRE" });

    // Then elle est opératrice, elle ne désigne aucune fiche, et l'allowlist est relue à
    // ce passage-ci et pas tenue pour acquise depuis sa connexion.
    await expect(utilisateurCourant()).resolves.toEqual({
      username: "operatrice.exemple",
      email: null,
      nom: null,
      personId: null,
      voie: "ESPACE_MEMBRE",
      operateur: true,
    });
    base.operateurs = [];
    await expect(utilisateurCourant()).resolves.toMatchObject({ operateur: false });

    // When une session porte exactement le même nom, mais vient de la voie par adresse :
    // c'est l'état qu'un renommage de fiche rendait atteignable, et rien ne compare un
    // identifiant fabriqué à l'allowlist au moment où on le renomme.
    base.operateurs = ["operatrice.exemple"];
    connecte({
      id: "u2",
      username: "operatrice.exemple",
      personId: "per_0000000000000000000000",
      voie: "ADRESSE",
    });

    // Then elle n'est pas opératrice, et le nom n'y change rien : la porte en décide.
    await expect(utilisateurCourant()).resolves.toEqual({
      username: "operatrice.exemple",
      email: null,
      nom: null,
      personId: "per_0000000000000000000000",
      voie: "ADRESSE",
      operateur: false,
    });

    // Then un jeton qui ne dit pas par quelle porte il est entré ne vaut pas session. Il
    // ne peut venir que d'avant la seconde porte, et lui supposer la première serait
    // juste aujourd'hui : c'est une reconnexion contre une supposition qui se périme.
    connecte({ id: "u3", username: "operatrice.exemple" });
    await expect(utilisateurCourant()).resolves.toBeNull();
  });

  it("sépare les deux refus de la garde d'opérateur, et laisse passer toute session à l'autre", async () => {
    // Given personne devant l'écran.
    base.operateurs = ["operatrice.exemple"];
    base.session = null;

    // Then les deux gardes renvoient vers l'écran de connexion : il n'y a pas d'identité.
    await expect(requireOperateur()).rejects.toThrow("NEXT_REDIRECT;replace;/login");
    await expect(requireUtilisateur()).rejects.toThrow("NEXT_REDIRECT;replace;/login");

    // When une session valide se présente, mais hors de l'équipe transverse.
    connecte({
      id: "u1",
      username: "camille.exemple",
      personId: "per_0000000000000000000000",
      voie: "ADRESSE",
    });

    // Then l'écran d'opérateur la renvoie chez elle et non vers la connexion : la
    // renvoyer là lui affirmerait à tort que sa connexion a échoué.
    await expect(requireOperateur()).rejects.toThrow("NEXT_REDIRECT;replace;/moi");

    // Then la garde qui ne demande qu'une identité la laisse passer, et lui rend la fiche
    // qui portera ses droits.
    await expect(requireUtilisateur()).resolves.toMatchObject({
      username: "camille.exemple",
      personId: "per_0000000000000000000000",
      operateur: false,
    });

    // When l'opératrice revient.
    connecte({ id: "u2", username: "operatrice.exemple", voie: "ESPACE_MEMBRE" });

    // Then rien n'a bougé pour elle, ni la garde ni ce qu'elle en rend.
    await expect(requireOperateur()).resolves.toMatchObject({
      username: "operatrice.exemple",
      operateur: true,
    });
  });
});
