import { describe, expect, it } from "vitest";

import { type ActionDeclaree, constatsDActionsDeclarees } from "./constat";

const declaration = (over: Partial<ActionDeclaree> = {}): ActionDeclaree => ({
  label: "Retirer jean.dupont de l'organisation incubateur-ademe",
  systemKey: "github",
  username: "jean.dupont",
  sens: "OFFBOARDING",
  declareeLe: new Date("2026-08-18T10:00:00Z"),
  dossierEncoreVivant: true,
  retourLe: null,
  inverseeLe: null,
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

  it("vérifie une arrivée sur une présence, et non sur une absence", () => {
    // Given une étape d'arrivée pointée « faite »
    const donne = declaration({
      sens: "ONBOARDING",
      label: "Inviter jean.dupont dans l'organisation incubateur-ademe",
      compteToujoursLa: false,
    });

    // When la collecte ne voit aucun compte, puis en voit un
    const [manquant] = constatsDActionsDeclarees([donne]);
    const observe = constatsDActionsDeclarees([{ ...donne, compteToujoursLa: true }]);

    // Then c'est l'absence qui dément la parole, et la présence qui la confirme :
    // reprendre la règle du départ ferait signaler chaque accès réellement donné.
    expect(manquant?.kind).toBe("OVERDUE_MANUAL_ACTION");
    expect(manquant?.severity).toBe("HIGH");
    expect(manquant?.detail).toContain("aucun compte n'est observé");
    expect(observe).toEqual([]);
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

  it("ne cesse de démentir une parole qu'une fois son dossier retombé et la personne revenue", () => {
    // Given un retrait GitHub pointé le 20 janvier, et le compte de nouveau observé à
    // la lecture d'août
    const retraitDeJanvier = declaration({ declareeLe: new Date("2026-01-20T10:00:00Z") });

    // When la personne est revenue le 1er juin, alors que ce départ est toujours en cours
    const enCours = { ...retraitDeJanvier, retourLe: new Date("2026-06-01T02:00:00Z") };

    // Then le démenti tient : un dossier vivant est le dernier de son sens, ce qu'il
    // demande reste attendu, et le retour d'une fiche qui saute une collecte ou d'un
    // renouvellement signé en retard ne décide de rien.
    const [enSuspens] = constatsDActionsDeclarees([enCours]);
    expect(enSuspens?.kind).toBe("OVERDUE_MANUAL_ACTION");
    expect(enSuspens?.dedupKey).toBe("OVERDUE_MANUAL_ACTION:github:jean.dupont");

    // When le départ est soldé, et elle revient ensuite
    const soldePuisRevenue = { ...enCours, dossierEncoreVivant: false };

    // Then ce retrait a bien eu lieu, et le compte rouvert ne le dément pas : c'est la
    // personne qui est revenue, et sans cette borne le démenti la suivrait de séjour
    // en séjour.
    expect(constatsDActionsDeclarees([soldePuisRevenue])).toEqual([]);

    // And le retrait du séjour en cours, lui, est toujours démenti : c'est le vrai cas,
    // celui de l'accès qu'on a cru couper, que le faux positif noyait.
    expect(
      constatsDActionsDeclarees([
        { ...soldePuisRevenue, declareeLe: new Date("2026-08-18T10:00:00Z") },
      ]),
    ).toHaveLength(1);

    // And sans retour, rien ne s'éteint, dossier clos ou non : une fusion déplace les
    // dossiers d'une fiche fabriquée vers la vraie, plus jeune qu'eux, et seule la
    // réapparition de quelqu'un dit qu'un séjour a recommencé.
    expect(
      constatsDActionsDeclarees([{ ...retraitDeJanvier, dossierEncoreVivant: false }]),
    ).toHaveLength(1);

    // And le retour ne suffit pas : celui de quelqu'un qu'on offboarde puis qu'on
    // réaccueille sans que sa fiche ait quitté le référentiel n'a jamais lieu. Son
    // invitation de juin est démentie tant qu'aucun départ n'a été exécuté, et cesse de
    // l'être dès que le départ de septembre a défait ce qu'elle avait donné, que le
    // dossier d'arrivée soit resté ouvert ou non.
    const invitation = declaration({
      sens: "ONBOARDING",
      label: "Inviter jean.dupont dans l'organisation incubateur-ademe",
      declareeLe: new Date("2026-06-10T10:00:00Z"),
      compteToujoursLa: false,
      relueLe: new Date("2026-09-20T04:30:00Z"),
    });

    expect(constatsDActionsDeclarees([invitation])).toHaveLength(1);
    expect(
      constatsDActionsDeclarees([{ ...invitation, inverseeLe: new Date("2026-09-15T09:00:00Z") }]),
    ).toEqual([]);

    // And un mouvement opposé antérieur à la déclaration ne l'éteint pas : c'est la
    // parole qui est venue après, et elle a encore quelque chose à prouver.
    expect(
      constatsDActionsDeclarees([{ ...invitation, inverseeLe: new Date("2026-06-05T09:00:00Z") }]),
    ).toHaveLength(1);
  });
});
