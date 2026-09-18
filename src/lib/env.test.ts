import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Ce que le schéma refuse de l'environnement, et pourquoi c'est lui qui le refuse.
 *
 * L'invariant du dépôt est que ce schéma fait foi : une prescription écrite dans la
 * documentation de déploiement n'est pas un garde-fou, et l'adresse du proxy se saisit à
 * la main dans un panneau.
 *
 * Le module est rechargé à chaque cas, la validation étant différée au premier accès puis
 * mise en cache : sans cela, le premier cas figerait la réponse de tous les suivants.
 */

/** Le minimum dont le schéma commun a besoin pour ne buter que sur ce qu'on lui oppose. */
const MINIMUM = {
  DATABASE_URL: "postgresql://interdit:interdit@127.0.0.1:1/aucune-base",
  ESPACE_MEMBRE_API_KEY: "aucune-cle-en-test",
};

async function lire(surcharge: Record<string, string>): Promise<() => string | undefined> {
  vi.resetModules();
  for (const [nom, valeur] of Object.entries({ ...MINIMUM, ...surcharge })) {
    vi.stubEnv(nom, valeur);
  }
  const { env } = await import("./env");
  return () => env.FGP_URL;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("l'adresse du proxy à jetons restreints, dans l'environnement", () => {
  it("n'est exigée en https qu'en production, et seulement quand elle est posée", async () => {
    // Given la production sans cette adresse : elle est facultative, son absence
    // dégradant l'émission en manuel sans empêcher le démarrage ni la collecte
    expect((await lire({ NODE_ENV: "production", FGP_URL: "" }))()).toBeUndefined();

    // Then en https, elle passe : c'est la forme que la documentation de déploiement
    // prescrit, et la seule qui protège le jeton de compte
    expect(
      (await lire({ NODE_ENV: "production", FGP_URL: "https://proxy.exemple.invalid" }))(),
    ).toBe("https://proxy.exemple.invalid");

    // Then en clair, le démarrage est refusé, et le message dit ce qui voyagerait :
    // l'émission poste le jeton de compte Scalingo, à portée compte entier, dans le
    // corps de la requête
    const enClair = await lire({ NODE_ENV: "production", FGP_URL: "http://proxy.exemple.invalid" });
    expect(enClair).toThrow("FGP_URL");
    expect(enClair).toThrow("https obligatoire en production");

    // Then hors production, l'adresse morte de l'étage d'intégration passe : la condition
    // ne concerne que la production, et une dérogation nommée pour la boucle locale ne
    // serait qu'une porte de plus à maintenir
    expect((await lire({ NODE_ENV: "test", FGP_URL: "http://127.0.0.1:1" }))()).toBe(
      "http://127.0.0.1:1",
    );

    // Then le refinement traverse l'extension vers le schéma de l'application web, qui
    // hérite du schéma commun : sans cela, la garde ne tiendrait que pour la collecte
    vi.resetModules();
    for (const [nom, valeur] of Object.entries({
      ...MINIMUM,
      NODE_ENV: "production",
      FGP_URL: "http://proxy.exemple.invalid",
      AUTH_SECRET: "aucun-secret-en-test",
      AUTH_URL: "https://exemple.invalid",
      SMTP_URL: "smtp://127.0.0.1:1",
      SMTP_EMAIL_FROM: "personne@exemple.invalid",
    })) {
      vi.stubEnv(nom, valeur);
    }
    const { webEnv } = await import("./env");
    expect(() => webEnv.FGP_URL).toThrow("https obligatoire en production");
  });
});
