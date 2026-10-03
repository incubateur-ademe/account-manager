import { describe, expect, it } from "vitest";

import { type CompteDeLObjet, classerObjetsPossedes, SECTIONS_D_OBJETS } from "./objets-possedes";

const SORTIE = new Date("2026-09-01T00:00:00Z");

const present = { vanishedAt: null };
const sortie = { vanishedAt: SORTIE };

function objet(
  nom: string,
  compte: CompteDeLObjet | null,
): { nom: string; compte: CompteDeLObjet | null } {
  return { nom, compte };
}

describe("le classement des objets possédés", () => {
  it("range chaque objet dans la première section qui s'applique, sans en perdre ni en doubler aucun", () => {
    // Given un objet par cas, dans un ordre qui ne suit pas celui des sections
    const objets = [
      objet("auteur déclaré", { matchMethod: "DECLARED", vanishedAt: null, person: present }),
      objet("sans compte connu", null),
      objet("ressemblance vers une fiche présente", {
        matchMethod: "HEURISTIC",
        vanishedAt: null,
        person: present,
      }),
      objet("compte de service", { matchMethod: "DECLARED", vanishedAt: null, person: null }),
      objet("auteur par login GitHub", {
        matchMethod: "GITHUB_LOGIN",
        vanishedAt: null,
        person: present,
      }),
      objet("compte disparu d'une fiche présente", {
        matchMethod: "EMAIL_EXACT",
        vanishedAt: SORTIE,
        person: present,
      }),
      objet("rattaché sans preuve", { matchMethod: "NONE", vanishedAt: null, person: present }),
      objet("fiche sortie", { matchMethod: "EMAIL_EXACT", vanishedAt: null, person: sortie }),
      objet("compte que personne ne réclame", {
        matchMethod: "NONE",
        vanishedAt: null,
        person: null,
      }),
      objet("ressemblance vers une fiche sortie", {
        matchMethod: "HEURISTIC",
        vanishedAt: null,
        person: sortie,
      }),
      objet("méthode que le code ne connaît pas", {
        matchMethod: "SSO",
        vanishedAt: null,
        person: present,
      }),
      objet("auteur par adresse exacte", {
        matchMethod: "EMAIL_EXACT",
        vanishedAt: null,
        person: present,
      }),
    ];

    // When on les classe
    const sections = classerObjetsPossedes(objets);
    const noms = (cle: (typeof SECTIONS_D_OBJETS)[number]) => sections[cle].map(({ nom }) => nom);

    // Then les orphelins réunissent tout objet sans auteur présent : sans compte, compte
    // disparu, compte de service, compte sans fiche, fiche sortie. Une ressemblance vers une
    // fiche sortie y tombe aussi, la section des orphelins passant devant celle des
    // rattachements à confirmer.
    expect(noms("orphelins")).toEqual([
      "sans compte connu",
      "compte de service",
      "compte disparu d'une fiche présente",
      "fiche sortie",
      "compte que personne ne réclame",
      "ressemblance vers une fiche sortie",
    ]);

    // Then un rattachement qui n'autoriserait pas une révocation laisse l'auteur à confirmer,
    // y compris une méthode inconnue, pour laquelle le défaut sûr est de douter.
    expect(noms("a-confirmer")).toEqual([
      "ressemblance vers une fiche présente",
      "rattaché sans preuve",
      "méthode que le code ne connaît pas",
    ]);

    // Then le reste a un auteur présent, rattaché sur preuve.
    expect(noms("auteur-present")).toEqual([
      "auteur déclaré",
      "auteur par login GitHub",
      "auteur par adresse exacte",
    ]);

    // Then le total est conservé, et chaque objet n'est rangé qu'une fois.
    const ranges = SECTIONS_D_OBJETS.flatMap((cle) => sections[cle]);
    expect(ranges).toHaveLength(objets.length);
    expect(new Set(ranges)).toEqual(new Set(objets));
  });
});
