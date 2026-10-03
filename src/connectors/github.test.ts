import { describe, expect, it, vi } from "vitest";

import type { Intent, PlannedStep, RunContext, SubjectRef } from "@/core/connector";

import {
  assemblerOrganisation,
  CONTRAT_GITHUB,
  collecter,
  constaterAppartenance,
  constaterRetrait,
  creerGithub,
  type Ecriture,
  executerOctroi,
  executerRetrait,
  interpreterAppartenance,
  type Lecteur,
  lireOrganisation,
  planifierOctroiGithub,
  planifierRetraitGithub,
  type ReponseGithub,
  type ScopeGithub,
  type Sonde,
  type Suppression,
} from "./github";

/**
 * L'environnement est une doublure et jamais le vrai : le lire validerait toute la
 * configuration du dépôt pour un seul jeton, et ce que ces tests exercent est le
 * comportement du connecteur selon qu'un credential d'écriture répond ou non.
 */
const environnement = vi.hoisted(() => ({ jetonAdmin: undefined as string | undefined }));

vi.mock("@/lib/env", () => ({
  env: {
    get GITHUB_TOKEN() {
      return "jeton-de-lecture";
    },
    get GITHUB_ADMIN_TOKEN() {
      return environnement.jetonAdmin;
    },
  },
}));

interface Reponses {
  membresAdmin?: unknown[];
  membres?: unknown[];
  invitations?: unknown[];
  equipes?: unknown[] | "echec";
  membresDEquipe?: Record<string, unknown[] | "echec">;
  membresEnEchec?: boolean;
  depots?: unknown[] | "echec";
  depotsDEquipe?: Record<string, unknown[] | "echec">;
  /** Par nom de dépôt, sans l'organisation. */
  collaborateurs?: Record<string, unknown[] | "echec">;
}

/**
 * Un lecteur factice qui retient ce qu'on lui a demandé : c'est ce qui rend le coût
 * en requêtes observable sans réseau, et c'est tout l'intérêt d'avoir séparé la
 * lecture de l'assemblage.
 */
function lecteur(reponses: Reponses): { lire: Lecteur; chemins: string[] } {
  return lecteurDOrganisations({ "incubateur-ademe": reponses });
}

/**
 * Le même lecteur, mais qui sait à quelle organisation on s'adresse : c'est ce qui
 * rend observable qu'aucune organisation non déclarée n'est interrogée.
 */
function lecteurDOrganisations(parOrganisation: Record<string, Reponses>): {
  lire: Lecteur;
  chemins: string[];
} {
  const chemins: string[] = [];

  const lire = (async <T>(chemin: string): Promise<T[]> => {
    chemins.push(chemin);

    const organisation = chemin.split("/")[2] ?? "";
    const reponses = parOrganisation[organisation];
    if (!reponses) {
      throw new Error("404 Not Found");
    }

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
    if (chemin.endsWith(`/orgs/${organisation}/repos`)) {
      if (reponses.depots === "echec") {
        throw new Error("500 Internal Server Error");
      }
      return (reponses.depots ?? []) as T[];
    }
    if (chemin.includes("/collaborators")) {
      const nom = chemin.split("/")[3] ?? "";
      const collaborateurs = reponses.collaborateurs?.[nom] ?? [];
      if (collaborateurs === "echec") {
        throw new Error("403 Forbidden");
      }
      return collaborateurs as T[];
    }
    if (chemin.endsWith("/repos")) {
      const equipe = chemin.split("/teams/")[1]?.replace("/repos", "") ?? "";
      const depots = reponses.depotsDEquipe?.[equipe] ?? [];
      if (depots === "echec") {
        throw new Error("500 Internal Server Error");
      }
      return depots as T[];
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
        externalId: "incubateur-ademe#10",
        label: "Équipe produit-alpha",
        url: "https://github.com/orgs/incubateur-ademe/teams/produit-alpha",
        // L'organisation contient l'équipe, et la comparaison exacte épingle du même
        // coup qu'elle-même n'est contenue par rien. La clé de l'équipe garde son dièse
        // et son organisation : ce que la contenance retire est l'obligation de l'y
        // relire, pas la clé, qu'on ne change pas sans dater tous ses accès disparus.
        parentExternalId: "incubateur-ademe",
      },
    ]);

    expect(assemblee.acces).toHaveLength(3);
    expect(assemblee.acces).toContainEqual({
      identityExternalId: "1",
      resourceExternalId: "incubateur-ademe#10",
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

    const partiel = await collecter(lire, ["incubateur-ademe"]);

    expect(partiel.status).toBe("partial");
    expect(partiel.errors?.[0]?.itemRef).toBe("incubateur-ademe/produit-beta");
    expect(partiel.status !== "failed" && partiel.identities).toHaveLength(2);

    // Aucun accès vers l'équipe illisible : le silence ne doit jamais valoir absence.
    const versBeta =
      partiel.status !== "failed" &&
      partiel.grants.filter((acces) => acces.resourceExternalId === "incubateur-ademe#11");
    expect(versBeta).toHaveLength(0);

    const sansListeDEquipes = await collecter(
      lecteur({ membres: [CAMILLE], equipes: "echec" }).lire,
      ["incubateur-ademe"],
    );

    expect(sansListeDEquipes.status).toBe("partial");
    expect(sansListeDEquipes.status !== "failed" && sansListeDEquipes.grants).toHaveLength(1);

    const rien = await collecter(lecteur({ membresEnEchec: true }).lire, ["incubateur-ademe"]);

    expect(rien.status).toBe("failed");
    expect(rien).not.toHaveProperty("identities");
  });

  it("fait suivre le coût au nombre d'équipes et de dépôts, jamais à celui des comptes", async () => {
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

    const depots = Array.from({ length: 5 }, (_, rang) => ({
      id: 500 + rang,
      full_name: `incubateur-ademe/depot-${rang}`,
      html_url: `https://github.com/incubateur-ademe/depot-${rang}`,
      archived: false,
    }));

    const petite = lecteur({ membres, equipes, membresDEquipe, depots });
    await lireOrganisation("incubateur-ademe", petite.lire);

    // Trois listes de l'organisation, deux par équipe, la liste des dépôts, un par dépôt
    expect(petite.chemins).toHaveLength(3 + 1 + 19 * 2 + 1 + 5);
    expect(petite.chemins.filter((chemin) => chemin.includes("/teams/"))).toHaveLength(38);
    expect(petite.chemins.filter((chemin) => chemin.includes("/collaborators"))).toHaveLength(5);
    expect(petite.chemins.some((chemin) => /personne-\d/.test(chemin))).toBe(false);

    const doublee = lecteur({
      membres: [...membres, ...membres.map((membre) => ({ ...membre, id: membre.id + 1000 }))],
      equipes,
      membresDEquipe,
      depots,
    });
    await lireOrganisation("incubateur-ademe", doublee.lire);

    expect(doublee.chemins).toHaveLength(petite.chemins.length);

    const uneDePlus = lecteur({
      membres,
      equipes: [...equipes, { id: 200, name: "produit-zeta", slug: "produit-zeta" }],
      membresDEquipe: { ...membresDEquipe, "produit-zeta": [] },
      depots,
    });
    await lireOrganisation("incubateur-ademe", uneDePlus.lire);

    expect(uneDePlus.chemins).toHaveLength(petite.chemins.length + 2);
  });
});

