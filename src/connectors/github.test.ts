import { describe, expect, it } from "vitest";

import { assemblerOrganisation, collecter, type Lecteur, lireOrganisation } from "./github";

interface Reponses {
  membresAdmin?: unknown[];
  membres?: unknown[];
  invitations?: unknown[];
  equipes?: unknown[] | "echec";
  membresDEquipe?: Record<string, unknown[] | "echec">;
  membresEnEchec?: boolean;
}

/**
 * Un lecteur factice qui retient ce qu'on lui a demandé : c'est ce qui rend le coût
 * en requêtes observable sans réseau, et c'est tout l'intérêt d'avoir séparé la
 * lecture de l'assemblage.
 */
function lecteur(reponses: Reponses): { lire: Lecteur; chemins: string[] } {
  const chemins: string[] = [];

  const lire = (async <T>(chemin: string): Promise<T[]> => {
    chemins.push(chemin);

    if (chemin.includes("/members?role=admin")) {
      if (reponses.membresEnEchec) {
        throw new Error("403 Forbidden");
      }
      return (reponses.membresAdmin ?? []) as T[];
    }
    if (chemin.includes("/members?role=member")) {
      return (reponses.membres ?? []) as T[];
    }
    if (chemin.endsWith("/invitations")) {
      return (reponses.invitations ?? []) as T[];
    }
    if (chemin.endsWith("/teams")) {
      if (reponses.equipes === "echec") {
        throw new Error("500 Internal Server Error");
      }
      return (reponses.equipes ?? []) as T[];
    }

    const slug = chemin.split("/teams/")[1]?.replace("/members", "") ?? "";
    const membres = reponses.membresDEquipe?.[slug];
    if (membres === "echec" || membres === undefined) {
      throw new Error(`404 Not Found`);
    }
    return membres as T[];
  }) as Lecteur;

  return { lire, chemins };
}

const CAMILLE = { id: 1, login: "camille.rivet" };
const ALEX = { id: 2, login: "alex.dupuis" };

