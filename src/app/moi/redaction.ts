import type { SystemeMuetVu } from "@/lib/espace-perso";

/**
 * Les phrases de l'espace perso, sorties de l'écran pour être relues.
 *
 * Ce qui se pose ici est ce qui porte une garantie sur ce que l'outil sait ou fera, pas
 * chaque mot de l'écran. Deux d'entre elles qualifient un vide, et un vide non qualifié
 * se lit comme une absence d'accès.
 */

function enumeration(mots: readonly string[]): string {
  return new Intl.ListFormat("fr", { type: "conjunction" }).format(mots);
}

export const MES_COMPTES = {
  titre: "Vos comptes sur les systèmes couverts",

  /**
   * Aucune fiche à ce nom, et le référentiel n'a jamais été lu. Ne dit pas que le
   * référentiel n'a pas été lu, la bannière du haut le disant déjà.
   */
  jamaisCollecte:
    "Aucune fiche ne peut porter vos comptes avant la première collecte du référentiel des personnes.",

  /** Aucune fiche à ce nom, alors que le référentiel a été lu. */
  ficheInconnue:
    "Aucune fiche suivie ici ne porte votre identifiant. Vos comptes sur les systèmes couverts ne peuvent donc pas vous être rattachés. Demandez à l'équipe transverse de l'incubateur de créer votre fiche.",

  /**
   * Ce que la liste énumère est ce qui a été lu **dans les délais**, et rien d'autre. Un
   * système en échec ou périmé en est absent sans n'avoir jamais été lu, si bien qu'une
   * phrase qui le dirait serait fausse dès la première collecte ratée. Ce qui manque à
   * chacun, l'alerte des muets le nomme juste au-dessus.
   */
  aucunCompte: (observes: readonly string[]): string =>
    observes.length === 0
      ? "Aucun système couvert n'a été lu dans les délais. Cette liste ne dit rien des accès que vous détenez."
      : `Aucun compte ne vous est rattaché sur les systèmes lus dans les délais (${enumeration(observes)}).`,

  /**
   * L'invariant du dépôt dit à voix haute plutôt que dissimulé. Un rattachement non sûr
   * ne produit aucune révocation, et la personne est la mieux placée pour le confirmer
   * ou le démentir. La conséquence se dit une fois sous le tableau, la marque de la
   * ligne restant courte pour ne pas la répéter autant qu'il y a de comptes.
   */
  rattachementIncertain: "Rattaché sans preuve",
  consequenceDuRattachementIncertain:
    "Un compte rattaché sans preuve ne sera coupé à votre départ qu'une fois le rattachement confirmé par l'équipe transverse de l'incubateur.",

  disparu: (quand: string): string => `Disparu du système le ${quand}`,

  /**
   * Ce que la liste vaut quand tout ce qui est attendu a bien été lu. La seconde phrase
   * est la réserve qui reste vraie même alors : un compte isolé se lit sur le système,
   * et il n'est rattaché à personne.
   */
  toutEstLu: (observes: readonly string[]): string =>
    `Systèmes lus dans les délais ${enumeration(observes)}. Un compte que rien ne rattache à votre fiche n'apparaît pas ici.`,

  muets: {
    titre: (combien: number): string =>
      combien === 1
        ? "Un système couvert n'est pas observé"
        : `${combien} systèmes couverts ne sont pas observés`,
    /**
     * Ce que le silence emporte, et pas un mot de plus. Promettre que rien de ces
     * systèmes n'apparaît se lirait juste au-dessus d'une ligne qui en vient : ce qui a
     * été vu reste montré, c'est ce qui a bougé depuis qui manque.
     */
    entete: "Un compte ouvert depuis leur dernière lecture n'apparaîtrait pas ci-dessous.",
    raison: (muet: SystemeMuetVu): string => {
      if (muet.raison === "echec") {
        return "a échoué à la dernière collecte";
      }
      if (muet.raison === "non-lu") {
        return "n'a jamais été lu, faute de collecte ou d'accès configuré";
      }
      return `n'a pas été lu depuis ${muet.heures} heures`;
    },
  },

  /**
   * La fraîcheur du référentiel, et elle seule. Celle des systèmes cibles est une autre
   * question, portée par l'alerte des muets : une bannière qui daterait l'écran entier
   * annoncerait des comptes périmés au moment même où leurs systèmes viennent d'être
   * lus, et l'inverse le jour où le référentiel seul est frais.
   */
  perimetre: {
    titre: "Le référentiel des personnes n'est plus à jour",
    description: (heures: number | null, seuil: number): string =>
      heures === null
        ? "Le référentiel des personnes n'a jamais été lu. Votre fiche et vos dossiers ne viennent d'aucune collecte."
        : `La dernière lecture du référentiel des personnes remonte à ${heures} heures, au-delà des ${seuil} heures admises. Votre fiche et vos dossiers datent de ce moment-là.`,
  },
} as const;