/**
 * `dryRun` vient de l'environnement et jamais du code : ces deux constantes nomment les
 * deux régimes pour que chaque scénario dise lequel il exerce, et pour qu'un booléen brut
 * ne ressemble jamais ici à un interrupteur qu'on pourrait choisir à la main.
 */
function depot(nom: string, id: number, archived = false) {
  return {
    id,
    full_name: `incubateur-ademe/${nom}`,
    html_url: `https://github.com/incubateur-ademe/${nom}`,
    archived,
  };
}

const PRESTATAIRE = { id: 9, login: "prestataire-exemple", type: "User", role_name: "admin" };
const admin = (compte: { id: number; login: string }) => ({
  ...compte,
  type: "User",
  role_name: "admin",
});

const PROPRIETAIRE = { id: 3, login: "proprietaire-exemple" };

/**
 * Huit dépôts, dont quatre seulement ont un administrateur humain en collaborateur direct
 * qui ne soit pas propriétaire de l'organisation.
 */
const DEPOTS: Reponses = {
  membresAdmin: [PROPRIETAIRE],
  membres: [CAMILLE, ALEX],
  equipes: [{ id: 10, name: "produit-alpha", slug: "produit-alpha" }],
  membresDEquipe: { "produit-alpha": [CAMILLE] },
  depotsDEquipe: {
    "produit-alpha": [
      { id: 102, role_name: "admin" },
      { id: 103, role_name: "push" },
    ],
  },
  depots: [
    depot("archive", 101, true),
    depot("tenu", 102),
    depot("seul", 103),
    depot("externe", 104),
    depot("partage", 105),
    depot("ecriture", 106),
    depot("robot", 107),
    depot("gere", 108),
  ],
  collaborateurs: {
    archive: [admin(CAMILLE)],
    tenu: [admin(CAMILLE)],
    seul: [admin(CAMILLE), { ...ALEX, type: "User", role_name: "write" }],
    externe: [PRESTATAIRE],
    partage: [admin(CAMILLE), admin(ALEX)],
    ecriture: [{ ...ALEX, type: "User", role_name: "maintain" }],
    robot: [{ id: 50, login: "dependabot", type: "Bot", role_name: "admin" }],
    gere: [admin(PROPRIETAIRE)],
  },
};

