import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import ObjetsPossedesPage from "@/app/objets-possedes/page";
import type { CapabilityDecl, Connector, ConnectorContract } from "@/core/connector";
import type { ObjetPossede } from "@/lib/objets-possedes";
import { Absent } from "@/ui/Absent";
import { dateFr } from "@/ui/dates";
import { DESTIN_AU_DEPART } from "@/ui/severites";

/**
 * Ce que l'écran des objets possédés range où, et ce qu'il dit quand rien ne recense.
 *
 * Patron serveur sans DOM, comme les écrans d'inventaire : la page est une fonction
 * asynchrone, et ce qui se vérifie est l'arbre qu'elle rend. Les libellés de destin sont
 * importés de leur table et jamais recopiés. Les phrases écrites dans la page n'ont pas de
 * table, elles se citent.
 */

type LigneEnBase = ObjetPossede & { vanishedAt: Date | null };

const base = vi.hoisted(() => ({
  connecteurs: [] as Connector[],
  references: [] as (ObjetPossede & { vanishedAt: Date | null })[],
}));

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

vi.mock("@/connectors", () => ({ CONNECTEURS: base.connecteurs }));

vi.mock("@/lib/db", () => ({
  prisma: {
    reference: {
      // La seule clause honorée est celle qui écarte les références datées : c'est elle que
      // l'écran ne doit pas perdre, et un double qui rendrait tout la laisserait tomber sans bruit.
      findMany: ({ where }: { where: { vanishedAt?: null } }) =>
        Promise.resolve(
          base.references
            .filter((ligne) => !("vanishedAt" in where) || ligne.vanishedAt === null)
            .map(({ vanishedAt: _, compte, ...ligne }) => ({ ...ligne, externalIdentity: compte })),
        ),
    },
  },
}));

const JETON: CapabilityDecl = { requires: ["jeton"], tier: "auto" };

function couvrir(
  ...systemes: readonly { cle: string; recense?: CapabilityDecl; jeton?: boolean }[]
) {
  base.connecteurs.length = 0;
  for (const { cle, recense, jeton = false } of systemes) {
    const contrat: ConnectorContract = {
      key: cle,
      label: cle,
      criticality: "medium",
      runbook: `Marche à suivre de ${cle}.`,
      accountSlug: ({ handle }) => handle,
      credentials: [],
      capabilities: (recense ? { reference: [recense] } : {}) as ConnectorContract["capabilities"],
      scopeSchema: z.strictObject({}),
    };
    base.connecteurs.push({
      contract: contrat,
      probe: () => Promise.resolve([{ id: "jeton", available: jeton, checkedAt: new Date() }]),
      plan: () => Promise.resolve([]),
    });
  }
}

const SORTIE = new Date("2026-09-12T10:00:00Z");

const personne = (username: string, fullname: string, vanishedAt: Date | null = null) => ({
  username,
  fullname,
  vanishedAt,
});

function reference(
  id: string,
  champs: Partial<LigneEnBase> & Pick<LigneEnBase, "compte" | "onOffboard">,
): LigneEnBase {
  return {
    id,
    resourceId: id,
    provider: "github",
    resource: { label: `Dépôt incubateur-exemple/${id}`, url: `https://exemple.fr/${id}` },
    vanishedAt: null,
    ...champs,
  };
}

interface NoeudRendu {
  type: unknown;
  accessoires: Record<string, unknown>;
}

function noeudsRendus(noeud: unknown): NoeudRendu[] {
  if (Array.isArray(noeud)) {
    return noeud.flatMap(noeudsRendus);
  }
  if (noeud === null || typeof noeud !== "object") {
    return [];
  }
  const accessoires = (noeud as { props?: Record<string, unknown> }).props;
  if (accessoires === undefined) {
    return [];
  }
  return [
    { type: (noeud as { type?: unknown }).type, accessoires },
    ...Object.values(accessoires).flatMap(noeudsRendus),
  ];
}

/**
 * Le texte qu'un lecteur voit : les enfants seulement, et la mention d'une valeur absente.
 * Une adresse de lien ou une infobulle n'est pas lue dans la cellule. Les morceaux se
 * recollent sans blanc, comme le navigateur les rend, et un saut de ligne en vaut un.
 */
function texteVisible(noeud: unknown): string {
  if (typeof noeud === "string" || typeof noeud === "number") {
    return String(noeud);
  }
  if (Array.isArray(noeud)) {
    return noeud.map(texteVisible).join("");
  }
  if (noeud === null || typeof noeud !== "object") {
    return "";
  }
  const { type, props } = noeud as { type?: unknown; props?: Record<string, unknown> };
  if (type === "br") {
    return " ";
  }
  if (type === "div") {
    return ` ${texteVisible(props?.["children"])} `;
  }
  if (type === Absent) {
    return String(props?.["mention"] ?? "");
  }
  return texteVisible(props?.["children"]);
}

const lu = (noeud: unknown): string => texteVisible(noeud).replace(/\s+/gu, " ").trim();

