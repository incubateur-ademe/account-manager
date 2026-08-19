import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import type { z } from "zod";

import { accountsSchema, configSchema, type Policy } from "@/core/policy";

/**
 * Répertoire des fichiers de politique. Configurable parce qu'ils ne vivent pas
 * nécessairement dans le dépôt du code : ils nomment des personnes et des comptes
 * machine, et une instance peut vouloir les tenir ailleurs.
 *
 * Seule variable lue hors du schéma de `env.ts`, et à dessein : ce dernier valide
 * tout d'un bloc au premier accès, si bien que vérifier un fichier YAML exigerait
 * une URL de base de données. Or `pnpm policy:check` doit tourner depuis le dépôt
 * de configuration, qui n'a ni base ni secrets. Un chemin de fichier n'est de
 * toute façon pas ce que ce schéma existe pour protéger.
 *
 * Résolue à l'appel et non à l'import : la collecte en ligne de commande ne renseigne
 * l'environnement depuis les fichiers d'environnement que dans le corps de son
 * module, donc après l'évaluation de ses imports. Une constante de module la lirait
 * avant, et retomberait invariablement sur `config`.
 */
function dossier(): string {
  return resolve(process.cwd(), process.env["POLICY_DIR"] ?? "config");
}

let cached: Policy | undefined;

function lire<T>(fichier: string, schema: z.ZodType<T>): T {
  const chemin = resolve(dossier(), fichier);

  // Un fichier absent n'est pas lu comme un fichier vide : le schéma décide, et il
  // n'acceptera que celui dont tout a un défaut. Les comptes, eux, seront refusés,
  // ce qui vaut mieux qu'un périmètre silencieusement réduit à personne.
  const present = existsSync(chemin);
  const brut = present ? parse(readFileSync(chemin, "utf8")) : { version: 1 };
  const lu = schema.safeParse(brut);

  if (!lu.success) {
    // Un fichier absent produirait autrement une liste de champs manquants, qui
    // envoie chercher une faute de saisie dans un fichier qui n'existe pas. La
    // cause est ailleurs : l'image a été construite sans politique, ou POLICY_DIR
    // ne désigne pas le bon répertoire.
    if (!present) {
      throw new Error(
        `Fichier de politique absent : ${chemin}. L'image a-t-elle été construite avec CONFIG_REPO, et POLICY_DIR désigne-t-il le bon répertoire ?`,
      );
    }

    const details = lu.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(racine)"} : ${issue.message}`)
      .join("\n");

    // Une version qui ne correspond pas ne dit pas qu'un champ est faux, mais que ce
    // fichier et ce code n'avancent plus ensemble.
    const explication = lu.error.issues.some((issue) => issue.path[0] === "version")
      ? "\n\nLa version du format ne correspond pas à celle qu'attend ce code. Le fichier a été écrit pour une autre version : mettez-le à jour, ou déployez la version du code qui va avec."
      : "";

    throw new Error(`Fichier de politique invalide (${chemin}) :\n${details}${explication}`);
  }

  return lu.data;
}

export function loadPolicy(): Policy {
  const { version: _versionComptes, ...comptes } = lire("accounts.yaml", accountsSchema);
  const { version: _versionReglages, ...reglages } = lire("config.yaml", configSchema);

  return { ...reglages, ...comptes };
}

export function policy(): Policy {
  cached ??= loadPolicy();
  return cached;
}
