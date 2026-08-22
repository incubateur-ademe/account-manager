import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RACINE = fileURLToPath(new URL("../..", import.meta.url));

/** Frontière du parcours : du code généré, gitignoré, et jamais de l'interface. */
const GENERE = resolve(RACINE, "src/generated");

const EXTENSIONS_DE_CODE = [".ts", ".tsx"];

/** Ce qui n'a rien à faire dans un binaire de ligne de commande, qui est du Node pur. */
const PAQUETS_DINTERFACE = [
  "react",
  "next/",
  "next-auth",
  "@codegouvfr/",
  "@mui/",
  "@emotion/",
  "tss-react",
];

interface Reference {
  specifier: string;
  /** Effacé à la compilation par verbatimModuleSyntax, donc ne charge rien. */
  typePur: boolean;
}

/**
 * Retire les commentaires en préservant les chaînes.
 *
 * Un simple remplacement de `/* ... *​/` traiterait le `/*` d'une chaîne comme une
 * ouverture de commentaire et effacerait tous les imports jusqu'au prochain `*​/` :
 * le parcours ne verrait plus rien et le test passerait au vert sans rien garder,
 * ce qui est exactement la panne que ce garde-fou existe pour empêcher.
 */
function sansCommentaires(source: string): string {
  let sortie = "";
  let rang = 0;

  while (rang < source.length) {
    const caractere = source[rang];
    const suivant = source[rang + 1];

    if (caractere === "/" && suivant === "*") {
      const fin = source.indexOf("*/", rang + 2);
      rang = fin === -1 ? source.length : fin + 2;
      sortie += " ";
      continue;
    }

    if (caractere === "/" && suivant === "/") {
      const fin = source.indexOf("\n", rang);
      rang = fin === -1 ? source.length : fin;
      continue;
    }

    if (caractere === '"' || caractere === "'" || caractere === "`") {
      const debut = rang;
      rang += 1;
      while (rang < source.length && source[rang] !== caractere) {
        rang += source[rang] === "\\" ? 2 : 1;
      }
      rang += 1;
      sortie += source.slice(debut, rang);
      continue;
    }

    sortie += caractere;
    rang += 1;
  }

  return sortie;
}

