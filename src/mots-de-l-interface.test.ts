import { describe, expect, it } from "vitest";

import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { LIBELLE_ACTEUR, LIBELLE_DOSSIER, LIBELLE_ETAT_DOSSIER } from "@/core/libelle-dossier";
import * as ENUMS from "@/generated/prisma/enums";
import { LIBELLE_SEVERITE, RATTACHEMENT_IDENTITE } from "@/ui/severites";

/**
 * Ce que la base sait dire, et ce que l'écran sait en dire.
 *
 * Deux garde-fous mécaniques contre le même défaut : une valeur d'énumération qui
 * arrive telle quelle sous les yeux d'un opérateur, en anglais et en majuscules, sur
 * un écran d'où il décide de couper un accès. Ce défaut ne se voit pas en relisant le
 * code, il se voit en regardant l'écran avec les bonnes données, et personne n'a
 * jamais toutes les données.
 *
 * Il se traite ici plutôt que plus haut parce qu'il n'a besoin ni de base, ni de
 * serveur, ni de navigateur : les énumérations sont des valeurs à l'exécution et les
 * écrans sont des fichiers. Un test de bout en bout couvrirait le même défaut pour
 * mille fois le prix, et seulement sur les états que ses données produisent.
 *
 * À la racine de `src/` comme les autres invariants qui traversent tous les
 * répertoires.
 */

const SOURCES = import.meta.glob(["./**/*.{ts,tsx}", "!./generated/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Readonly<Record<string, string>>;

function duCode(): [chemin: string, source: string][] {
  return Object.entries(SOURCES)
    .filter(([chemin]) => !chemin.includes(".test."))
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Les énumérations de la base et la table qui les dit en français.
 *
 * Les unions du noyau (`Acteur`, `EtatDossier`, `SensDossier`, `ConstatKind`) ne sont
 * pas les énumérations de la base : elles en sont des rétrécissements écrits à la
 * main, qui ne portent que les valeurs dont le produit sait quoi faire. C'est
 * volontaire et c'est le point de ce garde-fou : l'écart entre les deux est une dette,
 * et la dette n'est tenable que tant que personne n'écrit les valeurs restées de
 * côté.
 */
const TABLES = [
  {
    enumeration: "FindingKind",
    valeurs: Object.values(ENUMS.FindingKind) as readonly string[],
    dites: Object.keys(LIBELLE_CONSTAT),
  },
  {
    enumeration: "StepActor",
    valeurs: Object.values(ENUMS.StepActor) as readonly string[],
    dites: Object.keys(LIBELLE_ACTEUR),
  },
  {
    enumeration: "CaseState",
    valeurs: Object.values(ENUMS.CaseState) as readonly string[],
    dites: Object.keys(LIBELLE_ETAT_DOSSIER),
  },
  {
    enumeration: "CaseKind",
    valeurs: Object.values(ENUMS.CaseKind) as readonly string[],
    dites: Object.keys(LIBELLE_DOSSIER),
  },
  {
    enumeration: "RiskLevel",
    valeurs: Object.values(ENUMS.RiskLevel) as readonly string[],
    dites: Object.keys(LIBELLE_SEVERITE),
  },
  {
    enumeration: "MatchMethod",
    valeurs: Object.values(ENUMS.MatchMethod) as readonly string[],
    dites: Object.keys(RATTACHEMENT_IDENTITE),
  },
] as const;

/** Ce qui écrit une valeur : le littéral, quelle que soit la façon de le citer. */
function quiEcrit(valeur: string): string[] {
  const litteral = new RegExp(`["'\`]${valeur}["'\`]`);
  return duCode()
    .filter(([, source]) => litteral.test(source))
    .map(([chemin]) => chemin);
}

describe("aucune valeur de la base n'arrive telle quelle sous les yeux d'un opérateur", () => {
  it("ne laisse une valeur sans mot français que si personne ne l'écrit", () => {
    // Given les énumérations de la base et les tables qui les disent en français. Les
    // unions du noyau sont plus étroites que les énumérations : elles ne portent que
    // ce dont le produit sait parler, et c'est un choix assumé.
    const dettes = TABLES.map((table) => ({
      enumeration: table.enumeration,
      sansMot: table.valeurs.filter((valeur) => !table.dites.includes(valeur)),
    })).filter((table) => table.sansMot.length > 0);

    // Then il y a bien une dette à surveiller, sans quoi ce test serait vert en
    // n'exerçant rien et le resterait le jour où la dette apparaîtrait.
    expect(dettes).not.toEqual([]);

    // Then aucune valeur laissée sans mot n'est écrite nulle part. C'est la seule
    // chose qui rende la dette tenable : `constats/page.tsx` retombe sur
    // `?? constat.kind` quand la table ne connaît pas le type, donc le jour où une de
    // ces valeurs est produite, la file des constats affiche une constante anglaise,
    // sans explication ni geste proposé, à qui décide de couper un accès.
    const ecrites = dettes.flatMap((dette) =>
      dette.sansMot
        .map((valeur) => ({ valeur, par: quiEcrit(valeur) }))
        .filter((ligne) => ligne.par.length > 0)
        .map((ligne) => `${dette.enumeration}.${ligne.valeur} écrit par ${ligne.par.join(", ")}`),
    );
    expect(ecrites).toEqual([]);
  });
});
