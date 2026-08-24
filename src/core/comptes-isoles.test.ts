import { describe, expect, it } from "vitest";

import {
  type CategorieDIsolement,
  categorieDIsolement,
  type IdentiteACategoriser,
} from "./comptes-isoles";

/**
 * La clause Prisma de `src/lib/comptes-isoles.ts` transcrite à la main. Les tests ne
 * touchent pas la base, donc l'équivalence entre les deux écritures ne peut être
 * tenue que par ce miroir : le jour où l'une bouge sans l'autre, c'est ici que ça se
 * voit, et non sur deux écrans qui affichent le même intitulé sur deux populations.
 */
function satisfaitLaClausePartagee(identite: IdentiteACategoriser): boolean {
  return (
    identite.vanishedAt === null &&
    ((identite.personId === null && identite.serviceAccountId === null) ||
      identite.matchMethod === "HEURISTIC")
  );
}

function identite(ajouts: Partial<IdentiteACategoriser>): IdentiteACategoriser {
  return {
    vanishedAt: null,
    personId: null,
    serviceAccountId: null,
    matchMethod: "NONE",
    ...ajouts,
  };
}

describe("les comptes non révocables se partagent la file sans se recouvrir", () => {
  const orpheline = identite({ matchMethod: "NONE" });
  const orphelineQuiRessemble = identite({ matchMethod: "HEURISTIC" });
  const supposeeAQuelquun = identite({ personId: "p-durand", matchMethod: "HEURISTIC" });
  const compteDeService = identite({ serviceAccountId: "sa-deploiement", matchMethod: "DECLARED" });
  const reconnue = identite({ personId: "p-durand", matchMethod: "GITHUB_LOGIN" });
  const disparue = identite({ vanishedAt: new Date("2026-01-04T00:00:00Z"), matchMethod: "NONE" });

  const parc = [
    orpheline,
    orphelineQuiRessemble,
    supposeeAQuelquun,
    compteDeService,
    reconnue,
    disparue,
  ];

  it("range chaque identité dans une seule catégorie, ou dans aucune", () => {
    expect(categorieDIsolement(orpheline)).toBe("sans-detenteur");

    // Sans détenteur l'emporte sur la ressemblance : compter cette ligne dans les deux
    // ferait dépasser le total, et elle n'a de toute façon personne à qui ressembler.
    expect(categorieDIsolement(orphelineQuiRessemble)).toBe("sans-detenteur");

    // Elle a un détenteur, et elle compte quand même : la collecte l'a supposé sur une
    // ressemblance que personne n'a confirmée.
    expect(categorieDIsolement(supposeeAQuelquun)).toBe("ressemblance");

    expect(categorieDIsolement(compteDeService)).toBeNull();
    expect(categorieDIsolement(reconnue)).toBeNull();

    // Une identité disparue ne demande plus rien : ce qu'elle ouvrait est déjà fermé.
    expect(categorieDIsolement(disparue)).toBeNull();
  });

  it("fait la somme exacte de la clause que l'écran des comptes isolés applique", () => {
    const categories = parc.map(categorieDIsolement);

    const sansDetenteur = categories.filter(
      (categorie: CategorieDIsolement | null) => categorie === "sans-detenteur",
    ).length;
    const ressemblance = categories.filter(
      (categorie: CategorieDIsolement | null) => categorie === "ressemblance",
    ).length;
    const total = parc.filter(satisfaitLaClausePartagee).length;

    expect(sansDetenteur).toBe(2);
    expect(ressemblance).toBe(1);
    expect(sansDetenteur + ressemblance).toBe(total);
  });

  it("ne range jamais rien hors de la file que l'écran affiche", () => {
    for (const ligne of parc) {
      expect(categorieDIsolement(ligne) !== null).toBe(satisfaitLaClausePartagee(ligne));
    }
  });
});
