import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll } from "vitest";

/**
 * Un dossier de politique le temps d'un fichier de test, et qui ne lui survit pas.
 *
 * Dix fichiers le posaient chacun de leur côté et aucun ne l'effaçait : sept cent
 * trente-trois dossiers s'étaient accumulés sur le poste du mainteneur, un par
 * lancement et par fichier.
 *
 * L'effacement passe par `afterAll` et non par la sortie du processus. Un
 * `process.on("exit")` ne se déclenche pas ici, Vitest ne laissant pas ses processus de
 * travail sortir d'eux-mêmes, et seule la mesure le montrait : les dix dossiers
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

  process.env["POLICY_DIR"] = dossier;
  afterAll(() => rmSync(dossier, { recursive: true, force: true }));

  return dossier;
}
