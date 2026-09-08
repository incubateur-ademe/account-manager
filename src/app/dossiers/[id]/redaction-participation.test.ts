import { describe, expect, it } from "vitest";

import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { DUREE_MAX_JOURS } from "@/core/participation";

import {
  aideDuCanal,
  LIBELLE_DROITS,
  LIBELLE_OCTROI,
  retientLaModale,
} from "./redaction-participation";

/**
 * L'écran des droits n'est rendu par aucun harnais, et cinq phrases fausses y sont déjà
 * parties, dont trois affirmaient une issue que le code ne tient pas toujours. Ce qui est
 * épinglé ici est ce qui porte une garantie ou une conséquence pour qui saisit : ni la
 * ponctuation, ni les libellés qui ne promettent rien.
 */

/** Les phrases seules : un nom de champ n'est pas du texte que quelqu'un lit. */
function phrases(valeur: unknown): string[] {
  if (typeof valeur === "string") {
    return [valeur];
  }
  if (valeur === null || typeof valeur !== "object") {
    return [];
  }
  return Object.values(valeur).flatMap(phrases);
}

/** Les phrases composées entrent à la main : une fonction ne se parcourt pas. */
const TOUTE_LA_COPIE = [
  ...phrases(LIBELLE_DROITS),
  ...phrases(LIBELLE_OCTROI),
  aideDuCanal(["beta.gouv.fr"]),
  LIBELLE_DROITS.ferme(LIBELLE_DOSSIER.OFFBOARDING.droitPossibleSur),
  LIBELLE_DROITS.ferme(LIBELLE_DOSSIER.ONBOARDING.droitPossibleSur),
  LIBELLE_DROITS.canal.absentIssue(true),
  LIBELLE_DROITS.canal.absentIssue(false),
  LIBELLE_DROITS.canal.declare("lead@exemple.org"),
  LIBELLE_DROITS.canal.deduit("lead@exemple.org"),
].join(" ");

