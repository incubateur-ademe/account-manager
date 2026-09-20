import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { parse, stringify } from "yaml";

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
 * Le referentiel des personnes, joue en local par `e2e/faux-espace-membre.ts`.
 *
 * C'est le seul systeme amont que ce depot sait pointer ailleurs sans changer une ligne de
 * production, `ESPACE_MEMBRE_URL` etant deja une variable du schema. Il existe pour qu'une
 * collecte se deroule vraiment pendant un scenario, la boucle locale restant la seule
 * chose qu'un scenario ait le droit d'atteindre.
 */
const PORT_REFERENTIEL = 3211;
const REFERENTIEL = `http://127.0.0.1:${PORT_REFERENTIEL}`;

/**
 * Une politique jetable, reduite a ce qu'une collecte exige.
 *
 * `policy()` lit `POLICY_DIR`, qui vaut `config` par defaut, ou seul l'exemple est commite.
 * Sans politique, `executerSync` sort en echec avant d'avoir appele quoi que ce soit, et un
 * scenario constaterait une collecte qui echoue sans savoir pourquoi.
 *
 * L'exemple prive de ses profils, et pas l'exemple entier. Le catalogue de profils remplit
 * la modale d'ouverture d'une arrivee, que `modales-au-dela-de-60-mots-par-champ` compte
 * alors comme de la redaction longue. Ce plafond mesure du texte d'ecran et n'a aucun moyen
 * de distinguer une aide bavarde d'une liste venue d'un fichier. Le poser ici ferait rougir
 * le releve sur une donnee de test. Ce que le releve gagnerait a voir un catalogue reel est
 * une autre question, et elle demande d'abord que la mesure sache les separer.
 */
function politiqueJetable(): string {
  const dossier = mkdtempSync(join(tmpdir(), "politique-de-bout-en-bout-"));
  const lue = parse(readFileSync(resolve(process.cwd(), "config/config.exemple.yaml"), "utf8")) as
    | Record<string, unknown>
    | undefined;
  const { profiles, ...garde } = lue ?? {};
  void profiles;
  writeFileSync(join(dossier, "config.yaml"), stringify(garde), "utf8");
  return dossier;
}

/**
 * La base de test, celle-là même que l'étage d'intégration exige, et le serveur tourne
 * dessus : un scénario qui sème dans une base et interroge un serveur branché sur une
 * autre passerait son temps à ne rien trouver.
 */
function baseDediee(): string {
  const url =
    process.env["DATABASE_URL"] ??
    `postgresql://account_manager:account_manager@127.0.0.1:${process.env["POSTGRES_PORT"] ?? "5432"}/account_manager_test`;

  // Ici et pas dans un scénario : ce fichier décide de la base sur laquelle le serveur
  // démarre. Posé plus loin, le refus laisserait un Next tourner sur la base de
  // développement de qui lance, avec un secret connu et une allowlist forgée, et sa
  // portée dépendrait de ce que chaque scénario futur pense à appeler.
  const nom = new URL(url).pathname.replace(/^\//, "");
  if (!nom.endsWith("_test")) {
    throw new Error(
      `Refus de démarrer les scénarios de bout en bout sur la base « ${nom} » : ils l'effacent, et seule une base dont le nom finit par « _test » peut l'accepter.`,
    );
  }

  return url;
}

export const BASE_DE_TEST = baseDediee();

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
  // Rien ne doit sortir de la machine, pas même par accident. Le relais d'envoi pointe
  // sur un port qui n'écoute jamais, et le référentiel des personnes sur le double local,
  // qui est la seule adresse joignable de tout cet environnement.
  ESPACE_MEMBRE_URL: REFERENTIEL,
  ESPACE_MEMBRE_API_KEY: "aucune-cle-en-bout-en-bout",
  POLICY_DIR: politiqueJetable(),
  SMTP_URL: "smtp://127.0.0.1:1",
  SMTP_EMAIL_FROM: "personne@exemple.invalid",
  // Le défaut du dépôt, redit ici parce qu'aucun scénario ne doit pouvoir écrire sur
  // un système tiers, même si l'environnement du poste l'autorise.
  ACTIONS_ENABLED: "false",
  /*
   * Vidés plutôt qu'absents, et c'est ce qui rend ces scénarios reproductibles d'un poste
   * à l'autre. Playwright construit l'environnement du serveur en posant `process.env`
   * sous ce bloc, si bien qu'un jeton exporté dans le shell de qui lance arrive jusqu'à
   * lui. Trois écrans sondent leur système au rendu (`src/app/systemes/page.tsx`,
   * `systemes/[cle]/page.tsx`, `dossiers/[id]/page.tsx`) : avec un jeton, ils
   * interrogent le vrai système et ne montrent pas la même chose que sur un poste qui
   * n'en a pas. `ACTIONS_ENABLED` ne les couvre pas, une sonde étant une lecture.
   * `vitest.config.ts` ferme déjà la même porte pour les mêmes raisons.
   */
  GITHUB_TOKEN: "",
  GITHUB_ADMIN_TOKEN: "",
  NOTION_SCIM_TOKEN: "",
  SCALINGO_API_TOKEN: "",
  FGP_URL: "",
};

export default defineConfig({
  testDir: "./e2e",
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
  webServer: [
    {
      command: "node --import tsx e2e/faux-espace-membre.ts",
      url: `${REFERENTIEL}/healthz`,
      env: { PORT_FAUX_ESPACE_MEMBRE: String(PORT_REFERENTIEL) },
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
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
  ],
});
