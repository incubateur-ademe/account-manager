import { describe, expect, it } from "vitest";

import { lireDeclaration, REVUE_PAR_DEFAUT } from "./compte-de-service";

/**
 * Cette lecture existe pour être la même aux deux endroits qui déclarent un compte
 * machine : l'écran des comptes de service, et la file des comptes isolés quand un
 * compte constaté fait découvrir la machine qui le détient. La régression que ce
 * scénario épingle n'est pas un refus manquant, c'est la divergence : un écran qui
 * accepterait ce que l'autre refuse laisserait passer, par la porte la moins fréquentée,
 * exactement ce que la première garde.
 */

const COMPLETE = {
  key: "bot-de-deploiement",
  label: "Bot de déploiement",
  purpose: "Déploie les applications de l'incubateur",
  ownerUsername: "claire.durand",
  reviewEveryDays: REVUE_PAR_DEFAUT,
};

describe("la saisie d'un compte de service", () => {
  it("passe entière et détourée, et se refuse dès qu'un des quatre dits manque", () => {
    // Given une saisie complète, dont les bords portent les espaces qu'un copier-coller
    // emporte toujours.
    const lu = lireDeclaration({
      ...COMPLETE,
      key: "  bot-de-deploiement  ",
      ownerUsername: " claire.durand ",
    });

    // Then elle passe, détourée : une clé qui garde son espace ne se retrouve plus, ni
    // par le rattachement d'un compte isolé, ni par qui la cherche dans la liste.
    expect(lu).toEqual({ declaration: COMPLETE });

    // Then chacun des quatre champs dits est exigé, y compris quand il n'est fait que
    // d'espaces : un libellé vide donne une ligne qu'on ne sait plus identifier.
    for (const vide of ["key", "label", "purpose"] as const) {
      expect(lireDeclaration({ ...COMPLETE, [vide]: "   " })).toHaveProperty("erreur");
    }

    // Then le propriétaire a son propre refus, et il dit pourquoi : c'est lui, avec la
    // revue, qui rend un accès permanent non humain gouvernable. Un message commun
    // laisserait croire à un champ administratif de plus.
    const sansProprietaire = lireDeclaration({ ...COMPLETE, ownerUsername: "" });
    expect(sansProprietaire).toHaveProperty("erreur");
    expect("erreur" in sansProprietaire && sansProprietaire.erreur).toContain("répond");
  });

  it("refuse toute revue qui ne se compterait pas en jours entiers positifs", () => {
    // Given les trois formes qu'une périodicité prend quand la saisie a dérapé : zéro,
    // négative, ou non entière. Un champ de nombre vide rend NaN, pas une absence.
    for (const revue of [0, -1, 1.5, Number.NaN]) {
      // Then elle est refusée. Zéro est le cas qui coûte : il poserait une revue due
      // chaque jour, un badge rouge que rien ne peut plus éteindre, et un signal qui ne
      // s'éteint jamais finit par ne plus rien signaler.
      expect(lireDeclaration({ ...COMPLETE, reviewEveryDays: revue })).toHaveProperty("erreur");
    }

    // Then un seul jour passe : c'est court, mais c'est une décision, pas une erreur de
    // saisie, et rien ici n'a autorité pour dire combien de temps un bot se garde.
    expect(lireDeclaration({ ...COMPLETE, reviewEveryDays: 1 })).toEqual({
      declaration: { ...COMPLETE, reviewEveryDays: 1 },
    });
  });
});
