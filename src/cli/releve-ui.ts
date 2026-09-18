/*
 * Chaque mesure compte une DISPERSION, jamais un volume : combien de façons différentes de faire un
 * geste identique. Un volume monte quand on découpe légitimement un écran en deux composants, donc il
 * punirait un remaniement sain.
 *
 * Les seuils vivent dans seuils-ui.json et ne remontent jamais. Un dépassement fait échouer `pnpm
 * cadre`, donc `pnpm verify`. Une valeur descendue sous son seuil est signalée pour que le seuil se
 * resserre : sans ça, une reprise gagnée se reperd au lot suivant sans que rien ne le dise.
 *
 * L'extraction des textes est faite à la regex et non sur l'arbre syntaxique. C'est un choix : l'API
 * TypeScript n'expose plus createSourceFile depuis la 7.0, et @babel/parser n'est ici qu'une
 * dépendance transitive de MUI. Conséquence à connaître avant de lire un chiffre : un texte calculé à
 * l'exécution échappe à la mesure, et un titre qui contient une expression n'est pas vu.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const SRC = join(RACINE, "src");
const FICHIER_SEUILS = join(ICI, "seuils-ui.json");

interface Source {
  readonly chemin: string;
  readonly contenu: string;
  readonly lignes: readonly string[];
}

interface Site {
  readonly chemin: string;
  readonly ligne: number;
  readonly extrait: string;
}

interface Resultat {
  readonly valeur: number;
  readonly sites: readonly Site[];
}

interface Mesure {
  readonly id: string;
  readonly libelle: string;
  readonly cible: string;
  readonly compter: (sources: readonly Source[]) => Resultat;
}

// ---------------------------------------------------------------------------
// Lecture des sources
// ---------------------------------------------------------------------------

function parcourir(racine: string, gardien: (chemin: string) => boolean): string[] {
  const trouves: string[] = [];
  const pile = [racine];
  while (pile.length > 0) {
    const courant = pile.pop();
    if (courant === undefined) break;
    for (const entree of readdirSync(courant)) {
      if (entree === "node_modules" || entree === "generated") continue;
      const chemin = join(courant, entree);
      if (statSync(chemin).isDirectory()) pile.push(chemin);
      else if (gardien(chemin)) trouves.push(chemin);
    }
  }
  return trouves.sort();
}

function lire(chemins: readonly string[]): Source[] {
  return chemins.map((chemin) => {
    const contenu = readFileSync(chemin, "utf8");
    return { chemin: relative(RACINE, chemin), contenu, lignes: contenu.split("\n") };
  });
}

/*
 * src/cli est exclu, et pas seulement pour éviter que ce fichier ne se compte lui-même : aucune de ces
 * chaînes n'atteint un opérateur, elles vont sur une sortie de terminal.
 */
const estSourceDInterface = (chemin: string): boolean =>
  (chemin.endsWith(".tsx") || chemin.endsWith(".ts")) &&
  !chemin.includes(".test.") &&
  !chemin.endsWith(".d.ts") &&
  !chemin.includes(`${sep}cli${sep}`);

const estEcran = (source: Source): boolean =>
  source.chemin.endsWith(`${"page"}.tsx`) && source.chemin.startsWith(join("src", "app"));

/*
 * Une route qui se termine par un refus ne rend aucun écran : son composant est typé `Promise<never>`
 * et appelle notFound(). Lui réclamer un fil d'Ariane produirait un faux positif permanent, et un
 * compteur qui ne peut pas atteindre zéro finit désactivé.
 */
const rendUnEcran = (source: Source): boolean => !/Promise<never>/.test(source.contenu);

/*
 * L'accueil hérite du titre posé par le gabarit racine, qui est déjà le nom du produit. Lui en donner
 * un second le dupliquerait dans l'onglet.
 */
/*
 * Un motif cherché hors des lignes de commentaire. La règle du dépôt veut que le POURQUOI vive en
 * commentaire, et le nom d'un composant y apparaît souvent : s'en contenter rendrait la mesure muette.
 */
const horsCommentaire = (source: Source, motif: RegExp): boolean =>
  source.lignes.some((ligne) => !estLigneDeCommentaire(ligne) && motif.test(ligne));

