import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
