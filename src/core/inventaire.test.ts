import { describe, expect, it } from "vitest";

import type { ReleveSysteme, SystemeMuet } from "@/core/collecte";

import {
  type AccesConstate,
  inventaireParSysteme,
  plusAncienneInvitation,
  qualiteDuCompte,
} from "./inventaire";

const HIER = new Date("2026-08-23T02:00:00Z");
const VIEUX = new Date("2026-05-02T10:00:00Z");
const PLUS_VIEUX = new Date("2026-03-14T10:00:00Z");

function acces(
  externalIdentityId: string,
  provider: string,
  role: string,
  firstSeenAt: Date = VIEUX,
): AccesConstate {
  return { externalIdentityId, provider, role, firstSeenAt };
}

describe("un parc réel se replie en un inventaire qui dit la même chose que les écrans", () => {
  // Deux systèmes. Sur github, une administratrice qui est aussi dans deux équipes,
  // deux membres dont un dans une équipe, et deux invitations jamais acceptées. Sur
  // notion, un membre et un compte qui n'a plus aucun accès vivant.
  const ACCES: readonly AccesConstate[] = [
    acces("gh-1", "github", "admin"),
    acces("gh-1", "github", "member"),
    acces("gh-1", "github", "member"),
    acces("gh-2", "github", "member"),
    acces("gh-2", "github", "member"),
    acces("gh-3", "github", "member"),
    acces("gh-4", "github", "invite:direct_member", VIEUX),
    acces("gh-5", "github", "invite:admin", PLUS_VIEUX),
    acces("nt-1", "notion", "member"),
  ];

  const COMPTES = [
    { provider: "github", comptes: 5 },
    { provider: "notion", comptes: 2 },
  ];

  const RELEVES: readonly ReleveSysteme[] = [
    { provider: "github", startedAt: HIER, status: "OK" },
    { provider: "notion", startedAt: HIER, status: "PARTIAL" },
  ];

  it("compte des comptes et non des accès, et ne laisse jamais le détail dépasser le total", () => {
    const lignes = inventaireParSysteme(["github", "notion"], COMPTES, ACCES, RELEVES, []);
    const github = lignes.find((ligne) => ligne.provider === "github");

    if (!github) {
      throw new Error("le système attendu devait avoir sa ligne");
    }

    if (github.comptes === null) {
      throw new Error("un système frais devait porter un total");
    }
    expect(github.comptes).toBe(5);

    // Neuf accès sur github, cinq comptes : les appartenances d'équipe produisent
    // autant d'accès `member` que d'équipes, et les compter multiplierait le parc.
    expect(github.administrateurs).toBe(1);
    expect(github.membres).toBe(2);
    expect(github.invitations).toBe(2);

    expect(github.administrateurs + github.membres + github.invitations).toBeLessThanOrEqual(
      github.comptes,
    );

    // Une invitation d'administrateur reste une invitation : elle n'ouvre rien tant
    // que personne ne l'a acceptée.
    expect(github.invitationObserveeDepuis).toEqual(PLUS_VIEUX);
    expect(github.observation).toEqual({ etat: "frais" });
  });

  it("ne présente pas comme sain un système lu partiellement", () => {
    const lignes = inventaireParSysteme(["github", "notion"], COMPTES, ACCES, RELEVES, []);
    const notion = lignes.find((ligne) => ligne.provider === "notion");

    // Le chiffre existe, mais la collecte a avalé des erreurs, donc elle n'a daté
    // aucune disparition : ce total peut contenir des comptes déjà partis.
    expect(notion?.comptes).toBe(2);
    expect(notion?.observation).toEqual({ etat: "partiel" });

    // Un compte sans aucun accès vivant reste dans le total sans grossir aucun détail.
    expect(notion?.membres).toBe(1);
    expect(notion?.invitations).toBe(0);
  });

  it("range chaque compte dans une seule qualité", () => {
    expect(qualiteDuCompte(["admin", "member"])).toBe("administrateur");
    expect(qualiteDuCompte(["OWNER"])).toBe("administrateur");
    expect(qualiteDuCompte(["member", "member"])).toBe("membre");
    expect(qualiteDuCompte(["invite:direct_member"])).toBe("invitation");

    // Un compte qui détient déjà quelque chose est entré, quelle que soit
    // l'invitation qui traîne encore à côté.
    expect(qualiteDuCompte(["invite:direct_member", "member"])).toBe("membre");

    expect(qualiteDuCompte([])).toBeNull();
  });

  it("date la plus ancienne invitation sur ce qui a été observé, jamais sur un rôle ordinaire", () => {
    expect(plusAncienneInvitation(ACCES)).toEqual(PLUS_VIEUX);
    expect(plusAncienneInvitation([acces("nt-1", "notion", "member", PLUS_VIEUX)])).toBeNull();
  });

  it("ne date aucune invitation quand la colonne en affiche zéro", () => {
    // Ce compte détient déjà quelque chose, il est donc membre et non invitation. Sans
    // garde, la cellule afficherait « 0, la plus ancienne observée depuis le 14/03 ».
    const lignes = inventaireParSysteme(
      ["ovh"],
      [{ provider: "ovh", comptes: 1 }],
      [
        acces("o-1", "ovh", "member", VIEUX),
        acces("o-1", "ovh", "invite:direct_member", PLUS_VIEUX),
      ],
      [{ provider: "ovh", startedAt: HIER, status: "OK" }],
      [],
    );

    expect(lignes[0]?.invitations).toBe(0);
    expect(lignes[0]?.invitationObserveeDepuis).toBeNull();
    expect(lignes[0]?.membres).toBe(1);
  });
});