function referencesDe(fichier: string): Reference[] {
  const source = sansCommentaires(readFileSync(fichier, "utf8"));
  const references: Reference[] = [];

  for (const [, clause, specifier] of source.matchAll(
    /\b(?:import|export)\s+((?:type\s+)?[^;]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    references.push({ specifier: specifier ?? "", typePur: /^type\b/.test((clause ?? "").trim()) });
  }

  for (const [, specifier] of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    references.push({ specifier: specifier ?? "", typePur: false });
  }

  const dynamiques = [...source.matchAll(/\bimport\s*\(/g)].length;
  const litteraux = [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)];

  // Un import dynamique dont la cible se calcule est un trou que ce parcours ne sait
  // pas suivre : le dire vaut mieux que de rendre un graphe incomplet pour complet.
  if (dynamiques !== litteraux.length) {
    throw new Error(
      `import dynamique non littéral dans ${relative(RACINE, fichier)} : le parcours de frontière ne peut pas suivre une cible calculée.`,
    );
  }

  for (const [, specifier] of litteraux) {
    references.push({ specifier: specifier ?? "", typePur: false });
  }

  return references;
}

interface Cible {
  chemin: string;
  /** Faux pour une feuille : un asset, ou du code généré dans lequel on ne descend pas. */
  parcourir: boolean;
}

/**
 * Un import non résolu fait échouer le parcours plutôt que de disparaître : sans
 * cette sévérité, le premier renommage de fichier trouerait la frontière en silence
 * et le test resterait vert sans plus rien parcourir.
 */
function resoudre(specifier: string, depuis: string): Cible | undefined {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = resolve(RACINE, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(depuis), specifier);
  } else {
    return undefined;
  }

  // Le test porte sur le chemin normalisé, jamais sur le specifier : une remontée
  // `@/generated/../ui/...` désigne l'interface et doit être vue comme telle.
  if (base === GENERE || base.startsWith(`${GENERE}/`)) {
    return { chemin: base, parcourir: false };
  }

  // Une feuille de style ou un fichier de données compte comme atteint, ce qui laisse
  // jouer la règle sur src/ui/, mais ne se lit pas comme du TypeScript.
  const extension = /\.[a-z0-9]+$/i.exec(base)?.[0]?.toLowerCase();
  if (extension && !EXTENSIONS_DE_CODE.includes(extension)) {
    return { chemin: base, parcourir: false };
  }

  for (const essai of [
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    if (existsSync(essai)) {
      return { chemin: essai, parcourir: true };
    }
  }

  throw new Error(
    `import non résolu : « ${specifier} » depuis ${relative(RACINE, depuis)}. Le parcours de frontière ne peut pas conclure sur un graphe qu'il n'a pas fini de lire.`,
  );
}

interface Parcours {
  fichiers: Set<string>;
  externes: Set<string>;
}

function parcourir(entrees: readonly string[], suivreLesTypes: boolean): Parcours {
  const fichiers = new Set<string>();
  const externes = new Set<string>();
  const aLire = entrees.map((entree) => resolve(RACINE, entree));
  const lus = new Set<string>();

  while (aLire.length > 0) {
    const fichier = aLire.pop() as string;
    if (lus.has(fichier)) {
      continue;
    }
    lus.add(fichier);
    fichiers.add(fichier);

    for (const { specifier, typePur } of referencesDe(fichier)) {
      if (typePur && !suivreLesTypes) {
        continue;
      }

      const cible = resoudre(specifier, fichier);
      if (!cible) {
        externes.add(specifier);
        continue;
      }

      fichiers.add(cible.chemin);
      if (cible.parcourir) {
        aLire.push(cible.chemin);
      }
    }
  }

  return { fichiers, externes };
}

function violations({ fichiers, externes }: Parcours): string[] {
  const dedans = [...fichiers].map((fichier) => relative(RACINE, fichier));

  return [
    ...dedans.filter(
      (chemin) =>
        chemin.endsWith(".tsx") || chemin.startsWith("src/ui/") || chemin.startsWith("src/app/"),
    ),
    ...[...externes].filter(
      (specifier) =>
        specifier === "next" || PAQUETS_DINTERFACE.some((prefixe) => specifier.startsWith(prefixe)),
    ),
  ];
}

const LIGNE_DE_COMMANDE = [
  "src/cli/sync.ts",
  "src/cli/verifier-politique.ts",
  "src/cli/schema-politique.ts",
];

describe("la ligne de commande n'embarque aucune interface", () => {
  it("ne rencontre ni composant, ni écran, ni bibliothèque d'interface", () => {
    const parcours = parcourir(LIGNE_DE_COMMANDE, false);

    expect(violations(parcours)).toEqual([]);

    // Une contre-épreuve, sans quoi un parcours en panne rendrait la même liste vide
    // et ce test ne prouverait plus que sa propre inertie.
    const atteints = [...parcours.fichiers].map((fichier) => relative(RACINE, fichier));
    expect(atteints).toContain("src/connectors/github.ts");
    expect(atteints).toContain("src/lib/sync/collecte.ts");
    expect(atteints).toContain("src/connectors/index.ts");
    expect(atteints).toContain("src/lib/configuration-connecteur.ts");
    expect(atteints.length).toBeGreaterThan(15);

    // `@next/env` n'est pas `next/` : le distinguer n'est pas un détail, c'est le
    // seul paquet du fournisseur dont la collecte a besoin.
    expect(parcours.externes).toContain("@next/env");
  });

  it("sait reconnaître une interface quand il en croise une", () => {
    const trouvees = violations(parcourir(["src/app/systemes/page.tsx"], false));

    expect(trouvees).toContain("src/app/systemes/page.tsx");
    expect(trouvees.some((specifier) => specifier.startsWith("@codegouvfr/"))).toBe(true);
  });

  it("échoue plutôt que de conclure sur un graphe qu'il n'a pas fini de lire", () => {
    const depuis = resolve(RACINE, "src/cli/sync.ts");

    expect(() => resoudre("@/ce-fichier-n-existe-pas", depuis)).toThrow(/import non résolu/);

    // Une chaîne qui contient une ouverture de commentaire ne doit pas emporter les
    // imports qui la suivent : c'est la façon la plus discrète de rendre ce test muet.
    const piege = sansCommentaires(
      ['const motif = "/* pas un commentaire";', 'import { x } from "@/core/connector";'].join(
        "\n",
      ),
    );
    expect(piege).toContain('from "@/core/connector"');

    // Un commentaire de fin de ligne ne doit pas non plus fabriquer d'arête fantôme.
    const fantome = sansCommentaires('const a = 1; // import { y } from "@/ui/Navigation";');
    expect(fantome).not.toContain("@/ui/Navigation");

    // Une remontée qui sort du code généré redevient visible du parcours.
    expect(resoudre("@/generated/../ui/connecteurs/registre", depuis)?.parcourir).toBe(true);
  });

  it("laisse l'interface connaître les connecteurs, jamais l'inverse", () => {
    const registre = parcourir(["src/ui/connecteurs/registre.ts"], true);
    const atteintsParLInterface = [...registre.fichiers].map((fichier) =>
      relative(RACINE, fichier),
    );
    expect(atteintsParLInterface).toContain("src/core/connector.ts");

    const depuisLesConnecteurs = parcourir(["src/connectors/index.ts"], true);
    const remontees = [...depuisLesConnecteurs.fichiers]
      .map((fichier) => relative(RACINE, fichier))
      .filter((chemin) => chemin.startsWith("src/ui/") || chemin.startsWith("src/app/"));

    expect(remontees).toEqual([]);
  });
});