describe("les dépôts qu'un compte administre dans une organisation", () => {
  it("rend un objet possédé par administrateur direct, gardé ou transféré, jamais archivé", async () => {
    // Given huit dépôts, dont un archivé, un administré par une équipe, un partagé entre deux
    // administrateurs, un tenu par un prestataire hors de l'organisation, un où seul un
    // propriétaire de l'organisation figure, et trois sans administrateur humain
    const { lire } = lecteur(DEPOTS);

    // When l'organisation se lit et s'assemble
    const assemblee = assemblerOrganisation(
      "incubateur-ademe",
      await lireOrganisation("incubateur-ademe", lire),
    );

    // Then chaque administrateur direct possède son dépôt, avec le destin du dépôt : gardé
    // s'il est archivé ou qu'une équipe l'administre, transféré sinon, même quand une équipe
    // y écrit sans l'administrer
    expect(assemblee.references).toEqual([
      { resourceExternalId: "incubateur-ademe/101", ownerIdentityExternalId: "1", fate: "keep" },
      { resourceExternalId: "incubateur-ademe/102", ownerIdentityExternalId: "1", fate: "keep" },
      {
        resourceExternalId: "incubateur-ademe/103",
        ownerIdentityExternalId: "1",
        fate: "transfer",
      },
      {
        resourceExternalId: "incubateur-ademe/104",
        ownerIdentityExternalId: "9",
        fate: "transfer",
      },
      {
        resourceExternalId: "incubateur-ademe/105",
        ownerIdentityExternalId: "1",
        fate: "transfer",
      },
      {
        resourceExternalId: "incubateur-ademe/105",
        ownerIdentityExternalId: "2",
        fate: "transfer",
      },
    ]);

    // Then un dépôt possédé devient une ressource de l'organisation, sur son identifiant,
    // et un dépôt où personne n'administre n'en devient pas une
    expect(assemblee.ressources).toContainEqual({
      externalId: "incubateur-ademe/103",
      label: "Dépôt incubateur-ademe/seul",
      url: "https://github.com/incubateur-ademe/seul",
      parentExternalId: "incubateur-ademe",
    });
    expect(assemblee.ressources.filter(({ label }) => label.startsWith("Dépôt "))).toHaveLength(5);

    // Then le prestataire a un compte, sans siège dans l'organisation : son dépôt va à son
    // compte et non aux orphelins
    expect(assemblee.identites).toContainEqual({
      externalId: "9",
      idKind: "opaque",
      handle: "prestataire-exemple",
    });
    expect(assemblee.acces.filter(({ identityExternalId }) => identityExternalId === "9")).toEqual(
      [],
    );

    // Then la collecte rend ces objets possédés, sur un passage complet
    const complete = await collecter(lecteur(DEPOTS).lire, ["incubateur-ademe"]);
    expect(complete.status).toBe("ok");
    expect(complete.status !== "failed" && complete.references).toHaveLength(6);
  });

  it("ne rend aucun objet possédé sur une liste qui manque", async () => {
    // When les collaborateurs d'un dépôt ne se lisent pas, comme avec un jeton qui ne couvre
    // aucun dépôt
    const illisible = await collecter(
      lecteur({ ...DEPOTS, collaborateurs: { ...DEPOTS.collaborateurs, seul: "echec" } }).lire,
      ["incubateur-ademe"],
    );

    // Then le passage est partiel, nomme le dépôt une seule fois, et ne rend aucun objet
    // possédé
    expect(illisible.status).toBe("partial");
    expect(illisible.errors?.map(({ itemRef }) => itemRef)).toEqual(["incubateur-ademe/seul"]);
    expect(illisible).not.toHaveProperty("references");

    // When la liste des dépôts, les dépôts d'une équipe ou la liste des équipes ne se lisent
    // pas
    const sansListe = await collecter(lecteur({ ...DEPOTS, depots: "echec" }).lire, [
      "incubateur-ademe",
    ]);
    const sansEquipe = await collecter(
      lecteur({ ...DEPOTS, depotsDEquipe: { "produit-alpha": "echec" } }).lire,
      ["incubateur-ademe"],
    );
    const sansEquipes = await collecter(lecteur({ ...DEPOTS, equipes: "echec" }).lire, [
      "incubateur-ademe",
    ]);

    // Then aucun objet possédé n'est rendu, puisqu'un destin se déciderait sur une lecture
    // amputée, et les comptes, eux, restent rendus
    for (const passage of [sansListe, sansEquipe, sansEquipes]) {
      expect(passage.status).toBe("partial");
      expect(passage).not.toHaveProperty("references");
      expect(passage.status !== "failed" && passage.identities).toHaveLength(3);
    }

    // When une seconde organisation déclarée ne rend pas ses dépôts
    const deux = await collecter(
      lecteurDOrganisations({
        "incubateur-ademe": DEPOTS,
        "autre-incubateur": { ...DEPOTS, depots: "echec" },
      }).lire,
      ["incubateur-ademe", "autre-incubateur"],
    );

    // Then rien n'est rendu non plus pour la première
    expect(deux).not.toHaveProperty("references");
  });
});

const SIMULATION = true;
const AUTORISEE = false;

const CONTEXTE: RunContext = {
  runId: "collecte-de-test",
  now: new Date("2026-08-22T00:00:00Z"),
  dryRun: SIMULATION,
  audit: () => undefined,
};

/** Une adhésion constatée, telle que le socle la transmet au départ. */
function siege(organisation: string, role = "member") {
  return {
    identityExternalId: "1",
    identityHandle: "camille-rivet",
    resourceExternalId: organisation,
    resourceLabel: `Organisation ${organisation}`,
    role,
  };
}

const REVOCATION: Intent = {
  kind: "revoke",
  subject: {
    kind: "person",
    username: "camille.rivet",
    acces: [siege("incubateur-ademe"), siege("autre-incubateur")],
  },
};