/*
 * Un objet metadata sans champ title laisse l'onglet muet tout autant qu'un écran sans metadata.
 */
const declareUnTitreDOnglet = (source: Source): boolean =>
  horsCommentaire(source, /\b(?:metadata|generateMetadata)\b/) &&
  /\btitle\s*:/.test(source.contenu);

const estAccueil = (source: Source): boolean => source.chemin === join("src", "app", "page.tsx");

// ---------------------------------------------------------------------------
// Extraction des textes destinés à l'opérateur
// ---------------------------------------------------------------------------

/*
 * Un littéral n'est retenu que s'il ressemble à une phrase française. Les trois exclusions portent sur
 * ce qui se confond le plus souvent avec du texte : les classes du DSFR, les chemins et adresses, et
 * les identifiants techniques écrits en camelCase ou en kebab-case.
 */
const ACRONYMES_TOLERES = new Set(["OVH", "SCIM", "API", "URL", "GitHub", "ADEME", "DSFR", "RGAA"]);

function estTexteOperateur(brut: string): boolean {
  const s = brut.trim();
  if (s.length < 8) return false;
  if (!s.includes(" ")) return false;
  if (/fr-[a-z]/.test(s)) return false;
  if (/^[/#]|^https?:|^mailto:/.test(s)) return false;
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(s)) return false;
  if (/^[\d\s%.,:;+*/=<>()[\]{}|&-]+$/.test(s)) return false;
  const motsAlphabetiques = s.split(/\s+/).filter((m) => /[a-zà-ÿ]{2}/i.test(m));
  if (motsAlphabetiques.length < 2) return false;
  return /[à-ÿ]/i.test(s) || /^[A-ZÀ-Ý]/.test(s);
}

interface Litteral extends Site {
  readonly texte: string;
}

/*
 * Un commentaire porte souvent les mêmes tournures que les écrans, la règle du dépôt voulant que le
 * POURQUOI y vive. Les compter gonflerait chaque mesure de texte d'un tiers sans qu'aucun opérateur
 * ne lise jamais ces lignes.
 */
const estLigneDeCommentaire = (ligne: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(ligne);

function litterauxDe(source: Source): Litteral[] {
  const trouves: Litteral[] = [];
  source.lignes.forEach((ligne, index) => {
    if (estLigneDeCommentaire(ligne)) return;
    // Les gabarits porteurs d'une interpolation sont écartés : leur texte rendu n'est pas celui-ci.
    const motifs = [/"([^"\\]{8,400})"/g, /`([^`\\$]{8,400})`/g];
    for (const motif of motifs) {
      let trouve = motif.exec(ligne);
      while (trouve !== null) {
        const texte = trouve[1];
        if (texte !== undefined && estTexteOperateur(texte)) {
          trouves.push({
            chemin: source.chemin,
            ligne: index + 1,
            extrait: texte.length > 110 ? `${texte.slice(0, 110)}…` : texte,
            texte,
          });
        }
        trouve = motif.exec(ligne);
      }
    }
  });
  return trouves;
}

/*
 * Deux tiers du texte de ce dépôt sont écrits nus entre deux balises JSX et non dans un littéral. Ne
 * lire que les littéraux ferait passer les mesures à côté de l'essentiel : une première version de ce
 * fichier ne voyait pas une clause de nuance posée dans un <p>.
 */
function textesNusDe(source: Source): Litteral[] {
  if (!source.chemin.endsWith(".tsx")) return [];
  const trouves: Litteral[] = [];
  /*
   * Les accolades sont remplacées plutôt qu'exclues : un texte porteur d'une valeur calculée reste
   * une phrase d'écran, et l'exclure laissait passer la forme la plus courante du dépôt.
   */
  const motif = />([^<]{8,600})</g;
  let trouve = motif.exec(source.contenu);
  while (trouve !== null) {
    const texte = trouve[1]
      ?.replace(/\{[^{}]*\}/g, "…")
      .replace(/\s+/g, " ")
      .trim();
    const ligneDuFragment = source.contenu.slice(0, trouve.index).split("\n").length;
    const estCommentaire = estLigneDeCommentaire(source.lignes[ligneDuFragment - 1] ?? "");
    if (texte !== undefined && !estCommentaire && estTexteOperateur(texte)) {
      trouves.push({
        chemin: source.chemin,
        ligne: source.contenu.slice(0, trouve.index).split("\n").length,
        extrait: texte.length > 110 ? `${texte.slice(0, 110)}…` : texte,
        texte,
      });
    }
    trouve = motif.exec(source.contenu);
  }
  return trouves;
}

const compterMots = (texte: string): number => texte.trim().split(/\s+/).filter(Boolean).length;

function tousLesTextes(sources: readonly Source[]): Litteral[] {
  return sources.flatMap((source) => [...litterauxDe(source), ...textesNusDe(source)]);
}

// ---------------------------------------------------------------------------
// Extraction des éléments d'interface
// ---------------------------------------------------------------------------

function balisesAvecTexte(source: Source, balise: string): Site[] {
  const motif = new RegExp(`<${balise}\\b[^>]*>\\s*([^<>{}\\n]{2,200}?)\\s*</${balise}>`, "g");
  const trouves: Site[] = [];
  let trouve = motif.exec(source.contenu);
  while (trouve !== null) {
    const texte = trouve[1];
    if (texte !== undefined && texte.trim().length > 0) {
      const ligne = source.contenu.slice(0, trouve.index).split("\n").length;
      trouves.push({ chemin: source.chemin, ligne, extrait: texte.trim() });
    }
    trouve = motif.exec(source.contenu);
  }
  return trouves;
}

function titres(sources: readonly Source[]): Site[] {
  return sources.flatMap((source) =>
    [1, 2, 3, 4, 5, 6].flatMap((niveau) => balisesAvecTexte(source, `h${niveau}`)),
  );
}

/*
 * Un actionnable est un bouton ou un lien dont le libellé est écrit en clair. Les trois formes
 * couvertes sont l'enfant textuel, la prop children et la prop label, qui sont les seules employées
 * ici. Un libellé calculé à l'exécution n'est pas vu, et c'est assumé.
 */
function actionnables(sources: readonly Source[]): Site[] {
  const trouves: Site[] = [];
  for (const source of sources) {
    trouves.push(...balisesAvecTexte(source, "Button"), ...balisesAvecTexte(source, "Link"));
    const props = /(?:children|label)=\{?"([^"\\]{2,120})"\}?/g;
    let trouve = props.exec(source.contenu);
    while (trouve !== null) {
      const texte = trouve[1];
      if (texte !== undefined) {
        const ligne = source.contenu.slice(0, trouve.index).split("\n").length;
        trouves.push({ chemin: source.chemin, ligne, extrait: texte });
      }
      trouve = props.exec(source.contenu);
    }
  }
  return trouves;
}

