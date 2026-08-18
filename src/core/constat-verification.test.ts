import { describe, expect, it } from "vitest";

import { type ActionDeclaree, constatsDActionsDeclarees } from "./constat";

const declaration = (over: Partial<ActionDeclaree> = {}): ActionDeclaree => ({
  label: "Retirer jean.dupont de l'organisation incubateur-ademe",
  systemKey: "github",
  username: "jean.dupont",
  declareeLe: new Date("2026-08-18T10:00:00Z"),
  compteToujoursLa: true,
  relueLe: new Date("2026-08-19T04:30:00Z"),
  ...over,
});

/**
 * L'outil n'exécute rien : il enregistre ce qu'un opérateur déclare avoir fait. Sans
 * cette confrontation, une case cochée vaudrait preuve alors qu'elle ne vaut que
 * parole, et un accès resté ouvert par oubli passerait pour un accès coupé.
 */
describe("confrontation entre ce qui est déclaré et ce qui est observé", () => {
  it("signale un compte toujours présent après relecture du système", () => {
    // Given une étape pointée « faite » hier
    // When la collecte de cette nuit revoit le compte
    const [constat] = constatsDActionsDeclarees([declaration()]);

    // Then l'écart est signalé en priorité haute, avec la personne concernée
    expect(constat?.kind).toBe("OVERDUE_MANUAL_ACTION");
    expect(constat?.severity).toBe("HIGH");
    expect(constat?.username).toBe("jean.dupont");
  });

  it("se tait quand le compte a bien disparu", () => {
    expect(constatsDActionsDeclarees([declaration({ compteToujoursLa: false })])).toEqual([]);
  });

  it("attend d'avoir regardé plutôt qu'un délai", () => {
    // Le système n'a pas été relu depuis la déclaration : rien ne permet encore de
    // dire quoi que ce soit. Un délai fixe accuserait à tort quand la collecte a
    // sauté une nuit, et se tairait à tort quand elle tourne toutes les heures.
    const jamaisRelu = declaration({ relueLe: null });
    const reluAvant = declaration({ relueLe: new Date("2026-08-18T04:30:00Z") });

    expect(constatsDActionsDeclarees([jamaisRelu])).toEqual([]);
    expect(constatsDActionsDeclarees([reluAvant])).toEqual([]);
  });

  it("ne signale qu'une fois par personne et par système", () => {
    // Deux étapes sur le même système pour la même personne décrivent le même écart :
    // deux lignes pour un seul geste feraient du bruit dans une file dont la valeur
    // tient à ce que tout ce qu'elle montre appelle une action.
    const constats = constatsDActionsDeclarees([
      declaration(),
      declaration({ label: "Retirer jean.dupont de l'équipe produit" }),
    ]);

    expect(new Set(constats.map((constat) => constat.dedupKey)).size).toBe(1);
  });
});
