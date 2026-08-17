import { describe, expect, it } from "vitest";

import {
  ACTEUR_SYSTEME,
  auMoinsUnFiltre,
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
