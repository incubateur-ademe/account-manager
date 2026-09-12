import { defineConfig, devices } from "@playwright/test";

/**
 * L'étage du bout en bout, et il ne tourne pas dans la vérification continue.
 *
 * C'est une décision et non un oubli. Trois choses seulement ne se tiennent à aucun
 * autre étage : qu'un cookie franchisse la barrière de `src/proxy.ts`, que la garde de
 * session distingue vraiment un opérateur d'un participant, et qu'un écran lourd ne
 * meure pas à l'hydratation. Tout le reste se tient plus bas, pour mille fois moins
 * cher. Le faire tourner sur chaque proposition coûterait deux à quatre minutes à
 * chacune pour une poignée de scénarios, et une suite qu'on répare chaque semaine
 * cesse d'être crue en trois mois.
 *
 * Il se lance donc à la main, avant une livraison : `pnpm test:e2e`.
 *
 * Un scénario instable se supprime, il ne se rejoue pas. D'où `retries: 0` et un seul
 * worker : un `retry` transforme un défaut intermittent en bruit vert, ce qui est la
 * façon la plus sûre de perdre confiance dans une suite sans s'en apercevoir.
 */

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;

/**
 * La base de test, celle-là même que l'étage d'intégration exige, et le serveur tourne
 * dessus : un scénario qui sème dans une base et interroge un serveur branché sur une
 * autre passerait son temps à ne rien trouver.
 */
export const BASE_DE_TEST =
  process.env["DATABASE_URL"] ??
  `postgresql://account_manager:account_manager@127.0.0.1:${process.env["POSTGRES_PORT"] ?? "5432"}/account_manager_test`;

/** Le même secret des deux côtés : le scénario forge le cookie que le serveur relira. */
export const SECRET = "un-secret-de-bout-en-bout-assez-long-pour-hkdf";

/** La seule personne que ce serveur tient pour opérateur. Tout autre nom ne l'est pas. */
export const OPERATRICE = "operatrice.exemple";

const ENVIRONNEMENT = {
  DATABASE_URL: BASE_DE_TEST,
  AUTH_SECRET: SECRET,
  AUTH_URL: BASE,
  AUTH_TRUST_HOST: "true",
  OPERATORS: OPERATRICE,
  BREAK_GLASS_USERNAMES: "",
  // Rien ne doit sortir de la machine, pas même par accident : le référentiel des
  // personnes et le relais d'envoi pointent sur un port qui n'écoute jamais.
  ESPACE_MEMBRE_URL: "http://127.0.0.1:1",
  ESPACE_MEMBRE_API_KEY: "aucune-cle-en-bout-en-bout",
  SMTP_URL: "smtp://127.0.0.1:1",
  SMTP_EMAIL_FROM: "personne@exemple.invalid",
  // Le défaut du dépôt, redit ici parce qu'aucun scénario ne doit pouvoir écrire sur
  // un système tiers, même si l'environnement du poste l'autorise.
  ACTIONS_ENABLED: "false",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    // Le serveur de développement compile à la demande : la première page d'un
    // scénario paie la compilation de tout ce qu'elle importe.
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `${BASE}/healthz`,
    env: ENVIRONNEMENT,
    // Jamais réutilisé : un serveur déjà debout tourne sur une autre base et avec une
    // autre allowlist, et le scénario le découvrirait par des échecs incompréhensibles.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
