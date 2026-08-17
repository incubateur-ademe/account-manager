import { describe, expect, it } from "vitest";

import { candidateUsernames, resolveOperator } from "./identite";

const OPERATORS = ["claire.durand"];
const BREAK_GLASS = ["samir.benali"];

/**
 * Le username change de champ à chaque étape de la connexion. Se tromper ici bloque
 * la création de compte, donc toute connexion, y compris les suivantes.
 */
describe("identification de l'opérateur au fil du parcours de connexion", () => {
  it("reconnaît l'utilisateur à l'envoi du lien, où le username est dans id", () => {
    // Forme produite par le wrapper du provider : il pose id, name, image et
    // l'adresse résolue, mais jamais username.
    const user = {
      id: "claire.durand",
      email: "claire.durand@beta.gouv.fr",
      name: "Lilian Saget-Lethias",
    };
    expect(resolveOperator(user, OPERATORS, BREAK_GLASS)).toEqual({
      username: "claire.durand",
      viaBreakGlass: false,
    });
  });

  it("reconnaît l'utilisateur provisoire du premier retour de lien", () => {
    // Auth.js fabrique cet objet quand le compte n'existe pas encore : id aléatoire,
    // et l'identifiant saisi placé dans email.
    const user = {
      id: "97ca70eb-1e97-4c9d-93b6-5b8f54909c06",
      email: "claire.durand",
    };
    expect(resolveOperator(user, OPERATORS, BREAK_GLASS)?.username).toBe("claire.durand");
  });

  it("reconnaît l'utilisateur une fois le compte créé en base", () => {
    const user = {
      id: "cm3x9k2p0000abcdefghijkl",
      username: "claire.durand",
      email: "claire.durand@beta.gouv.fr",
    };
    expect(resolveOperator(user, OPERATORS, BREAK_GLASS)?.username).toBe("claire.durand");
  });

  it("signale le recours à la liste de secours", () => {
    const match = resolveOperator({ id: "samir.benali" }, OPERATORS, BREAK_GLASS);
    expect(match).toEqual({ username: "samir.benali", viaBreakGlass: true });
  });

  it("refuse qui n'est sur aucune des deux listes", () => {
    expect(resolveOperator({ id: "jean.dupont" }, OPERATORS, BREAK_GLASS)).toBeNull();
  });

  it("écarte les adresses des candidats, un username n'a jamais d'arobase", () => {
    expect(candidateUsernames({ email: "quelquun@beta.gouv.fr", id: "abc" })).toEqual(["abc"]);
  });

  it("ne propose aucun candidat quand rien n'est exploitable", () => {
    expect(candidateUsernames({ email: "quelquun@beta.gouv.fr" })).toEqual([]);
    expect(resolveOperator({}, OPERATORS, BREAK_GLASS)).toBeNull();
  });

  it("retient l'identité validée, jamais un autre champ du même objet", () => {
    // Un objet peut porter plusieurs identifiants dont un seul est autorisé.
    // Siéger sous celui qui n'a pas été vérifié serait une confusion d'identité.
    const user = { username: "jean.dupont", id: "claire.durand" };
    expect(candidateUsernames(user)[0]).toBe("jean.dupont");
    expect(resolveOperator(user, OPERATORS, BREAK_GLASS)?.username).toBe("claire.durand");
  });
});
