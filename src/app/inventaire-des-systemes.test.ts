import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import AccueilPage from "@/app/page";
import SystemesPage from "@/app/systemes/page";
import type {
  CapabilityDecl,
  Connector,
  ConnectorContract,
  CredentialProbe,
} from "@/core/connector";
import { LIBELLE_ETAT_COLLECTE, LIBELLE_TIER } from "@/core/lexique";
import { OU_SANS_DETENTEUR } from "@/lib/comptes-isoles";
import { dateFr } from "@/ui/dates";

/**
 * Ce que les deux écrans d'inventaire disent d'un système, et ce qu'ils refusent d'en
 * dire quand personne n'a regardé.
 *
 * Les tables de `src/core/lexique.ts` sont épinglées ailleurs comme tables : ce qui ne
 * l'est nulle part, c'est que ces écrans-là servent la bonne entrée, au bon endroit et
 * dans le bon état. Elles sont donc importées et confrontées à ce que la page rend,
 * jamais recopiées. Les phrases écrites en dur dans `src/app/page.tsx`, elles, n'ont
 * aucune table : elles se citent, faute de quoi rien ne les tient.
 *
 * Patron serveur sans DOM : les deux cibles sont des fonctions asynchrones, et ce qui
 * est vérifié est l'arbre qu'elles rendent. Aucun jsdom, aucune bibliothèque de rendu.
 */

const HEURE = 60 * 60 * 1000;

type EtatDeCollecte = "OK" | "PARTIAL" | "FAILED" | "SKIPPED";

interface ReleveEnBase {
  provider: string;
  startedAt: Date;
  status: EtatDeCollecte;
  itemsSeen: number;
}

interface AccesEnBase {
  externalIdentityId: string;
  role: string;
  firstSeenAt: Date;
  resourceId: string;
}

interface PersonneEnBase {
  missionEnd: Date | null;
  vanishedAt: Date | null;
  startups: string[];
  startupAssignments: { startupGhid: string; until: Date; endedAt: Date | null }[];
}

