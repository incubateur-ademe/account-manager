import { describe, expect, it } from "vitest";

import { type PersonneProposable, suggererRattachements } from "./suggestion-rattachement";

const ANNUAIRE: PersonneProposable[] = [
  { username: "camille.rivet", fullname: "Camille Rivet" },
  { username: "jean.francois.leduc", fullname: "Jean-François Leduc" },
  { username: "lea.roy", fullname: "Léa Roy" },
  { username: "samir.benali", fullname: "Samir Benali" },
];

function usernames(suggestions: readonly { username: string }[]): string[] {
  return suggestions.map((suggestion) => suggestion.username);
}

describe("suggestion de rattachement d'un compte isolé", () => {
  it("propose le détenteur d'un compte nominatif, et lui seul", () => {
    // Le cas courant sur les systèmes ouverts en libre-service : l'adresse porte le
    // nom en clair, et l'opérateur passe son temps à le retaper à la main.
    const suggestions = suggererRattachements("camille.rivet@exemple.org", ANNUAIRE);

    expect(usernames(suggestions)).toEqual(["camille.rivet"]);
    expect(suggestions[0]).toMatchObject({
      fullname: "Camille Rivet",
      niveau: "forte",
      motif: "Nom entier retrouvé dans ce compte",
    });
  });

  it("franchit ce qui sépare l'écriture sans séparer les personnes", () => {
    // Accents, tirets, points, doublons numérotés et logins sans arobase décrivent
    // tous la même personne. Comparer sans réduire d'abord ne proposerait rien, et
    // l'écran resterait muet là où il a le plus à dire.
    const parAdresse = suggererRattachements("jean-francois.leduc2@exemple.org", ANNUAIRE);
    const parLoginGithub = suggererRattachements("Jean-Francois-Leduc", ANNUAIRE);
    const parSoulignement = suggererRattachements("JEAN_FRANCOIS_LEDUC@exemple.org", ANNUAIRE);

    // Le compte peut aussi avoir avalé les traits d'union que le référentiel garde,
    // et porter en plus une mention de prestation : deux découpages du même nom que
    // rien ne rapproche tant qu'on compare fragment à fragment.
    const parNomRecolle = suggererRattachements("jeanfrancois.leduc.ext@exemple.org", ANNUAIRE);
    const parNomEntierementRecolle = suggererRattachements(
      "jeanfrancoisleduc@exemple.org",
      ANNUAIRE,
    );

    for (const suggestions of [
      parAdresse,
      parLoginGithub,
      parSoulignement,
      parNomRecolle,
      parNomEntierementRecolle,
    ]) {
      expect(usernames(suggestions)).toEqual(["jean.francois.leduc"]);
      expect(suggestions[0]?.niveau).toBe("forte");
    }

    // Recoller n'est pas chercher le nom n'importe où dans le compte : un nom voisin
    // plus long ne doit pas absorber le plus court, sans quoi Léa Roy deviendrait une
    // certitude sur le compte d'une Royer.
    expect(suggererRattachements("marielea.royer@exemple.org", ANNUAIRE)).toEqual([]);
  });

  it("distingue la ressemblance partielle de la certitude, et se tait sur un fragment trop court", () => {
    // Un nom de famille seul suffit à orienter, jamais à conclure : il reste des
    // homonymes, et le rattachement manuel pose la méthode qui autorise une coupure.
    const partielle = suggererRattachements("benali@exemple.org", ANNUAIRE);

    expect(usernames(partielle)).toEqual(["samir.benali"]);
    expect(partielle[0]).toMatchObject({
      niveau: "faible",
      motif: "Fragment de nom ou d'identifiant retrouvé dans ce compte",
    });

    // « roy » se retrouverait dans « royaume », « leroy » ou n'importe quel domaine :
    // trois lettres ne désignent personne.
    expect(suggererRattachements("roy@exemple.org", ANNUAIRE)).toEqual([]);

    // Un nom qui tient en un seul fragment est couvert par le premier compte qui le
    // porte : le proposer comme une certitude ferait de tous les homonymes de prénom
    // autant de rattachements sûrs. Il reste proposé, mais sans cette assurance.
    const mononyme: PersonneProposable[] = [{ username: "camille", fullname: "Camille" }];
    expect(suggererRattachements("camille@exemple.org", mononyme)).toMatchObject([
      { username: "camille", niveau: "faible" },
    ]);
  });

  it("ne départage pas deux homonymes à la place de qui décide", () => {
    // Choisir ici reviendrait à rattacher un compte à la mauvaise personne une fois
    // sur deux, en silence. Les deux ressortent, l'opérateur tranche.
    const jumelles: PersonneProposable[] = [
      { username: "camille.rivet", fullname: "Camille Rivet" },
      { username: "c.rivet", fullname: "Camille Rivet" },
    ];

    const suggestions = suggererRattachements("camille.rivet@exemple.org", jumelles);

    expect(usernames(suggestions)).toEqual(["c.rivet", "camille.rivet"]);
    expect(suggestions.every((suggestion) => suggestion.niveau === "forte")).toBe(true);
  });

  it("ne ressemble à personne sur un compte fonctionnel, ni sur le domaine partagé", () => {
    // La moitié de la file est faite de comptes de service et de boîtes partagées.
    // Une proposition fabriquée sur du vide y coûte plus cher que le silence.
    expect(suggererRattachements("contact@exemple.org", ANNUAIRE)).toEqual([]);
    expect(suggererRattachements("admin@exemple.org", ANNUAIRE)).toEqual([]);
    expect(suggererRattachements("", ANNUAIRE)).toEqual([]);

    // Le dernier segment du domaine se retrouve sur tout le parc : s'il comptait,
    // chaque compte de l'incubateur proposerait les mêmes personnes.
    const domaineHomonyme: PersonneProposable[] = [
      { username: "chris.org", fullname: "Chris Org" },
      { username: "alix.exemple", fullname: "Alix Exemple" },
    ];
    expect(usernames(suggererRattachements("contact@exemple.org", domaineHomonyme))).toEqual([
      "alix.exemple",
    ]);
  });

  it("lit le nom de part et d'autre de l'arobase, sans le recomposer par-dessus", () => {
    // Une adresse personnelle porte souvent le prénom devant et le nom de famille en
    // domaine. Refuser d'y voir un nom entier passerait à côté de comptes que
    // l'opérateur reconnaît au premier regard, sur des systèmes en libre-service où
    // chacun s'inscrit avec l'adresse qu'il veut.
    const personnelle = suggererRattachements("camille@rivet.fr", ANNUAIRE);

    expect(usernames(personnelle)).toEqual(["camille.rivet"]);
    expect(personnelle[0]).toMatchObject({
      niveau: "forte",
      motif: "Nom entier retrouvé dans ce compte",
    });

    // Recoller, en revanche, s'arrête à l'arobase. Reconnaître un fragment entier de
    // chaque côté est un indice, recomposer un mot à cheval fabriquerait une chaîne
    // qui n'existe dans aucune des deux parties. Le compte reste proposé, par la voie
    // faible qui dit ce qu'elle vaut, plutôt que par une certitude bâtie sur du vide.
    const aCheval = suggererRattachements("jeanfrancois@leduc.fr", ANNUAIRE);

    expect(usernames(aCheval)).toEqual(["jean.francois.leduc"]);
    expect(aCheval[0]?.niveau).toBe("faible");
  });

  it("met les certitudes devant les ressemblances", () => {
    // L'opérateur lit de haut en bas et clique le premier nom qui lui parle : l'ordre
    // décide de ce qui sera rattaché.
    const parents: PersonneProposable[] = [
      { username: "zoe.benali", fullname: "Zoé Benali" },
      { username: "samir.benali", fullname: "Samir Benali" },
      { username: "alex.benali", fullname: "Alex Benali" },
    ];

    const suggestions = suggererRattachements("samir.benali@exemple.org", parents);

    expect(usernames(suggestions)).toEqual(["samir.benali", "alex.benali", "zoe.benali"]);
    expect(suggestions.map((suggestion) => suggestion.niveau)).toEqual([
      "forte",
      "faible",
      "faible",
    ]);
  });

  it("range ensemble les propositions de même motif, pour un titre de groupe et un seul", () => {
    // L'écran coiffe chaque groupe de vignettes du motif commun, écrit une fois. Deux
    // propositions de même motif séparées par une troisième produiraient deux groupes
    // identiques, et l'opérateur lirait le même titre deux fois sans comprendre ce qui
    // les distingue.
    const melange: PersonneProposable[] = [
      { username: "camille.rivet", fullname: "Camille Rivet" },
      { username: "rivet.exemple", fullname: "Alix Bonnet" },
      { username: "camille.exemple", fullname: "Camille Exemple" },
      { username: "noa.rivet", fullname: "Noa Rivet" },
    ];

    const suggestions = suggererRattachements("camille.rivet@exemple.org", melange);

    expect(suggestions.map((suggestion) => [suggestion.username, suggestion.motif])).toEqual([
      ["rivet.exemple", "Identifiant entier retrouvé dans ce compte"],
      ["camille.exemple", "Nom entier retrouvé dans ce compte"],
      ["camille.rivet", "Nom entier retrouvé dans ce compte"],
      ["noa.rivet", "Fragment de nom ou d'identifiant retrouvé dans ce compte"],
    ]);

    // Un motif qui réapparaît après en avoir laissé passer un autre casserait le
    // groupement, que l'écran fait en une passe sur des voisins.
    const titres = suggestions
      .map((suggestion) => suggestion.motif)
      .filter((motif, rang, tous) => motif !== tous[rang - 1]);
    expect(new Set(titres).size).toBe(titres.length);
  });
});
