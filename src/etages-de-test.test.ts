import { describe, expect, it } from "vitest";

/**
 * Ce qu'un test unitaire a le droit d'atteindre : rien.
 *
 * L'étage unitaire reçoit un environnement qui ne mène nulle part, posé par
 * `vitest.config.ts`. Ce réglage peut en être retiré sans qu'aucun test ne rougisse, et
 * l'étage rejoindrait alors pour de vrai la base et le référentiel des personnes. C'est
 * la seule propriété de la pyramide qui pourrisse en silence, et c'est pour elle seule
 * que ce fichier existe.
 *
 * Le reste de la frontière n'a pas besoin d'un test. Un scénario mal rangé se voit dans
 * un diff, et se paie tout de suite : suffixé `.integration` il réclame une base,
 * suffixé `.contrat` il réclame un jeton et le réseau, suffixé autrement il échoue sur
 * une adresse morte.
 */

describe("l'étage unitaire n'atteint rien", () => {
  it("ne mène ni à une base, ni au référentiel des personnes, ni à un relais d'envoi", () => {
    // Given l'environnement que l'étage unitaire reçoit.

    // Then la base ne mène nulle part. Le port 1 n'écoute jamais : un test qui aurait
    // oublié de la doubler échoue en quelques millisecondes, au lieu d'attendre un
    // délai sur une adresse plausible ou, bien pire, de trouver la base de
    // développement de qui joue les tests.
    const base = new URL(process.env["DATABASE_URL"] ?? "");
    expect(base.port).toBe("1");
    expect(base.pathname).not.toContain("_test");

    // Then le référentiel des personnes non plus, et c'est le plus important des trois.
    // Le schéma d'environnement pose par défaut l'adresse de production, si bien qu'un
    // test qui oublie de piéger `fetch` interroge le vrai référentiel, sur une route
    // dont rien ne restreint la portée à l'incubateur. Le défaut est silencieux,
    // puisque l'appel réussit.
    const referentiel = new URL(process.env["ESPACE_MEMBRE_URL"] ?? "");
    expect(referentiel.port).toBe("1");
    expect(referentiel.hostname).toBe("127.0.0.1");

    // Then le relais d'envoi non plus : un lien de connexion part sur une vraie boîte,
    // et une adresse inventée dans un scénario peut appartenir à quelqu'un.
    expect(new URL(process.env["SMTP_URL"] ?? "").port).toBe("1");

    // Then le jeton de Notion est vidé, et pas seulement absent. Une adresse morte
    // n'intercepte pas une URL écrite en dur : `notion.contrat.test.ts` en porte une, et
    // un jeton hérité du shell suffisait à lui faire interroger l'API réelle. Il vit
    // désormais dans son propre étage, et ce vidage est la seconde serrure.
    expect(process.env["NOTION_SCIM_TOKEN"]).toBe("");

    // Then aucune écriture n'est autorisée, quoi qu'en dise le poste : l'invariant du
    // produit est qu'une exécution est une simulation tant que rien ne l'autorise, et
    // une suite de tests n'est pas ce qui l'autorise.
    expect(process.env["ACTIONS_ENABLED"]).toBe("false");
  });
});