describe("les organisations que le connecteur GitHub suit sont celles qu'on lui déclare", () => {
  it("n'interroge que les organisations déclarées, et rend les sièges de chacune", async () => {
    const { lire, chemins } = lecteurDOrganisations({
      "incubateur-ademe": {
        membres: [CAMILLE],
        equipes: [{ id: 10, name: "produit-alpha", slug: "produit-alpha" }],
        membresDEquipe: { "produit-alpha": [CAMILLE] },
      },
      "autre-incubateur": { membres: [ALEX] },
      "jamais-declaree": { membres: [{ id: 9, login: "intruse" }] },
    });

    const collecte = await collecter(lire, ["incubateur-ademe", "autre-incubateur"]);

    expect(collecte.status).toBe("ok");
    expect(collecte.errors).toBeUndefined();
    expect(collecte.status !== "failed" && collecte.identities).toHaveLength(2);

    expect(chemins.some((chemin) => chemin.includes("/orgs/jamais-declaree/"))).toBe(false);
    expect(
      chemins.every((chemin) => /^\/orgs\/(incubateur-ademe|autre-incubateur)\//.test(chemin)),
    ).toBe(true);

    const ressources =
      collecte.status !== "failed"
        ? collecte.resources.map((ressource) => ressource.externalId)
        : [];
    expect(ressources).toContain("incubateur-ademe");
    expect(ressources).toContain("autre-incubateur");

    expect(collecte.status !== "failed" && collecte.grants).toContainEqual({
      identityExternalId: "2",
      resourceExternalId: "autre-incubateur",
      role: "member",
    });
  });

  it("dégrade sur une organisation muette, et n'écrit rien quand toutes le sont", async () => {
    const partielle = await collecter(
      lecteurDOrganisations({
        "incubateur-ademe": { membres: [CAMILLE] },
        "autre-incubateur": { membresEnEchec: true },
      }).lire,
      ["incubateur-ademe", "autre-incubateur"],
    );

    expect(partielle.status).toBe("partial");
    expect(partielle.errors?.map((erreur) => erreur.itemRef)).toContain("autre-incubateur");
    expect(partielle.status !== "failed" && partielle.identities).toHaveLength(1);

    // L'organisation restée lisible garde ses accès : une panne chez la voisine ne
    // doit jamais faire passer ses membres pour partis.
    expect(partielle.status !== "failed" && partielle.grants).toContainEqual({
      identityExternalId: "1",
      resourceExternalId: "incubateur-ademe",
      role: "member",
    });

    const rien = await collecter(
      lecteurDOrganisations({
        "incubateur-ademe": { membresEnEchec: true },
        "autre-incubateur": { membresEnEchec: true },
      }).lire,
      ["incubateur-ademe", "autre-incubateur"],
    );

    expect(rien.status).toBe("failed");
    expect(rien).not.toHaveProperty("identities");
    expect(rien.errors).toHaveLength(2);
  });

  it("refuse une liste vide et produit une étape de retrait par organisation", async () => {
    const vide = CONTRAT_GITHUB.configSchema?.safeParse({ organisations: [] });
    expect(vide?.success).toBe(false);

    const inconnue = CONTRAT_GITHUB.configSchema?.safeParse({ organisation: ["incubateur-ademe"] });
    expect(inconnue?.success).toBe(false);

    // Ne rien déclarer revient exactement à déclarer le défaut : sans ça, le
    // mécanisme de configuration éteindrait la collecte le jour de son arrivée.
    const absente = CONTRAT_GITHUB.configSchema?.safeParse({});
    expect(absente?.success && absente.data).toEqual({ organisations: ["incubateur-ademe"] });

    const connecteur = creerGithub(() => ({
      organisations: ["incubateur-ademe", "autre-incubateur"],
    }));

    const etapes = await connecteur.plan(REVOCATION, CONTEXTE);

    expect(etapes).toHaveLength(2);
    expect(etapes.map((etape) => etape.idempotencyKey)).toEqual([
      "github:incubateur-ademe:revoke:camille.rivet",
      "github:autre-incubateur:revoke:camille.rivet",
    ]);
    expect(etapes.every((etape) => etape.tier === "manual" && etape.riskLevel === "high")).toBe(
      true,
    );
    expect(etapes[1]?.manual?.deeplink).toBe("https://github.com/orgs/autre-incubateur/people");

    const octroi = await connecteur.plan({ ...REVOCATION, kind: "grant" }, CONTEXTE);
    expect(octroi).toHaveLength(0);

    // Un dépôt possédé s'ajoute aux retraits, à la main, avec la consigne de son destin
    const avecDepots = await connecteur.plan(
      {
        ...REVOCATION,
        subject: {
          ...REVOCATION.subject,
          kind: "person",
          username: "camille.rivet",
          references: [
            {
              resourceExternalId: "incubateur-ademe/103",
              resourceLabel: "Dépôt incubateur-ademe/seul",
              url: "https://github.com/incubateur-ademe/seul",
              fate: "transfer",
            },
            {
              resourceExternalId: "incubateur-ademe/104",
              resourceLabel: "Dépôt incubateur-ademe/vieux",
              fate: "archive",
            },
          ],
        },
      },
      CONTEXTE,
    );
    expect(avecDepots.map(({ label }) => label).slice(2)).toEqual([
      "Transférer le dépôt incubateur-ademe/seul",
      "Archiver le dépôt incubateur-ademe/vieux",
    ]);
    expect(avecDepots[2]?.manual?.runbook).toContain("donner le rôle Admin au repreneur");
    expect(avecDepots[3]?.manual?.runbook).toContain("Archive this repository");
    expect(avecDepots.slice(2).every(({ capability }) => capability === "reference")).toBe(true);
  });
});

const CAMILLE_GITHUB = "camille-rivet";

const SUJET: SubjectRef = {
  kind: "person",
  username: "camille.rivet",
  handles: { github: CAMILLE_GITHUB },
};

/** La même personne, dont aucun compte GitHub n'est connu avec certitude. */
const SANS_COMPTE: SubjectRef = { kind: "person", username: "camille.rivet" };

const MEMBRE: ScopeGithub = { organisation: "incubateur-ademe", role: "member" };
const ADMINISTRATION: ScopeGithub = { organisation: "incubateur-ademe", role: "admin" };

const EXECUTION: RunContext = { ...CONTEXTE, dryRun: AUTORISEE };

function etapeUnique(etapes: readonly PlannedStep[]): PlannedStep {
  const [etape, ...reste] = etapes;

  if (!etape || reste.length > 0) {
    throw new Error(`une seule étape était attendue, ${etapes.length} rendues`);
  }

  return etape;
}

/** Une sonde qui retient ce qu'on lui a demandé, et ne joint jamais GitHub. */
function sonde(reponse: ReponseGithub): { sonder: Sonde; chemins: string[] } {
  const chemins: string[] = [];

  return {
    chemins,
    sonder: (chemin) => {
      chemins.push(chemin);
      return Promise.resolve(reponse);
    },
  };
}

function ecriture(reponse: ReponseGithub | Error): {
  ecrire: Ecriture;
  appels: { chemin: string; corps: unknown }[];
} {
  const appels: { chemin: string; corps: unknown }[] = [];

  return {
    appels,
    ecrire: (chemin, corps) => {
      appels.push({ chemin, corps });
      return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse);
    },
  };
}

