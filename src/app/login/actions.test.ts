import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAction } from "./actions";

interface Appel {
  provider: string;
  options: Record<string, unknown>;
}

const base = vi.hoisted(() => ({
  appels: [] as Appel[],
  refuse: false,
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/auth", () => ({
  signIn: (provider: string, options: Record<string, unknown>) => {
    base.appels.push({ provider, options });
    if (base.refuse) {
      const erreur = new Error("AccessDenied");
      erreur.name = "AccessDenied";
      throw erreur;
    }
    return Promise.resolve("/api/auth/verify-request?provider=nodemailer&type=email");
  },
}));

const MESSAGE =
  "Si cette saisie ouvre un accès, un lien de connexion vient de partir. Vérifiez votre boîte : il est valable peu de temps.";

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

/** Le plancher de temporisation vaut mille cinq cents millisecondes ; on le franchit. */
async function soumettre(valeurs: Record<string, string>): Promise<string | null> {
  const promesse = loginAction(null, champs(valeurs));
  await vi.advanceTimersByTimeAsync(3000);
  return promesse;
}

beforeEach(() => {
  base.appels = [];
  base.refuse = false;
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("l'écran de connexion, qui route sur l'arobase et ne dit jamais rien d'autre", () => {
  it("envoie la saisie à la bonne porte sans jamais quitter cet écran", async () => {
    // Given un identifiant sans arobase.
    // When il est soumis.
    await expect(
      soumettre({ username: "  Camille.Exemple  ", suite: "/dossiers/dos_1" }),
    ).resolves.toBe(MESSAGE);

    // Then il part vers l'espace-membre, la destination demandée voyage avec le lien, et
    // `redirect: false` garde la réponse sur cet écran : tant que l'acceptation part sur
    // la page de confirmation d'envoi et que le refus reste ici, la barre d'adresse dit
    // ce que la phrase unique refuse de dire.
    expect(base.appels).toEqual([
      {
        provider: ESPACE_MEMBRE_PROVIDER_ID,
        options: {
          email: "Camille.Exemple",
          redirectTo: "/dossiers/dos_1",
          redirect: false,
        },
      },
    ]);

    // When la saisie porte une arobase.
    base.appels = [];
    await expect(soumettre({ username: "camille@exemple.org" })).resolves.toBe(MESSAGE);

    // Then elle part vers le second fournisseur, et la destination retombe sur l'accueil.
    expect(base.appels).toEqual([
      {
        provider: "nodemailer",
        options: { email: "camille@exemple.org", redirectTo: "/", redirect: false },
      },
    ]);

    // Then une destination qui n'est pas un chemin de cette application est écartée :
    // `//ailleurs` est une adresse absolue déguisée.
    base.appels = [];
    await soumettre({ username: "camille.exemple", suite: "//ailleurs.example/piege" });
    expect(base.appels[0]?.options["redirectTo"]).toBe("/");
  });

  it("rend la même phrase à l'accueilli, à l'éconduit et au maladroit, et prend le même temps", async () => {
    // Given une saisie que le contrôle de connexion refuse.
    base.refuse = true;

    // Then le refus rend exactement la phrase de l'envoi, et ne remonte aucune erreur :
    // distinguer les deux ferait de cet outil un oracle d'appartenance à l'annuaire
    // beta.gouv entier, interrogeable sans être connecté.
    await expect(soumettre({ username: "passante.exemple" })).resolves.toBe(MESSAGE);

    // Given les saisies que le normalisateur du paquet refuse en levant, et la saisie
    // vide. Then aucune ne sort du processus, et toutes rendent la même phrase : une
    // exception remontée du paquet vaudrait un message distinct.
    base.refuse = false;
    for (const saisie of ["", "   ", 'ca"mille@exemple.org', "a@b@exemple.org", "camille@,org"]) {
      base.appels = [];
      await expect(soumettre({ username: saisie })).resolves.toBe(MESSAGE);
      expect(base.appels).toEqual([]);
    }

    // Given la branche refusée, qui ne fait aucune poignée de main avec le serveur de
    // courrier là où la branche acceptée en fait une complète.
    base.refuse = true;
    let rendu = false;
    const promesse = loginAction(null, champs({ username: "passante.exemple" })).then((valeur) => {
      rendu = true;
      return valeur;
    });

    // Then elle attend elle aussi le plancher : sans lui, le temps de réponse dirait ce
    // que le message tait, et le retirer rouvre le canal sans changer une ligne de texte.
    await vi.advanceTimersByTimeAsync(1000);
    expect(rendu).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rendu).toBe(true);
    await expect(promesse).resolves.toBe(MESSAGE);
  });
});