/** Chaque section de l'écran, son titre et les lignes de son tableau telles qu'elles se lisent. */
function sectionsRendues(
  page: unknown,
): { titre: string; entetes: string[]; lignes: string[][] }[] {
  return noeudsRendus(page)
    .filter(({ type }) => type === "section")
    .map(({ accessoires }) => {
      const dedans = noeudsRendus(accessoires["children"]);
      const titre = dedans.find(({ type }) => type === "h2");
      const tableau = dedans.find(({ accessoires: props }) => props["headers"] !== undefined);
      if (titre === undefined || tableau === undefined) {
        throw new Error("une section sans titre ou sans tableau");
      }
      return {
        titre: lu(titre.accessoires["children"]),
        entetes: (tableau.accessoires["headers"] as unknown[]).map(lu),
        lignes: (tableau.accessoires["data"] as unknown[][]).map((ligne) => ligne.map(lu)),
      };
    });
}

const liens = (page: unknown): { href: unknown; texte: string }[] =>
  noeudsRendus(page)
    .filter(({ accessoires }) => typeof accessoires["href"] === "string")
    .map(({ accessoires }) => ({ href: accessoires["href"], texte: lu(accessoires["children"]) }));

beforeEach(() => {
  base.references.length = 0;
  couvrir({ cle: "github", recense: { requires: [], tier: "auto" } }, { cle: "notion" });
});