/*
 * Le texte d'une balise ouvrante, accolades suivies. Une prop calculée contient volontiers un « > »
 * dans un ternaire ou une comparaison, donc s'arrêter au premier « > » couperait la balise en deux et
 * ferait manquer les props qui suivent.
 */
function balisesOuvrantes(
  source: Source,
  nom: string,
): { readonly site: Site; readonly texte: string }[] {
  const trouves: { site: Site; texte: string }[] = [];
  const debut = new RegExp(`<${nom}[\\s/>]`, "g");
  let amorce = debut.exec(source.contenu);
  while (amorce !== null) {
    let profondeur = 0;
    let index = amorce.index;
    while (index < source.contenu.length) {
      const caractere = source.contenu[index];
      if (caractere === "{") profondeur += 1;
      else if (caractere === "}") profondeur -= 1;
      else if (caractere === ">" && profondeur === 0) break;
      index += 1;
    }
    const texte = source.contenu.slice(amorce.index, index + 1);
    trouves.push({
      site: {
        chemin: source.chemin,
        ligne: source.contenu.slice(0, amorce.index).split("\n").length,
        extrait: texte.replace(/\s+/g, " ").slice(0, 110),
      },
      texte,
    });
    amorce = debut.exec(source.contenu);
  }
  return trouves;
}

