import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll } from "vitest";

/**
 * Un dossier de politique le temps d'un fichier de test, et qui ne lui survit pas.
 *
 * Onze fichiers le posaient chacun de leur côté et aucun ne l'effaçait, laissant un
 * dossier par lancement et par fichier s'accumuler sur le poste.
 *
 * L'effacement passe par `afterAll` et non par la sortie du processus. Un
 * `process.on("exit")` ne se déclenche pas ici, Vitest ne laissant pas ses processus de
 * travail sortir d'eux-mêmes, et seule la mesure le montrait : les dossiers
 * continuaient d'apparaître pendant que la suite passait au vert.
 *
 * Posé depuis le corps du module, là où le dossier se crée, parce que `POLICY_DIR` doit
 * valoir quelque chose avant le premier appel qui le lit, donc avant tout scénario. Un
 * `afterAll` déclaré à cet endroit couvre le fichier entier.
 */
export function politiqueJetable(nom: string, contenu?: string): string {
  const dossier = mkdtempSync(join(tmpdir(), `${nom}-`));

  if (contenu === undefined) {
    copyFileSync(
      resolve(process.cwd(), "config/config.exemple.yaml"),
      join(dossier, "config.yaml"),
    );
  } else {
    writeFileSync(join(dossier, "config.yaml"), contenu, "utf8");
  }

  // Rendue telle qu'elle était, et pas seulement effacée : un processus de travail sert
  // plusieurs fichiers, et laisser la variable désigner un dossier supprimé rendrait le
  // suivant sensible à l'ordre.
  const precedent = process.env["POLICY_DIR"];
  process.env["POLICY_DIR"] = dossier;

  afterAll(() => {
    rmSync(dossier, { recursive: true, force: true });
    if (precedent === undefined) {
      // `delete` et non une affectation : Node convertit la valeur en chaîne, si bien
      // qu'y poser `undefined` laisse la variable valoir « undefined ».
      delete process.env["POLICY_DIR"];
    } else {
      process.env["POLICY_DIR"] = precedent;
    }
  });

  return dossier;
}
