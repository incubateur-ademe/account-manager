import { describe, expect, it } from "vitest";
import { z } from "zod";

import { resoudreConfigurations } from "./configuration-connecteur";
import type { ConnectorContract } from "./connector";

function contrat(key: string, configSchema?: z.ZodType): ConnectorContract {
  return {
    key,
    label: key,
    criticality: "low",
    runbook: "à la main",
    credentials: [],
    capabilities: {},
    scopeSchema: z.object({}),
    ...(configSchema ? { configSchema } : {}),
  };
}

const AVEC_DEFAUTS = contrat(
  "avec-defauts",
  z.strictObject({
    sources: z.array(z.string().min(1)).min(1, "au moins une source").default(["la-notre"]),
    actif: z.boolean().default(true),
  }),
);

const SANS_DEFAUT = contrat("sans-defaut", z.strictObject({ espace: z.string().min(1) }));

const SANS_SCHEMA = contrat("sans-schema");

describe("ce qu'un fichier de politique règle sur chaque connecteur", () => {
  it("rend les défauts quand rien n'est déclaré, et complète une entrée partielle", () => {
    const rien = resoudreConfigurations([AVEC_DEFAUTS, SANS_SCHEMA], {});

    expect(rien.erreurs).toEqual([]);
    expect(rien.valeurs.get("avec-defauts")).toEqual({ sources: ["la-notre"], actif: true });

    // Un connecteur sans schéma n'a pas de valeur : il n'a rien à recevoir, et lui en
    // fabriquer une laisserait croire qu'il se règle.
    expect(rien.valeurs.has("sans-schema")).toBe(false);

    const partielle = resoudreConfigurations([AVEC_DEFAUTS], {
      "avec-defauts": { sources: ["une", "deux"] },
    });

    expect(partielle.erreurs).toEqual([]);
    expect(partielle.valeurs.get("avec-defauts")).toEqual({
      sources: ["une", "deux"],
      actif: true,
    });

    // Un champ obligatoire sans défaut refuse de se taire : le connecteur a déclaré
    // qu'il ne sait pas travailler sans, et démarrer quand même reviendrait à le
    // faire tourner sur une valeur que personne n'a choisie.
    const manquante = resoudreConfigurations([SANS_DEFAUT], {});
    expect(manquante.erreurs).toHaveLength(1);
    expect(manquante.erreurs[0]).toContain("connectors.sans-defaut.espace");
  });

  it("refuse ce qui ne correspond à aucun connecteur, et ce qu'aucun connecteur n'attend", () => {
    const inconnue = resoudreConfigurations([AVEC_DEFAUTS, SANS_SCHEMA], {
      "un-connecteur-parti": { peu: "importe" },
    });

    expect(inconnue.erreurs).toHaveLength(1);
    expect(inconnue.erreurs[0]).toContain("connectors.un-connecteur-parti");
    expect(inconnue.erreurs[0]).toContain("avec-defauts");

    const inutile = resoudreConfigurations([AVEC_DEFAUTS, SANS_SCHEMA], {
      "sans-schema": { peu: "importe" },
    });

    expect(inutile.erreurs).toHaveLength(1);
    expect(inutile.erreurs[0]).toContain("ce connecteur ne se configure pas");

    // Le reste du fichier reste résolu : une faute quelque part ne doit pas priver
    // celui qui la corrige de voir ce que le reste vaut.
    expect(inutile.valeurs.get("avec-defauts")).toEqual({ sources: ["la-notre"], actif: true });
  });

  it("remonte toutes les fautes d'un même fichier en une passe", () => {
    const { erreurs, valeurs } = resoudreConfigurations([AVEC_DEFAUTS, SANS_DEFAUT, SANS_SCHEMA], {
      "avec-defauts": { sources: [], surnumeraire: true },
      "sans-defaut": { espace: "" },
      "sans-schema": {},
      "jamais-vu": {},
    });

    expect(erreurs).toHaveLength(5);
    expect(erreurs.join("\n")).toContain("connectors.avec-defauts.sources : au moins une source");
    expect(erreurs.join("\n")).toContain("connectors.avec-defauts : Unrecognized key");
    expect(erreurs.join("\n")).toContain("connectors.sans-defaut.espace");
    expect(erreurs.join("\n")).toContain("connectors.sans-schema");
    expect(erreurs.join("\n")).toContain("connectors.jamais-vu");

    // Un YAML se corrige en une passe, pas en cinq allers-retours dont chacun
    // révèle la faute suivante.
    expect(valeurs.size).toBe(0);

    // Chaque ligne s'indente comme celles de la politique et de l'environnement :
    // ces messages se lisent côte à côte dans le même journal.
    expect(erreurs.every((erreur) => erreur.startsWith("  "))).toBe(true);
  });
});
