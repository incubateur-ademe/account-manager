import { normaliserIdentifiant } from "./fiche-manuelle";

export type NiveauSuggestion = "forte" | "faible";

export interface SuggestionRattachement {
  username: string;
  fullname: string;
  niveau: NiveauSuggestion;
  /**
   * Ce qui a fait proposer cette personne, rédigé pour coiffer un groupe entier :
   * l'écran range les propositions par motif et l'affiche une fois au-dessus d'elles.
   * Il ne nomme donc pas le fragment reconnu, qui diffère d'une personne à l'autre et
   * éclaterait le groupe en autant de titres que de candidats.
   */
  motif: string;
}

const MOTIF = {
  nom: "Nom entier retrouvé dans ce compte",
  identifiant: "Identifiant entier retrouvé dans ce compte",
  fragment: "Fragment de nom ou d'identifiant retrouvé dans ce compte",
} as const;

export interface PersonneProposable {
  username: string;
  fullname: string;
}

/**
 * Un compte dont personne ne se réclame porte presque toujours de quoi deviner son
 * détenteur : `camille.rivet@exemple.org` n'est pas anonyme. Deviner n'est pas
 * savoir, et rien de ce qui sort d'ici ne s'écrit en base : une suggestion est une
 * aide à la saisie que l'opérateur lit et tranche, pas une observation. C'est
 * pourquoi elle se recalcule à chaque affichage plutôt que de se figer à la
 * collecte, où elle prendrait un `personId` que la fiche de la personne afficherait
 * ensuite comme un fait.
 */

/**
 * La longueur en deçà de laquelle un fragment ne prouve rien seul. Elle écarte les
 * particules et les initiales, qui se retrouvent partout et rattacheraient n'importe
 * qui à n'importe quoi.
 */
const LONGUEUR_DISCRIMINANTE = 4;

/**
 * Les chiffres tombent avant la comparaison : un doublon de compte s'écrit
 * `dupuis2`, et c'est toujours la même personne.
 */
function fragments(valeur: string): readonly string[] {
  return normaliserIdentifiant(valeur)
    .split(".")
    .map((fragment) => fragment.replace(/[0-9]+/g, ""))
    .filter((fragment) => fragment.length >= 2);
}

/**
 * Le dernier segment du domaine ne dit rien de personne : `fr` et `org` se
 * retrouvent sur tout le parc. Ce qui le précède, en revanche, porte parfois le nom,
 * les adresses personnelles étant courantes sur les systèmes ouverts en libre-service.
 */
function fragmentsDuCompte(handle: string): readonly string[] {
  const arobase = handle.lastIndexOf("@");
  if (arobase <= 0) {
    return fragments(handle);
  }

  const domaine = handle.slice(arobase + 1).split(".");
  return [...fragments(handle.slice(0, arobase)), ...fragments(domaine.slice(0, -1).join("."))];
}

/**
 * Deux fragments au moins, et c'est ce seuil qui donne son sens au mot « entier ».
 * Un nom ou un identifiant qui se réduit à un seul fragment est couvert par le premier
 * compte qui le porte, si bien que tous les Camille du parc deviendraient des
 * certitudes sur `camille@exemple.org`. Un tel nom reste proposé, mais par la voie
 * faible, qui dit ce qu'elle vaut.
 */
function toutCouvert(attendus: readonly string[], presents: ReadonlySet<string>): boolean {
  return attendus.length >= 2 && attendus.every((fragment) => presents.has(fragment));
}

function premierDiscriminant(
  candidats: readonly string[],
  presents: ReadonlySet<string>,
): string | undefined {
  return candidats.find(
    (fragment) => fragment.length >= LONGUEUR_DISCRIMINANTE && presents.has(fragment),
  );
}

/**
 * Propose qui pourrait détenir ce compte, sans jamais choisir à la place de qui
 * décide : deux homonymes ressortent tous les deux. Le silence est une réponse
 * valable, et c'est la plus fréquente sur un compte de service.
 *
 * Les propositions ne sont pas tronquées. Un écran qui montre trois candidats sur
 * huit se lit comme s'il n'y en avait que trois, et l'opérateur tranche alors sans
 * savoir qu'on lui a caché le reste.
 */
export function suggererRattachements(
  handle: string,
  personnes: readonly PersonneProposable[],
): readonly SuggestionRattachement[] {
  const presents = new Set(fragmentsDuCompte(handle));
  if (presents.size === 0) {
    return [];
  }

  const suggestions: SuggestionRattachement[] = [];

  for (const personne of personnes) {
    const duNom = fragments(personne.fullname);
    const deIdentifiant = fragments(personne.username);
    const commun = { username: personne.username, fullname: personne.fullname };

    if (toutCouvert(duNom, presents)) {
      suggestions.push({ ...commun, niveau: "forte", motif: MOTIF.nom });
      continue;
    }
    if (toutCouvert(deIdentifiant, presents)) {
      suggestions.push({ ...commun, niveau: "forte", motif: MOTIF.identifiant });
      continue;
    }

    if (premierDiscriminant([...duNom, ...deIdentifiant], presents) !== undefined) {
      suggestions.push({ ...commun, niveau: "faible", motif: MOTIF.fragment });
    }
  }

  // Les certitudes d'abord, puis les motifs, puis les noms : l'écran regroupe des
  // propositions consécutives de même motif, ce qu'un tri sur le seul niveau
  // laisserait s'entrelacer.
  return suggestions.sort(
    (gauche, droite) =>
      Number(droite.niveau === "forte") - Number(gauche.niveau === "forte") ||
      gauche.motif.localeCompare(droite.motif) ||
      gauche.username.localeCompare(droite.username),
  );
}