interface CompteDeServiceEnBase {
  reviewEveryDays: number;
  lastReviewedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

const base = vi.hoisted(() => ({
  connecteurs: [] as Connector[],
  seuilHeures: 24,
  perimetre: null as {
    startedAt: Date;
    status: EtatDeCollecte;
    itemsSeen: number;
    error: unknown;
  } | null,
  releves: [] as ReleveEnBase[],
  comptesParSysteme: [] as { provider: string; comptes: number }[],
  acces: [] as AccesEnBase[],
  ressources: [] as { id: string; provider: string }[],
  personnes: [] as PersonneEnBase[],
  constats: { ouverts: 0, sorties: 0, arrivees: 0 },
  nonRevocables: { sansDetenteur: 0, ressemblance: 0 },
  comptesDeService: [] as CompteDeServiceEnBase[],
  startups: [] as { ghid: string; currentPhase: string | null }[],
  operationsTracees: 0,
}));

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

vi.mock("@/lib/policy", () => ({
  policy: () => ({
    thresholds: {
      graceDays: 7,
      soonDays: 30,
      staleDays: 180,
      collectStaleHours: base.seuilHeures,
    },
    startups: { terminalPhases: ["alumni"] },
    profiles: [],
  }),
}));

vi.mock("@/connectors", () => ({
  CONNECTEURS: base.connecteurs,
  catalogueDOctroi: () => [],
}));

const FOURNISSEUR_PERIMETRE = "espace-membre";

vi.mock("@/lib/db", () => ({
  prisma: {
    person: { findMany: () => Promise.resolve(base.personnes) },
    finding: {
      // Les trois comptes de constats ne diffèrent que par leur `kind`, et la tuile en
      // sert deux dans une même phrase : un double qui rendrait le même nombre aux
      // trois laisserait leurs places s'échanger sans que rien ne bouge.
      count: ({ where }: { where: { kind?: string } }) =>
        Promise.resolve(
          where.kind === undefined
            ? base.constats.ouverts
            : where.kind === "SCOPE_EXIT"
              ? base.constats.sorties
              : base.constats.arrivees,
        ),
    },
    syncRun: {
      findFirst: ({ where }: { where: { provider: string } }) =>
        Promise.resolve(
          where.provider === FOURNISSEUR_PERIMETRE
            ? base.perimetre
            : (base.releves.find((releve) => releve.provider === where.provider) ?? null),
        ),
      findMany: () => Promise.resolve(base.releves),
    },
    externalIdentity: {
      groupBy: () =>
        Promise.resolve(
          base.comptesParSysteme.map(({ provider, comptes }) => ({
            provider,
            _count: { _all: comptes },
          })),
        ),
      // Reconnue à la clause elle-même, et non à une condition réécrite ici : c'est
      // la seule façon de dire de quelle file sort le nombre que la tuile affiche.
      count: ({ where }: { where: unknown }) =>
        Promise.resolve(
          where === OU_SANS_DETENTEUR
            ? base.nonRevocables.sansDetenteur
            : base.nonRevocables.ressemblance,
        ),
    },
    accessGrant: { findMany: () => Promise.resolve(base.acces) },
    resource: { findMany: () => Promise.resolve(base.ressources) },
    serviceAccount: { findMany: () => Promise.resolve(base.comptesDeService) },
    startup: { findMany: () => Promise.resolve(base.startups) },
    auditEvent: { count: () => Promise.resolve(base.operationsTracees) },
  },
}));

/**
 * Ce que la page a placé dans son arbre, texte et nombres.
 *
 * Un composant nommé en JSX n'est pas appelé : il devient un nœud portant ses
 * accessoires, et le parcours lit donc ce que la page a décidé de rendre. Il lit tous
 * les emplacements et pas les seuls enfants, une phrase servie en accessoire, comme la
 * description d'une alerte, n'étant l'enfant de rien. Les nombres comptent autant que
 * les chaînes : une cellule qui vaut `0` et une cellule qui dit « non observé » sont
 * précisément ce que cet écran ne doit pas confondre.
 */
function textesRendus(noeud: unknown): string[] {
  if (typeof noeud === "string") {
    return [noeud];
  }
  if (typeof noeud === "number") {
    return [String(noeud)];
  }
  if (Array.isArray(noeud)) {
    return noeud.flatMap(textesRendus);
  }
  if (noeud === null || typeof noeud !== "object") {
    return [];
  }
  const accessoires = (noeud as { props?: Record<string, unknown> }).props;
  if (accessoires === undefined) {
    return [];
  }
  // Une classe du système de design n'est pas du texte : la laisser entrer collerait
  // « fr-text--sm » devant la moitié des cellules, et une cellule se compare ici mot
  // pour mot.
  return Object.entries(accessoires).flatMap(([nom, valeur]) =>
    nom === "className" ? [] : textesRendus(valeur),
  );
}

/** Le même texte, lu comme un écran le rend : les blancs du JSX ne disent rien. */
const texteRendu = (noeud: unknown): string =>
  textesRendus(noeud).join(" ").replace(/\s+/gu, " ").trim();

interface NoeudRendu {
  type: unknown;
  noeud: unknown;
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
    { type: (noeud as { type?: unknown }).type, noeud, accessoires },
    ...Object.values(accessoires).flatMap(noeudsRendus),
  ];
}

/** Les cellules d'un tableau du système de design, désigné par sa légende. */
function cellulesDuTableau(page: unknown, legende: string): unknown[][] {
  const tableau = noeudsRendus(page).find(
    (candidat) => candidat.accessoires["caption"] === legende,
  );
  if (tableau === undefined) {
    throw new Error(`aucun tableau légendé « ${legende} » dans cet arbre`);
  }
  return tableau.accessoires["data"] as unknown[][];
}

/** Les mêmes, lues comme un écran les rend. */
const lignesDuTableau = (page: unknown, legende: string): string[][] =>
  cellulesDuTableau(page, legende).map((ligne) => ligne.map(texteRendu));

