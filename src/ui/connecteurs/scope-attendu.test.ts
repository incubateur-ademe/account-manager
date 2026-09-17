import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CONNECTEURS } from "@/connectors";

import { scopeAttendu } from "./scope-attendu";

describe("le scope attendu se lit sur le schéma qui validera la saisie, jamais à côté", () => {
  it("rend le scope de chaque connecteur du registre, avec ses valeurs admises et sa stricture", () => {
    for (const { contract } of CONNECTEURS) {
      // Un scope illisible ici serait un contrat non déclaratif, ce que le contrat
      // interdit précisément pour que cet écran et la saisie assistée en dérivent.
      const lu = scopeAttendu(contract.scopeSchema);
      expect(lu.etat).toBe("lu");

      // Et strict, y compris quand il n'attend aucun champ : c'est ce qui fait refuser
      // le scope d'un système recopié sur un autre. La règle vaut pour le registre
      // entier, sans quoi le prochain connecteur l'apprendrait en production.
      expect(lu.etat === "lu" && lu.clesInconnuesRefusees).toBe(true);

      // Un connecteur dont le scope a plusieurs formes ne doit jamais sortir sans champ :
      // l'écran y lirait qu'un accès ne se découpe pas, sur le système précis où il se
      // découpe de plusieurs façons.
      expect(lu.etat === "lu" && lu.champs.length === 0 && lu.variantes.length > 0).toBe(false);
    }

    const scalingo = CONNECTEURS.find(({ contract }) => contract.key === "scalingo");

    if (!scalingo) {
      throw new Error("le registre devrait porter scalingo");
    }

    const parNature = scopeAttendu(scalingo.contract.scopeSchema);

    if (parNature.etat !== "lu") {
      throw new Error("le scope de scalingo devrait se lire");
    }

    // Deux natures d'accès sur ce système, donc deux formes à écrire, et l'écran doit
    // pouvoir nommer celle qu'un profil choisit plutôt que d'annoncer un rang.
    expect(parNature.variantes.map(({ libelle }) => libelle)).toEqual([
      "nature = collaboration",
      "nature = jeton",
    ]);
    expect(parNature.variantes.every(({ champs }) => champs.length > 0)).toBe(true);
    expect(parNature.champs.find(({ nom }) => nom === "nature")?.attendu).toBe(
      "l'une de : collaboration, jeton",
    );

    const github = CONNECTEURS.find(({ contract }) => contract.key === "github");
    const notion = CONNECTEURS.find(({ contract }) => contract.key === "notion");

    if (!github || !notion) {
      throw new Error("le registre devrait porter github et notion");
    }

    const lu = scopeAttendu(github.contract.scopeSchema);

    if (lu.etat !== "lu") {
      throw new Error("le scope de github devrait se lire");
    }

    expect(lu.champs).toEqual([
      {
        nom: "organisation",
        requis: true,
        attendu: "texte non vide",
        description: expect.stringContaining("connectors.github.organisations"),
        exemple: expect.any(String),
      },
      {
        nom: "role",
        requis: true,
        attendu: "l'une de : member, admin",
        description: expect.stringContaining("admin"),
        exemple: "member",
      },
    ]);

    // Une clé inconnue dans un profil écrit à la main est une faute de frappe : l'écran
    // doit pouvoir le dire, donc lire la stricture et ne pas la supposer.
    expect(lu.clesInconnuesRefusees).toBe(true);

    // Un scope à une seule forme n'a pas de variantes, et l'écran n'a donc rien de plus
    // à rendre que sa table à plat.
    expect(lu.variantes).toEqual([]);

    // Être membre du workspace, c'est l'être en entier : rien à découper, donc aucun
    // champ, ce qui n'est pas la même chose qu'un scope illisible.
    expect(scopeAttendu(notion.contract.scopeSchema)).toEqual({
      etat: "lu",
      champs: [],
      clesInconnuesRefusees: true,
      variantes: [],
    });
  });

  it("rend une variante par branche quand un accès a plusieurs natures, sans jamais promettre à plat ce qu'une branche seule ne tient", () => {
    // Étant donné un scope à deux natures, tel que celui qu'un système qui sait à la fois
    // inviter quelqu'un et faire émettre un jeton doit exposer.
    const collaboration = z.strictObject({
      nature: z.literal("collaboration").meta({ examples: ["collaboration"] }),
      region: z.string().min(1).meta({ description: "La région qui héberge l'application." }),
      application: z
        .string()
        .min(1)
        .meta({ examples: ["produit-alpha"] }),
      role: z.enum(["collaborateur", "proprietaire"]),
    });

    const jeton = z.strictObject({
      nature: z.literal("jeton").meta({ examples: ["jeton"] }),
      usage: z.enum(["inventaire-d-une-region", "catalogue-des-regions"]).meta({
        description: "Le besoin que ce jeton sert.",
      }),
      region: z.string().min(1).optional(),
      // Volontairement plus permissif que dans l'autre branche : c'est ce qui fait
      // vérifier que la table à plat ne retient que la plus faible des deux promesses.
      application: z.string().optional(),
    });

    // Quand l'écran lit ce schéma, qui ne rend plus un objet à la racine mais un choix
    // entre deux formes.
    const lu = scopeAttendu(z.discriminatedUnion("nature", [collaboration, jeton]));

    if (lu.etat !== "lu") {
      throw new Error("un scope à plusieurs natures devrait se lire");
    }

    // Alors les deux branches sortent, nommées par ce qui les distingue et non par leur
    // rang, chacune avec ses seuls champs et sa propre stricture.
    expect(lu.variantes).toEqual([
      {
        libelle: "nature = collaboration",
        clesInconnuesRefusees: true,
        champs: [
          {
            nom: "nature",
            requis: true,
            attendu: "exactement : collaboration",
            exemple: "collaboration",
          },
          {
            nom: "region",
            requis: true,
            attendu: "texte non vide",
            description: "La région qui héberge l'application.",
          },
          { nom: "application", requis: true, attendu: "texte non vide", exemple: "produit-alpha" },
          { nom: "role", requis: true, attendu: "l'une de : collaborateur, proprietaire" },
        ],
      },
      {
        libelle: "nature = jeton",
        clesInconnuesRefusees: true,
        champs: [
          { nom: "nature", requis: true, attendu: "exactement : jeton", exemple: "jeton" },
          {
            nom: "usage",
            requis: true,
            attendu: "l'une de : inventaire-d-une-region, catalogue-des-regions",
            description: "Le besoin que ce jeton sert.",
          },
          { nom: "region", requis: false, attendu: "texte non vide" },
          { nom: "application", requis: false, attendu: "texte" },
        ],
      },
    ]);

    // Et la table à plat, que l'écran rend aujourd'hui sans rien savoir des variantes,
    // continue de dire vrai : le discriminant y montre ses deux valeurs au lieu de « texte »,
    // et rien n'y est donné pour requis qui ne le soit dans les deux branches.
    expect(lu.champs).toEqual([
      {
        nom: "nature",
        requis: true,
        attendu: "l'une de : collaboration, jeton",
        exemple: "collaboration",
      },
      {
        nom: "region",
        requis: false,
        attendu: "texte non vide",
        description: "La région qui héberge l'application.",
      },
      { nom: "application", requis: false, attendu: "texte", exemple: "produit-alpha" },
      { nom: "role", requis: false, attendu: "l'une de : collaborateur, proprietaire" },
      {
        nom: "usage",
        requis: false,
        attendu: "l'une de : inventaire-d-une-region, catalogue-des-regions",
        description: "Le besoin que ce jeton sert.",
      },
    ]);

    // La liste des champs n'est jamais vide : c'est elle qui empêchait l'écran d'annoncer
    // qu'un accès ne se découpe pas sur un système où il se découpe de deux façons.
    expect(lu.champs.length).toBeGreaterThan(0);
    expect(lu.clesInconnuesRefusees).toBe(true);

    // Et une seule branche laxiste suffit à retirer la promesse de stricture à la racine,
    // parce qu'un profil qui choisit cette branche-là passera ses fautes de frappe.
    const laxiste = scopeAttendu(
      z.discriminatedUnion("nature", [
        collaboration,
        z.looseObject({ nature: z.literal("jeton"), usage: z.string() }),
      ]),
    );

    expect(laxiste.etat === "lu" && laxiste.clesInconnuesRefusees).toBe(false);
    expect(laxiste.etat === "lu" && laxiste.variantes.map((v) => v.clesInconnuesRefusees)).toEqual([
      true,
      false,
    ]);
  });

  it("absorbe un schéma que JSON Schema ne sait pas représenter au lieu d'emporter l'écran", () => {
    // Cet écran montre tous les connecteurs d'un coup : un seul contrat fautif y ferait
    // disparaître l'état des credentials de tous les autres, au moment où on vient le lire.
    expect(scopeAttendu(z.object({ organisation: z.string() }).transform((lu) => lu))).toEqual({
      etat: "illisible",
    });

    expect(scopeAttendu(z.object({ ouvertJusquA: z.date() }))).toEqual({ etat: "illisible" });

    // Une branche qui n'est pas un objet ne se décrit pas en champs : mieux vaut le dire
    // que d'en rendre une variante vide, que l'écran lirait comme « rien à découper ».
    expect(scopeAttendu(z.union([z.string(), z.strictObject({ region: z.string() })]))).toEqual({
      etat: "illisible",
    });
  });
});
