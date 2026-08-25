import { describe, expect, it } from "vitest";

import {
  type FicheAFusionner,
  type FicheManuelle,
  ficheEditable,
  normaliserIdentifiant,
  planifierFusion,
  renommable,
  validerChamps,
} from "./fiche-manuelle";
import { autoriseUneRevocation, type PersonneConnue, rapprocher } from "./rapprochement";

const DECLARES_LOCAUX = ["prestataire.exemple"];

const fiche = (over: Partial<FicheManuelle> = {}): FicheManuelle => ({
  username: "camille.exempl",
  source: "LOCAL",
  usernameFabricated: true,
  ...over,
});

const le = (iso: string) => new Date(`${iso}T00:00:00Z`);
const AUJOURDHUI = new Date("2026-08-19T15:00:00Z");

const aFusionner = (over: Partial<FicheAFusionner> = {}): FicheAFusionner => ({
  username: "camille.exempl",
  missionEnd: null,
  comptes: [],
  constats: [],
  dossiers: [],
  references: [],
  rattachements: [],
  surcharge: null,
  ...over,
});

describe("ce qui se corrige sur une fiche, et ce qui ne se touche pas", () => {
  it("n'ouvre le renommage que sur un identifiant fabriqué ici", () => {
    // Quatre familles de fiches coexistent, et trois d'entre elles portent un
    // identifiant qu'aucun code n'a le droit de toucher.
    const fabriquee = fiche();
    const adoptee = fiche({
      username: "camille.roux",
      source: "BETA",
      usernameFabricated: false,
    });
    const declaree = fiche({ username: "prestataire.exemple" });
    const horsIncubateur = fiche({ username: "dominique.roux", usernameFabricated: false });

    expect(ficheEditable(fabriquee, DECLARES_LOCAUX)).toEqual({ editable: true });
    expect(renommable(fabriquee, DECLARES_LOCAUX)).toBe(true);

    // La collecte a éteint le drapeau en adoptant la fiche. Aucun `betaUuid` n'entre
    // dans cette décision, et c'est le point : il est nul sur une fiche recopiée
    // depuis l'espace-membre pour quelqu'un hors incubateur, qui porte pourtant un
    // vrai pivot.
    expect(ficheEditable(adoptee, DECLARES_LOCAUX)).toEqual({
      editable: false,
      raison: "COLLECTEE",
    });
    expect(renommable(adoptee, DECLARES_LOCAUX)).toBe(false);

    // Déclarée dans la politique : le YAML fait autorité, et il gagne même si la
    // reprise de données a posé le drapeau à tort sur cette fiche.
    expect(declaree.usernameFabricated).toBe(true);
    expect(ficheEditable(declaree, DECLARES_LOCAUX)).toEqual({
      editable: false,
      raison: "DECLAREE",
    });
    expect(renommable(declaree, DECLARES_LOCAUX)).toBe(false);

    // Vrai pivot beta.gouv sur une fiche locale : ses champs se corrigent, son
    // identifiant non.
    expect(ficheEditable(horsIncubateur, DECLARES_LOCAUX)).toEqual({ editable: true });
    expect(renommable(horsIncubateur, DECLARES_LOCAUX)).toBe(false);
  });

  it("fabrique un identifiant de la même façon à la création et au renommage", () => {
    expect(normaliserIdentifiant("Camille Exemple")).toBe("camille.exemple");
    expect(normaliserIdentifiant("  Camille   ÉXEMPLE  ")).toBe("camille.exemple");
    expect(normaliserIdentifiant("!!!")).toBe("");

    const valide = validerChamps({
      fullname: "  Camille Exemple ",
      githubLogin: "https://github.com/Camille-Exemple/",
      primaryEmail: " Camille.Exemple@Beta.Gouv.FR ",
      communicationEmail: "",
    });

    expect(valide).toEqual({
      champs: {
        fullname: "Camille Exemple",
        githubLogin: "camille-exemple",
        primaryEmail: "camille.exemple@beta.gouv.fr",
        communicationEmail: null,
      },
    });

    expect(
      validerChamps({
        fullname: "Camille Exemple",
        githubLogin: "",
        primaryEmail: "camille.exemple",
        communicationEmail: "",
      }),
    ).toEqual({ erreur: "« camille.exemple » n'est pas une adresse électronique." });

    expect(
      validerChamps({ fullname: "C", githubLogin: "", primaryEmail: "", communicationEmail: "" }),
    ).toEqual({ erreur: "Indiquez le nom de la personne." });
  });
});