/*
 * Les composants react-dsfr dont la classe racine est réécrite à la main quelque part. Le composant
 * existe et est typé : écrire sa classe soi-même en reproduit le rendu sans son comportement ni ses
 * garanties d'accessibilité.
 */
/*
 * Tout composant react-dsfr qui rend un titre quand on lui passe title ou label, et qui choisit h3
 * quand rien ne le dit. Les oublier laisse un h3 s'injecter sans que la mesure le voie.
 */
const COMPOSANTS_PORTEURS_DE_TITRE = ["Alert", "Tile", "Accordion", "CallOut"] as const;

const CLASSES_RACINES: readonly (readonly [string, string])[] = [
  ["CallOut", "fr-callout"],
  ["Pagination", "fr-pagination"],
  ["TagsGroup", "fr-tags-group"],
];
// fr-search-bar n'est pas de la liste : react-dsfr 1.32.4 n'exporte aucun SearchBar, donc l'écrire à
// la main est ici la seule voie. Une règle qui réclame un composant absent se fait désactiver.

/*
 * Les titres d'un écran ne vivent pas tous dans son fichier : une page monte des composants qui
 * écrivent les leurs. Mesurer la hiérarchie sans les suivre donne un zéro qui ne prouve rien, ce
 * qu'une relecture a constaté sur /collectes, où le h1 est dans la page et le h3 dans un enfant.
 */
function cheminImporte(source: Source, specificateur: string): string | null {
  const base = specificateur.startsWith("@/")
    ? join("src", specificateur.slice(2))
    : specificateur.startsWith(".")
      ? join(dirname(source.chemin), specificateur)
      : null;
  return base === null ? null : `${base}.tsx`;
}

interface TitreRendu {
  readonly niveau: number;
  readonly position: number;
  readonly ligne: number;
  readonly chemin: string;
}

function titresDuFichier(source: Source): TitreRendu[] {
  const titres: TitreRendu[] = [];

  const balises = /<h([1-6])[\s>]/g;
  let trouve = balises.exec(source.contenu);
  while (trouve !== null) {
    titres.push({
      niveau: Number(trouve[1]),
      position: trouve.index,
      ligne: source.contenu.slice(0, trouve.index).split("\n").length,
      chemin: source.chemin,
    });
    trouve = balises.exec(source.contenu);
  }

  /*
   * Un composant react-dsfr porteur d'un title injecte un titre, en h3 quand rien ne le dit. C'est
   * ce h3 implicite qui crée les sauts.
   */
  for (const nom of COMPOSANTS_PORTEURS_DE_TITRE) {
    for (const { site, texte } of balisesOuvrantes(source, nom)) {
      if (!/\b(?:title|label)=/.test(texte)) continue;
      const declare = /\b(?:as|titleAs)="h([2-6])"/.exec(texte);
      titres.push({
        niveau: declare?.[1] === undefined ? 3 : Number(declare[1]),
        position: source.contenu.indexOf(texte),
        ligne: site.ligne,
        chemin: source.chemin,
      });
    }
  }

  return titres;
}

