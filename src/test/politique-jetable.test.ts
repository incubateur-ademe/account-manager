import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Le dossier de politique d'un fichier de test se pose par le helper, et pas a la main.
 *
 * Dix fichiers l'avaient pose chacun de leur cote sans jamais l'effacer, et mille sept
 * cent deux dossiers s'etaient accumules sans que rien ne le signale. Le defaut ne se
 * voit ni dans un diff, ou trois lignes de mise en place ressemblent a toutes les autres,
 * ni dans une suite verte, qu'il ne fait pas rougir.
 *
 * La regle vise le couple et non `mkdtempSync` seul : un fichier de test a le droit
 * d'ecrire un dossier temporaire pour autre chose qu'une politique, et une interdiction
 * plus large finirait desactivee au premier cas legitime.
 */

const RACINE = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(RACINE, "src");

/**
 * Le helper, seul endroit ou les deux gestes se rencontrent legitimement, et ce fichier,
 * qui doit citer les deux motifs pour les chercher.
 */
const HORS_REGLE = new Set([
  join("src", "test", "politique-jetable.ts"),
  join("src", "test", "politique-jetable.test.ts"),
]);

function fichiersDeTest(): string[] {
  const trouves: string[] = [];
  const pile = [SRC];
  while (pile.length > 0) {
    const courant = pile.pop();
    if (courant === undefined) break;
    for (const entree of readdirSync(courant)) {
      if (entree === "generated") continue;
      const chemin = join(courant, entree);
      if (statSync(chemin).isDirectory()) pile.push(chemin);
      else if (entree.includes(".test.")) trouves.push(chemin);
    }
  }
  return trouves.sort();
}

describe("une politique jetable se pose par le helper", () => {
  it("refuse un fichier de test qui fabrique son dossier et pointe POLICY_DIR lui-meme", () => {
    // Given les fichiers de test du depot, et le helper qui fait legitimement les deux.
    const suspects = fichiersDeTest()
      .map((chemin) => ({ chemin: relative(RACINE, chemin), source: readFileSync(chemin, "utf8") }))
      .filter(
        ({ chemin, source }) =>
          !HORS_REGLE.has(chemin) &&
          source.includes("mkdtempSync") &&
          source.includes('process.env["POLICY_DIR"]'),
      );

    // Then aucun ne recommence : le helper efface son dossier, une pose a la main non.
    expect(suspects.map(({ chemin }) => chemin)).toEqual([]);
  });
});
