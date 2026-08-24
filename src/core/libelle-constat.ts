import type { ConstatKind } from "./constat";

interface Libelle {
  titre: string;
  explication: string;
  action: string;
}

/**
 * Les libellés se recalculent à l'affichage plutôt que d'être figés en base : un
 * constat est réconcilié à chaque collecte, un texte gravé au moment de l'ouverture
 * décrirait une situation qui a pu changer depuis.
 */
export const LIBELLE_CONSTAT: Record<ConstatKind, Libelle> = {
  OVERDUE_MANUAL_ACTION: {
    titre: "Action déclarée faite, mais sans effet observé",
    explication:
      "Une étape a été pointée comme faite, et la lecture suivante du système dit le contraire : le compte est toujours là après un départ, ou toujours absent après une arrivée. L'outil n'exécute rien lui-même : une case cochée vaut parole, pas preuve, et c'est la collecte qui tranche. Soit le geste a été fait ailleurs qu'attendu, soit il ne l'a pas été.",
    action: "Reprendre l'étape sur le système, ou corriger le pointage s'il était erroné.",
  },
  SCOPE_EXIT: {
    titre: "Sortie du référentiel",
    explication:
      "Cette personne a disparu du référentiel de l'incubateur, et rien ici ne dit ce que ses accès sont devenus. Le référentiel amont retire des équipes les membres dont la mission est terminée, ce qui la rend invisible au moment précis où il faut agir.",
    action: "Vérifier ses accès et les couper, puis clore ce constat.",
  },
  INACTIVE_STARTUP: {
    titre: "Startups toutes terminées",
    explication:
      "Toutes les startups qui portent son rattachement sont dans une phase terminale, alors que son échéance ne la signale pas encore comme partie. Plus aucune startup vivante de l'incubateur ne justifie ses accès.",
    action: "Confirmer son rattachement réel, ou retirer les accès devenus sans objet.",
  },
  ORPHAN: {
    titre: "Compte d'une personne partie",
    explication:
      "Ce compte appartient à quelqu'un qui a quitté le référentiel de l'incubateur, et il est toujours actif sur le système. C'est un accès qui survit à son motif : le rattachement repose sur une preuve, pas sur une ressemblance.",
    action: "Couper cet accès, puis clore ce constat.",
  },
  UNREGISTERED: {
    titre: "Compte sans détenteur connu",
    explication:
      "Ce compte existe sur un système de l'incubateur sans qu'aucune personne suivie ni aucun compte de service ne s'en réclame. Le plus souvent il manque une fiche, plutôt qu'il ne faut retirer un accès : traiter ce cas comme un départ reviendrait à couper quelqu'un en poste, précisément parce qu'on ne le connaît pas.",
    action: "Le rattacher à une personne ou à un compte de service, ou créer la fiche qui manque.",
  },
};