describe("l'arrivée sur GitHub, telle qu'un profil la demande", () => {
  it("nomme le compte visé, et dégrade pour deux raisons qui ne se confondent pas", async () => {
    // Given un jeton d'écriture et un compte GitHub dont le socle répond
    environnement.jetonAdmin = "jeton-d-administration";

    // When le profil ouvre un siège de membre
    const auto = etapeUnique(planifierOctroiGithub(MEMBRE, SUJET, true));

    // Then l'étape est automatique, nomme le compte visé, et porte la fenêtre de
    // réversibilité que sa capacité déclare : c'est elle qui décide de l'ordre
    // d'exécution.
    expect(auto.tier).toBe("auto");
    expect(auto.capability).toBe("grant");
    expect(auto.riskLevel).toBe("medium");
    expect(auto.reversibleForDays).toBe(7);
    expect(auto.manual).toBeUndefined();
    expect(auto.label).toContain(CAMILLE_GITHUB);
    expect(auto.params).toEqual({
      organisation: "incubateur-ademe",
      role: "member",
      beneficiaire: "camille.rivet",
      compte: CAMILLE_GITHUB,
    });
    expect(auto.expectedState).toEqual({ membre: true, role: "member" });
    expect(auto.idempotencyKey).toBe("github:incubateur-ademe:grant:camille.rivet:member");

    // Then l'administration de l'organisation ne porte pas le même risque qu'un siège
    // ordinaire : c'est ce risque qui exige une échéance ailleurs.
    expect(etapeUnique(planifierOctroiGithub(ADMINISTRATION, SUJET, true)).riskLevel).toBe("high");

    // When le jeton d'écriture manque
    const sansJeton = etapeUnique(planifierOctroiGithub(MEMBRE, SUJET, false));

    // Then l'étape reste, à la main, et dit ce qui manque pour l'automatiser. Une
    // ligne d'arrivée qui disparaît est le mode de panne que cet outil évite.
    expect(sansJeton.tier).toBe("manual");
    expect(sansJeton.reversibleForDays).toBeUndefined();
    expect(sansJeton.manual?.runbook).toContain("github-token-admin");
    expect(sansJeton.manual?.deeplink).toBe("https://github.com/orgs/incubateur-ademe/people");

    // Then le critère de complétion dit qu'une invitation en attente est un accès
    // accordé : sans cette phrase, l'opérateur relancerait un accès déjà donné, ou
    // pire, croirait la porte fermée tant que personne n'a cliqué.
    expect(sansJeton.manual?.doneWhen).toContain("invitations en attente");
    expect(sansJeton.manual?.doneWhen).toContain("accès accordé");

    // When c'est l'identifiant qui manque, le jeton étant là
    const sansCompte = etapeUnique(planifierOctroiGithub(MEMBRE, SANS_COMPTE, true));

    // Then l'étape dégrade aussi, mais pour l'autre raison, et le refus le dit : ce
    // qui manque est une donnée, pas un secret, et les deux appellent deux gestes
    // différents.
    expect(sansCompte.tier).toBe("manual");
    expect(sansCompte.params["compte"]).toBeNull();
    expect(sansCompte.manual?.runbook).toContain("Aucun identifiant GitHub sûr");
    expect(sansCompte.manual?.runbook).not.toContain("github-token-admin");

    // Then la clé d'idempotence n'a pas bougé : elle suit le pivot d'identité, et non
    // un compte qui peut se découvrir entre deux calculs.
    expect(sansCompte.idempotencyKey).toBe(auto.idempotencyKey);

    // When le même octroi passe par le plan du contrat, avec son scope
    const connecteur = creerGithub(() => ({ organisations: ["incubateur-ademe"] }));
    const parLePlan = await connecteur.plan(
      { kind: "grant", subject: SUJET, scope: MEMBRE },
      CONTEXTE,
    );

    // Then c'est le même geste, sous la même clé : les deux voies convergent sur une
    // seule fonction, faute de quoi le même octroi sortirait deux fois.
    expect(etapeUnique(parLePlan).idempotencyKey).toBe(auto.idempotencyKey);
    expect(etapeUnique(connecteur.planifierOctroi?.(MEMBRE, SUJET) ?? []).idempotencyKey).toBe(
      auto.idempotencyKey,
    );

    // Then sans scope, aucune étape : ce que le profil décide ne se devine pas, et une
    // adhésion par défaut donnerait à toute arrivée un accès que personne n'a demandé.
    expect(await connecteur.plan({ kind: "grant", subject: SUJET }, CONTEXTE)).toHaveLength(0);
    expect(
      await connecteur.plan({ kind: "grant", subject: SUJET, scope: { role: "member" } }, CONTEXTE),
    ).toHaveLength(0);
  });
});

describe("le précheck de GitHub, qui est une lecture", () => {
  it("solde un accès déjà ouvert, et arrête l'escalade silencieuse sur un rôle qui diffère", async () => {
    const attendu = { role: "member" };

    // Given personne à ce nom dans l'organisation
    // Then il reste quelque chose à faire
    expect(interpreterAppartenance(404, undefined, attendu)).toEqual({ state: "READY" });

    // Given une adhésion active au rôle attendu
    // Then l'étape est soldée sans qu'aucun appel n'ait été fait
    expect(interpreterAppartenance(200, { state: "active", role: "member" }, attendu)).toEqual({
      state: "ALREADY_PRESENT",
    });

    // Given une invitation encore en attente, dans le vocabulaire des invitations
    // Then c'est déjà un accès accordé, et non un accès en suspens
    expect(
      interpreterAppartenance(200, { state: "pending", role: "direct_member" }, attendu),
    ).toEqual({ state: "ALREADY_PRESENT" });

    // Given un membre déjà en place, alors que le profil demande une administration
    const escalade = interpreterAppartenance(
      200,
      { state: "active", role: "member" },
      {
        role: "admin",
      },
    );

    // Then rien ne partira : un PUT avec « admin » sur ce compte répondrait 200 sans
    // rien signaler, en élevant le rôle en place. C'est l'écart qui l'empêche, et il
    // porte l'attendu et le constaté, que le journal recopie tels quels.
    expect(escalade).toEqual({
      state: "STALE",
      expected: { etat: "active ou pending", role: "admin" },
      actual: { etat: "active", role: "member" },
    });

    // Given une réponse dont l'état ne se lit pas
    // Then c'est un écart et non une absence : ne pas savoir n'autorise pas à écrire
    expect(interpreterAppartenance(200, { rien: true }, attendu)).toEqual({
      state: "STALE",
      expected: { etat: "active ou pending", role: "member" },
      actual: { etat: null, role: null },
    });

    // Given une organisation qui répond mal
    // Then la lecture n'a pas eu lieu, et rien n'est décidé dessus
    expect(() => interpreterAppartenance(500, undefined, attendu)).toThrow("500");

    // Given une étape d'octroi et la lecture d'une adhésion existante
    const etape = etapeUnique(planifierOctroiGithub(MEMBRE, SUJET, true));
    const lecture = sonde({ statut: 200, corps: { state: "active", role: "member" } });

    // When le précheck tourne
    const verdict = await constaterAppartenance(lecture.sonder, etape);

    // Then il a lu le compte que l'étape désigne, et lui seul
    expect(lecture.chemins).toEqual([`/orgs/incubateur-ademe/memberships/${CAMILLE_GITHUB}`]);
    expect(verdict).toEqual({ state: "ALREADY_PRESENT" });

    // Given une étape que l'octroi n'a pas écrite, ou qui ne désigne aucun compte
    const retrait = etapeUnique(
      planifierRetraitGithub(
        ["incubateur-ademe"],
        { kind: "person", username: "camille.rivet", acces: [siege("incubateur-ademe")] },
        true,
      ),
    );
    const muette = sonde({ statut: 404, corps: undefined });

    // When le précheck la reçoit
    const surLeRetrait = await constaterAppartenance(muette.sonder, retrait);
    const surLOctroiSansCompte = await constaterAppartenance(
      muette.sonder,
      etapeUnique(planifierOctroiGithub(MEMBRE, SANS_COMPTE, true)),
    );

    // Then rien n'est lu et rien n'est conclu : déduire un login de l'identifiant beta.gouv
    // serait la ressemblance sur laquelle ce produit refuse d'agir.
    expect(surLeRetrait).toEqual({ state: "READY" });
    expect(surLOctroiSansCompte).toEqual({ state: "READY" });
    expect(muette.chemins).toEqual([]);
  });
});