/** Les puces d'une liste, seule forme sous laquelle un bandeau énumère des systèmes. */
const pucesRendues = (page: unknown): string[] =>
  noeudsRendus(page)
    .filter((candidat) => candidat.type === "li")
    .map((candidat) => texteRendu(candidat.noeud));

/**
 * Ce qu'une tuile promet et où elle mène, les trois ensemble.
 *
 * Son titre porte un chiffre, sa description le détaille, et son lien décide de
 * l'écran où l'opérateur atterrit. Lus séparément, les trois passent toujours : un
 * chiffre juste sous un libellé qui n'est pas le sien fait traiter la mauvaise file,
 * et le nombre seul, lui, ne dit pas de quelle file il parle.
 */
function tuilesRendues(page: unknown): { titre: string; description: string; cible: unknown }[] {
  return noeudsRendus(page)
    .filter((candidat) => candidat.accessoires["linkProps"] !== undefined)
    .map((candidat) => ({
      titre: texteRendu(candidat.accessoires["title"]),
      description: texteRendu(candidat.accessoires["desc"]),
      cible: (candidat.accessoires["linkProps"] as { href?: unknown }).href,
    }));
}

/** Ce qu'un badge dit et de quelle couleur, sous la forme même de la table du lexique. */
function badgeDe(cellule: unknown): { libelle: string; severite: unknown } {
  const badge = noeudsRendus(cellule).find(
    (candidat) => candidat.accessoires["severity"] !== undefined,
  );
  if (badge === undefined) {
    throw new Error("aucun badge dans cette cellule");
  }
  return {
    libelle: texteRendu(badge.accessoires["children"]),
    severite: badge.accessoires["severity"],
  };
}

const ilYA = (heures: number): Date => new Date(Date.now() - heures * HEURE);

/** Un jalon en jours, négatif pour une échéance déjà passée. */
const dansJours = (jours: number): Date => new Date(Date.now() + jours * 24 * HEURE);

const personneDe = (missionEnd: Date | null, startups: string[] = []): PersonneEnBase => ({
  missionEnd,
  vanishedAt: null,
  startups,
  startupAssignments: [],
});

function contratDe(
  cle: string,
  libelle: string,
  capabilities: Partial<Record<"list" | "grant" | "revoke" | "verify", readonly CapabilityDecl[]>>,
): ConnectorContract {
  return {
    key: cle,
    label: libelle,
    criticality: "medium",
    runbook: `Marche à suivre de ${libelle}.`,
    accountSlug: ({ handle }) => handle,
    credentials: [],
    capabilities: capabilities as ConnectorContract["capabilities"],
    scopeSchema: z.strictObject({}),
  };
}

function connecteurDe(
  contrat: ConnectorContract,
  sondes: readonly CredentialProbe[] = [],
): Connector {
  return {
    contract: contrat,
    probe: () => Promise.resolve(sondes),
    plan: () => Promise.resolve([]),
  };
}

beforeEach(() => {
  base.connecteurs.length = 0;
  base.releves.length = 0;
  base.comptesParSysteme.length = 0;
  base.acces.length = 0;
  base.ressources.length = 0;
  base.personnes.length = 0;
  base.comptesDeService.length = 0;
  base.startups.length = 0;
  base.constats = { ouverts: 0, sorties: 0, arrivees: 0 };
  base.nonRevocables = { sansDetenteur: 0, ressemblance: 0 };
  base.operationsTracees = 0;
  base.seuilHeures = 24;
  base.perimetre = null;
});