function titresDeLEcran(
  source: Source,
  parChemin: ReadonlyMap<string, Source>,
  vus: ReadonlySet<string> = new Set(),
): TitreRendu[] {
  const titres = titresDuFichier(source);

  const imports = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  let trouve = imports.exec(source.contenu);
  while (trouve !== null) {
    const chemin = cheminImporte(source, trouve[2] ?? "");
    const enfant = chemin === null ? undefined : parChemin.get(chemin);
    if (enfant !== undefined && !vus.has(enfant.chemin)) {
      for (const nom of (trouve[1] ?? "").split(",").map((m) => m.trim().split(" ")[0])) {
        if (nom === undefined || nom.length === 0) continue;
        for (const { site } of balisesOuvrantes(source, nom)) {
          const position = source.contenu.indexOf(`<${nom}`, 0);
          const interieurs = titresDeLEcran(enfant, parChemin, new Set([...vus, source.chemin]));
          for (const titre of interieurs) {
            titres.push({
              ...titre,
              position: position + titre.position / 100_000,
              ligne: site.ligne,
            });
          }
          break;
        }
      }
    }
    trouve = imports.exec(source.contenu);
  }

  return titres.sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Les mesures
// ---------------------------------------------------------------------------

const resultat = (sites: readonly Site[]): Resultat => ({ valeur: sites.length, sites });

const MESURES: readonly Mesure[] = [
  {
    id: "titres-ponctues",
    libelle: "Titres terminés par une ponctuation",
    cible: "Le DSFR l'interdit. Déjà à zéro : le figer est gratuit.",
    compter: (sources) => resultat(titres(sources).filter((t) => /[.;:!]$/.test(t.extrait))),
  },
  {
    id: "libelles-ponctues",
    libelle: "Libellés d'actionnable terminés par une ponctuation",
    cible: "Déjà à zéro.",
    compter: (sources) => resultat(actionnables(sources).filter((a) => /[.;:!?]$/.test(a.extrait))),
  },
  {
    id: "libelles-en-capitales",
    libelle: "Libellés d'actionnable portant un mot tout en capitales",
    cible: "Déjà à zéro. Les acronymes du domaine sont tolérés.",
    compter: (sources) =>
      resultat(
        actionnables(sources).filter((a) =>
          a.extrait
            .split(/\s+/)
            .some((mot) => /^[A-ZÀ-Ý]{2,}$/.test(mot) && !ACRONYMES_TOLERES.has(mot)),
        ),
      ),
  },
  {
    id: "deux-points-explicatifs",
    libelle: "Textes dont les deux-points ouvrent une explication",
    cible: "Les deux-points introduisent une consigne ou une donnée, jamais un pourquoi.",
    compter: (sources) =>
      resultat(tousLesTextes(sources).filter((t) => / : [a-zà-ÿ]/.test(t.texte))),
  },
  {
    id: "clauses-de-nuance",
    libelle: "Textes revenant sur ce qu'ils viennent d'affirmer",
    cible: "Annoncer le fait, s'arrêter. Zéro à terme.",
    compter: (sources) =>
      resultat(
        tousLesTextes(sources).filter((t) =>
          /ne dit rien (de|des|du|d')|, ce qui ne (dit|veut)|son silence ne|faute d'observation|n'est pas la même chose/.test(
            t.texte,
          ),
        ),
      ),
  },
  {
    id: "textes-de-plus-de-quarante-mots",
    libelle: "Textes de plus de quarante mots",
    cible: "Aucune chaîne longue du dépôt n'est une énumération légitime.",
    compter: (sources) => resultat(tousLesTextes(sources).filter((t) => compterMots(t.texte) > 40)),
  },
  {
    id: "libelles-d-attente",
    libelle: "Rédactions distinctes d'un libellé d'attente",
    cible:
      "Un libellé d'attente se dérive du verbe de son bouton. Une forme par action, pas dix-sept.",
    compter: (sources) => {
      const vus = new Map<string, Site>();
      for (const source of sources) {
        source.lignes.forEach((ligne, index) => {
          if (/placeholder/.test(ligne)) return;
          const motif = /"([^"\\]{3,80}…)"/g;
          let trouve = motif.exec(ligne);
          while (trouve !== null) {
            const texte = trouve[1];
            if (texte !== undefined && !vus.has(texte)) {
              vus.set(texte, { chemin: source.chemin, ligne: index + 1, extrait: texte });
            }
            trouve = motif.exec(ligne);
          }
        });
      }
      return resultat([...vus.values()]);
    },
  },
  {
    id: "valeur-absente-ecrite-a-la-main",
    libelle: "Rendus de la valeur absente écrits hors du composant dédié",
    cible: "Un seul composant porte ce rendu. Zéro ailleurs.",
    compter: (sources) => {
      const sites: Site[] = [];
      for (const source of sources) {
        if (source.chemin === join("src", "ui", "Absent.tsx")) continue;
        const motif = /<span[^>]*\bfr-hint-text\b[^>]*>\s*([^<{][^<]*?)\s*<\/span>/g;
        let trouve = motif.exec(source.contenu);
        while (trouve !== null) {
          const texte = (trouve[1] ?? "").replace(/\s+/g, " ").trim();
          /*
           * La même classe sert au texte d'aide sous un label, qui est son usage canonique et qui
           * n'a rien à voir avec une valeur manquante. Seule la longueur les sépare : une valeur
           * absente se dit en un mot ou deux, une consigne en une phrase.
           */
          if (compterMots(texte) <= 5) {
            sites.push({
              chemin: source.chemin,
              ligne: source.contenu.slice(0, trouve.index).split("\n").length,
              extrait: texte.slice(0, 80),
            });
          }
          trouve = motif.exec(source.contenu);
        }
      }
      return resultat(sites);
    },
  },
  {
    id: "coquilles-de-page",
    libelle: "Formes distinctes de la coquille de page",
    cible: "22 des 23 écrans partagent déjà la même. Les écarts sont les écrans de repli.",
    compter: (sources) => {
      const formes = new Map<string, Site>();
      for (const source of sources.filter(estEcran).filter(rendUnEcran)) {
        const trouve = /<main\b([^>]*)>/.exec(source.contenu);
        const signature = (trouve?.[1] ?? "(aucun main)").replace(/\s+/g, " ").trim();
        if (!formes.has(signature)) {
          const ligne = trouve ? source.contenu.slice(0, trouve.index).split("\n").length : 1;
          formes.set(signature, { chemin: source.chemin, ligne, extrait: signature });
        }
      }
      return resultat([...formes.values()]);
    },
  },
  {
    id: "ecrans-sans-titre-d-onglet",
    libelle: "Écrans sans titre d'onglet",
    cible: "Un écran sans metadata laisse l'onglet muet.",
    compter: (sources) =>
      resultat(
        sources
          .filter(estEcran)
          .filter((source) => !estAccueil(source))
          .filter((source) => !declareUnTitreDOnglet(source))
          .map((source) => ({
            chemin: source.chemin,
            ligne: 1,
            extrait: "ni metadata ni generateMetadata",
          })),
      ),
  },
  {
    id: "ecrans-profonds-sans-fil-d-ariane",
    libelle: "Écrans de profondeur deux ou plus sans fil d'Ariane",
    cible: "Sans lui, l'écran ne dit pas d'où l'on vient.",
    compter: (sources) =>
      resultat(
        sources
          .filter(estEcran)
          .filter(rendUnEcran)
          /*
           * L'espace personnel en est exclu : react-dsfr nomme « Accueil » le lien de tête du fil
           * d'Ariane, quand la navigation appelle la même destination « Mon espace ». Un lien de
           * retour explicite y dit mieux où l'on va.
           */
          .filter((source) => !source.chemin.startsWith(join("src", "app", "moi")))
          .filter((source) => {
            const segments = source.chemin.split(/[\\/]/).slice(2, -1);
            return segments.length >= 2 && !horsCommentaire(source, /<Breadcrumb\b/);
          })
          .map((source) => ({ chemin: source.chemin, ligne: 1, extrait: "aucun Breadcrumb" })),
      ),
  },
  {
    id: "titres-injectes-sans-niveau",
    libelle: "Composants DSFR posant un titre sans déclarer son niveau",
    cible:
      "Un Alert ou un Tile porteur d'un title l'injecte en h3 par défaut, d'où des h3 sans h2 parent.",
    compter: (sources) =>
      resultat(
        sources.flatMap((source) =>
          COMPOSANTS_PORTEURS_DE_TITRE.flatMap((nom) =>
            balisesOuvrantes(source, nom)
              .filter(({ texte }) => /\btitle=/.test(texte))
              .filter(({ texte }) => !/\b(as|titleAs)=/.test(texte))
              .map(({ site }) => site),
          ),
        ),
      ),
  },
  {
    id: "sauts-de-niveau-de-titre",
    libelle: "Ruptures dans la hiérarchie des titres d'un écran",
    cible:
      "Le RGAA veut une hiérarchie sans saut. Un h3 posé après un h1 en est un, une remontée de h3 à h2 aussi.",
    compter: (sources) => {
      const parChemin = new Map(sources.map((source) => [source.chemin, source]));
      const sites: Site[] = [];

      for (const source of sources.filter(estEcran).filter(rendUnEcran)) {
        let precedent = 0;
        for (const titre of titresDeLEcran(source, parChemin)) {
          if (precedent > 0 && titre.niveau > precedent + 1) {
            sites.push({
              chemin: titre.chemin,
              ligne: titre.ligne,
              extrait: `${source.chemin} : h${precedent} puis h${titre.niveau}`,
            });
          }
          precedent = titre.niveau;
        }
      }

      return resultat(sites);
    },
  },
  {
    id: "controles-desactives",
    libelle: "Contrôles rendus inertes plutôt que retirés",
    cible:
      "Un contrôle sans effet se retire. Grisé, il occupe la place et le regard sans rien offrir. Seule l'attente d'une soumission le justifie.",
    compter: (sources) => {
      const sites: Site[] = [];
      for (const source of sources) {
        source.lignes.forEach((ligne, index) => {
          if (estLigneDeCommentaire(ligne)) return;
          if (!/\bdisabled(?:=|\s|$)/.test(ligne)) return;
          /* Le temps d'une soumission, l'inertie dit que le geste est parti. */
          if (/isPending|pending|soumission|useFormStatus|\ben[A-Z]\w+/.test(ligne)) return;
          sites.push({
            chemin: source.chemin,
            ligne: index + 1,
            extrait: ligne.trim().slice(0, 110),
          });
        });
      }
      return resultat(sites);
    },
  },
  {
    id: "titres-de-modale-en-h1",
    libelle: "Modales laissant leur titre en h1",
    cible:
      "react-dsfr rend un titre de modale en h1. Chaque modale déclarée ajoute donc un second h1 au document, quoi qu'en dise le code de la page.",
    compter: (sources) =>
      resultat(
        sources.flatMap((source) =>
          balisesOuvrantes(source, "[A-Za-z][\\w]*\\.Component")
            .filter(({ texte }) => !/\btitleAs=/.test(texte))
            .map(({ site }) => site),
        ),
      ),
  },
  {
    id: "composants-dsfr-reecrits-a-la-main",
    libelle: "Classes racines de composants react-dsfr écrites à la main",
    cible: "Le composant existe et il est typé. Sa classe n'a aucune raison d'être écrite ici.",
    compter: (sources) => {
      const sites: Site[] = [];
      for (const source of sources) {
        for (const [composant, classe] of CLASSES_RACINES) {
          source.lignes.forEach((ligne, index) => {
            /*
             * La ligne qui emploie le composant porte aussi sa classe, puisque react-dsfr la pose.
             * Seule cette ligne est exonérée : exonérer le fichier entier laisserait passer ses
             * autres occurrences écrites à la main.
             */
            if (new RegExp(`<${composant}\\b`).test(ligne)) return;
            if (new RegExp(`["'\`\\s]${classe}["'\`\\s]`).test(ligne)) {
              sites.push({
                chemin: source.chemin,
                ligne: index + 1,
                extrait: ligne.trim().slice(0, 110),
              });
            }
          });
        }
      }
      return resultat(sites);
    },
  },
  {
    id: "suppressions-de-diagnostic-de-plugin",
    libelle: "Commentaires supprimant un diagnostic de plugin Biome",
    cible:
      "Une seule suppression lève TOUS les diagnostics de plugin sur le nœud. Les compter est la seule contre-mesure.",
    compter: (sources) => {
      const sites: Site[] = [];
      for (const source of sources) {
        source.lignes.forEach((ligne, index) => {
          if (/biome-ignore\s+lint\/plugin/.test(ligne)) {
            sites.push({ chemin: source.chemin, ligne: index + 1, extrait: ligne.trim() });
          }
        });
      }
      return resultat(sites);
    },
  },
];