describe("ce que le connecteur GitHub remonte d'une organisation", () => {
  it("fait d'une équipe une ressource et de son appartenance un accès", async () => {
    const { lire } = lecteur({
      membres: [CAMILLE, ALEX],
      equipes: [{ id: 10, name: "produit-alpha", slug: "produit-alpha" }],
      membresDEquipe: { "produit-alpha": [CAMILLE] },
    });

    const assemblee = assemblerOrganisation(
      "incubateur-ademe",
      await lireOrganisation("incubateur-ademe", lire),
    );

    expect(assemblee.identites).toHaveLength(2);
    expect(assemblee.ressources).toEqual([
      {
        externalId: "incubateur-ademe",
        label: "Organisation incubateur-ademe",
        url: "https://github.com/incubateur-ademe",
      },
      {
        externalId: "incubateur-ademe/produit-alpha",
        label: "Équipe produit-alpha",
        url: "https://github.com/orgs/incubateur-ademe/teams/produit-alpha",
      },
    ]);

    expect(assemblee.acces).toHaveLength(3);
    expect(assemblee.acces).toContainEqual({
      identityExternalId: "1",
      resourceExternalId: "incubateur-ademe/produit-alpha",
      role: "member",
    });
    expect(assemblee.acces.filter((acces) => acces.identityExternalId === "2")).toHaveLength(1);

    // Ce qui est un accès n'a rien à faire dans une métadonnée : le socle ne saurait
    // ni le réconcilier, ni le faire disparaître, ni le porter dans un plan.
    const dites = assemblee.identites.flatMap((identite) => identite.details ?? []);
    expect(dites).toHaveLength(0);
  });

  it("ne met en métadonnée que ce qu'aucun accès ne dit", async () => {
    const { lire } = lecteur({
      membresAdmin: [{ ...ALEX }],
      membres: [{ id: 3, login: "robot-deploiement", type: "Bot" }],
      invitations: [
        {
          id: 77,
          login: null,
          email: "quelquun@exemple.org",
          role: "direct_member",
          created_at: "2026-03-03T09:00:00Z",
          inviter: { login: "camille.rivet" },
          team_count: 2,
        },
      ],
    });

    const assemblee = assemblerOrganisation(
      "incubateur-ademe",
      await lireOrganisation("incubateur-ademe", lire),
    );

    const robot = assemblee.identites.find((identite) => identite.handle === "robot-deploiement");
    const administrateur = assemblee.identites.find(
      (identite) => identite.handle === "alex.dupuis",
    );
    const invitee = assemblee.identites.find(
      (identite) => identite.externalId === "email:quelquun@exemple.org",
    );

    expect(robot?.details).toEqual([{ label: "Type de compte", value: "robot" }]);

    // L'administration de l'organisation se lit dans le rôle de l'accès : la redire
    // ici en ferait une seconde vérité, que rien ne tiendrait à jour.
    expect(administrateur?.details).toBeUndefined();
    expect(assemblee.acces).toContainEqual({
      identityExternalId: "2",
      resourceExternalId: "incubateur-ademe",
      role: "admin",
    });

    expect(invitee?.details).toEqual([
      { label: "Invitée le", value: "3 mars 2026" },
      { label: "Invitée par", value: "camille.rivet" },
      { label: "Équipes visées", value: "2" },
    ]);
    expect(assemblee.acces).toContainEqual({
      identityExternalId: "email:quelquun@exemple.org",
      resourceExternalId: "incubateur-ademe",
      role: "invite:direct_member",
    });
  });

  it("dégrade sur une équipe illisible, sans faire disparaître personne", async () => {
    const { lire } = lecteur({
      membres: [CAMILLE, ALEX],
      equipes: [
        { id: 10, name: "produit-alpha", slug: "produit-alpha" },
        { id: 11, name: "produit-beta", slug: "produit-beta" },
      ],
      membresDEquipe: { "produit-alpha": [CAMILLE], "produit-beta": "echec" },
    });

    const partiel = await collecter(lire);

    expect(partiel.status).toBe("partial");
    expect(partiel.errors?.[0]?.itemRef).toBe("incubateur-ademe/produit-beta");
    expect(partiel.status !== "failed" && partiel.identities).toHaveLength(2);

    // Aucun accès vers l'équipe illisible : le silence ne doit jamais valoir absence.
    const versBeta =
      partiel.status !== "failed" &&
      partiel.grants.filter((acces) => acces.resourceExternalId?.endsWith("produit-beta"));
    expect(versBeta).toHaveLength(0);

    const sansListeDEquipes = await collecter(
      lecteur({ membres: [CAMILLE], equipes: "echec" }).lire,
    );

    expect(sansListeDEquipes.status).toBe("partial");
    expect(sansListeDEquipes.status !== "failed" && sansListeDEquipes.grants).toHaveLength(1);

    const rien = await collecter(lecteur({ membresEnEchec: true }).lire);

    expect(rien.status).toBe("failed");
    expect(rien).not.toHaveProperty("identities");
  });

  it("fait suivre le coût au nombre d'équipes, jamais à celui des comptes", async () => {
    const membres = Array.from({ length: 95 }, (_, rang) => ({
      id: rang + 1,
      login: `personne-${rang + 1}`,
    }));
    const equipes = Array.from({ length: 19 }, (_, rang) => ({
      id: 100 + rang,
      name: `produit-${rang}`,
      slug: `produit-${rang}`,
    }));
    const membresDEquipe = Object.fromEntries(equipes.map((equipe) => [equipe.slug, [membres[0]]]));

    const petite = lecteur({ membres, equipes, membresDEquipe });
    await lireOrganisation("incubateur-ademe", petite.lire);

    expect(petite.chemins).toHaveLength(23);
    expect(petite.chemins.filter((chemin) => chemin.includes("/teams/"))).toHaveLength(19);
    expect(petite.chemins.some((chemin) => /personne-\d/.test(chemin))).toBe(false);

    const doublee = lecteur({
      membres: [...membres, ...membres.map((membre) => ({ ...membre, id: membre.id + 1000 }))],
      equipes,
      membresDEquipe,
    });
    await lireOrganisation("incubateur-ademe", doublee.lire);

    expect(doublee.chemins).toHaveLength(23);

    const uneDePlus = lecteur({
      membres,
      equipes: [...equipes, { id: 200, name: "produit-zeta", slug: "produit-zeta" }],
      membresDEquipe: { ...membresDEquipe, "produit-zeta": [] },
    });
    await lireOrganisation("incubateur-ademe", uneDePlus.lire);

    expect(uneDePlus.chemins).toHaveLength(24);
  });
});