describe("l'identifiant fautif rejoint la vraie personne", () => {
  const source = aFusionner({
    comptes: [
      {
        id: "i1",
        provider: "github",
        handle: "camille-exemple",
        externalId: "42",
        matchMethod: "DECLARED",
      },
      {
        id: "i2",
        provider: "notion",
        handle: "camille.exemple@beta.gouv.fr",
        externalId: "n-7",
        matchMethod: "HEURISTIC",
      },
    ],
    constats: [
      { id: "f1", kind: "UNREGISTERED", dedupKey: "UNREGISTERED:notion:camille.exemple" },
      { id: "f2", kind: "SCOPE_EXIT", dedupKey: "SCOPE_EXIT:camille.exempl" },
      { id: "f3", kind: "SCOPE_ENTRY", dedupKey: "SCOPE_ENTRY:camille.exempl" },
    ],
    dossiers: [{ id: "d1", vivant: true }],
    references: [{ id: "r1", resourceId: "res-1" }],
  });

  const cible = aFusionner({ username: "camille.exemple" });

  it("déplace tout avant de supprimer, et ne promeut aucun compte au passage", () => {
    const plan = planifierFusion(source, cible, AUJOURDHUI);

    expect(plan.blocage).toBeNull();

    // Les deux comptes suivent, avec leur méthode. Un compte arrivé par ressemblance
    // reste incapable de justifier une coupure : la fusion dit que ces deux fiches
    // sont la même personne, pas que chaque compte est bien à elle.
    expect(plan.comptes.map((compte) => compte.matchMethod)).toEqual(["DECLARED", "HEURISTIC"]);
    expect(plan.comptes.filter((compte) => autoriseUneRevocation(compte.matchMethod))).toHaveLength(
      1,
    );

    // Le constat ancré sur le compte traverse sans retouche, celui ancré sur la
    // personne est réattribué au nouvel identifiant.
    expect(plan.constatsMigres).toHaveLength(3);
    expect(plan.clesReecrites).toEqual([
      { id: "f2", avant: "SCOPE_EXIT:camille.exempl", apres: "SCOPE_EXIT:camille.exemple" },
      { id: "f3", avant: "SCOPE_ENTRY:camille.exempl", apres: "SCOPE_ENTRY:camille.exemple" },
    ]);
    expect(plan.constatsFermes).toHaveLength(0);

    expect(plan.dossiers).toEqual([{ id: "d1", vivant: true }]);
    expect(plan.references).toEqual([{ id: "r1", resourceId: "res-1" }]);
    expect(plan.referencesSupprimees).toHaveLength(0);

    // L'ordre est ce qui neutralise les cascades du schéma : un `delete` posé avant
    // les déplacements emporterait sans un mot les constats, les dossiers et les
    // références, et laisserait les plans du dossier avec un dossier nul.
    expect(plan.etapes.map((etape) => etape.type)).toEqual([
      "deplacer-comptes",
      "migrer-constats",
      "reecrire-cles",
      "deplacer-dossiers",
      "deplacer-references",
      "supprimer-fiche",
    ]);
    expect(plan.etapes.at(-1)).toEqual({ type: "supprimer-fiche", username: "camille.exempl" });
  });
});

describe("la fusion refuse ce qu'elle ne sait pas fusionner sans perte", () => {
  it("bloque sur deux dossiers vivants, signale les doublons, ferme une clé déjà prise", () => {
    const source = aFusionner({
      comptes: [
        {
          id: "i1",
          provider: "github",
          handle: "camille-exempl",
          externalId: "42",
          matchMethod: "DECLARED",
        },
      ],
      constats: [{ id: "f2", kind: "SCOPE_EXIT", dedupKey: "SCOPE_EXIT:camille.exempl" }],
      dossiers: [{ id: "d1", vivant: true }],
    });

    // Un seul dossier vivant par personne est une règle du socle : en faire migrer un
    // second produirait deux plans concurrents pour un même départ.
    const bloquee = planifierFusion(
      source,
      aFusionner({ username: "camille.exemple", dossiers: [{ id: "d2", vivant: true }] }),
      AUJOURDHUI,
    );
    expect(bloquee.blocage).toContain("dossier de départ en cours");
    expect(bloquee.etapes).toHaveLength(0);

    // Un dossier clos d'un côté ne bloque rien.
    const cible = aFusionner({
      username: "camille.exemple",
      dossiers: [{ id: "d2", vivant: false }],
      comptes: [
        {
          id: "i9",
          provider: "github",
          handle: "camille-exemple",
          externalId: "43",
          matchMethod: "GITHUB_LOGIN",
        },
      ],
      // Fermé, mais la clé de déduplication est unique sur toute la table : réécrire
      // dessus ferait échouer la fusion, ou pire, ferait échouer une collecte
      // ultérieure au moment précis où elle a quelque chose à signaler.
      constats: [{ id: "f8", kind: "SCOPE_EXIT", dedupKey: "SCOPE_EXIT:camille.exemple" }],
    });

    const plan = planifierFusion(source, cible, AUJOURDHUI);

    expect(plan.blocage).toBeNull();
    expect(plan.doublons).toEqual([
      { provider: "github", source: ["camille-exempl"], cible: ["camille-exemple"] },
    ]);

    expect(plan.clesReecrites).toHaveLength(0);
    expect(plan.constatsFermes.map((constat) => constat.id)).toEqual(["f2"]);
    expect(plan.etapes).toContainEqual({
      type: "fermer-constats",
      ids: ["f2"],
      raison: "fusionnée dans camille.exemple",
    });
  });

  it("laisse à la cible une référence qu'elle porte déjà", () => {
    const plan = planifierFusion(
      aFusionner({
        references: [
          { id: "r1", resourceId: "res-1" },
          { id: "r2", resourceId: "res-2" },
        ],
      }),
      aFusionner({ username: "camille.exemple", references: [{ id: "r9", resourceId: "res-1" }] }),
      AUJOURDHUI,
    );

    expect(plan.references).toEqual([{ id: "r2", resourceId: "res-2" }]);
    expect(plan.referencesSupprimees).toEqual([{ id: "r1", resourceId: "res-1" }]);
    expect(plan.etapes.map((etape) => etape.type)).toEqual([
      "deplacer-references",
      "supprimer-references",
      "supprimer-fiche",
    ]);
  });
});

