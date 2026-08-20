import type { Appartenance } from "@/core/appartenance";
import { surchargeSuperflue } from "@/core/appartenance";
import type { Fraicheur } from "@/core/collecte";
import { LIBELLE_STATUT, type Statut } from "@/core/statut";

import type { ConstatOuvert, MotifDAction } from "./CeQuiAppelleUneAction";
import { motifsDesConstats } from "./CeQuiAppelleUneAction";
import { expliquerStatut, type Seuils, STATUT_A_TRAITER } from "./libelles";

export interface EtatDeLaFiche {
  statut: Statut;
  seuils: Seuils;
  appartenance: Appartenance;
  libelleSansSurcharge: string;
  ouverts: readonly ConstatOuvert[];
  fraicheur: Fraicheur;
  toutesStartupsTerminees: boolean;
  /** Rattachée par une équipe : un titre qui ne passe par aucune startup. */
  parEquipe: boolean;
}

/**
 * Ce qui appelle un geste sur cette fiche, dans l'ordre où on veut le lire.
 *
 * Rendre une liste vide est un résultat, pas un cas limite : c'est ce qui fait
 * disparaître le bloc, et l'absence de bloc dit qu'il n'y a rien à faire.
 */
export function motifsDAction(etat: EtatDeLaFiche): MotifDAction[] {
  const motifs: MotifDAction[] = [];
  const graviteStatut = STATUT_A_TRAITER[etat.statut];

  if (graviteStatut) {
    motifs.push({
      cle: "statut",
      severite: graviteStatut,
      titre: LIBELLE_STATUT[etat.statut],
      description: expliquerStatut(etat.statut, etat.seuils),
    });
  }

  motifs.push(...motifsDesConstats(etat.ouverts));

  if (etat.fraicheur.perimee) {
    motifs.push({
      cle: "fraicheur",
      severite: "warning",
      titre: "Ce que montre cette fiche n'est plus frais",
      description:
        etat.fraicheur.heures === null
          ? "Aucune collecte n'a jamais eu lieu : cette fiche ne reflète aucune observation."
          : `Dernière collecte lancée il y a ${etat.fraicheur.heures} heures. Sa situation a pu changer depuis.`,
    });
  }

  // Doublon écarté : quand le constat est déjà levé, il porte la même chose et la
  // porte mieux, avec sa gravité et sa date.
  const constatDejaLeve = etat.ouverts.some((constat) => constat.kind === "INACTIVE_STARTUP");
  if (etat.toutesStartupsTerminees && !etat.parEquipe && !constatDejaLeve) {
    motifs.push({
      cle: "startups-terminees",
      severite: "warning",
      titre: "Toutes ses startups sont dans une phase terminale",
      description:
        "Plus aucune startup vivante de l'incubateur ne porte son rattachement. Confirmer son rattachement réel, ou retirer les accès devenus sans objet.",
    });
  }

  const surcharge = etat.appartenance.surcharge;
  if (surcharge !== null && !surchargeSuperflue(etat.appartenance)) {
    motifs.push({
      cle: "surcharge",
      severite: "warning",
      titre:
        surcharge.sens === "EXCLUDE"
          ? "Déclarée hors incubateur, contre ce que portent ses rattachements"
          : "Forcée dans l'incubateur, faute de rattachement qui l'y place",
      description: `Décidée par ${surcharge.par}. Sans cette décision, elle serait « ${etat.libelleSansSurcharge} » d'après ses rattachements en cours.`,
    });
  }

  // Deux autorités qui se contredisent, et une seule visible ici. Sans cette ligne,
  // un opérateur croirait avoir sorti quelqu'un que la politique continue de
  // réclamer à chaque collecte.
  const sansSurcharge = etat.appartenance.sansSurcharge;
  if (
    surcharge?.sens === "EXCLUDE" &&
    (sansSurcharge === "EQUIPE" || sansSurcharge === "EQUIPE_ET_STARTUP")
  ) {
    motifs.push({
      cle: "sortie-contre-equipe",
      severite: "warning",
      titre: "Deux autorités se contredisent",
      description:
        "Elle relève pourtant d'une équipe de l'incubateur, et la collecte le réécrira à chaque passage. Pour que la sortie soit portée des deux côtés, il reste à la retirer de scope.transverse dans la politique.",
    });
  }

  if (etat.appartenance.sansStartupConnue) {
    motifs.push({
      cle: "sans-startup",
      severite: "warning",
      titre: "Un rattachement par startup, mais aucune startup connue",
      description:
        "La dernière collecte n'en a trouvé aucune. Conclure d'une collecte peut-être tronquée reviendrait à la sortir sur du vide : c'est la collecte qu'il faut regarder avant elle.",
    });
  }

  return motifs;
}