describe("l'exécution d'un octroi GitHub", () => {
  it("ne part jamais en simulation, et dit ce que GitHub a répondu quand elle part", async () => {
    const etape = etapeUnique(planifierOctroiGithub(MEMBRE, SUJET, true));

    // Given une exécution demandée alors que rien ne l'autorise
    const simulation = ecriture({ statut: 200, corps: { state: "pending", role: "member" } });

    // When elle atteint le connecteur
    // Then elle est refusée ici aussi, et non chez le seul appelant : ce qui ne part
    // pas ne peut pas partir par erreur.
    await expect(executerOctroi(simulation.ecrire, true, etape, CONTEXTE)).rejects.toThrow(
      "ACTIONS_ENABLED",
    );
    expect(simulation.appels).toEqual([]);

    // Given l'écriture autorisée, mais aucun jeton d'administration
    const sansJeton = ecriture({ statut: 200, corps: {} });
    const refus = await executerOctroi(sansJeton.ecrire, false, etape, EXECUTION);

    // Then l'échec est définitif et renvoie à la marche à suivre : reprendre tel quel
    // échouerait de la même façon.
    expect(refus).toEqual({
      state: "FAILED",
      error: expect.stringContaining("github-token-admin"),
      retryable: false,
    });
    expect(sansJeton.appels).toEqual([]);

    // Given une étape que ce connecteur n'a pas écrite
    const etrangere = ecriture({ statut: 200, corps: {} });
    const inconnue = await executerOctroi(
      etrangere.ecrire,
      true,
      { ...etape, action: "ouvrir-l-acces" },
      EXECUTION,
    );

    // Then rien n'est écrit au hasard sur un système tiers
    expect(inconnue.state).toBe("FAILED");
    expect(inconnue.state === "FAILED" && inconnue.retryable).toBe(false);
    expect(etrangere.appels).toEqual([]);

    // Given l'écriture autorisée et un compte à inviter
    const envoi = ecriture({ statut: 200, corps: { state: "pending", role: "member" } });
    const issue = await executerOctroi(envoi.ecrire, true, etape, EXECUTION);

    // Then l'appel a visé le compte de l'étape, avec le rôle qu'elle porte
    expect(envoi.appels).toEqual([
      {
        chemin: `/orgs/incubateur-ademe/memberships/${CAMILLE_GITHUB}`,
        corps: { role: "member" },
      },
    ]);

    // Then l'évidence dit qu'une invitation a été envoyée et non qu'un accès est
    // ouvert : personne ne l'a encore acceptée.
    expect(issue.state).toBe("SUCCEEDED");
    expect(issue.state === "SUCCEEDED" && issue.evidence).toContain("Invitation envoyée");
    expect(issue.state === "SUCCEEDED" && issue.reversibleUntil).toEqual(
      new Date("2026-08-29T00:00:00Z"),
    );

    // Given une adhésion immédiatement active
    const active = await executerOctroi(
      ecriture({ statut: 200, corps: { state: "active", role: "admin" } }).ecrire,
      true,
      etape,
      EXECUTION,
    );
    expect(active.state === "SUCCEEDED" && active.evidence).toContain("Adhésion active");

    // Given un refus du fournisseur
    const interdit = await executerOctroi(
      ecriture({ statut: 403, corps: { message: "Resource not accessible" } }).ecrire,
      true,
      etape,
      EXECUTION,
    );

    // Then l'échec porte ce que GitHub a dit, et ne se retente pas tout seul
    expect(interdit).toEqual({
      state: "FAILED",
      error: "GitHub a répondu 403 : Resource not accessible",
      retryable: false,
    });

    // Given une panne passagère, puis une panne de transport
    const panne = await executerOctroi(
      ecriture({ statut: 502, corps: undefined }).ecrire,
      true,
      etape,
      EXECUTION,
    );
    const coupure = await executerOctroi(
      ecriture(new Error("connexion interrompue")).ecrire,
      true,
      etape,
      EXECUTION,
    );

    // Then les deux se reprennent : la reprise repassera par le précheck, qui
    // constatera ce qui a eu lieu ou non.
    expect(panne.state === "FAILED" && panne.retryable).toBe(true);
    expect(coupure).toEqual({
      state: "FAILED",
      error: "connexion interrompue",
      retryable: true,
    });
  });
});

/** Une sonde qui répond selon le chemin, et retient ce qu'on lui a demandé. */
function sondeParChemin(reponses: Record<string, ReponseGithub>): {
  sonder: Sonde;
  chemins: string[];
} {
  const chemins: string[] = [];
  return {
    chemins,
    sonder: (chemin) => {
      chemins.push(chemin);
      return Promise.resolve(reponses[chemin] ?? { statut: 404, corps: undefined });
    },
  };
}

function suppression(reponse: ReponseGithub | Error): {
  supprimer: Suppression;
  chemins: string[];
} {
  const chemins: string[] = [];
  return {
    chemins,
    supprimer: (chemin) => {
      chemins.push(chemin);
      return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse);
    },
  };
}

