import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

/**
 * Deux étages, et la frontière est ce qui compte.
 *
 * L'unitaire ne touche rien : ni base, ni réseau, ni navigateur. Son environnement ne
 * mène nulle part, le port 1 n'écoutant jamais, si bien qu'un double oublié échoue tout
 * de suite au lieu d'atteindre pour de vrai ce qu'il croyait doubler. Le cas qui le
 * justifie à lui seul est `ESPACE_MEMBRE_URL`, dont le schéma pose par défaut l'adresse
 * de production : un test qui oublie de piéger `fetch` interroge le vrai référentiel des
 * personnes, et l'appel réussit. C'est `pnpm test` qui le joue, et il doit rester une
 * commande qui tourne sans rien démarrer.
 *
 * L'intégration écrit dans une vraie base, et seulement dans une base dédiée dont le nom
 * le dit. Elle existe pour ce que l'unitaire ne peut pas tenir : une requête qu'un
 * double ne peut honorer sans réécrire un moteur, à commencer par un compte à travers
 * une relation. Une vraie base ne donne pas droit au reste, et les adresses mortes
 * valent pour elle aussi.
 *
 * Le bout en bout ne vit pas ici, il a son propre lanceur : un navigateur n'est pas un
 * environnement de Vitest, et le mélanger ferait payer son démarrage à chaque
 * `pnpm test`.
 */

const MORT = "127.0.0.1:1";

/** Ce qu'aucun étage n'a le droit d'atteindre. Posé avant les fichiers de mise en place. */
const ADRESSES_MORTES = {
  ESPACE_MEMBRE_URL: `http://${MORT}`,
  ESPACE_MEMBRE_API_KEY: "aucune-cle-en-test",
  AUTH_SECRET: "aucun-secret-en-test",
  // Vidé plutôt qu'absent : un jeton hérité du shell ferait sortir un appel réel.
  NOTION_SCIM_TOKEN: "",
  // Redit ici bien qu'il vaille faux par défaut : l'invariant du produit est qu'aucune
  // exécution n'écrit sans autorisation explicite, et un poste qui l'autorise ne doit
  // pas le transmettre à une suite de tests.
  ACTIONS_ENABLED: "false",
  SMTP_URL: `smtp://${MORT}`,
  SMTP_EMAIL_FROM: "personne@exemple.invalid",
};

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // `jsx: "preserve"` dans le tsconfig laisse esbuild retomber sur `React.createElement`,
  // un identifiant libre que rien n'importe ici : un composant serveur joué comme une
  // fonction lève alors sur `React is not defined`. Next compile en runtime automatique,
  // et c'est ce que ce réglage rétablit pour les tests.
  esbuild: { jsx: "automatic" },
  test: {
    // Les deux étages portent des scénarios, donc n'en trouver aucun est un défaut et
    // non un cas de figure. Sans ce refus, un motif d'inclusion cassé rendrait la
    // vérification verte en ne jouant rien, ce qui est le seul échec qu'une suite de
    // tests ne sait pas signaler d'elle-même.
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unite",
          environment: "node",
          // `.tsx` entre ici pour une seule raison : monter les composants clients, que
          // rien ne voyait. Le rendu se demande fichier par fichier, par la directive
          // `@vitest-environment jsdom` en tête, et jamais globalement : un DOM posé
          // partout ferait payer son coût aux quatre cent quatre-vingts tests qui n'en
          // ont pas besoin, et masquerait le jour où un test serveur en dépendrait.
          include: ["src/**/*.test.{ts,tsx}"],
          // Sans cette exclusion, l'étage qui exige une base serait joué par celui qui
          // s'interdit d'en avoir une : les deux suffixes finissent par `.test.ts`.
          exclude: [
            ...defaultExclude,
            "src/**/*.integration.test.{ts,tsx}",
            "src/**/*.contrat.test.{ts,tsx}",
          ],
          env: {
            ...ADRESSES_MORTES,
            DATABASE_URL: `postgresql://interdit:interdit@${MORT}/aucune-base-en-unitaire`,
          },
          setupFiles: ["./vitest.setup.unite.ts"],
        },
      },
      {
        extends: true,
        test: {
          // Les tests de contrat interrogent une vraie API distante, par conception :
          // ils existent pour voir une réponse changer de forme sans annonce, ce qu'un
          // enregistrement figé ne montrerait jamais. Ils ne sont donc pas unitaires,
          // et leur laisser une adresse morte les viderait de leur sens. Hors de
          // `pnpm test` : ils dépendent d'un jeton et du réseau.
          name: "contrat",
          environment: "node",
          include: ["src/**/*.contrat.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.{ts,tsx}"],
          // La base, elle, vient de l'appelant : la poser ici la rendrait implicite, et
          // le refus du nom non dédié perdrait son sens.
          env: ADRESSES_MORTES,
          setupFiles: ["./vitest.setup.integration.ts"],
          // Un scénario qui sème puis efface ne supporte pas d'en croiser un autre sur
          // la même base : l'isolation vient de la remise à zéro, donc de l'ordre.
          fileParallelism: false,
        },
      },
    ],
  },
});
