import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `server-only` lève à l'import hors d'un composant serveur, et c'est tout ce qu'il
// fait : Next le remplace par un module vide quand il compile pour le serveur, ce que
// cette ligne rejoue. Sans elle, le module ne s'importe pas et la garantie ci-dessous
// n'aurait aucun étage où se tenir.
vi.mock("server-only", () => ({}));

const { DsfrHead, getHtmlAttributes } = await import("./server");

/**
 * Ce que la tête doit contenir pour que le thème du lecteur survive au premier rendu.
 *
 * Le schéma de couleurs ne vient pas de la feuille de style : il vient d'un script que
 * le système de design pose dans le `head` et qui, avant toute peinture, lit le choix
 * enregistré puis écrit `data-fr-scheme` et `data-fr-theme` sur la racine. Ce script
 * n'est pas une optimisation, c'est le seul porteur du thème au chargement : absent, la
 * page s'affiche en clair chez quelqu'un qui a choisi le sombre, et rien ne le signale,
 * ni erreur, ni test.
 *
 * Épinglé au plus bas étage qui sache le tenir, une chaîne rendue. Ce qui se joue est un
 * contrat avec un paquet tiers, `@codegouvfr/react-dsfr`, dont une montée de version peut
 * changer la forme de la tête sans que rien ici ne bouge. Ce que ce scénario ne peut pas
 * tenir, et qu'il ne prétend donc pas : que le navigateur exécute ce script. React ne
 * l'exécute pas quand il le crée au lieu de l'hydrater, et cela demande un vrai document.
 */
describe("la tête du système de design", () => {
  it("porte le script qui pose le thème du lecteur avant la première peinture", () => {
    // Given la racine telle que le gabarit la monte. L'appel est un préalable et non un
    // décor : la tête réclame que les attributs aient été calculés avant elle.
    const attributs = getHtmlAttributes({ lang: "fr" });
    expect(attributs.lang).toBe("fr");

    // When la tête se rend.
    const tete = renderToStaticMarkup(<DsfrHead />);

    // Then elle porte un script, et ce script écrit les deux attributs dont dépend le
    // thème. Les deux sont demandés : `data-fr-scheme` retient le choix, `data-fr-theme`
    // est celui que la feuille de style lit, et l'un sans l'autre ne peint rien.
    expect(tete).toContain("<script>");
    expect(tete).toContain("data-fr-scheme");
    expect(tete).toContain("data-fr-theme");
  });
});