describe("une base vide ne se lit pas comme un parc sain", () => {
  const MUETS: readonly SystemeMuet[] = [
    { provider: "github", raison: "non-lu", heures: null },
    { provider: "notion", raison: "echec", heures: null },
    { provider: "ovh", raison: "perime", heures: 96 },
  ];

  it("dit de chaque système qu'il n'est pas observé, et jamais qu'il n'a aucun compte", () => {
    const lignes = inventaireParSysteme(
      ["github", "notion", "ovh"],
      [],
      [],
      [{ provider: "notion", startedAt: VIEUX, status: "FAILED" }],
      MUETS,
    );

    expect(lignes).toHaveLength(3);

    for (const ligne of lignes) {
      // Le point de tout l'exercice : « 0 compte » et « pas regardé » se ressemblent
      // trait pour trait, et un inventaire est une machine à produire cette confusion.
      expect(ligne.comptes).toBeNull();
      expect(ligne.observation.etat).toBe("muet");
    }

    expect(lignes[0]?.observation).toEqual({ etat: "muet", raison: "non-lu", heures: null });
    expect(lignes[2]?.observation).toEqual({ etat: "muet", raison: "perime", heures: 96 });
  });

  it("rend une ligne par système attendu, dans l'ordre où ils sont attendus", () => {
    const lignes = inventaireParSysteme(["ovh", "github"], [], [], [], []);

    expect(lignes.map((ligne) => ligne.provider)).toEqual(["ovh", "github"]);

    // Aucun relevé passé, donc rien d'établi : sans cette garde, la ligne dirait
    // « 0 compte, lu dans les délais » d'un système que personne n'a jamais lu.
    expect(lignes[0]?.comptes).toBeNull();
    expect(lignes[0]?.observation).toEqual({ etat: "muet", raison: "non-lu", heures: null });
  });

  it("compte zéro quand la collecte a bien tourné et n'a rien trouvé", () => {
    const lignes = inventaireParSysteme(
      ["ovh"],
      [],
      [],
      [{ provider: "ovh", startedAt: HIER, status: "OK" }],
      [],
    );

    expect(lignes[0]?.comptes).toBe(0);
    expect(lignes[0]?.observation).toEqual({ etat: "frais" });
  });
});