describe("l'écran des objets possédés", () => {
  it("range chaque objet vivant sous la première section qui s'applique, et tait une section vide", async () => {
    // Given des objets de chaque section, dont un daté que l'écran ne doit plus montrer
    base.references.push(
      reference("site-vitrine", { compte: null, onOffboard: "TRANSFER" }),
      reference("scripts", {
        onOffboard: "ARCHIVE",
        compte: {
          handle: "ancien-gh",
          matchMethod: "DECLARED",
          vanishedAt: null,
          serviceAccountId: null,
          person: personne("remi.exemple", "Rémi Exemple", SORTIE),
        },
      }),
      reference("deploiement", {
        onOffboard: "KEEP",
        compte: {
          handle: "ci-bot",
          matchMethod: "DECLARED",
          vanishedAt: null,
          serviceAccountId: "sa-ci",
          person: null,
        },
      }),
      reference("feuille-de-route", {
        provider: "notion",
        resource: { label: "Feuille de route", url: null },
        onOffboard: "KEEP",
        compte: {
          handle: "lou@exemple.fr",
          matchMethod: "EMAIL_EXACT",
          vanishedAt: SORTIE,
          serviceAccountId: null,
          person: personne("lou.exemple", "Lou Exemple"),
        },
      }),
      reference("scripts-stagiaire", {
        onOffboard: "ARCHIVE",
        compte: {
          handle: "ancien-stagiaire",
          matchMethod: "NONE",
          vanishedAt: null,
          serviceAccountId: null,
          person: null,
        },
      }),
      reference("prototype", {
        onOffboard: "TRANSFER",
        compte: {
          handle: "sacha-dev",
          matchMethod: "HEURISTIC",
          vanishedAt: null,
          serviceAccountId: null,
          person: personne("sacha.exemple", "Sacha Exemple"),
        },
      }),
      reference("carte", {
        onOffboard: "TRANSFER",
        compte: {
          handle: "noor-gh",
          matchMethod: "GITHUB_LOGIN",
          vanishedAt: null,
          serviceAccountId: null,
          person: personne("noor.exemple", "Noor Exemple"),
        },
      }),
      reference("carte-bis", {
        resourceId: "carte",
        resource: { label: "Dépôt incubateur-exemple/carte", url: "https://exemple.fr/carte" },
        onOffboard: "TRANSFER",
        compte: {
          handle: "camille-gh",
          matchMethod: "GITHUB_LOGIN",
          vanishedAt: null,
          serviceAccountId: null,
          person: personne("camille.exemple", "Camille Exemple", SORTIE),
        },
      }),
      reference("ancien-depot", {
        onOffboard: "TRANSFER",
        vanishedAt: SORTIE,
        compte: {
          handle: "noor-gh",
          matchMethod: "GITHUB_LOGIN",
          vanishedAt: null,
          serviceAccountId: null,
          person: personne("noor.exemple", "Noor Exemple"),
        },
      }),
    );

    // When l'écran se rend
    const page = await ObjetsPossedesPage();
    const sections = sectionsRendues(page);

    // Then les trois sections viennent dans l'ordre, chacune avec les quatre mêmes colonnes
    expect(sections.map(({ titre }) => titre)).toEqual([
      "Orphelins",
      "Auteur à confirmer",
      "Auteur présent",
    ]);
    for (const { entetes } of sections) {
      expect(entetes).toEqual(["Objet", "Système", "Compte", "Au départ"]);
    }

    // Then chaque orphelin dit pourquoi il l'est dans sa cellule de compte, et son destin dans le
    // mot de la table des destins
    expect(sections[0]?.lignes).toEqual([
      [
        "Dépôt incubateur-exemple/site-vitrine",
        "github",
        "aucun compte connu",
        DESTIN_AU_DEPART.TRANSFER.libelle,
      ],
      [
        "Dépôt incubateur-exemple/scripts",
        "github",
        "ancien-gh Rémi Exemple sortie",
        DESTIN_AU_DEPART.ARCHIVE.libelle,
      ],
      [
        "Dépôt incubateur-exemple/deploiement",
        "github",
        "ci-bot compte de service",
        DESTIN_AU_DEPART.KEEP.libelle,
      ],
      [
        "Dépôt incubateur-exemple/scripts-stagiaire",
        "github",
        "ancien-stagiaire rattaché à aucune personne",
        DESTIN_AU_DEPART.ARCHIVE.libelle,
      ],
    ]);
    expect(sections[1]?.lignes).toEqual([
      [
        "Dépôt incubateur-exemple/prototype",
        "github",
        "sacha-dev Sacha Exemple",
        DESTIN_AU_DEPART.TRANSFER.libelle,
      ],
    ]);

    // Then un compte disparu d'une personne présente garde son objet chez l'auteur présent,
    // comme le plan de départ le tient. Un dépôt partagé avec un auteur sorti n'y fait qu'une
    // ligne, qui nomme ses deux comptes. Une référence datée ne revient pas.
    expect(sections[2]?.lignes).toEqual([
      [
        "Feuille de route",
        "notion",
        `lou@exemple.fr Lou Exemple Disparu le ${dateFr.format(SORTIE)}`,
        DESTIN_AU_DEPART.KEEP.libelle,
      ],
      [
        "Dépôt incubateur-exemple/carte",
        "github",
        "noor-gh Noor Exemple camille-gh Camille Exemple sortie",
        DESTIN_AU_DEPART.TRANSFER.libelle,
      ],
    ]);

    // Then un objet porteur d'une adresse mène au système, une fiche mène à la personne, et
    // l'auteur à confirmer envoie là où le rattachement se tranche
    const cibles = liens(page);
    expect(cibles).toContainEqual({
      href: "https://exemple.fr/site-vitrine",
      texte: "Dépôt incubateur-exemple/site-vitrine",
    });
    expect(cibles).toContainEqual({ href: "/personnes/remi.exemple", texte: "Rémi Exemple" });
    expect(cibles).toContainEqual({ href: "/comptes-isoles", texte: "comptes isolés" });
    expect(cibles.some(({ texte }) => texte === "Feuille de route")).toBe(false);

    // Then le total ne compte que les vivants, et rien ne dit qu'aucun système ne recense
    const texte = lu(page);
    expect(texte).toContain("7 objets possédés.");
    expect(texte).not.toContain("ne recense");

    // When il ne reste que des objets dont l'auteur est présent
    base.references.splice(0, base.references.length - 3);
    const seule = sectionsRendues(await ObjetsPossedesPage());

    // Then les deux sections vides disparaissent, sans titre ni tableau vide
    expect(seule.map(({ titre }) => titre)).toEqual(["Auteur présent"]);
  });

  it("dit qu'aucun système ne recense, mène aux systèmes, et sépare ce silence d'un relevé vide", async () => {
    // Given un système qui déclare recenser sans en avoir le jeton, et un autre qui ne le
    // déclare pas
    couvrir({ cle: "github", recense: JETON }, { cle: "notion" });

    // When l'écran se rend sans aucun objet
    const sansRecensement = await ObjetsPossedesPage();

    // Then il dit que rien ne recense, mène à ce que chaque système sait faire, et ne pose
    // aucune section
    expect(lu(sansRecensement)).toContain("Aucun système couvert ne recense les objets possédés.");
    expect(liens(sansRecensement)).toContainEqual({
      href: "/systemes",
      texte: "Ce que chaque système sait faire",
    });
    expect(sectionsRendues(sansRecensement)).toEqual([]);
    expect(lu(sansRecensement)).not.toContain("Aucun objet possédé relevé");
    expect(lu(sansRecensement)).not.toMatch(/\d+ objets? possédés?\./u);

    // When le jeton arrive et que la collecte ne relève rien
    couvrir({ cle: "github", recense: JETON, jeton: true }, { cle: "notion" });
    const releveVide = lu(await ObjetsPossedesPage());

    // Then l'écran nomme le système regardé, et ne renvoie plus vers les systèmes
    expect(releveVide).toContain("Aucun objet possédé relevé sur github.");
    expect(releveVide).not.toContain("ne recense");

    // When le jeton repart alors que des objets restent en base
    couvrir({ cle: "github", recense: JETON }, { cle: "notion" });
    base.references.push(reference("carte", { compte: null, onOffboard: "TRANSFER" }));
    const reste = await ObjetsPossedesPage();

    // Then les objets restent visibles, sous la phrase qui dit que plus rien ne recense
    expect(lu(reste)).toContain("Aucun système couvert ne recense les objets possédés.");
    expect(sectionsRendues(reste).map(({ titre }) => titre)).toEqual(["Orphelins"]);
  });
});
