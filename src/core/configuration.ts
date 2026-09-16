import { z } from "zod";

/**
 * Ce que la configuration sait faire d'une valeur, et d'où elle la tient.
 *
 * Trois niveaux, du plus faible au plus fort : l'environnement, le fichier, la base. Le
 * premier suit le déploiement, le deuxième se relit en revue, la troisième se règle depuis
 * l'outil. L'ordre n'est pas une commodité : ce qui se change sans livraison doit pouvoir
 * corriger ce qui en demandait une, sans quoi l'interface ne servirait à rien.
 *
 * Les garde-fous n'entrent dans aucun des trois. Ils vivent en environnement seul, sous un
 * nom sans préfixe, et rien de ce qui suit ne peut les atteindre : un interrupteur général
 * qu'une interface peut rouvrir n'est pas un interrupteur.
 */
export type Niveau = "environnement" | "fichier" | "base";

export interface Provenance {
  chemin: string;
  niveau: Niveau | "defaut";
}

/** Le type d'une feuille, tel que le schéma le déclare, pour convertir ce que l'environnement rend. */
export type Forme = "texte" | "nombre" | "booleen" | "liste" | "objet";

export interface CheminConnu {
  chemin: string;
  forme: Forme;
  /** Le nom d'environnement qui le surcharge, dérivé du chemin et jamais choisi à la main. */
  variable: string;
}

interface NoeudJson {
  type?: unknown;
  properties?: Record<string, NoeudJson>;
  items?: NoeudJson;
}

function formeDe(noeud: NoeudJson): Forme {
  const type = Array.isArray(noeud.type) ? noeud.type[0] : noeud.type;

  switch (type) {
    case "array":
      return "liste";
    case "number":
    case "integer":
      return "nombre";
    case "boolean":
      return "booleen";
    case "object":
      return "objet";
    default:
      return "texte";
  }
}

/**
 * `config.mail.domainsLostOnDeparture` devient `CONFIG_MAIL_DOMAINS_LOST_ON_DEPARTURE`.
 *
 * Dérivé et jamais choisi : un nom posé à la main finirait par diverger de la clé qu'il
 * surcharge, et personne ne saurait plus laquelle des deux fait foi.
 */