describe("corriger le login rebranche le rapprochement, sans rien promouvoir", () => {
  it("rattache un compte resté isolé faute d'un login mal saisi", () => {
    const compte = {
      provider: "github",
      externalId: "42",
      handle: "Camille-Exemple",
      emails: [],
    };

    const avant: PersonneConnue = {
      id: "p1",
      username: "camille.exempl",
      githubLogin: "camile-exemple",
      primaryEmail: null,
      communicationEmail: null,
    };

    expect(rapprocher(compte, [avant], [])).toEqual({
      personId: null,
      serviceAccountId: null,
      methode: "NONE",
    });

    const validation = validerChamps({
      fullname: "Camille Exemple",
      githubLogin: "@Camille-Exemple",
      primaryEmail: "",
      communicationEmail: "",
    });
    expect("champs" in validation).toBe(true);
    const corrige: PersonneConnue = {
      ...avant,
      githubLogin: "champs" in validation ? validation.champs.githubLogin : null,
    };

    const rapproche = rapprocher(compte, [corrige], []);
    expect(rapproche).toEqual({ personId: "p1", serviceAccountId: null, methode: "GITHUB_LOGIN" });
    expect(autoriseUneRevocation(rapproche.methode)).toBe(true);
  });

  it("laisse un compte rattaché par ressemblance hors de toute révocation après fusion", () => {
    const plan = planifierFusion(
      aFusionner({
        comptes: [
          {
            id: "i2",
            provider: "notion",
            handle: "camille.exemple@beta.gouv.fr",
            externalId: "n-7",
            matchMethod: "HEURISTIC",
          },
        ],
      }),
      aFusionner({ username: "camille.exemple" }),
      AUJOURDHUI,
    );

    const migre = plan.comptes[0];
    expect(migre?.matchMethod).toBe("HEURISTIC");
    expect(autoriseUneRevocation(migre?.matchMethod ?? "")).toBe(false);
  });
});

