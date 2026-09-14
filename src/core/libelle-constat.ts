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
      "Une étape a été déclarée faite, et la lecture suivante du système dit le contraire : le compte est toujours là après un départ, ou toujours absent après une arrivée. Une case cochée vaut parole, pas preuve, et c'est la collecte qui tranche. Soit le geste a été fait ailleurs qu'attendu, soit il ne l'a pas été.",
    action:
      "Reprendre l'étape sur le système, ou corriger cette déclaration si elle était erronée.",
  },
  SCOPE_EXIT: {
    titre: "Sortie du référentiel des personnes",
    explication:
      "Cette personne a disparu du référentiel des personnes de l'incubateur, et rien ici ne dit ce que ses accès sont devenus. L'amont retire des équipes les membres dont la mission est terminée : elle devient invisible au moment précis où il faut agir.",
    action: "Vérifier ses accès et les couper, puis clore ce constat.",
  },
  SCOPE_ENTRY: {
    titre: "Arrivée non préparée",
    explication:
      "Cette personne est apparue parmi les personnes suivies sans qu'aucun plan d'arrivée n'ait été exécuté pour elle : ses accès ont été posés ailleurs, ou pas posés du tout. Le jour de son départ, l'outil ne saura pas quoi retirer.",
    action: "Préparer son arrivée, ou clore ce constat en disant ce qui a déjà été fait.",
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
      "Ce compte appartient à quelqu'un qui a quitté le référentiel des personnes de l'incubateur, et il est toujours actif sur le système. C'est un accès qui survit à son motif, et le rattachement de ce compte à cette personne repose sur une preuve, pas sur une ressemblance.",
    action: "Couper cet accès, puis clore ce constat.",
  },
  UNREGISTERED: {
    titre: "Compte sans détenteur connu",
    explication:
      "Ce compte existe sur un système de l'incubateur sans qu'aucune personne suivie ni aucun compte de service ne s'en réclame. Le plus souvent il manque une fiche, plutôt qu'il ne faut retirer un accès : traiter ce cas comme un départ reviendrait à couper quelqu'un en poste, précisément parce qu'on ne le connaît pas.",
    action: "Le rattacher à une personne ou à un compte de service, ou créer la fiche qui manque.",
  },
};
