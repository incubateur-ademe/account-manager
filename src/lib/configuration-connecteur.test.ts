import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ConnectorContract } from "@/core/connector";

/**
 * Une politique jetable plutôt qu'une fixture versionnée : ce test a besoin d'un
 * fichier qui règle deux connecteurs à la fois, situation qu'aucun modèle du dépôt
 * ne décrit puisqu'un seul connecteur existe.
 *
 * `POLICY_DIR` se pose avant le premier appel et non avant l'import : le répertoire
 * est résolu à l'appel, pas dans une constante de module.
 */
const REPERTOIRE = mkdtempSync(join(tmpdir(), "politique-connecteurs-"));

copyFileSync(
  resolve(process.cwd(), "config/accounts.exemple.yaml"),
  join(REPERTOIRE, "accounts.yaml"),
);

writeFileSync(
  join(REPERTOIRE, "config.yaml"),
  [
    "version: 1",
    "",
    "connectors:",
    "  alpha:",
    "    sources:",
    "      - la-notre",
    "  beta:",
    "    espace: le-notre",
    "  delta:",
    "    espace: 0",
    "",
  ].join("\n"),
);

process.env["POLICY_DIR"] = REPERTOIRE;

const { configurationDe, verifierConfigurations } = await import("@/lib/configuration-connecteur");

function contrat(key: string, configSchema: z.ZodType): ConnectorContract {
  return {
    key,
    label: key,
    criticality: "low",
    runbook: "à la main",
    credentials: [],
    capabilities: {},
    scopeSchema: z.object({}),
    configSchema,
  };
}

const ALPHA = contrat(
  "alpha",
  z.strictObject({
    sources: z.array(z.string().min(1)).min(1).default(["par-defaut"]),
    actif: z.boolean().default(true),
  }),
);

const BETA = contrat("beta", z.strictObject({ espace: z.string().min(1) }));

const GAMMA = contrat("gamma", z.strictObject({ requis: z.string().min(1) }));

const DELTA = contrat("delta", z.strictObject({ espace: z.string().min(1) }));

describe("un connecteur lit sa configuration sans dépendre de celle des autres", () => {
  it("résout un connecteur seul, et refuse ce qui est faux là où c'est lu", () => {
    // Le rendu d'une page n'interroge qu'un connecteur : les clés des autres ne sont
    // pas des orphelines, et les compter ainsi ferait tomber une page sur une
    // configuration parfaitement valide.
    expect(configurationDe(ALPHA)).toEqual({ sources: ["la-notre"], actif: true });
    expect(configurationDe(BETA)).toEqual({ espace: "le-notre" });

    // Un réglage obligatoire que personne n'a écrit refuse de se taire, même sur le
    // chemin d'une page : le connecteur a déclaré qu'il ne sait pas travailler sans.
    expect(() => configurationDe(GAMMA)).toThrow(/connectors\.gamma\.requis/);

    // Et une entrée présente mais fausse est refusée là où elle est lue, pas plus tard.
    expect(() => configurationDe(DELTA)).toThrow(/connectors\.delta\.espace/);
  });

  it("refuse au contrôle d'ensemble ce que la lecture d'un seul ne peut pas voir", () => {
    // La cohérence du fichier entier est le travail de `pnpm policy:check` et de la
    // collecte : eux seuls connaissent la liste complète des connecteurs, donc eux
    // seuls peuvent dire qu'une clé ne correspond à rien.
    expect(() => verifierConfigurations([ALPHA])).toThrow(/connectors\.beta/);
    expect(() => verifierConfigurations([ALPHA])).toThrow(/connectors\.delta/);

    expect(() => verifierConfigurations([ALPHA, BETA, DELTA])).toThrow(/connectors\.delta\.espace/);
  });
});
