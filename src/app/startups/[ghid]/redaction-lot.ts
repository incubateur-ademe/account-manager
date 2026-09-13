import { LIBELLE_CONSTAT } from "@/core/libelle-constat";

/**
 * Ce que promet l'écran qui traite les membres d'une startup en une fois.
 *
 * C'est le seul geste de l'outil qui porte sur plusieurs personnes à la fois, et
 * chacun de ses trois boutons fait une chose que les deux autres ne font pas : un
 * malentendu y coûte autant de fois qu'il y a de lignes cochées. Les phrases vivent
 * donc ici, où ce qu'elles promettent se vérifie.
 */

export const LOT = {
  titre: "Traiter ses membres en une fois",

  intro: (nomStartup: string): string =>
    `${nomStartup} s'arrête, et ses membres se traitent le même jour pour la même raison. Une phase terminale ne sort personne d'elle-même : c'est vous qui décidez, ligne par ligne. Les lignes cochées d'avance sont celles pour qui la question se pose vraiment ; les autres restent cochables une par une, et la colonne « Ce qui la retient » dit pourquoi elles ne l'étaient pas.`,

  colonneRetient: "Ce qui la retient",

  raison: {
    label: "Raison",
    aide: "Obligatoire. Saisie une fois, elle vaut pour toutes les personnes cochées et sera recopiée au journal sur la trace de chacune, avec votre nom.",
  },

  /**
   * Les trois gestes ne s'enchaînent pas. Déclarer quelqu'un hors incubateur ne ferme
   * aucun constat, et l'écran le dit : sans cette phrase, une file restée pleine
   * derrière un traitement qu'on croit terminé passerait pour une panne.
   */
  sortie: {
    bouton: "Les déclarer hors incubateur",
    recapitulatif: "Déclarées hors incubateur",
  },
  depart: {
    bouton: "Ouvrir leurs dossiers de départ",
    recapitulatif: "Dossiers de départ",
  },
  cloture: {
    /**
     * Le titre vient de la table des constats et ne se recopie pas : le bouton, la
     * colonne qu'il vide et la file `/constats` nomment le même constat, et trois
     * chaînes écrites à la main finissent par en nommer trois.
     */
    bouton: (nombre: number): string =>
      `Clore leurs constats « ${LIBELLE_CONSTAT.INACTIVE_STARTUP.titre} » (${nombre})`,
    recapitulatif: "Constats clos",
  },

  ceQueLaSortieNeFaitPas:
    "Déclarer quelqu'un hors incubateur ne coupe aucun accès et ne ferme aucun constat : la collecte de la nuit le reconstatera. C'est le troisième bouton qui vide la file, et il se signe à part.",

  traces:
    "Chaque personne a sa propre trace au journal, et celles de ce lot s'y retrouvent ensemble.",
} as const;
