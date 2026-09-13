import { describe, expect, it } from "vitest";

import { LOT } from "./redaction-lot";

/** Les mots que le modèle porte et qu'aucun écran ne sert tels quels. */
const MOTS_DU_MODELE =
  /moteur|assemblage|précheck|empreinte|octroi|pointage|pointer|soldée?|solder|surcharge|socle|ghid|corrélation|\bvoies?\b|référentiel(?! des)/iu;

/** Tout ce que cet écran écrit, pour les balayages qui portent sur le bloc entier. */
const TOUT = [
  LOT.titre,
  LOT.intro("Beta Exemple"),
  LOT.colonneRetient,
  LOT.raison.label,
  LOT.raison.aide,
  LOT.sortie.bouton,
  LOT.sortie.recapitulatif,
  LOT.depart.bouton,
  LOT.depart.recapitulatif,
  LOT.cloture.bouton(4),
  LOT.cloture.recapitulatif,
  LOT.ceQueLaSortieNeFaitPas,
  LOT.traces,
];

/**
 * Le seul écran qui agit sur plusieurs personnes d'un coup, et le seul dont un
 * malentendu coûte autant de fois qu'il y a de lignes cochées. Ce qu'il promet est donc
 * tenu ici, et pas seulement relu.
 */
describe("ce que promet l'écran qui traite les membres d'une startup en une fois", () => {
  it("nomme trois gestes distincts, et dit qu'aucun n'en déclenche un autre", () => {
    // Given les trois boutons du bloc, qui partagent une sélection et une raison mais
    // pas leurs effets : le premier pose une décision d'appartenance, le deuxième ouvre
    // des dossiers de départ, le troisième ferme des constats.
    const boutons = [LOT.sortie.bouton, LOT.depart.bouton, LOT.cloture.bouton(4)];

    // Then chacun dit ce que le clic fait, du point de vue de qui clique, et aucun ne
    // dit la même chose qu'un autre.
    expect(new Set(boutons).size).toBe(3);
    expect(LOT.sortie.bouton).toMatch(/hors incubateur/u);
    expect(LOT.depart.bouton).toMatch(/dossiers de départ/u);
    expect(LOT.cloture.bouton(4)).toMatch(/constats/u);

    // Then le troisième annonce combien de constats il fermera : un bouton qui vide une
    // file sans dire de combien de lignes se clique sans savoir ce qu'on signe.
    expect(LOT.cloture.bouton(4)).toContain("(4)");
    expect(LOT.cloture.bouton(0)).toContain("(0)");

    // Then la phrase de bas de bloc dit, en toutes lettres, ce que le premier geste ne
    // fait pas. C'est le cœur de l'écran : déclarer quelqu'un hors incubateur n'éteint
    // aucun constat, la collecte de la nuit reconstate, et sans cette phrase une file
    // restée pleine derrière un traitement qu'on croit terminé passerait pour une panne.
    expect(LOT.ceQueLaSortieNeFaitPas).toMatch(/ne coupe aucun accès/u);
    expect(LOT.ceQueLaSortieNeFaitPas).toMatch(/ne ferme aucun constat/u);
    expect(LOT.ceQueLaSortieNeFaitPas).toMatch(/collecte de la nuit/u);

    // Then elle désigne celui des trois qui, lui, vide la file, et dit qu'il se signe à
    // part : l'enchaîner ferait de la sortie forcée le moyen le plus rapide de faire
    // disparaître un écart gênant, ce que les trois actions séparées interdisent.
    expect(LOT.ceQueLaSortieNeFaitPas).toMatch(/troisième bouton/u);
    expect(LOT.ceQueLaSortieNeFaitPas).toMatch(/à part/u);

    // Then chaque geste a son propre récapitulatif : trois titres partagés diraient
    // « traité » sous le geste qui vient d'échouer.
    const recapitulatifs = [
      LOT.sortie.recapitulatif,
      LOT.depart.recapitulatif,
      LOT.cloture.recapitulatif,
    ];
    expect(new Set(recapitulatifs).size).toBe(3);
  });

  it("dit ce qu'il faut saisir et où cela ira, sans rien promettre de plus", () => {
    // Given le champ de raison, saisi une fois pour un lot entier.

    // Then l'aide dit qu'il est obligatoire, qu'il vaut pour toutes les lignes cochées,
    // et où il finira : chaque personne reçoit sa propre trace, la raison y est
    // recopiée, et le nom de l'opérateur avec. Ce sont les trois choses que le code
    // tient, et l'aide n'en promet pas une quatrième.
    expect(LOT.raison.aide).toMatch(/Obligatoire/u);
    expect(LOT.raison.aide).toMatch(/toutes les personnes cochées/u);
    expect(LOT.raison.aide).toMatch(/journal/u);
    expect(LOT.raison.aide).toMatch(/votre nom/u);

    // Then elle ne promet pas que cette raison s'affichera sur une fiche : elle ne le
    // fait que pour le premier des trois gestes, et une aide servie sous trois boutons
    // mentirait sous deux d'entre eux.
    expect(LOT.raison.aide).not.toMatch(/fiche/u);

    // Then l'intro dit que rien ne part de soi-même, et que la sélection préremplie est
    // une proposition : une phase terminale ne sort personne, et l'écran ne doit pas
    // laisser croire qu'il a déjà tranché.
    const intro = LOT.intro("Beta Exemple");
    expect(intro).toContain("Beta Exemple");
    expect(intro).toMatch(/ne sort personne/u);
    expect(intro).toMatch(/c'est vous qui décidez/u);

    // Then elle renvoie à la colonne qui dit pourquoi une ligne n'était pas cochée, et
    // la nomme comme le tableau la nomme : un renvoi vers un intitulé qui n'existe pas
    // envoie chercher ailleurs.
    expect(intro).toContain(`« ${LOT.colonneRetient} »`);

    // Then le récapitulatif dit qu'une trace existe par personne et non une pour le lot :
    // un événement qui dirait « quinze personnes sorties » ne se réexamine pas.
    expect(LOT.traces).toMatch(/sa propre trace/u);
  });

  it("parle la langue des écrans et non celle du modèle", () => {
    // Given toutes les phrases du bloc, boutons et récapitulatifs compris.

    // Then aucune ne sert un mot que seul le code porte. « le moteur ne lit pas cette
    // décision » se disait ici, et « moteur » n'existe sur aucun écran.
    for (const phrase of TOUT) {
      expect(phrase).not.toMatch(MOTS_DU_MODELE);
    }

    // Then aucune n'emploie « écarter », que le glossaire réserve à l'étape qu'un
    // opérateur refuse : la colonne de cet écran dit ce qui retient une ligne, ce qui
    // n'a rien à voir, et les deux sens dans un même bloc ne se distinguent plus.
    for (const phrase of TOUT) {
      expect(phrase).not.toMatch(/écart/iu);
    }
  });
});
