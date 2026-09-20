import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Tout ecran s'ouvre dans un navigateur, sur des donnees, avant d'etre livre.
 *
 * Le relevé visuel ouvre une liste de routes ecrite a la main. Un ecran neuf n'y entre
 * pas tout seul, et rien ne signalait son absence : il partait alors sans que personne
 * ne l'ait vu peuplé, et la seule trace en était un « à vérifier visuellement » dans une
 * description de PR. C'est la seule propriété de cette liste qui pourrisse en silence,
 * et c'est pour elle seule que ce fichier existe.
 *
 * Ici plutôt que dans `pnpm cadre`, qui ne lit ni les tests ni `e2e/`. Ici plutôt que
 * dans `e2e/`, qui ne tourne pas dans la vérification continue : un écran neuf doit se
 * heurter au refus sur la proposition qui l'introduit, pas la veille d'une livraison.
 */

const RACINE = fileURLToPath(new URL("../..", import.meta.url));
const ECRANS = join(RACINE, "src", "app");
const RELEVE = join(RACINE, "e2e", "releve-visuel.spec.ts");

/**
 * Les deux écrans que le relevé n'ouvre pas, et la raison de chacun.
 *
 * `/login` est la seule route publique, donc la seule que le relevé ne peut pas atteindre
 * avec la session qu'il ouvre d'entrée. `/moi/[...reste]` est le refus de l'espace
 * personnel, dont le composant est typé `Promise<never>` et n'affiche rien de lui-même,
 * la page de non-trouvé du gabarit prenant la main.
 */
const HORS_RELEVE = new Set(["/login", "/moi/[...reste]"]);

function routes(): string[] {
  const trouvees: string[] = [];
  const pile = [ECRANS];
  while (pile.length > 0) {
    const courant = pile.pop();
    if (courant === undefined) break;
    for (const entree of readdirSync(courant)) {
      const chemin = join(courant, entree);
      if (statSync(chemin).isDirectory()) pile.push(chemin);
      else if (entree === "page.tsx") {
        const route = relative(ECRANS, courant).split(sep).join("/");
        trouvees.push(`/${route}`.replace(/\/$/u, "") || "/");
      }
    }
  }
  return trouvees.sort();
}

/**
 * Les chemins que le relevé ouvre, un segment interpolé valant un segment quelconque.
 *
 * Le relevé les écrit concrets, `/personnes/noor.exemple` ou `/dossiers/${DOSSIER_DEPART}`.
 * C'est donc la route qui sert de motif et le chemin de sujet, jamais l'inverse : réduire
 * les deux au même joker ferait matcher `/personnes/x/edit` avec `/personnes/x`.
 */
function ouvertes(): string[] {
  const source = readFileSync(RELEVE, "utf8");
  return [...source.matchAll(/chemin: [`"]([^`"]+)[`"]/gu)].map(([, chemin]) =>
    (chemin ?? "").replace(/\$\{[^}]*\}/gu, "segment-interpole"),
  );
}

/** `/personnes/[username]/edit` devient le motif qui reconnait `/personnes/qui-que-ce-soit/edit`. */
function motifDe(route: string): RegExp {
  const corps = route
    .split("/")
    .map((segment) =>
      /^\[.*\]$/u.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${corps}$`, "u");
}

describe("les écrans passent tous par le relevé visuel", () => {
  it("n'en laisse aucun sortir sans avoir été ouvert sur un semis plein", () => {
    // Given les écrans du dépôt et les routes que le relevé ouvre.
    const tous = routes();
    const chemins = ouvertes();

    // Then chaque écran est ouvert, ou nommé dans les exclusions avec sa raison.
    const jamaisOuverts = tous.filter(
      (route) => !HORS_RELEVE.has(route) && !chemins.some((chemin) => motifDe(route).test(chemin)),
    );
    expect(jamaisOuverts).toEqual([]);

    // Then aucune exclusion ne survit à l'écran qu'elle couvrait. Une exclusion orpheline
    // est un droit de passage que plus rien ne justifie.
    expect([...HORS_RELEVE].filter((route) => !tous.includes(route))).toEqual([]);
  });
});
