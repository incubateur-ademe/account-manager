import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

/**
 * Deux étages, et la frontière est ce qui compte.
 *
 * L'unitaire ne touche rien : ni base, ni réseau, ni navigateur. Son passage de mise en
 * place pose des adresses mortes plutôt que de s'en remettre à la discipline de qui
 * écrit le test, si bien qu'un double oublié échoue tout de suite au lieu d'atteindre
 * pour de vrai ce qu'il croyait doubler. C'est lui que `pnpm test` joue, et il doit
 * rester une commande qui tourne sans rien démarrer : c'est ce qui décide s'il sera
 * joué souvent.
 *
 * L'intégration écrit dans une vraie base, et seulement dans une base dédiée dont le
 * nom le dit. Elle existe pour ce que l'unitaire ne peut pas tenir : les doubles de
 * base écrits à la main recodent la condition qu'ils reçoivent au lieu de l'honorer,
 * et un test qui vérifie un `where` contre un double vérifie surtout qu'on a écrit le
 * double comme on a écrit le code.
 *
 * Le bout en bout ne vit pas ici, il a son propre lanceur : un navigateur n'est pas un
 * environnement de Vitest, et le mélanger à ces deux étages ferait payer son démarrage
 * à chaque `pnpm test`.
 */
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
    // L'étage d'intégration n'a pas encore de scénario. Le déclarer vide plutôt que de
    // l'omettre pose la convention et le refus qui la garde, pour que le premier
    // scénario n'ait qu'à s'écrire.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unite",
          environment: "node",
          include: ["src/**/*.test.ts"],
          // Sans cette exclusion, l'étage qui exige une base serait joué par celui qui
          // s'interdit d'en avoir une : les deux suffixes finissent par `.test.ts`.
          exclude: [...defaultExclude, "src/**/*.integration.test.ts"],
          setupFiles: ["./vitest.setup.unite.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          setupFiles: ["./vitest.setup.integration.ts"],
          // Un scénario qui sème puis efface ne supporte pas d'en croiser un autre sur
          // la même base : l'isolation vient de la remise à zéro, donc de l'ordre.
          fileParallelism: false,
        },
      },
    ],
  },
});
