import { describe, expect, it } from "vitest";

import {
  type CompteDeServiceConnu,
  normaliserLogin,
  type PersonneConnue,
  rapprocher,
} from "./rapprochement";

const PERSONNES: PersonneConnue[] = [
  {
    id: "p-jean",
    username: "jean.dupont",
    githubLogin: "Jean-Dupont",
    primaryEmail: "jean.dupont@beta.gouv.fr",
    communicationEmail: "jd@example.org",
  },
  {
    id: "p-marie",
    username: "marie.martin",
    githubLogin: "https://github.com/MarieMartin/",
    primaryEmail: "marie.martin@beta.gouv.fr",
    communicationEmail: null,
  },
];

const COMPTES: CompteDeServiceConnu[] = [
  {
    id: "s-ci",
    key: "github-ci-incubateur-ademe",
    identites: [{ provider: "github", externalId: "9001" }],
  },
];

describe("rapprochement d'un compte observé", () => {
  it("rend un compte machine à son compte de service déclaré", () => {
    // Sans cette déclaration, le jeton d'intégration continue reviendrait comme
    // compte isolé à chaque collecte : un bruit permanent, dans un écran qui n'a de
    // valeur que si tout ce qu'il montre appelle une action.
    expect(
      rapprocher(
        { provider: "github", externalId: "9001", handle: "ademe-ci-bot" },
        PERSONNES,
        COMPTES,
      ),
    ).toEqual({ personId: null, serviceAccountId: "s-ci", methode: "DECLARED" });
  });

  it("retrouve une personne par son login GitHub, quelle qu'en soit l'écriture", () => {
    // Le login est saisi à la main dans l'espace-membre : on y trouve l'adresse
    // complète du profil comme une casse fantaisiste.
    expect(
      rapprocher({ provider: "github", externalId: "1", handle: "jean-dupont" }, PERSONNES, COMPTES)
        .methode,
    ).toBe("GITHUB_LOGIN");

    expect(
      rapprocher(
        { provider: "github", externalId: "2", handle: "MARIEMARTIN" },
        PERSONNES,
        COMPTES,
      ),
    ).toEqual({ personId: "p-marie", serviceAccountId: null, methode: "GITHUB_LOGIN" });
  });

  it("retrouve une personne par une adresse exacte, principale ou de communication", () => {
    const parCommunication = rapprocher(
      { provider: "notion", externalId: "n1", handle: "Jean", emails: ["JD@example.org"] },
      PERSONNES,
      COMPTES,
    );

    expect(parCommunication).toEqual({
      personId: "p-jean",
      serviceAccountId: null,
      methode: "EMAIL_EXACT",
    });
  });

  it("ne conclut qu'à une ressemblance quand le compte porte un username", () => {
    // Vrai la plupart du temps, et c'est pour cela que ce n'en est pas une preuve :
    // ce rattachement alimente une file à trancher, jamais une coupure.
    expect(
      rapprocher(
        { provider: "notion", externalId: "n2", handle: "marie.martin" },
        PERSONNES,
        COMPTES,
      ),
    ).toEqual({ personId: "p-marie", serviceAccountId: null, methode: "HEURISTIC" });
  });

  it("laisse isolé un compte que personne ne réclame", () => {
    // Ce n'est pas un échec du rapprochement : c'est le résultat que l'outil existe
    // pour produire.
    expect(
      rapprocher(
        { provider: "github", externalId: "3", handle: "prestataire-externe" },
        PERSONNES,
        COMPTES,
      ),
    ).toEqual({ personId: null, serviceAccountId: null, methode: "NONE" });
  });

  it("distingue une fiche qui répète son adresse de deux fiches qui la partagent", () => {
    // Given une fiche dont l'adresse de communication reprend l'adresse principale,
    // ce qui est le cas par défaut et non le cas limite, et deux fiches distinctes
    // adossées à une même boîte d'équipe.
    const personnes: PersonneConnue[] = [
      {
        id: "p-camille",
        username: "camille.rouvier",
        githubLogin: null,
        primaryEmail: "camille.rouvier@beta.gouv.fr",
        communicationEmail: "Camille.Rouvier@beta.gouv.fr",
      },
      {
        id: "p-nadia",
        username: "nadia.belkacem",
        githubLogin: null,
        primaryEmail: "contact@equipe-tacite.fr",
        communicationEmail: "nadia.belkacem@beta.gouv.fr",
      },
      {
        id: "p-oumar",
        username: "oumar.sylla",
        githubLogin: null,
        primaryEmail: "contact@equipe-tacite.fr",
        communicationEmail: null,
      },
    ];

    // Then une adresse répétée par sa seule titulaire reste une preuve : la répéter
    // ne la rend pas ambiguë, sans quoi la quasi-totalité des fiches deviendrait
    // hors d'atteinte de `EMAIL_EXACT` sans que rien ne le signale.
    expect(
      rapprocher(
        {
          provider: "notion",
          externalId: "n10",
          handle: "Camille R.",
          emails: ["camille.rouvier@beta.gouv.fr"],
        },
        personnes,
        COMPTES,
      ),
    ).toEqual({ personId: "p-camille", serviceAccountId: null, methode: "EMAIL_EXACT" });

    // Then une adresse revendiquée par deux fiches distinctes reste écartée : la
    // rattacher au hasard finirait par couper l'accès de la mauvaise.
    expect(
      rapprocher(
        {
          provider: "notion",
          externalId: "n11",
          handle: "boite-partagee",
          emails: ["contact@equipe-tacite.fr"],
        },
        personnes,
        COMPTES,
      ),
    ).toEqual({ personId: null, serviceAccountId: null, methode: "NONE" });

    // Then l'adresse écartée n'emporte pas les autres adresses de la même fiche.
    expect(
      rapprocher(
        {
          provider: "notion",
          externalId: "n12",
          handle: "Nadia B.",
          emails: ["Nadia.Belkacem@beta.gouv.fr"],
        },
        personnes,
        COMPTES,
      ),
    ).toEqual({ personId: "p-nadia", serviceAccountId: null, methode: "EMAIL_EXACT" });
  });

  it("refuse de trancher entre deux fiches qui revendiquent le même compte", () => {
    // Choisir au hasard reviendrait à couper un jour l'accès de la mauvaise.
    const jumelles: PersonneConnue[] = [
      {
        id: "p-a",
        username: "a.dupont",
        githubLogin: "Jean-Dupont",
        primaryEmail: null,
        communicationEmail: null,
      },
      {
        id: "p-b",
        username: "b.dupont",
        githubLogin: "jean-dupont",
        primaryEmail: null,
        communicationEmail: null,
      },
    ];

    expect(
      rapprocher({ provider: "github", externalId: "4", handle: "jean-dupont" }, jumelles, COMPTES),
    ).toEqual({ personId: null, serviceAccountId: null, methode: "NONE" });
  });
});

describe("normalisation d'un login GitHub", () => {
  it("ramène les écritures courantes à la même valeur", () => {
    expect(normaliserLogin("  @Jean-Dupont ")).toBe("jean-dupont");
    expect(normaliserLogin("https://github.com/Jean-Dupont/")).toBe("jean-dupont");
    expect(normaliserLogin("http://www.github.com/Jean-Dupont")).toBe("jean-dupont");
    expect(normaliserLogin(null)).toBeNull();
    expect(normaliserLogin("   ")).toBeNull();
  });
});
