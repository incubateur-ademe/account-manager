import type { Appartenance } from "@/core/appartenance";
import { surchargeSuperflue } from "@/core/appartenance";
import type { Fraicheur } from "@/core/collecte";
import type { ConstatKind } from "@/core/constat";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { LIBELLE_STATUT, type Statut } from "@/core/statut";

import { expliquerStatut, type Seuils, STATUT_A_TRAITER } from "./libelles";

/**
 * Un geste que la consigne nomme et que cet écran sait faire. Il se nomme ici et se
 * rend ailleurs : un motif reste une donnée, sans quoi ce module cesserait d'être
 * calculable sans rendu.
 */
export type Geste =
  | { nom: "rattacher-startup" }
  | {
      nom: "clore";
      dedupKey: string;
      /** Les trois textes que la modale de clôture rappelle, portés une seule fois. */
      titre: string;
      explication: string;
      consigne: string;
    };

export interface ConstatOuvert {
  id: string;
  kind: string;
  dedupKey: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** Le compte que le constat désigne, quand il en désigne un. */
  compte: { provider: string; handle: string } | null;
}

export interface ConstatFerme {
  kind: string;
  /** Renseigné quand un humain a clos, laissé nul par une réconciliation. */
  closedBy: string | null;
}

export interface MotifDAction {
  cle: string;
  severite: "error" | "warning" | "info";
  titre: string;
  description: string;
  /** Ce que la consigne nomme et que cet écran sait faire, dans l'ordre de lecture. */
  gestes?: readonly Geste[];
  /** Où le geste se fait, quand il ne se fait pas ici. */
  lien?: { href: string; libelle: string };
}

const SEVERITE_CONSTAT = { HIGH: "error", MEDIUM: "warning", LOW: "info" } as const;

export function motifsDesConstats(
  ouverts: readonly ConstatOuvert[],
  dossierVivant: string | null,
): MotifDAction[] {
  return ouverts.map((constat) => {
    const libelle = LIBELLE_CONSTAT[constat.kind as ConstatKind];
    const titre = libelle?.titre ?? constat.kind;
    const consigne = libelle?.action ?? "";

    const gestes: Geste[] = [];
    if (constat.kind === "INACTIVE_STARTUP") {
      gestes.push({ nom: "rattacher-startup" });
    }
    gestes.push({
      nom: "clore",
      dedupKey: constat.dedupKey,
      titre,
      explication: libelle?.explication ?? "",
      consigne,
    });

    // Le lien ne mène plus à la file, qui n'offrait que ce que le bloc offre
    // désormais. Il ne reste que pour le constat dont le geste vit dans un dossier,
    // et seulement quand ce dossier existe : une action déclarée sans effet se
    // reprend là où elle a été pointée.
    const versLeDossier =
      constat.kind === "OVERDUE_MANUAL_ACTION" && dossierVivant !== null
        ? { href: `/departs/${dossierVivant}`, libelle: "Ouvrir le dossier de départ en cours" }
        : null;

    return {
      cle: `constat-${constat.id}`,
      severite: SEVERITE_CONSTAT[constat.severity],
      titre,
      // Nommer le compte, et seulement quand le constat en désigne un : un libellé
      // calculé n'affirme que ce que son calcul établit.
      description: constat.compte
        ? `${consigne} Il s'agit du compte ${constat.compte.handle} sur ${constat.compte.provider}.`
        : consigne,
      gestes,
      ...(versLeDossier ? { lien: versLeDossier } : {}),
    };
  });
}

export interface EtatDeLaFiche {
  statut: Statut;
  seuils: Seuils;
  appartenance: Appartenance;
  libelleSansSurcharge: string;
  ouverts: readonly ConstatOuvert[];
  /** Ce qui a déjà été traité, et qui ne doit pas revenir sous un autre nom. */
  fermes: readonly ConstatFerme[];
  fraicheur: Fraicheur;
  toutesStartupsTerminees: boolean;
  /** Rattachée par une équipe : un titre qui ne passe par aucune startup. */
  parEquipe: boolean;
  /** Le dossier de départ ouvert sur cette personne, unique par construction. */
  dossierVivant: string | null;
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

  // Le statut « Sorti du référentiel » et le constat de sortie naissent du même
  // `vanishedAt`. Les afficher tous les deux mettrait deux lignes presque
  // identiques en tête de bloc, là où le constat dit déjà tout et dit en plus quoi
  // faire. Le constat prime, comme partout ailleurs ici.
  //
  // Une sortie close à la main compte autant qu'une sortie constatée. Sans elle, clore
  // depuis cette page ferait paraître à la place du constat une alerte qui affirme que
  // rien ne dit ce que ses accès sont devenus, au moment précis où quelqu'un vient de
  // l'écrire et de le signer. Le verrou de clôture dit que la situation est traitée,
  // et un libellé n'affirme que ce que son calcul établit.
  const sortieDejaConstatee =
    etat.statut === "SORTI" &&
    (etat.ouverts.some((constat) => constat.kind === "SCOPE_EXIT") ||
      etat.fermes.some((constat) => constat.kind === "SCOPE_EXIT" && constat.closedBy !== null));

  if (graviteStatut && !sortieDejaConstatee) {
    motifs.push({
      cle: "statut",
      severite: graviteStatut,
      titre: LIBELLE_STATUT[etat.statut],
      description: expliquerStatut(etat.statut, etat.seuils),
    });
  }

  motifs.push(...motifsDesConstats(etat.ouverts, etat.dossierVivant));

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
      // Le même geste que le constat qui dit la même chose : deux routes, une seule
      // destination. Pas de clôture, celui-ci n'est pas un constat.
      gestes: [{ nom: "rattacher-startup" }],
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
      // La phrase qui dit ce que serait l'appartenance sans la décision vit sous
      // Situation, avec le libellé qu'elle explique. La redire ici la mettrait deux
      // fois sur le même écran.
      description: `Décidée par ${surcharge.par}, contre ce que la collecte constate. C'est à trancher.`,
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