// ---------------------------------------------------------------------------
// Seuils et sortie
// ---------------------------------------------------------------------------

type Seuils = Record<string, number>;

function lireSeuils(): Seuils | null {
  if (!existsSync(FICHIER_SEUILS)) return null;
  return JSON.parse(readFileSync(FICHIER_SEUILS, "utf8")) as Seuils;
}

function principal(): number {
  const arguments_ = process.argv.slice(2);
  const poser = arguments_.includes("--poser");
  const detail = arguments_.find((a) => a.startsWith("--detail="))?.slice("--detail=".length);

  const sources = lire(parcourir(SRC, estSourceDInterface));
  const mesures = MESURES.map((mesure) => ({ mesure, resultat: mesure.compter(sources) }));

  if (detail !== undefined) {
    const trouve = mesures.find((m) => m.mesure.id === detail);
    if (trouve === undefined) {
      process.stderr.write(`Mesure inconnue : ${detail}\n`);
      return 2;
    }
    process.stdout.write(`${trouve.mesure.libelle} : ${trouve.resultat.valeur}\n\n`);
    for (const site of trouve.resultat.sites) {
      process.stdout.write(`  ${site.chemin}:${site.ligne}\n    ${site.extrait}\n`);
    }
    return 0;
  }

  if (poser) {
    const relacher = arguments_.includes("--relacher");
    const anciens = lireSeuils() ?? {};
    const remontees = mesures.filter(({ mesure, resultat: r }) => {
      const ancien = anciens[mesure.id];
      return ancien !== undefined && r.valeur > ancien;
    });

    if (remontees.length > 0 && !relacher) {
      process.stderr.write(
        `Refus : ${remontees.length} plafond(s) remonteraient.\n` +
          remontees
            .map(
              ({ mesure, resultat: r }) => `  ${mesure.id} : ${anciens[mesure.id]} → ${r.valeur}`,
            )
            .join("\n") +
          `\n\nReprends la dette, ou assume la hausse avec « --relacher ».\n`,
      );
      return 1;
    }

    const seuils: Seuils = {};
    for (const { mesure, resultat: r } of mesures) {
      const ancien = anciens[mesure.id];
      seuils[mesure.id] = ancien === undefined ? r.valeur : Math.min(r.valeur, ancien);
    }
    if (relacher) for (const { mesure, resultat: r } of mesures) seuils[mesure.id] = r.valeur;
    writeFileSync(FICHIER_SEUILS, `${JSON.stringify(seuils, null, 2)}\n`, "utf8");
    process.stdout.write(
      `Seuils posés sur ${mesures.length} mesures dans ${relative(RACINE, FICHIER_SEUILS)}.\n`,
    );
    return 0;
  }

  const seuils = lireSeuils();
  if (seuils === null) {
    process.stderr.write(
      `Aucun fichier de seuils. Lance « pnpm cadre:poser » une première fois pour figer l'état actuel.\n`,
    );
    return 2;
  }

  const largeur = Math.max(...mesures.map((m) => m.mesure.id.length));
  const depassements: string[] = [];
  const relachements: string[] = [];

  for (const { mesure, resultat: r } of mesures) {
    const seuil = seuils[mesure.id];
    if (seuil === undefined) {
      depassements.push(`${mesure.id} : mesure absente du fichier de seuils`);
      continue;
    }
    const etat = r.valeur > seuil ? "DÉPASSE" : r.valeur < seuil ? "gagné" : "tenu";
    process.stdout.write(
      `  ${mesure.id.padEnd(largeur)}  ${String(r.valeur).padStart(4)} / ${String(seuil).padEnd(4)}  ${etat}\n`,
    );
    if (r.valeur > seuil) {
      depassements.push(
        `${mesure.id} : ${r.valeur} au lieu de ${seuil}. ${mesure.cible}\n` +
          r.sites
            .slice(0, 5)
            .map((s) => `      ${s.chemin}:${s.ligne}  ${s.extrait}`)
            .join("\n"),
      );
    }
    if (r.valeur < seuil) relachements.push(`${mesure.id} : ${seuil} → ${r.valeur}`);
  }

  if (relachements.length > 0) {
    process.stdout.write(
      `\nSeuils à resserrer, la reprise est faite mais rien ne la tient encore :\n${relachements
        .map((r) => `  ${r}`)
        .join("\n")}\n  Lance « pnpm cadre:poser » pour les figer.\n`,
    );
  }

  if (depassements.length > 0) {
    process.stderr.write(`\n${depassements.length} dépassement(s) :\n\n`);
    for (const d of depassements) process.stderr.write(`  ${d}\n\n`);
    return 1;
  }

  process.stdout.write(`\n${mesures.length} mesures, aucun dépassement.\n`);
  return 0;
}

process.exitCode = principal();
