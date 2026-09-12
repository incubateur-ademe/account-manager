import { describe, expect, it } from "vitest";

/**
 * La frontière entre les étages de test, tenue par un test plutôt que par la règle
 * écrite.
 *
 * Une règle de rédaction se contourne sans mauvaise foi, simplement en ne la lisant
 * pas. Ce qui suit se contourne aussi, mais bruyamment : c'est la différence entre une
 * convention et un garde-fou, et c'est la seule chose qui empêche une pyramide de
 * redevenir un tas.
 *
 * Deux propriétés, et elles pourrissent toutes les deux en silence. Le passage de mise
 * en place de l'étage unitaire peut être retiré de `vitest.config.ts` sans qu'aucun
 * test ne rougisse, et l'étage rejoindrait alors pour de vrai la base et le
 * référentiel des personnes. Et un scénario d'intégration mal suffixé serait joué par
 * l'étage qui s'interdit d'avoir une base, où il échouerait sur une adresse morte en
 * accusant le code plutôt que son propre nom.
 */

const SOURCES = import.meta.glob(["./**/*.test.ts", "!./generated/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Readonly<Record<string, string>>;

describe("les étages de test ne se mélangent pas", () => {
  it("interdit à l'unitaire d'atteindre quoi que ce soit, base comme référentiel", () => {
    // Given l'étage unitaire, dont le passage de mise en place pose des adresses
    // mortes sans condition.

    // Then la base ne mène nulle part. Le port 1 n'écoute jamais : un test qui aurait
    // oublié de la doubler échoue en une poignée de millisecondes, au lieu d'attendre
    // un délai sur une adresse plausible ou, bien pire, de trouver la base de
    // développement de qui joue les tests.
    const base = new URL(process.env["DATABASE_URL"] ?? "");
    expect(base.port).toBe("1");
    expect(base.pathname).not.toContain("_test");

    // Then le référentiel des personnes non plus, et c'est le plus important des deux.
    // Le schéma d'environnement pose par défaut l'adresse de production, si bien qu'un
    // test qui oublie de piéger `fetch` interroge le vrai espace-membre, sur une route
    // dont rien ne restreint la portée à l'incubateur.
    const referentiel = new URL(process.env["ESPACE_MEMBRE_URL"] ?? "");
    expect(referentiel.port).toBe("1");
    expect(referentiel.hostname).toBe("127.0.0.1");

    // Then le relais d'envoi non plus : un lien de connexion part sur une vraie boîte,
    // et une adresse inventée dans un scénario peut appartenir à quelqu'un.
    expect(new URL(process.env["SMTP_URL"] ?? "").port).toBe("1");
  });

  it("range chaque scénario dans l'étage que son nom annonce", () => {
    // Given tous les fichiers de test du dépôt, énumérés plutôt que listés à la main :
    // une liste écrite se périme au prochain ajout, et c'est justement le nouveau venu
    // qui se trompe d'étage.
    const fichiers = Object.keys(SOURCES).sort();
    expect(fichiers.length).toBeGreaterThan(50);

    // When on sépare les deux étages par leur suffixe,
    const integration = fichiers.filter((chemin) => chemin.endsWith(".integration.test.ts"));
    const unitaires = fichiers.filter((chemin) => !chemin.endsWith(".integration.test.ts"));

    // Then aucun scénario unitaire ne prétend toucher une base. Les seize doubles
    // écrits à la main sont la raison d'être de l'étage d'intégration : un test qui
    // vérifie un `where` contre un double vérifie surtout qu'on a écrit le double comme
    // on a écrit le code. Celui qui veut une vraie base porte le suffixe qui la lui
    // donne, et le passage de mise en place refusera toute base qui ne soit pas dédiée.
    const menteurs = unitaires.filter((chemin) => {
      const source = SOURCES[chemin] ?? "";
      return /from ["']@\/lib\/db["']/.test(source) && !/vi\.mock\(["']@\/lib\/db["']/.test(source);
    });
    expect(menteurs).toEqual([]);

    // Then l'étage d'intégration porte exactement ce qu'on a décidé d'y mettre. La
    // liste est écrite à la main, contrairement à tout le reste de ce fichier, et c'est
    // délibéré : cet étage coûte une vraie base et quelques centaines de millisecondes
    // par scénario, donc un ajout doit être une décision et non une dérive. Un scénario
    // qui apparaît ici sans passer par cette ligne n'a été relu par personne.
    expect(integration).toEqual(["./lib/sync/collecte.integration.test.ts"]);
  });
});