describe("ce que l'inventaire dit d'un système, et ce qu'il refuse d'en dire", () => {
  it("distingue le frais, le partiel et le muet, et ne pose jamais de zéro sur ce qu'il n'a pas regardé", async () => {
    // Given quatre systèmes couverts et quatre sorts différents : l'un lu dans les
    // délais, l'un lu partiellement, l'un en échec, et le dernier jamais lu. Le
    // référentiel des personnes, lui, a conclu de façon incomplète.
    const invitationDepuis = new Date("2026-01-12T00:00:00Z");
    for (const [cle, libelle] of [
      ["atelier", "Atelier"],
      ["annuaire", "Annuaire"],
      ["messagerie", "Messagerie"],
      ["archives", "Archives"],
    ] as const) {
      base.connecteurs.push(connecteurDe(contratDe(cle, libelle, {})));
    }
    base.perimetre = {
      startedAt: ilYA(1),
      status: "PARTIAL",
      itemsSeen: 95,
      error: null,
    };
    base.releves.push(
      { provider: "atelier", startedAt: ilYA(1), status: "OK", itemsSeen: 3 },
      { provider: "annuaire", startedAt: ilYA(1), status: "PARTIAL", itemsSeen: 2 },
      { provider: "messagerie", startedAt: ilYA(1), status: "FAILED", itemsSeen: 0 },
    );
    base.comptesParSysteme.push(
      { provider: "atelier", comptes: 3 },
      { provider: "annuaire", comptes: 2 },
    );
    base.ressources.push(
      { id: "ressource-atelier", provider: "atelier" },
      { id: "ressource-annuaire", provider: "annuaire" },
    );
    base.acces.push(
      {
        externalIdentityId: "compte-1",
        role: "admin",
        firstSeenAt: ilYA(240),
        resourceId: "ressource-atelier",
      },
      {
        externalIdentityId: "compte-2",
        role: "member",
        firstSeenAt: ilYA(240),
        resourceId: "ressource-atelier",
      },
      {
        externalIdentityId: "compte-3",
        role: "invite:member",
        firstSeenAt: invitationDepuis,
        resourceId: "ressource-atelier",
      },
      {
        externalIdentityId: "compte-4",
        role: "member",
        firstSeenAt: ilYA(240),
        resourceId: "ressource-annuaire",
      },
      {
        externalIdentityId: "compte-5",
        role: "member",
        firstSeenAt: ilYA(240),
        resourceId: "ressource-annuaire",
      },
    );

    // When l'accueil se rend
    const page = await AccueilPage();

    // Then chaque ligne dit ce que sa collecte permet de dire, et rien de plus. Les
    // deux systèmes muets n'affichent aucun nombre : un zéro y dirait qu'on a regardé
    // et trouvé personne, alors que la seule chose établie est qu'on n'a pas regardé.
    expect(lignesDuTableau(page, "Comptes observés sur chaque système")).toEqual([
      [
        "atelier",
        "3",
        "1",
        "1",
        `1, la plus ancienne observée depuis le ${dateFr.format(invitationDepuis)}`,
        "Lu dans les délais",
      ],
      [
        "annuaire",
        "2",
        "0",
        "2",
        "0",
        "Lu partiellement, sur des erreurs : ce qui reste peut contenir des comptes déjà partis",
      ],
      [
        "messagerie",
        "non observé",
        "non observé",
        "non observé",
        "non observé",
        "En échec à la dernière collecte",
      ],
      [
        "archives",
        "non observé",
        "non observé",
        "non observé",
        "non observé",
        "Jamais lu : aucune collecte, ou aucun accès configuré pour ce système",
      ],
    ]);

    // Then le bandeau des systèmes non observés paraît, accordé au nombre qu'il
    // annonce, et il les énumère un par un plutôt que de laisser chercher lesquels.
    const texte = texteRendu(page);
    expect(texte).toContain("2 systèmes couverts ne sont pas observés");
    expect(texte).toContain(
      "Une fiche qui ne montre aucun compte sur ces systèmes ne dit pas qu'il n'y en a pas : elle dit qu'on n'a pas regardé.",
    );
    expect(pucesRendues(page)).toEqual([
      "messagerie a échoué à la dernière collecte",
      "archives n'a jamais été lu : aucune collecte, ou aucun accès configuré pour lui",
    ]);

    // Then le compte des systèmes lus s'accorde lui aussi, et il nomme les non observés
    // dans la même phrase plutôt que de laisser croire que tout a été vu.
    expect(texte).toContain("2 systèmes sur 4 lus dans les délais, 2 non observés.");

    // Then la conclusion du référentiel des personnes est celle de la table, qui ne nie
    // pas les disparitions en bloc, et l'état brut de la collecte n'affleure nulle part.
    expect(texte).toContain(LIBELLE_ETAT_COLLECTE.PARTIAL.explication);
    expect(texte).toContain("95 personnes lues");
    for (const etat of ["OK", "PARTIAL", "FAILED", "SKIPPED"]) {
      expect(texte).not.toContain(etat);
    }

    // Given le même parc, mais dont le système jusque-là frais n'a plus été lu depuis
    // deux jours, le seuil étant d'un jour
    const atelier = base.releves[0];
    if (atelier === undefined) {
      throw new Error("le relevé de l'atelier n'a pas été posé");
    }
    atelier.startedAt = ilYA(48);

    // When l'accueil se rend de nouveau
    const perime = await AccueilPage();

    // Then un relevé réussi mais vieux vaut non observé au même titre qu'un échec : la
    // ligne perd ses chiffres, la puce dit depuis quand, et le compte suit
    expect(lignesDuTableau(perime, "Comptes observés sur chaque système")[0]).toEqual([
      "atelier",
      "non observé",
      "non observé",
      "non observé",
      "non observé",
      "Plus lu depuis 48 heures",
    ]);
    expect(pucesRendues(perime)).toContain("atelier n'a pas été lu depuis 48 heures");
    expect(texteRendu(perime)).toContain("1 système sur 4 lu dans les délais, 3 non observés.");

    // Given un parc entièrement lu, le système qui n'avait jamais été vu compris
    atelier.startedAt = ilYA(1);
    base.releves.push({
      provider: "archives",
      startedAt: ilYA(1),
      status: "OK",
      itemsSeen: 0,
    });
    base.releves[2] = {
      provider: "messagerie",
      startedAt: ilYA(1),
      status: "OK",
      itemsSeen: 0,
    };

    // When l'accueil se rend une dernière fois
    const observe = await AccueilPage();
    const texteObserve = texteRendu(observe);

    // Then le bandeau disparaît avec ses puces, et le zéro revient là où il veut enfin
    // dire quelque chose : un système lu qui ne porte aucun compte
    expect(texteObserve).toContain("4 systèmes sur 4 lus dans les délais.");
    expect(texteObserve).not.toContain("non observé");
    expect(texteObserve).not.toContain("elle dit qu'on n'a pas regardé");
    expect(pucesRendues(observe)).toEqual([]);
    expect(lignesDuTableau(observe, "Comptes observés sur chaque système")[3]).toEqual([
      "archives",
      "0",
      "0",
      "0",
      "0",
      "Lu dans les délais",
    ]);
  });

  it("sert le mot du lexique pour chaque tier, et jamais la valeur que le code manipule", async () => {
    // Given un système dont les quatre capacités tombent chacune sur un tier différent :
    // une voie automatique praticable, une voie manuelle inconditionnelle, une voie
    // assistée atteinte après dégradation d'une voie automatique dont le credential
    // manque, et une capacité qu'aucune voie ne porte. Et un second système qui ne
    // déclare rien du tout.
    const atelier = contratDe("atelier", "Atelier des accès", {
      list: [{ requires: ["cle-atelier"], tier: "auto" }],
      revoke: [{ requires: [], tier: "manual" }],
      grant: [
        { requires: ["cle-absente"], tier: "auto" },
        { requires: [], tier: "assisted" },
      ],
    });
    base.connecteurs.push(
      connecteurDe(atelier, [
        { id: "cle-atelier", available: true, checkedAt: ilYA(1) },
        {
          id: "cle-absente",
          available: false,
          unavailableReason: "jamais renseignée",
          checkedAt: ilYA(1),
        },
      ]),
      connecteurDe(contratDe("annuaire", "Annuaire", {})),
    );
    base.releves.push({
      provider: "atelier",
      startedAt: ilYA(1),
      status: "PARTIAL",
      itemsSeen: 12,
    });

    // When l'inventaire des systèmes se rend
    const page = await SystemesPage();
    const cellules = cellulesDuTableau(page, "Capacités sur Atelier des accès");
    const lignes = lignesDuTableau(page, "Capacités sur Atelier des accès");

    // Then la colonne « Aujourd'hui » sert l'entrée du lexique qui correspond au tier
    // résolu, libellé et sévérité compris, dans l'ordre des capacités. Une capacité
    // qu'aucune voie ne porte n'est pas tue : elle dit qu'il n'y a pas moyen de la
    // faire, ce qui est justement ce que cet écran existe pour montrer.
    expect(lignes.length).toBe(4);
    expect(cellules.map((ligne) => badgeDe(ligne[1]))).toEqual([
      LIBELLE_TIER.auto,
      LIBELLE_TIER.manual,
      LIBELLE_TIER.assisted,
      LIBELLE_TIER.none,
    ]);

    // Then la colonne qui dit ce qui manque sert la même table, sans la traduire deux
    // fois : la voie perdue s'y nomme du mot de son tier, suivie du credential absent.
    expect(lignes.map((ligne) => ligne[2])).toEqual([
      "sans objet",
      "sans objet",
      `${LIBELLE_TIER.auto.libelle} si : cle-absente`,
      "sans objet",
    ]);

    // Then un système qui ne déclare aucune voie n'a pas d'autre mot que celui-là, sur
    // ses quatre capacités
    expect(
      cellulesDuTableau(page, "Capacités sur Annuaire").map((ligne) => badgeDe(ligne[1])),
    ).toEqual([LIBELLE_TIER.none, LIBELLE_TIER.none, LIBELLE_TIER.none, LIBELLE_TIER.none]);

    // Then le paragraphe sous chaque titre dit sa dernière lecture avec le mot du
    // lexique, et un système jamais lu le dit plutôt que d'afficher une ligne vide
    const texte = texteRendu(page);
    expect(texte).toContain(`collecte ${LIBELLE_ETAT_COLLECTE.PARTIAL.libelle}, 12 comptes.`);
    expect(texte).toContain("Jamais lu.");

    // Then aucune valeur brute ne sort de cet écran, ni celle d'un tier, ni celle d'un
    // état de collecte : ce sont les deux vocabulaires que cette page manipule, et
    // c'est ici qu'ils affleureraient
    for (const badge of noeudsRendus(page).filter(
      (candidat) => candidat.accessoires["severity"] !== undefined,
    )) {
      expect(Object.keys(LIBELLE_TIER)).not.toContain(texteRendu(badge.accessoires["children"]));
    }
    for (const etat of ["OK", "PARTIAL", "FAILED", "SKIPPED"]) {
      expect(texte).not.toContain(etat);
    }
  });
  it("porte chaque chiffre sous son propre libellé, vers l'écran qui le détaille, et dit d'où il sort", async () => {
    // Given un parc dont les chiffres de l'accueil sont tous distincts les uns des
    // autres : deux nombres qui s'échangeraient dans une même phrase se liraient sinon
    // pareil, et c'est exactement ce qu'aucune assertion ne verrait.
    base.connecteurs.push(connecteurDe(contratDe("atelier", "Atelier", {})));
    base.releves.push({ provider: "atelier", startedAt: ilYA(1), status: "OK", itemsSeen: 7 });
    base.comptesParSysteme.push({ provider: "atelier", comptes: 7 });
    base.perimetre = { startedAt: ilYA(2), status: "OK", itemsSeen: 95, error: null };
    base.constats = { ouverts: 9, sorties: 4, arrivees: 2 };
    base.nonRevocables = { sansDetenteur: 11, ressemblance: 8 };
    base.operationsTracees = 21;
    base.personnes.push(
      personneDe(dansJours(-60)),
      personneDe(dansJours(-60)),
      personneDe(dansJours(-60)),
      personneDe(dansJours(-3)),
      personneDe(dansJours(-3)),
      personneDe(dansJours(10), ["jardin-partage"]),
      personneDe(dansJours(10)),
      personneDe(dansJours(10)),
      personneDe(null, ["cantine-mobile"]),
      personneDe(null),
      personneDe(null),
      personneDe(null),
      personneDe(null),
      personneDe(null),
      { missionEnd: null, vanishedAt: dansJours(-1), startups: [], startupAssignments: [] },
    );
    base.startups.push(
      { ghid: "jardin-partage", currentPhase: "alumni" },
      { ghid: "cantine-mobile", currentPhase: "alumni" },
      // Terminale, mais plus personne dessus : elle n'appelle aucun geste, et la tuile
      // qui la compterait quand même enverrait chercher un départ inexistant.
      { ghid: "atelier-fantome", currentPhase: "alumni" },
      { ghid: "releve-des-sols", currentPhase: "acceleration" },
    );
    base.comptesDeService.push(
      ...Array.from({ length: 6 }, () => ({
        reviewEveryDays: 90,
        lastReviewedAt: dansJours(-5),
        createdAt: dansJours(-400),
        expiresAt: null,
      })),
      { reviewEveryDays: 30, lastReviewedAt: null, createdAt: dansJours(-200), expiresAt: null },
      // Un jeton émis dont le terme est passé, et dont la revue est dépassée depuis des
      // mois : il compte parmi les comptes suivis, jamais parmi les retards. Rien ne peut
      // le reprendre, le proxy qui l'a émis n'offrant ni révocation ni introspection, si
      // bien qu'il n'y a aucun geste à réclamer à personne. Le compter en retard rallumerait
      // pour toujours le signal que ce lot existe pour éteindre.
      {
        reviewEveryDays: 7,
        lastReviewedAt: null,
        createdAt: dansJours(-200),
        expiresAt: dansJours(-1),
      },
    );

    // When l'accueil se rend
    const page = await AccueilPage();

    // Then la section dit d'abord d'où sortent ses chiffres : sans cette phrase, un
    // tableau de nombres se lit comme l'état du jour alors qu'il date de la dernière
    // collecte, et c'est la première chose que cet écran a à dire.
    expect(texteRendu(page)).toContain(
      "Le tableau et les chiffres qui suivent sortent de la base, donc de la dernière collecte : ils disent le dernier état constaté, jamais l'état du jour, et aucun n'est demandé à un système au moment où vous lisez cette page. Les tuiles du bas, elles, disent chacune d'où elles tiennent leur chiffre.",
    );

    // Then chaque tuile porte son chiffre sous son propre libellé et mène à l'écran qui
    // le détaille. Les trois se tiennent ensemble : une tuile dit à un opérateur combien
    // de comptes attendent quoi, et deux nombres échangés dans sa description lui font
    // traiter la mauvaise file sans que rien ne le détrompe.
    expect(tuilesRendues(page)).toEqual([
      {
        titre: "9 constats",
        description: "Dont 4 sorties du référentiel des personnes et 2 arrivées à acter.",
        cible: "/constats",
      },
      {
        titre: "3 à traiter",
        description: "Échéance dépassée au-delà du délai de grâce.",
        cible: "/personnes?vue=a-traiter",
      },
      {
        titre: "5 à surveiller",
        description: "Échéance dans les 30 jours, ou dépassée depuis peu.",
        cible: "/personnes?vue=a-surveiller",
      },
      {
        titre: "14 personnes suivies",
        description: "Dont 6 sans échéance connue.",
        cible: "/personnes",
      },
      {
        titre: "19 comptes non révocables",
        description: "11 sans détenteur, 8 rattachés par ressemblance à confirmer.",
        cible: "/comptes-isoles",
      },
      {
        titre: "8 comptes de service",
        description: "Dont 1 en retard de revue.",
        cible: "/comptes-de-service",
      },
      {
        titre: "4 startups",
        description: "Dont 2 en phase terminale portent encore quelqu'un, sans accès justifié.",
        cible: "/startups",
      },
      {
        titre: "21 opérations tracées",
        description:
          "Sur 30 jours. Compteur approximatif : c'est une preuve d'activité, pas une mesure de couverture. L'écran du journal, lui, montre tout l'historique.",
        cible: "/journal",
      },
    ]);
  });
});