export function nomDeVariable(chemin: string): string {
  const mots = chemin
    .split(".")
    .flatMap((segment) => segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "));

  return ["CONFIG", ...mots].join("_").toUpperCase();
}

/**
 * Les chemins qu'une surcharge peut viser, dérivés du schéma lui-même.
 *
 * Seules les feuilles : surcharger un objet entier écraserait des clés que personne n'a
 * nommées, et le ferait sans que la provenance sache quoi afficher.
 *
 * Les tableaux d'objets n'en sont pas. Une liste de profils ou de comptes ne se règle pas
 * par une variable d'environnement, et prétendre le contraire donnerait une syntaxe que
 * personne ne saurait écrire.
 */
/**
 * Ce qui n'est pas un réglage mais une propriété du fichier. La version dit quel format il
 * parle : la surcharger ferait refuser toute la politique, et l'afficher comme réglable
 * inviterait à le faire.
 */
const HORS_REGLAGE = new Set(["version"]);

export function cheminsConnus(schema: z.ZodType): readonly CheminConnu[] {
  const racine = z.toJSONSchema(schema, { io: "input" }) as NoeudJson;
  const trouves: CheminConnu[] = [];

  const descendre = (noeud: NoeudJson, prefixe: readonly string[]): void => {
    for (const [cle, enfant] of Object.entries(noeud.properties ?? {})) {
      const chemin = [...prefixe, cle];

      if (HORS_REGLAGE.has(chemin.join("."))) {
        continue;
      }

      if (enfant.properties) {
        descendre(enfant, chemin);
        continue;
      }

      const forme = formeDe(enfant);
      if (forme === "objet" || (forme === "liste" && enfant.items?.properties)) {
        continue;
      }

      trouves.push({
        chemin: chemin.join("."),
        forme,
        variable: nomDeVariable(chemin.join(".")),
      });
    }
  };

  descendre(racine, []);

  return trouves;
}

/**
 * Ce qu'une variable d'environnement rend, dans la forme que le schéma attend.
 *
 * Une liste se sépare par des virgules, et rien d'autre : c'est la seule syntaxe qu'on
 * puisse écrire dans un environnement sans la citer, et la seule qu'on relise sans erreur.
 * Une valeur vide vaut liste vide, et non liste d'une chaîne vide.
 */
export function convertir(brut: string, forme: Forme): unknown {
  switch (forme) {
    case "liste":
      return brut
        .split(",")
        .map((entree) => entree.trim())
        .filter((entree) => entree.length > 0);
    case "nombre": {
      // Ce qui n'est pas un nombre le reste : rendre NaN ferait remonter un refus du schéma
      // dont le message ne dirait pas que la valeur n'en était pas un, et une chaîne vide
      // vaudrait zéro, donc un seuil de zéro jour que personne n'a écrit.
      const lu = brut.trim() === "" ? Number.NaN : Number(brut);
      return Number.isFinite(lu) ? lu : brut;
    }
    case "booleen":
      return brut === "true";
    default:
      return brut;
  }
}

export function poser(cible: Record<string, unknown>, chemin: string, valeur: unknown): void {
  const segments = chemin.split(".");
  const dernier = segments.pop();
  if (dernier === undefined) {
    return;
  }

  let courant = cible;
  for (const segment of segments) {
    const enfant = courant[segment];
    if (typeof enfant !== "object" || enfant === null || Array.isArray(enfant)) {
      courant[segment] = {};
    }
    courant = courant[segment] as Record<string, unknown>;
  }

  courant[dernier] = valeur;
}

/**
 * La surcouche l'emporte, et les objets se rejoignent au lieu de s'écraser : sans quoi
 * déclarer un seul seuil dans un fichier effacerait tous ceux que l'environnement a posés.
 *
 * Les tableaux, eux, se remplacent. Les fusionner reviendrait à interdire d'en retirer une
 * entrée, et le cas d'usage premier de ces listes est justement d'en retirer.
 */
export function fusionner(
  base: Record<string, unknown>,
  surcouche: Record<string, unknown>,
): Record<string, unknown> {
  const resultat: Record<string, unknown> = { ...base };

  for (const [cle, valeur] of Object.entries(surcouche)) {
    const existant = resultat[cle];
    const deuxObjets =
      typeof valeur === "object" &&
      valeur !== null &&
      !Array.isArray(valeur) &&
      typeof existant === "object" &&
      existant !== null &&
      !Array.isArray(existant);

    resultat[cle] = deuxObjets
      ? fusionner(existant as Record<string, unknown>, valeur as Record<string, unknown>)
      : valeur;
  }

  return resultat;
}

export interface SourcesDeConfiguration {
  /** Ce que l'environnement porte, par nom de variable. */
  environnement: Readonly<Record<string, string | undefined>>;
  /** Le fichier, tel qu'il a été lu, avant toute validation. */
  fichier: Record<string, unknown>;
  /** Ce que la base porte, par chemin. */
  base: Readonly<Record<string, unknown>>;
}

export interface Resolution {
  valeurs: Record<string, unknown>;
  provenances: readonly Provenance[];
  /** Les variables `CONFIG_` qu'aucun chemin du schéma ne réclame. */
  inconnues: readonly string[];
}

/**
 * Les trois sources réunies, et la trace de qui a gagné.
 *
 * La provenance n'est pas un agrément : trois niveaux font trois endroits où se tromper, et
 * sans elle personne ne saura pourquoi un réglage ne prend pas.
 *
 * Une variable `CONFIG_` qu'aucun chemin ne réclame est rendue plutôt qu'ignorée. Une faute
 * de frappe dans un nom d'environnement ne se voit nulle part ailleurs : la valeur ne prend
 * pas, et rien ne le dit.
 */
export function resoudre(
  connus: readonly CheminConnu[],
  sources: SourcesDeConfiguration,
): Resolution {
  const depuisEnvironnement: Record<string, unknown> = {};
  const provenances = new Map<string, Provenance>();

  for (const connu of connus) {
    const brut = sources.environnement[connu.variable];
    if (brut !== undefined) {
      poser(depuisEnvironnement, connu.chemin, convertir(brut, connu.forme));
      provenances.set(connu.chemin, { chemin: connu.chemin, niveau: "environnement" });
    }
  }

  let valeurs = fusionner(depuisEnvironnement, sources.fichier);

  for (const connu of connus) {
    if (lire(sources.fichier, connu.chemin) !== undefined) {
      provenances.set(connu.chemin, { chemin: connu.chemin, niveau: "fichier" });
    }
  }

  const depuisBase: Record<string, unknown> = {};
  for (const [chemin, valeur] of Object.entries(sources.base)) {
    poser(depuisBase, chemin, valeur);
    provenances.set(chemin, { chemin, niveau: "base" });
  }
  valeurs = fusionner(valeurs, depuisBase);

  const reclames = new Set(connus.map((connu) => connu.variable));
  const inconnues = Object.keys(sources.environnement)
    .filter((nom) => nom.startsWith("CONFIG_") && !reclames.has(nom))
    .sort();

  return {
    valeurs,
    provenances: connus.map(
      (connu) => provenances.get(connu.chemin) ?? { chemin: connu.chemin, niveau: "defaut" },
    ),
    inconnues,
  };
}

export function lire(objet: Record<string, unknown>, chemin: string): unknown {
  let courant: unknown = objet;

  for (const segment of chemin.split(".")) {
    if (typeof courant !== "object" || courant === null) {
      return undefined;
    }
    courant = (courant as Record<string, unknown>)[segment];
  }

  return courant;
}