const RENOMMEE = "camille-renommee";
const ADHESION = `/orgs/incubateur-ademe/memberships/${RENOMMEE}`;

/** Le retrait d'un membre, tel qu'un départ le planifie avec un jeton d'écriture. */
function retraitDUnMembre(): PlannedStep {
  return etapeUnique(
    planifierRetraitGithub(
      ["incubateur-ademe"],
      { kind: "person", username: "camille.rivet", acces: [siege("incubateur-ademe")] },
      true,
    ),
  );
}

describe("le départ sur GitHub", () => {
  it("retire seul un membre, et laisse à la main un administrateur et une invitation", () => {
    // Given une personne membre d'une organisation, administratrice d'une autre, invitée par
    // adresse dans une troisième, par login dans une quatrième, et absente d'une cinquième
    const sujet: Extract<SubjectRef, { kind: "person" }> = {
      kind: "person",
      username: "camille.rivet",
      acces: [
        siege("incubateur-ademe"),
        { ...siege("autre-incubateur", "admin"), resourceLabel: "Organisation autre-incubateur" },
        {
          identityExternalId: "email:camille@exemple.fr",
          identityHandle: "camille@exemple.fr",
          resourceExternalId: "troisieme",
          role: "invite:direct_member",
        },
        {
          identityExternalId: "invite-77",
          identityHandle: "camille-rivet",
          resourceExternalId: "quatrieme",
          role: "invite:direct_member",
        },
      ],
    };
    const organisations = [
      "incubateur-ademe",
      "autre-incubateur",
      "troisieme",
      "quatrieme",
      "cinquieme",
    ];

    // When le départ se planifie avec un jeton d'écriture
    const etapes = planifierRetraitGithub(organisations, sujet, true);

    // Then une étape par organisation où un accès est constaté, aucune ailleurs
    expect(etapes.map(({ params }) => params["organisation"])).toEqual([
      "incubateur-ademe",
      "autre-incubateur",
      "troisieme",
      "quatrieme",
    ]);
    const [membre, administratrice, invitation, invitationParLogin] = etapes;

    // Then le membre part seul, et l'étape nomme le compte qu'elle vise
    expect(membre?.tier).toBe("auto");
    expect(membre?.manual).toBeUndefined();
    expect(membre?.label).toBe(
      "Retirer camille.rivet (compte camille-rivet) de l'organisation incubateur-ademe",
    );
    expect(membre?.idempotencyKey).toBe("github:incubateur-ademe:revoke:camille.rivet");

    // Then l'administratrice et les deux invitations restent à la main, chacune avec sa
    // raison, et le critère nomme ce qu'on cherche dans la liste, pas l'identifiant beta.gouv
    expect(administratrice?.tier).toBe("manual");
    expect(administratrice?.manual?.runbook).toContain("Un administrateur");
    expect(administratrice?.manual?.doneWhen).toBe(
      "camille-rivet n'apparaît plus dans les membres de autre-incubateur, ni dans les invitations en attente.",
    );
    expect(invitation?.tier).toBe("manual");
    expect(invitation?.manual?.runbook).toContain("Une invitation en attente");
    expect(invitation?.label).toBe("Retirer camille.rivet de l'organisation troisieme");
    expect(invitation?.manual?.doneWhen).toContain("camille@exemple.fr n'apparaît plus");
    // Un login d'invitation peut changer de porteur avant l'exécution : rien ne part seul
    expect(invitationParLogin?.tier).toBe("manual");
    expect(invitationParLogin?.manual?.runbook).toContain("Une invitation en attente");

    // When le jeton d'écriture manque
    const sansJeton = planifierRetraitGithub(organisations, sujet, false);

    // Then le membre aussi reste à la main, et l'étape dit ce qui manque
    expect(sansJeton[0]?.tier).toBe("manual");
    expect(sansJeton[0]?.manual?.runbook).toContain("il manque : github-token-admin");

    // When la personne siège dans une organisation sous deux comptes
    const deuxComptes = planifierRetraitGithub(
      ["incubateur-ademe"],
      {
        kind: "person",
        username: "camille.rivet",
        acces: [
          siege("incubateur-ademe"),
          { ...siege("incubateur-ademe"), identityExternalId: "2", identityHandle: "camille-bis" },
        ],
      },
      true,
    );

    // Then une seule étape, à la main, qui les nomme tous les deux : la clé ne nomme pas le
    // compte, et retirer le premier seul laisserait le second en place
    expect(deuxComptes).toHaveLength(1);
    expect(deuxComptes[0]?.tier).toBe("manual");
    expect(deuxComptes[0]?.label).toBe(
      "Retirer camille.rivet (comptes camille-rivet, camille-bis) de l'organisation incubateur-ademe",
    );
    expect(deuxComptes[0]?.manual?.doneWhen).toContain(
      "camille-rivet, camille-bis n'apparaissent plus",
    );

    // When le même compte garde son ancien rôle vivant à côté du nouveau, après une
    // promotion vue par un passage partiel
    const promue = planifierRetraitGithub(
      ["incubateur-ademe"],
      {
        kind: "person",
        username: "camille.rivet",
        acces: [siege("incubateur-ademe"), siege("incubateur-ademe", "admin")],
      },
      true,
    );

    // Then c'est un seul compte, administrateur, à la main, et ses paramètres ne portent pas
    // le login, qu'un renommage changerait
    expect(promue[0]?.label).toBe(
      "Retirer camille.rivet (compte camille-rivet) de l'organisation incubateur-ademe",
    );
    expect(promue[0]?.tier).toBe("manual");
    expect(promue[0]?.manual?.runbook).toContain("Un administrateur");
    expect(promue[0]?.params).not.toHaveProperty("compte");

    // Then le contrat déclare la voie automatique du retrait, et sa voie manuelle dessous
    expect(CONTRAT_GITHUB.capabilities.revoke?.map(({ tier }) => tier)).toEqual(["auto", "manual"]);
  });

  it("relit le login par l'identifiant avant de conclure, et refuse un membre promu entre-temps", async () => {
    // Given un membre dont le login a changé depuis la collecte
    const etape = retraitDUnMembre();
    const present = sondeParChemin({
      "/user/1": { statut: 200, corps: { login: RENOMMEE } },
      [ADHESION]: { statut: 200, corps: { state: "active", role: "member" } },
    });
    const lecture = sondeParChemin({});

    // Then le précheck lit l'adhésion du login actuel, et le retrait est à faire
    expect(await constaterRetrait(present.sonder, lecture.sonder, etape)).toEqual({
      state: "READY",
    });
    expect(present.chemins).toEqual(["/user/1", ADHESION]);

    // Given le même membre parti entre-temps, ce que le jeton de collecte confirme, ou dont le
    // compte n'existe plus
    const parti = sondeParChemin({ "/user/1": { statut: 200, corps: { login: RENOMMEE } } });
    const supprime = sondeParChemin({});

    // Then l'étape se solde sans qu'un humain aille vérifier
    expect(await constaterRetrait(parti.sonder, lecture.sonder, etape)).toEqual({
      state: "ALREADY_ABSENT",
    });
    expect(lecture.chemins).toEqual([`/orgs/incubateur-ademe/members/${RENOMMEE}`]);
    expect(await constaterRetrait(supprime.sonder, lecture.sonder, etape)).toEqual({
      state: "ALREADY_ABSENT",
    });
    expect(supprime.chemins).toEqual(["/user/1"]);

    // Given un jeton d'écriture qui ne voit pas l'organisation, quand celui de collecte y voit
    // le membre
    const encoreLa = sondeParChemin({
      [`/orgs/incubateur-ademe/members/${RENOMMEE}`]: { statut: 204, corps: undefined },
    });

    // Then rien ne se solde, et le refus nomme le jeton à vérifier
    await expect(constaterRetrait(parti.sonder, encoreLa.sonder, etape)).rejects.toThrow(
      "Vérifiez que github-token-admin couvre incubateur-ademe",
    );

    // Given une invitation à la main, qu'aucun compte ne désigne
    const [invitation] = planifierRetraitGithub(
      ["incubateur-ademe"],
      {
        kind: "person",
        username: "camille.rivet",
        acces: [{ ...siege("incubateur-ademe"), identityExternalId: "invite-77" }],
      },
      true,
    );
    const muette = sondeParChemin({});

    // Then le précheck ne lit rien et laisse la main décider
    expect(await constaterRetrait(muette.sonder, muette.sonder, invitation as PlannedStep)).toEqual(
      { state: "READY" },
    );
    expect(muette.chemins).toEqual([]);

    // Given le même membre promu administrateur depuis le plan
    const promu = sondeParChemin({
      "/user/1": { statut: 200, corps: { login: RENOMMEE } },
      [ADHESION]: { statut: 200, corps: { state: "active", role: "admin" } },
    });

    // Then le précheck refuse, et rien ne part sans qu'un humain le revoie
    expect(await constaterRetrait(promu.sonder, lecture.sonder, etape)).toMatchObject({
      state: "STALE",
      actual: { role: "admin" },
    });

    // Given une organisation qui répond mal
    const panne = sondeParChemin({
      "/user/1": { statut: 200, corps: { login: RENOMMEE } },
      [ADHESION]: { statut: 502, corps: undefined },
    });

    // Then rien n'est décidé
    await expect(constaterRetrait(panne.sonder, lecture.sonder, etape)).rejects.toThrow("502");
  });

  it("ne part jamais en simulation, et dit ce que GitHub a répondu quand elle part", async () => {
    const etape = retraitDUnMembre();
    const relu = sondeParChemin({ "/user/1": { statut: 200, corps: { login: RENOMMEE } } });

    // Given la simulation : rien ne part, et le refus le dit
    const simulee = suppression({ statut: 204, corps: undefined });
    await expect(
      executerRetrait(relu.sonder, simulee.supprimer, true, etape, CONTEXTE),
    ).rejects.toThrow("ACTIONS_ENABLED");
    expect(simulee.chemins).toEqual([]);

    // Given aucun jeton d'écriture : l'étape échoue sans reprise, et renvoie à la main
    const sansJeton = await executerRetrait(
      relu.sonder,
      simulee.supprimer,
      false,
      etape,
      EXECUTION,
    );
    expect(sansJeton).toMatchObject({ state: "FAILED", retryable: false });

    // Given une étape qui vise un administrateur, même mal écrite en automatique
    const administratrice = { ...etape, params: { ...etape.params, role: "admin" } };
    const refusee = await executerRetrait(
      relu.sonder,
      simulee.supprimer,
      true,
      administratrice,
      EXECUTION,
    );
    expect(refusee).toMatchObject({ state: "FAILED", retryable: false });
    expect(simulee.chemins).toEqual([]);

    // When le retrait part
    const reussie = suppression({ statut: 204, corps: undefined });
    const issue = await executerRetrait(relu.sonder, reussie.supprimer, true, etape, EXECUTION);

    // Then il vise le login relu, et le dit
    expect(reussie.chemins).toEqual([ADHESION]);
    expect(issue).toMatchObject({ state: "SUCCEEDED" });

    // Then un absent est un succès, un refus de droit ne se reprend pas, une panne si
    expect(
      await executerRetrait(
        relu.sonder,
        suppression({ statut: 404, corps: undefined }).supprimer,
        true,
        etape,
        EXECUTION,
      ),
    ).toEqual({ state: "ALREADY_ABSENT" });
    expect(
      await executerRetrait(
        relu.sonder,
        suppression({ statut: 403, corps: { message: "Must have admin rights" } }).supprimer,
        true,
        etape,
        EXECUTION,
      ),
    ).toEqual({
      state: "FAILED",
      error: "GitHub a répondu 403 : Must have admin rights",
      retryable: false,
    });
    expect(
      await executerRetrait(
        relu.sonder,
        suppression(new Error("connexion coupée")).supprimer,
        true,
        etape,
        EXECUTION,
      ),
    ).toMatchObject({ state: "FAILED", retryable: true });
  });
});
