import { describe, expect, it } from "vitest";

import { LIBELLE_ETAT_COLLECTE } from "./lexique";

/**
 * Deux écrans rendaient la conclusion d'une collecte par sa valeur brute, `OK` ou
 * `PARTIAL` dans un badge français. Ce que cette table promet à la place n'est pas une
 * traduction de confort : « complète » veut dire que les disparitions ont pu être
 * datées, « incomplète » qu'une partie a pu rester non datée, sans qu'aucune ne soit
 * exclue, et c'est un invariant du dépôt. La négation absolue serait fausse : un
 * passage se dégrade en « incomplète » après avoir daté ce qu'il tenait.
 */
describe("ce que l'écran dit d'une collecte", () => {
  it("nomme chacune de ses quatre conclusions en français, et jamais par sa valeur brute", () => {
    // Given les quatre conclusions qu'une collecte peut atteindre. Qu'il n'en manque
    // aucune est tenu par le type de la table, exhaustif sur l'énuméré de la base ; ce
    // qu'aucun type ne tient, et qui se vérifie ici, c'est ce que chacune promet.
    const conclusions = Object.entries(LIBELLE_ETAT_COLLECTE);
    expect(conclusions).toHaveLength(4);

    for (const [conclusion, dit] of conclusions) {
      // Then chacune a de quoi remplir un badge et de quoi remplir une phrase, et les
      // deux sont du français : sans cela, un écran retomberait sur la valeur brute,
      // qui est exactement le défaut que cette table ferme.
      expect(dit.libelle.length).toBeGreaterThan(0);
      expect(dit.explication.length).toBeGreaterThan(0);
      expect(dit.libelle).not.toContain(conclusion);
      expect(dit.explication).not.toContain(conclusion);

      // Then la phrase se lit seule, hors du badge qu'elle suit : le tableau de bord la
      // sert sans badge, et une explication qui commencerait par « : » n'y dirait rien.
      expect(dit.explication).toMatch(/^[A-ZÀ-Ü]/u);
      expect(dit.explication.trimEnd()).toMatch(/\.$/u);
    }
  });

  it("ne promet la datation des disparitions qu'à la collecte qui l'a faite, et ne la nie pas en bloc", () => {
    // Given une conclusion qui ne se prend pas passage par passage mais moitié par
    // moitié : un garde-fou peut refuser la chute des ressources pendant que celle des
    // identités passe, auquel cas les identités disparues sont bien datées alors que le
    // passage entier vaut « incomplète ».

    // Then la complète affirme la datation, et c'est la seule à pouvoir l'affirmer.
    expect(LIBELLE_ETAT_COLLECTE.OK.explication).toMatch(/dispariti/u);
    expect(LIBELLE_ETAT_COLLECTE.OK.explication).not.toMatch(/aucune|rien/u);

    // Then l'incomplète ne se tait pas, mais ne nie rien en bloc non plus. « Aucune
    // disparition n'a été datée » est une phrase que ce chemin dément, et une négation
    // absolue est le genre d'affirmation qu'un écran ne peut pas rattraper : elle se dit
    // donc au possible, ce qui est exactement ce que le passage garantit.
    expect(LIBELLE_ETAT_COLLECTE.PARTIAL.explication).not.toMatch(/aucune dispariti/u);
    expect(LIBELLE_ETAT_COLLECTE.PARTIAL.explication).toMatch(/ont pu rester non datées/u);
    expect(LIBELLE_ETAT_COLLECTE.PARTIAL.explication).toMatch(/tout n'a pas pu être conclu/u);

    // Then les deux qui n'ont rien lu ne promettent ni ne nient aucune datation : elles
    // n'ont pas regardé, et c'est tout ce qu'elles ont le droit de dire.
    for (const muette of [LIBELLE_ETAT_COLLECTE.FAILED, LIBELLE_ETAT_COLLECTE.SKIPPED]) {
      expect(muette.explication).not.toMatch(/dispariti/u);
    }

    // Then le silence d'un système non lu se dit comme un silence, et non comme un
    // résultat : « zéro compte » et « pas regardé » se ressemblent trait pour trait sur
    // un tableau de nombres, et c'est la confusion que cet outil existe pour lever.
    expect(LIBELLE_ETAT_COLLECTE.SKIPPED.explication).toMatch(/inconnu/u);
  });

  it("range les quatre conclusions par ce qu'elles coûtent, et non par ordre d'apparition", () => {
    // Given le badge que chaque conclusion porte à l'écran.

    // Then seule la collecte complète est rassurante, et l'échec est le seul rouge :
    // une collecte incomplète n'a pas échoué, elle a conclu à moitié, et la peindre en
    // rouge ferait chercher une panne qui n'a pas eu lieu.
    expect(LIBELLE_ETAT_COLLECTE.OK.severite).toBe("success");
    expect(LIBELLE_ETAT_COLLECTE.PARTIAL.severite).toBe("warning");
    expect(LIBELLE_ETAT_COLLECTE.FAILED.severite).toBe("error");

    // Then un système non lu n'est ni une réussite ni une panne : personne n'a regardé.
    expect(LIBELLE_ETAT_COLLECTE.SKIPPED.severite).toBe("info");
  });
});
