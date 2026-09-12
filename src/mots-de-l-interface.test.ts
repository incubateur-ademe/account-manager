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

/**
 * Les champs dont le nom trahit une valeur d'énumération. Le nom suffit : ce sont les
 * colonnes de Prisma, et le garde-fou vaut mieux large et exempté que juste et muet.
 */
const CHAMPS = [
  "status",
  "kind",
  "tier",
  "state",
  "matchMethod",
  "decision",
  "riskLevel",
  "expectedActor",
  "validationBy",
  "idKind",
  "attachment",
  "currentPhase",
  "severity",
  "source",
];

/**
 * Une accolade de JSX qui sert un de ces champs, sans passer par une table.
 *
 * Trois formes sont écartées parce qu'elles ne montrent rien. L'indexation d'une table
 * (`LIBELLE[x.kind]`) est justement le geste attendu. La comparaison (`x.kind ===`) ne
 * rend pas la valeur. Et une accolade précédée d'un signe égal est une propriété
 * passée à un composant, pas du texte : c'est au composant qui la reçoit de la dire.
 */
const SERVI = new RegExp(`(?<!=)\\{[^{}]*?\\b\\w+\\.(${CHAMPS.join("|")})\\b[^{}]*?\\}`, "g");

interface Fuite {
  ou: string;
  champ: string;
  fragment: string;
}

function fuites(): Fuite[] {
  const trouvees: Fuite[] = [];

  for (const [chemin, source] of duCode()) {
    if (!chemin.endsWith(".tsx")) {
      continue;
    }
    source.split("\n").forEach((ligne, rang) => {
      for (const trouve of ligne.matchAll(SERVI)) {
        const fragment = trouve[0];
        const champ = trouve[1] ?? "";
        const indexe = new RegExp(`\\w\\[[^\\]]*\\.${champ}`).test(fragment);
        const compare = /===|!==|==|!=|\?\.|map\(|filter\(| as /.test(fragment);
        if (indexe || compare) {
          continue;
        }
        trouvees.push({ ou: `${chemin}:${rang + 1}`, champ, fragment: fragment.trim() });
      }
    });
  }

  return trouvees;
}

/**
 * Ce qui sert une valeur brute et qu'on accepte, chacun avec sa raison.
 *
 * La clé est le fichier et le champ, jamais le numéro de ligne, qu'une ligne ajoutée
 * plus haut périmerait sans que rien n'ait changé.
 *
 * Une entrée qui ne correspond plus à rien fait échouer ce test au même titre qu'une
 * fuite neuve. C'est la moitié qui compte : une liste d'exceptions que personne ne
 * nettoie finit par couvrir un défaut revenu entre-temps, et elle n'aurait alors servi
 * qu'à le rendre invisible.
 */
const ADMISES: Readonly<Record<string, string>> = {
  "./app/personnes/[username]/Identifiant.tsx|source":
    "L'identifiant de la fiche absorbée par une fusion, pas la colonne `PersonSource` : le nom se ressemble, la valeur est un username.",
  "./ui/connecteurs/github/tuiles.tsx|status":
    "Le code de réponse HTTP de GitHub, dans le message d'une exception. C'est un nombre, et il n'a pas de traduction française.",
  "./app/dossiers/[id]/page.tsx|tier":
    "La valeur passe par `libelleDe`, qui est la table de ce fichier : l'indexation est dans la fonction plutôt que sur la ligne.",
  "./app/collectes/page.tsx|status":
    "Dette connue : le badge de la file des collectes sert `OK`, `PARTIAL`, `FAILED` et `SKIPPED` bruts. Corrigé sur la branche `vocabulaire-des-ecrans`, qui pose la table `LIBELLE_ETAT_COLLECTE`. À retirer d'ici à son arrivée.",
  "./app/page.tsx|status":
    "Dette connue, même famille : « état SKIPPED » dans une phrase française du tableau de bord. Corrigé sur la même branche.",
  "./app/systemes/page.tsx|status":
    "Dette connue, même famille : « état PARTIAL » sous le titre de chaque système. Corrigé sur la même branche.",
};

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

  it("ne sert aucun champ d'énumération sans passer par une table, hors exceptions déclarées", () => {
    // Given les accolades de JSX qui servent un champ dont le nom est celui d'une
    // colonne d'énumération, sans l'indexer dans une table ni le comparer.
    const trouvees = fuites();

    // Then le balayage voit quelque chose : un motif devenu muet ferait tout passer.
    expect(trouvees.length).toBeGreaterThan(0);

    // Then chacune est déclarée, avec la raison qui la rend acceptable.
    const declarees = trouvees.map((fuite) => ({
      fuite,
      cle: `${fuite.ou.split(":")[0]}|${fuite.champ}`,
    }));
    const indues = declarees.filter((ligne) => !Object.hasOwn(ADMISES, ligne.cle));
    expect(indues.map((ligne) => `${ligne.fuite.ou} ${ligne.fuite.fragment}`)).toEqual([]);

    // Then et aucune exception ne survit à ce qu'elle couvrait. Une liste que personne
    // ne nettoie finit par couvrir un défaut revenu depuis, et elle n'aura alors servi
    // qu'à le rendre invisible.
    const perimees = Object.keys(ADMISES).filter(
      (cle) => !declarees.some((ligne) => ligne.cle === cle),
    );
    expect(perimees).toEqual([]);
  });
});
