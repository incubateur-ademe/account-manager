import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";

import { cheminsConnus, type Provenance, resoudre } from "@/core/configuration";
import { type Policy, policySchema } from "@/core/policy";

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

/**
 * Le fichier tel quel, avant toute validation : il n'est plus qu'une des trois sources, et
 * le valider seul refuserait une politique que l'environnement ou la base complètent.
 *
 * Un fichier absent n'est pas une erreur ici. Ce qui manque vraiment se dira en une fois,
 * les trois niveaux réunis, plutôt que par une liste de champs qui envoie chercher une
 * faute de saisie dans un fichier qui n'existe pas.
 */
function brut(fichier: string): Record<string, unknown> {
  const chemin = resolve(dossier(), fichier);
  if (!existsSync(chemin)) {
    return {};
  }

  const lu: unknown = parse(readFileSync(chemin, "utf8"));
  if (typeof lu !== "object" || lu === null || Array.isArray(lu)) {
    throw new Error(`Fichier de politique illisible (${chemin}) : un objet était attendu.`);
  }

  return lu as Record<string, unknown>;
}

let surcharges: Readonly<Record<string, unknown>> = {};
let provenances: readonly Provenance[] = [];
let inconnues: readonly string[] = [];

export function provenancesDeLaPolitique(): readonly Provenance[] {
  policy();
  return provenances;
}

/** Les variables `CONFIG_` qu'aucun chemin ne réclame : une faute de frappe ne se voit nulle part ailleurs. */
export function variablesInconnues(): readonly string[] {
  policy();
  return inconnues;
}

/**
 * Vrai quand aucune des trois sources ne porte quoi que ce soit, donc que tout vient des
 * défauts du schéma. Ce n'est pas une erreur, le schéma promettant qu'une instance sans
 * fichier fonctionne, et c'est le cas du développement local comme du bout en bout.
 *
 * Mais c'est aussi exactement ce qu'un POLICY_DIR mal pointé produit, avec un périmètre qui
 * ne suit personne. Dit plutôt que refusé : refuser emporterait la page de connexion et les
 * sondes, là où le dire laisse quelqu'un s'en apercevoir.
 */
export function politiqueEntierementParDefaut(): boolean {
  policy();
  return provenances.every(({ niveau }) => niveau === "defaut");
}

/**
 * Charge les surcharges de la base avant toute lecture de politique. Séparé et explicite :
 * `policy()` est synchrone et appelée partout, y compris là où aucune base n'existe, et la
 * rendre asynchrone obligerait chaque écran à attendre ce qu'il ne lit pas.
 */
export function poserLesSurcharges(lues: Readonly<Record<string, unknown>>): void {
  surcharges = lues;
  cached = undefined;
}

export function loadPolicy(): Policy {
  // Un fichier resté là où il n'a plus rien à faire ne se lirait plus, et ce qu'il porte
  // disparaîtrait en silence : refuser de démarrer vaut mieux que d'appliquer une politique
  // amputée de ce que quelqu'un croit avoir déclaré.
  if (existsSync(resolve(dossier(), "accounts.yaml"))) {
    throw new Error(
      "accounts.yaml ne se lit plus. Verser sa clé « scope » dans config.yaml, puis supprimer le fichier. Les comptes de service, eux, ne se déclarent plus dans un fichier : ils se saisissent dans l'écran « Comptes de service », et le schéma refuse désormais cette clé.",
    );
  }

  const fichier = brut("config.yaml");
  const resolution = resoudre(cheminsConnus(policySchema), {
    environnement: process.env,
    fichier,
    base: surcharges,
  });

  provenances = resolution.provenances;
  inconnues = resolution.inconnues;

  // La version que le fichier déclare, et 1 seulement quand il n'en déclare aucune : la
  // remplacer ferait accepter comme version 1 un fichier écrit pour une autre, dont les
  // champs compatibles passeraient et les autres seraient refusés sans qu'on sache pourquoi.
  const lu = policySchema.safeParse({ version: 1, ...resolution.valeurs });
  if (!lu.success) {
    const details = lu.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(racine)"} : ${issue.message}`)
      .join("\n");

    throw new Error(`Configuration invalide, les trois niveaux réunis :\n${details}`);
  }

  const { version: _version, ...declare } = lu.data;

  return declare;
}

export function policy(): Policy {
  cached ??= loadPolicy();
  return cached;
}
