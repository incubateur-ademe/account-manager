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
  SCOPE_EXIT: {
    titre: "Sortie du référentiel sans traitement",
    explication:
      "Cette personne a disparu du référentiel de l'incubateur alors que rien n'indique que ses accès ont été coupés. Le référentiel amont retire des équipes les membres dont la mission est terminée, ce qui la rend invisible au moment précis où il faut agir.",
    action: "Vérifier ses accès et les couper, puis clore ce constat.",
  },
  INACTIVE_STARTUP: {
    titre: "Startups toutes terminées",
    explication:
      "Cette personne est encore en mission, mais toutes les startups auxquelles elle est rattachée sont abandonnées ou transférées. Elle ne travaille donc plus sur rien au sein de l'incubateur.",
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