describe("la fusion emporte tout ce qui pend à la fiche, pas seulement ce qu'on avait en tête", () => {
  it("fait suivre les rattachements manuels et la surcharge d'appartenance", () => {
    // Ces deux relations sont en cascade depuis Person : oubliées de l'inventaire,
    // elles partaient sans erreur ni ligne au journal à la suppression finale.
    const plan = planifierFusion(
      aFusionner({
        rattachements: [
          { id: "sa1", startupGhid: "produit-omega", until: le("2026-11-30"), endedAt: null },
          {
            id: "sa2",
            startupGhid: "produit-alpha",
            until: le("2026-11-30"),
            endedAt: le("2026-08-01"),
          },
        ],
        surcharge: {
          id: "so1",
          sens: "EXCLUDE",
          par: "alex.martin",
          raison: "partie de l'incubateur",
        },
      }),
      aFusionner({ username: "camille.exemple" }),
      AUJOURDHUI,
    );

    // Le clos suit aussi : sans lui, un constat levé la veille deviendrait
    // inexplicable sur la fiche cible.
    expect(plan.rattachements.map((rattachement) => rattachement.id)).toEqual(["sa1", "sa2"]);
    expect(plan.surcharge?.id).toBe("so1");
    expect(plan.surchargeAbandonnee).toBeNull();

    expect(plan.etapes.map((etape) => etape.type)).toEqual([
      "deplacer-rattachements",
      "deplacer-surcharge",
      "supprimer-fiche",
    ]);
  });

  it("laisse à la cible sa propre surcharge, et nomme celle qu'on perd", () => {
    const perdue = {
      id: "so1",
      sens: "INCLUDE",
      par: "alex.martin",
      raison: "coach de l'incubateur",
    };

    const plan = planifierFusion(
      aFusionner({ surcharge: perdue }),
      aFusionner({
        username: "camille.exemple",
        surcharge: { id: "so9", sens: "EXCLUDE", par: "camille.roux", raison: "déjà partie" },
      }),
      AUJOURDHUI,
    );

    // Une décision nominative ne s'écrase pas parce qu'une autre fiche en portait
    // une : la cible garde la sienne, et celle de la source est nommée plutôt que
    // supprimée en silence.
    expect(plan.surcharge).toBeNull();
    expect(plan.surchargeAbandonnee).toEqual(perdue);
    expect(plan.etapes).toContainEqual({ type: "supprimer-surcharge", id: "so1" });
    expect(plan.etapes).not.toContainEqual({ type: "deplacer-surcharge", id: "so1" });
  });

  it("ne réécrit pas une clé de constat que la source occupe déjà elle-même", () => {
    // Après un renommage, la source garde ses anciennes clés fermées et la collecte
    // en ouvre de nouvelles : la clé cible peut donc être prise de son propre côté.
    const plan = planifierFusion(
      aFusionner({
        username: "camille.exempl",
        constats: [
          { id: "f1", kind: "SCOPE_EXIT", dedupKey: "SCOPE_EXIT:camille.exempl" },
          { id: "f2", kind: "SCOPE_EXIT", dedupKey: "SCOPE_EXIT:camille.exemple" },
        ],
      }),
      aFusionner({ username: "camille.exemple" }),
      AUJOURDHUI,
    );

    expect(plan.clesReecrites).toHaveLength(0);
    expect(plan.constatsFermes.map((constat) => constat.id)).toEqual(["f1"]);
  });
});

describe("la fusion annonce ce qu'elle repousse", () => {
  it("dit que l'échéance de la cible passe au rattachement déplacé", () => {
    // Le refus de prolongation ne joue qu'à la pose, contre la fiche d'alors. Posé
    // sur une fiche sans échéance, ce rattachement ne prolongeait rien ; la fusion
    // le fait atterrir sur quelqu'un qui en a une, et c'en devient une.
    const plan = planifierFusion(
      aFusionner({
        rattachements: [
          { id: "sa1", startupGhid: "produit-omega", until: le("2027-03-31"), endedAt: null },
        ],
      }),
      aFusionner({ username: "camille.exemple", missionEnd: le("2027-01-16") }),
      AUJOURDHUI,
    );

    expect(plan.prolongation).toEqual({ avant: le("2027-01-16"), apres: le("2027-03-31") });
  });

  it("se tait quand rien n'est repoussé", () => {
    const cible = { username: "camille.exemple", missionEnd: le("2027-12-31") };

    // Un rattachement plus court que la mission de la cible ne repousse rien.
    expect(
      planifierFusion(
        aFusionner({
          rattachements: [
            { id: "sa1", startupGhid: "produit-omega", until: le("2027-03-31"), endedAt: null },
          ],
        }),
        aFusionner(cible),
        AUJOURDHUI,
      ).prolongation,
    ).toBeNull();

    // Un rattachement expiré non plus, et un rattachement clos pas davantage.
    expect(
      planifierFusion(
        aFusionner({
          rattachements: [
            { id: "sa1", startupGhid: "produit-omega", until: le("2026-01-01"), endedAt: null },
            {
              id: "sa2",
              startupGhid: "produit-alpha",
              until: le("2030-01-01"),
              endedAt: le("2026-08-01"),
            },
          ],
        }),
        aFusionner({ username: "camille.exemple", missionEnd: le("2027-01-16") }),
        AUJOURDHUI,
      ).prolongation,
    ).toBeNull();

    // Une cible sans échéance en gagne une : c'est un bornage, pas une prolongation,
    // mais l'écran doit quand même le dire, l'échéance affichée va changer.
    expect(
      planifierFusion(
        aFusionner({
          rattachements: [
            { id: "sa1", startupGhid: "produit-omega", until: le("2027-03-31"), endedAt: null },
          ],
        }),
        aFusionner({ username: "camille.exemple" }),
        AUJOURDHUI,
      ).prolongation,
    ).toEqual({ avant: null, apres: le("2027-03-31") });
  });
});