describe("ce que l'écran des droits dit à qui saisit", () => {
  it("dit le geste, ce qu'il y a à saisir, et les bornes qu'on ne peut pas deviner", () => {
    // Given le geste ouvre un accès à quelqu'un, sur un dossier qui est déjà ouvert
    // puisqu'on le regarde
    // Then rien ne se lit comme une action sur le dossier lui-même, et le bouton de
    // soumission répond au retrait de la liste
    expect(LIBELLE_OCTROI.declencheur).toBe("Laisser quelqu'un d'autre agir");
    expect(LIBELLE_OCTROI.titre).toBe("Laisser quelqu'un d'autre agir sur ce dossier");
    expect(LIBELLE_OCTROI.soumettre).toBe("Accorder ce droit");
    expect(LIBELLE_DROITS.retrait.soumettre).toBe("Retirer ce droit");
    expect(TOUTE_LA_COPIE).not.toContain("Ouvrir ce dossier");

    // Then ce que le geste produit pour la personne se dit avant les champs, et il ne
    // promet pas plus que ce que l'écran du participant tient : celui-là nomme la
    // personne concernée et le sens du dossier dès son titre, listes vides comprises
    expect(LIBELLE_OCTROI.effet).toBe(
      "Elle verra de quel dossier il s'agit et qui il concerne, les étapes qui lui reviennent et celles qu'elle doit signer. Le reste ne lui est pas montré.",
    );
    expect(LIBELLE_OCTROI.effet).not.toContain("rien d'autre de ce dossier");

    // Then les choses qu'un opérateur ne peut pas deviner sont dites là où il saisit :
    // un identifiant d'opérateur sera refusé, et la durée a un plafond
    expect(LIBELLE_OCTROI.identifiant.aide).toBe(
      "Son identifiant beta.gouv, ou celui que sa fiche porte ici. Un identifiant d'opérateur sera refusé.",
    );
    expect(LIBELLE_OCTROI.duree.aide).toBe(
      `${DUREE_MAX_JOURS} jours au maximum. Passé ce terme, l'accès s'arrête de lui-même, et vous pourrez le redonner.`,
    );

    // Then le refus du champ de durée nomme la borne au lieu de réclamer ce qui est
    // déjà là : le navigateur le sert sur toutes les violations, dépassement compris,
    // et « Indiquez une durée » répondait à qui venait d'en indiquer une
    expect(LIBELLE_OCTROI.duree.manquant).toBe(
      `Indiquez une durée de 1 à ${DUREE_MAX_JOURS} jours.`,
    );

    // Then l'adresse dit quand la renseigner, et ne promet pas que le lien part sur la
    // fiche : aucune fiche que la collecte entretient n'offre d'adresse servable, et
    // c'est le cas de toutes celles qui viennent de l'espace-membre
    expect(LIBELLE_OCTROI.canal.manquante).toBe(
      "Renseignez-la pour qui n'a pas de compte beta.gouv. Sans elle, le lien part sur l'adresse de contact de sa fiche, quand l'outil peut la servir.",
    );

    // Then le motif dit où il finit, ce qui est la seule chose que sa saisie engage
    expect(LIBELLE_OCTROI.motif.aide).toBe(
      "En une phrase. Elle s'affichera ici et restera au journal, avec votre nom.",
    );

    // Then aucun texte d'aide n'explique la conception de l'outil, et le vocabulaire de
    // l'octroi ne ressort jamais à l'écran
    expect(TOUTE_LA_COPIE.toLowerCase()).not.toContain("octroy");
    expect(TOUTE_LA_COPIE.toLowerCase()).not.toContain("octroi");
    expect(TOUTE_LA_COPIE).not.toContain("canal");
  });

  it("énonce les domaines menacés au lieu de les recopier, et se tait quand il n'y en a pas", () => {
    // Given une politique qui déclare deux domaines coupés au départ
    // When l'aide du champ d'adresse se compose
    // Then ils se lisent comme une phrase, et non comme une liste jointe par des virgules
    expect(aideDuCanal(["beta.gouv.fr", "ademe.fr"])).toBe(
      `${LIBELLE_OCTROI.canal.manquante} Évitez une adresse en beta.gouv.fr ou ademe.fr : ces boîtes se ferment au départ de leur titulaire.`,
    );
    expect(aideDuCanal(["beta.gouv.fr", "ademe.fr", "exemple.org"])).toContain(
      "beta.gouv.fr, ademe.fr ou exemple.org",
    );
    expect(aideDuCanal(["beta.gouv.fr"])).toContain("Évitez une adresse en beta.gouv.fr :");

    // Then une politique qui n'en déclare aucun ne laisse pas une phrase à trou
    expect(aideDuCanal([])).toBe(LIBELLE_OCTROI.canal.manquante);
  });

  it("dit de chaque droit en cours où le lien part, ce qui va le couper, et par où sortir", () => {
    // Given un droit dont l'adresse a été déclarée au geste, et un droit dont l'adresse
    // est lue sur la fiche
    // Then les deux se distinguent, et le second dit qu'il n'est pas garanti
    expect(LIBELLE_DROITS.canal.declare("lead@exemple.org")).toBe(
      "Le lien de connexion part sur lead@exemple.org, déclarée avec ce droit.",
    );
    expect(LIBELLE_DROITS.canal.deduit("lead@exemple.org")).toBe(
      "Le lien de connexion part sur lead@exemple.org, lue sur sa fiche : personne ne l'a choisie pour ce dossier, et une collecte peut la remplacer.",
    );

    // Given un droit dont plus rien ne résout l'adresse, sur une personne qui porte un
    // identifiant beta.gouv réel
    // Then les deux issues se disent, la seconde n'engageant l'outil à rien
    expect(`${LIBELLE_DROITS.canal.absent} ${LIBELLE_DROITS.canal.absentIssue(false)}`).toBe(
      "Aucune adresse où envoyer le lien. Redonnez ce droit en déclarant une adresse, ou dites-lui de se connecter avec son identifiant beta.gouv.",
    );

    // Given le même droit, mais sur une fiche dont l'identifiant a été fabriqué ici
    // Then la seconde issue disparaît : aucun espace-membre ne connaît cet identifiant,
    // et c'est précisément la personne pour qui rien d'autre ne marche
    expect(`${LIBELLE_DROITS.canal.absent} ${LIBELLE_DROITS.canal.absentIssue(true)}`).toBe(
      "Aucune adresse où envoyer le lien. Son identifiant n'existe que dans cet outil : redonnez ce droit en déclarant une adresse.",
    );
    expect(LIBELLE_DROITS.canal.absentIssue(true)).not.toContain("identifiant beta.gouv");

    // Then la boîte qu'un départ ferme se dit aussi dans la liste, et pas seulement au
    // moment du geste : la modale se referme, la page reste
    expect(`${LIBELLE_DROITS.canal.menace} ${LIBELLE_DROITS.canal.menaceEffet}`).toBe(
      "Cette boîte se ferme au départ de son titulaire. Le lien cessera d'y arriver, sans doute avant le terme du droit.",
    );

    // Given un dossier qui ne s'ouvre plus à personne, dans chacun des deux sens
    // Then le refus nomme ce qu'il refuse, et s'accorde avec lui : le composant ignorait
    // le sens du dossier, si bien qu'une arrivée close lisait qu'un droit ne se donne
    // que sur un départ
    expect(LIBELLE_DROITS.ferme(LIBELLE_DOSSIER.OFFBOARDING.droitPossibleSur)).toBe(
      "Ce dossier ne s'ouvre plus à personne : un droit ne se donne que sur un départ décidé et pas encore soldé.",
    );
    expect(LIBELLE_DROITS.ferme(LIBELLE_DOSSIER.ONBOARDING.droitPossibleSur)).toBe(
      "Ce dossier ne s'ouvre plus à personne : un droit ne se donne que sur une arrivée décidée et pas encore soldée.",
    );
  });

  it("retient la modale sur l'avertissement autant que sur le refus, et la ferme sur le succès muet", () => {
    // Given l'octroi peut rendre un avertissement en même temps qu'un succès : le canal
    // choisi est une boîte que le départ va couper
    // When cet état revient du serveur
    // Then quelque chose retient la modale ouverte, sans quoi la seule phrase qui dise
    // cela partirait avec elle
    expect(retientLaModale({ avertissement: LIBELLE_OCTROI.canalMenace })).toBe(
      LIBELLE_OCTROI.canalMenace,
    );

    // Then les deux avertissements disent d'abord que le droit est posé : retenue sans
    // cela, la modale laisserait lire un refus là où le geste a abouti
    for (const phrase of [LIBELLE_OCTROI.canalMenace, LIBELLE_OCTROI.sansCanal]) {
      expect(phrase).toMatch(/^Le droit est accordé/u);
    }
    expect(LIBELLE_OCTROI.canalMenace).toBe(
      "Le droit est accordé. Le lien part sur une boîte que l'incubateur ferme au départ de son titulaire : elle cessera de répondre, sans doute avant le terme du droit. Redonnez ce droit avec une autre adresse dès qu'elle est connue.",
    );

    // Then le droit que rien n'atteint se dit aussi, et c'est le seul cas où l'absence
    // d'adresse est une anomalie : un identifiant beta.gouv réel est une porte, un
    // identifiant fabriqué ici n'en est pas une
    expect(LIBELLE_OCTROI.sansCanal).toBe(
      "Le droit est accordé, mais personne ne peut lui envoyer de lien de connexion : sa fiche n'offre aucune adresse que l'outil puisse servir, et son identifiant n'existe que dans cet outil. Redonnez ce droit en déclarant une adresse.",
    );
    expect(retientLaModale({ avertissement: LIBELLE_OCTROI.sansCanal })).toBe(
      LIBELLE_OCTROI.sansCanal,
    );

    // Then un refus la retient de la même façon, l'opérateur devant le lire là où il
    // vient de saisir
    expect(retientLaModale({ erreur: "Aucune fiche ne porte cet identifiant." })).toBe(
      "Aucune fiche ne porte cet identifiant.",
    );

    // Then le succès qui n'a rien à dire la ferme, et l'état initial ne la ferme pas
    // avant d'avoir servi
    expect(retientLaModale({})).toBeUndefined();
    expect(retientLaModale(null)).toBeUndefined();
  });
});
