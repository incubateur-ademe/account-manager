import { describe, expect, it } from "vitest";

import {
  ACTEUR_SYSTEME,
  auMoinsUnFiltre,
  identifiantsLies,
  lienJournal,
  lireCriteres,
  nombreDePages,
  TAILLE_PAGE,
  versFiltre,
} from "./criteres";

function parametresDe(lien: string): Record<string, string> {
  return Object.fromEntries(new URL(lien, "https://exemple.test").searchParams);
}

describe("critères de consultation du journal", () => {
  it("garde les filtres d'un opérateur d'une page à l'autre", () => {
    const criteres = lireCriteres({
      acteur: "jean.dupont",
      action: "auth.signin",
      resultat: "FAILURE",
      page: "3",
    });

    expect(criteres).toEqual({
      acteur: "jean.dupont",
      action: "auth.signin",
      resultat: "FAILURE",
      execution: "",
      personne: "",
      page: 3,
    });
    expect(versFiltre(criteres)).toEqual({
      actorUsername: "jean.dupont",
      action: "auth.signin",
      result: "FAILURE",
    });
    expect(auMoinsUnFiltre(criteres)).toBe(true);

    const pageSuivante = lienJournal(criteres, { page: 4 });
    expect(lireCriteres(parametresDe(pageSuivante))).toEqual({ ...criteres, page: 4 });

    expect(lienJournal(criteres, { page: 1 })).not.toContain("page=");

    expect(nombreDePages(0)).toBe(1);
    expect(nombreDePages(TAILLE_PAGE)).toBe(1);
    expect(nombreDePages(TAILLE_PAGE + 1)).toBe(2);
  });

  it("écarte une valeur d'URL invalide au lieu de filtrer dessus", () => {
    const criteres = lireCriteres({
      resultat: "SUPPRIME",
      page: "0",
      acteur: ["  jean.dupont  ", "quelqu'un.dautre"],
    });

    expect(criteres.resultat).toBe("");
    expect(criteres.acteur).toBe("jean.dupont");
    expect(criteres.page).toBe(1);

    const filtre = versFiltre(criteres);
    expect(filtre).toEqual({ actorUsername: "jean.dupont" });
    expect(Object.keys(filtre)).not.toContain("result");

    expect(lireCriteres({ page: "-4" }).page).toBe(1);
    expect(lireCriteres({ page: "onze" }).page).toBe(1);

    const sansFiltre = lireCriteres({});
    expect(versFiltre(sansFiltre)).toEqual({});
    expect(auMoinsUnFiltre(sansFiltre)).toBe(false);
    expect(lienJournal(sansFiltre)).toBe("/journal");
  });

  it("reconstitue une exécution de collecte sans confondre le système et un humain", () => {
    const systeme = lireCriteres({ acteur: ACTEUR_SYSTEME });
    expect(versFiltre(systeme)).toEqual({ actorKind: "SYSTEM" });

    const lienExecution = lienJournal(systeme, { execution: "collecte-2026-08-09", page: 1 });
    const execution = lireCriteres(parametresDe(lienExecution));

    expect(versFiltre(execution)).toEqual({
      actorKind: "SYSTEM",
      correlationId: "collecte-2026-08-09",
    });
    expect(lienJournal(execution, { execution: "" })).toBe("/journal?acteur=%40systeme");
  });

  it("rassemble l'histoire d'une personne, dont les constats qui la nomment en fin de clé", () => {
    // Les événements ne portent pas de champ « personne » : ils la nomment dans la
    // cible, après le type de constat. Un filtre sur l'égalité seule raterait donc
    // tout ce qui la concerne vraiment.
    const criteres = lireCriteres({ personne: "jean.dupont" });

    expect(versFiltre(criteres)).toEqual({
      OR: [
        { targetId: "jean.dupont" },
        { targetId: { endsWith: ":jean.dupont" } },
        { actorUsername: "jean.dupont", targetType: "session" },
      ],
    });
    expect(auMoinsUnFiltre(criteres)).toBe(true);

    const retour = lienJournal(criteres, { personne: "" });
    expect(retour).toBe("/journal");
    expect(lienJournal(criteres)).toContain("personne=jean.dupont");
  });
});

describe("histoire d'une fiche à travers ses renommages et sa fusion", () => {
  // Deux corrections d'identifiant, puis l'arrivée de la personne dans
  // l'espace-membre et la fusion vers son vrai pivot.
  const LIENS = [
    { before: { username: "camile.exempl" }, after: { username: "camille.exempl" } },
    { before: { username: "camille.exempl" }, after: { username: "camille.exemple" } },
    { before: { username: "camille.exemple" }, after: { username: "camille.roux" } },
    // Bruit du journal : d'autres fiches, et des charges utiles qui ne nomment
    // personne. Ni l'une ni l'autre n'a à entrer dans la chaîne.
    { before: { username: "dominique.roux" }, after: { username: "dominique.exemple" } },
    { before: null, after: { comptes: 2 } },
  ];

  it("retrouve tous les identifiants portés, quel que soit le bout par lequel on entre", () => {
    const attendus = ["camile.exempl", "camille.exempl", "camille.exemple", "camille.roux"];

    expect(identifiantsLies(LIENS, "camille.roux")).toEqual(attendus);
    expect(identifiantsLies(LIENS, "camile.exempl")).toEqual(attendus);
    expect(identifiantsLies(LIENS, "camille.exempl")).toEqual(attendus);

    // Une fiche qu'aucun renommage n'a touchée reste seule, et une recherche vide
    // ne fabrique aucun alias.
    expect(identifiantsLies(LIENS, "jean.dupont")).toEqual(["jean.dupont"]);
    expect(identifiantsLies(LIENS, "")).toEqual([]);
  });

  it("couvre les quatre identifiants dans le filtre servi à la base", () => {
    const criteres = lireCriteres({ personne: "camille.roux" });
    const filtre = versFiltre(criteres, identifiantsLies(LIENS, criteres.personne));

    expect(filtre.OR).toHaveLength(12);
    expect(filtre.OR).toContainEqual({ targetId: "camile.exempl" });
    expect(filtre.OR).toContainEqual({ targetId: { endsWith: ":camille.exempl" } });
    expect(filtre.OR).toContainEqual({ actorUsername: "camille.roux", targetType: "session" });

    // Sans alias, le filtre reste exactement celui d'avant : la chaîne ne se paie
    // pas sur les écrans qui n'en ont pas besoin.
    expect(versFiltre(criteres).OR).toHaveLength(3);
  });

  it("ne tourne pas en rond sur une chaîne circulaire", () => {
    const boucle = [
      { before: { username: "a.exemple" }, after: { username: "b.exemple" } },
      { before: { username: "b.exemple" }, after: { username: "c.exemple" } },
      { before: { username: "c.exemple" }, after: { username: "a.exemple" } },
      { before: { username: "a.exemple" }, after: { username: "a.exemple" } },
    ];

    expect(identifiantsLies(boucle, "b.exemple")).toEqual(["a.exemple", "b.exemple", "c.exemple"]);
  });
});
