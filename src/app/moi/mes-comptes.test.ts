import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import MonEspacePage from "@/app/moi/page";
import type { CapabilityDecl, Connector, ConnectorContract } from "@/core/connector";
import type { MatchMethod } from "@/generated/prisma/enums";
import type { Utilisateur } from "@/lib/session";
import { operatrice, participant } from "@/test/doubles/session";

import { MesComptes } from "./MesComptes";
import { MES_COMPTES } from "./redaction";

/**
 * Ce que quelqu'un lit de ses propres comptes, et ce que l'écran refuse de laisser
 * croire quand personne n'a regardé.
 *
 * La garantie qui coûte cher ici n'est pas l'affichage : c'est la clé par laquelle la
 * fiche se trouve. Une seule ressemblance de trop, et cet écran-ci montre les comptes
 * de quelqu'un d'autre à qui n'a rien demandé.
 *
 * Patron serveur sans DOM, comme les deux écrans d'inventaire : la page est une fonction
 * asynchrone, et ce qui se vérifie est l'arbre qu'elle rend.
 */

const HEURE = 60 * 60 * 1000;

type EtatDeCollecte = "OK" | "PARTIAL" | "FAILED" | "SKIPPED";

interface CompteEnBase {
  id: string;
  provider: string;
  handle: string;
  matchMethod: MatchMethod;
  lastSeenAt: Date;
  vanishedAt: Date | null;
  /** Ce qu'un connecteur sait du compte, et qui peut nommer qui a invité. */
  details: unknown;
  externalId: string;
}

interface FicheEnBase {
  id: string;
  username: string;
  comptes: CompteEnBase[];
}

const base = vi.hoisted(() => ({
  utilisateur: undefined as unknown as Utilisateur,
  connecteurs: [] as Connector[],
  seuilHeures: 24,
  fiches: [] as FicheEnBase[],
  perimetre: null as { startedAt: Date } | null,
  releves: [] as { provider: string; startedAt: Date; status: EtatDeCollecte }[],
  /** Par quelle clé la fiche a été demandée, seule garde qui tienne sur cet écran. */
  clesLues: [] as string[],
  /** Les colonnes de compte que la requête a demandées. */
  colonnes: [] as string[],
}));

vi.mock("@/lib/session", async () =>
  (await import("@/test/doubles/session")).doublerSession({ lire: () => base.utilisateur }),
);

vi.mock("@/lib/policy", () => ({
  policy: () => ({ thresholds: { collectStaleHours: base.seuilHeures } }),
}));

vi.mock("@/connectors", () => ({ CONNECTEURS: base.connecteurs }));

vi.mock("@/lib/db", () => ({
  prisma: {
    caseParticipation: { findMany: () => Promise.resolve([]) },
    person: {
      findUnique: ({
        where,
        select,
      }: {
        where: { id?: string; username?: string };
        select: { identities: { select: Record<string, boolean> } };
      }) => {
        base.clesLues.push(
          where.id === undefined ? `username:${where.username}` : `id:${where.id}`,
        );
        base.colonnes = Object.keys(select.identities.select).sort();
        const fiche = base.fiches.find(
          (candidate) => candidate.id === where.id || candidate.username === where.username,
        );
        return Promise.resolve(fiche === undefined ? null : { identities: fiche.comptes });
      },
    },
    syncRun: {
      findFirst: () => Promise.resolve(base.perimetre),
      findMany: () => Promise.resolve(base.releves),
    },
  },
}));

function contratDe(cle: string, libelle: string): ConnectorContract {
  return {
    key: cle,
    label: libelle,
    criticality: "medium",
    runbook: `Marche à suivre de ${libelle}.`,
    accountSlug: ({ handle }) => handle,
    credentials: [],
    capabilities: {} as Partial<
      Record<"list" | "grant" | "revoke" | "verify", readonly CapabilityDecl[]>
    > as ConnectorContract["capabilities"],
    scopeSchema: z.strictObject({}),
  };
}

function couvrir(...systemes: readonly (readonly [string, string])[]): void {
  base.connecteurs.length = 0;
  for (const [cle, libelle] of systemes) {
    base.connecteurs.push({
      contract: contratDe(cle, libelle),
      probe: () => Promise.resolve([]),
      plan: () => Promise.resolve([]),
    });
  }
}

function compte(champs: Partial<CompteEnBase> & { id: string; provider: string }): CompteEnBase {
  return {
    handle: `${champs.id}@exemple.fr`,
    matchMethod: "DECLARED",
    lastSeenAt: ilYA(1),
    vanishedAt: null,
    details: [{ label: "Invitée par", value: "operatrice.exemple" }],
    externalId: `externe-${champs.id}`,
    ...champs,
  };
}

const ilYA = (heures: number): Date => new Date(Date.now() - heures * HEURE);

/**
 * Le texte que la page a placé dans son arbre, phrases composées comprises.
 *
 * `MesComptes` est appelé plutôt que parcouru : un composant nommé en JSX n'est pas
 * appelé, il devient un nœud portant ses accessoires, et tout ce que la section dit
 * resterait alors invisible. L'appeler ici prouve du même coup que la page lui a bien
 * passé ce qu'elle a lu.
 */
function textesRendus(noeud: unknown): string[] {
  if (typeof noeud === "string") {
    return [noeud];
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
  if ((noeud as { type?: unknown }).type === MesComptes) {
    return textesRendus(MesComptes(accessoires as Parameters<typeof MesComptes>[0]));
  }
  return Object.values(accessoires).flatMap(textesRendus);
}

const texteRendu = (noeud: unknown): string =>
  textesRendus(noeud).join(" ").replace(/\s+/gu, " ").trim();

const rendre = async (): Promise<string> => texteRendu(await MonEspacePage());

beforeEach(() => {
  base.utilisateur = participant({ username: "camille.exemple", personId: "personne-camille" });
  base.fiches.length = 0;
  base.releves.length = 0;
  base.clesLues.length = 0;
  base.colonnes.length = 0;
  base.perimetre = { startedAt: ilYA(1) };
  base.seuilHeures = 24;
  couvrir(["github", "GitHub"], ["notion", "Notion"], ["scalingo", "Scalingo"]);
});

describe("les comptes qu'on connaît à quelqu'un, et ce que leur absence vaut", () => {
  it("ne trouve la fiche que par ce que la session a prouvé, jamais par ressemblance", async () => {
    // Given deux fiches, celle d'une personne venue par un droit sur un dossier et
    // celle de quelqu'un de l'équipe transverse, chacune avec son compte
    base.fiches.push(
      {
        id: "personne-camille",
        username: "camille.exemple",
        comptes: [compte({ id: "compte-camille", provider: "github", handle: "camille-gh" })],
      },
      {
        id: "personne-operatrice",
        username: "operatrice.exemple",
        comptes: [compte({ id: "compte-operatrice", provider: "notion", handle: "op@exemple.fr" })],
      },
    );

    // When la personne venue par un droit ouvre son espace
    const sienne = await rendre();

    // Then elle y voit son compte et celui-là seul, et la fiche a été demandée par
    // l'identifiant que la connexion a résolu, jamais par le nom que le jeton porte
    expect(sienne).toContain("camille-gh");
    expect(sienne).not.toContain("op@exemple.fr");
    expect(base.clesLues).toEqual(["id:personne-camille"]);

    // Given quelqu'un de l'équipe transverse, dont la connexion ne résout aucune fiche
    // parce que l'allowlist vit dans l'environnement et non dans le périmètre
    base.clesLues.length = 0;
    base.utilisateur = operatrice({ username: "operatrice.exemple", personId: null });

    // When il ouvre le sien
    const sien = await rendre();

    // Then la fiche se trouve par son identifiant, que la voie espace-membre a prouvé
    expect(base.clesLues).toEqual(["username:operatrice.exemple"]);
    expect(sien).toContain("op@exemple.fr");
    expect(sien).not.toContain("camille-gh");

    // Given quelqu'un dont aucune fiche ne porte l'identifiant, ce qui est le cas
    // ordinaire de qui administre sans figurer au référentiel
    base.clesLues.length = 0;
    base.utilisateur = operatrice({ username: "sans.fiche.exemple", personId: null });

    // Then l'écran le dit et ne tombe pas, et il ne met pas en cause une collecte qui a
    // bien eu lieu
    const sansFiche = await rendre();
    expect(sansFiche).toContain(MES_COMPTES.ficheInconnue);
    expect(sansFiche).not.toContain(MES_COMPTES.jamaisCollecte);

    // Given ce même écran avant la toute première collecte du référentiel
    base.perimetre = null;

    // Then il ne reproche plus l'absence de fiche à personne, rien n'ayant encore été lu
    const avantToute = await rendre();
    expect(avantToute).toContain(MES_COMPTES.jamaisCollecte);
    expect(avantToute).not.toContain(MES_COMPTES.ficheInconnue);

    // Given une session sans fiche résolue et hors de la voie espace-membre, forme
    // qu'aucune connexion ne pose aujourd'hui et que la garde refuse quand même
    base.clesLues.length = 0;
    base.utilisateur = participant({ username: "camille.exemple", personId: null });

    // Then rien n'est même allé chercher de fiche : un identifiant que rien n'a prouvé
    // ne sert pas de clé
    await rendre();
    expect(base.clesLues).toEqual([]);
  });

  it("qualifie une liste vide par ce qui a été lu, et garde un compte sur un système muet", async () => {
    // Given une fiche sans aucun compte rattaché, et trois systèmes couverts qu'aucune
    // collecte n'a jamais lus
    base.fiches.push({ id: "personne-camille", username: "camille.exemple", comptes: [] });

    // When son espace se rend
    const jamaisLu = await rendre();

    // Then les trois sont annoncés muets avec leur raison, et l'écran ne prétend nulle
    // part qu'elle n'a pas de compte
    expect(jamaisLu).toContain(MES_COMPTES.muets.titre(3));
    expect(jamaisLu).toContain(MES_COMPTES.muets.entete);
    expect(jamaisLu).toContain("n'a jamais été lu");
    expect(jamaisLu).toContain(
      "Aucun système couvert n'a encore été lu. Cette liste ne dit rien des accès que vous détenez.",
    );

    // Given un système lu à l'instant, un deuxième en échec, un troisième lu au-delà du
    // seuil admis
    base.releves.push(
      { provider: "github", startedAt: ilYA(1), status: "OK" },
      { provider: "notion", startedAt: ilYA(1), status: "FAILED" },
      { provider: "scalingo", startedAt: ilYA(50), status: "OK" },
    );

    // When son espace se rend de nouveau
    const partiel = await rendre();

    // Then seul le premier qualifie le vide, et les deux autres portent chacun sa
    // raison, celle du troisième avec son âge
    expect(partiel).toContain(
      "Aucun compte ne vous est rattaché sur les systèmes déjà lus (GitHub).",
    );
    expect(partiel).toContain(MES_COMPTES.muets.titre(2));
    expect(partiel).toContain("Notion a échoué à la dernière collecte");
    expect(partiel).toContain("Scalingo n'a pas été lu depuis 50 heures");

    // Given un compte sur le système qu'on ne lit plus
    const fiche = base.fiches[0];
    if (fiche === undefined) {
      throw new Error("la fiche n'a pas été posée");
    }
    fiche.comptes.push(compte({ id: "compte-muet", provider: "scalingo", handle: "camille-sc" }));

    // Then il reste affiché, le silence portant sur ce qu'on ne voit plus et non sur ce
    // qu'on a vu, et l'alerte continue de dire que la liste peut être incomplète
    const avecUnCompte = await rendre();
    expect(avecUnCompte).toContain("camille-sc");
    expect(avecUnCompte).toContain(MES_COMPTES.muets.entete);
    expect(avecUnCompte).not.toContain("Aucun compte ne vous est rattaché");

    // Given tous les systèmes lus dans les délais
    base.releves.length = 0;
    base.releves.push(
      { provider: "github", startedAt: ilYA(1), status: "OK" },
      { provider: "notion", startedAt: ilYA(1), status: "OK" },
      { provider: "scalingo", startedAt: ilYA(1), status: "OK" },
    );

    // Then l'alerte disparaît, et la réserve qui reste vraie même alors est dite : un
    // compte que rien ne rattache à la fiche n'apparaît nulle part ici
    const toutLu = await rendre();
    expect(toutLu).not.toContain(MES_COMPTES.muets.entete);
    expect(toutLu).toContain(MES_COMPTES.toutEstLu(["GitHub", "Notion", "Scalingo"]));
  });

  it("dit ce qu'un rattachement sans preuve n'emporte pas, et ne lit rien qui nomme un tiers", async () => {
    // Given une fiche portant trois comptes : un déclaré, un rattaché sur une
    // ressemblance de nom, et un dont le système ne rend plus rien
    base.fiches.push({
      id: "personne-camille",
      username: "camille.exemple",
      comptes: [
        compte({ id: "compte-sur", provider: "github", handle: "camille-gh" }),
        compte({
          id: "compte-ressemblant",
          provider: "notion",
          handle: "c.exemple@notion",
          matchMethod: "HEURISTIC",
        }),
        compte({
          id: "compte-disparu",
          provider: "scalingo",
          handle: "camille-sc",
          vanishedAt: new Date("2026-06-15T00:00:00Z"),
        }),
      ],
    });
    base.releves.push(
      { provider: "github", startedAt: ilYA(1), status: "OK" },
      { provider: "notion", startedAt: ilYA(1), status: "OK" },
      { provider: "scalingo", startedAt: ilYA(1), status: "OK" },
    );

    // When son espace se rend
    const page = await rendre();

    // Then les trois sortent, nommés par le libellé du système et non par sa clé
    expect(page).toContain("camille-gh");
    expect(page).toContain("c.exemple@notion");
    expect(page).toContain("camille-sc");
    expect(page).toContain("GitHub");

    // Then celui qui ne repose sur rien porte sa marque, et ce qu'elle emporte se dit
    // une fois sous le tableau plutôt qu'à chaque ligne
    expect(page).toContain(MES_COMPTES.rattachementIncertain);
    expect(page).toContain(MES_COMPTES.consequenceDuRattachementIncertain);

    // Then celui qu'on ne voit plus reste affiché avec sa date, c'est justement ce que
    // la personne peut constater mieux que quiconque
    expect(page).toContain(MES_COMPTES.disparu("15 juin 2026"));

    // Then la requête n'a demandé que ces colonnes-là, et c'est cette liste qui garde
    // l'écran : `details` nomme qui a invité, `externalId` ne dit rien à personne
    expect(base.colonnes).toEqual([
      "handle",
      "id",
      "lastSeenAt",
      "matchMethod",
      "provider",
      "vanishedAt",
    ]);
    expect(page).not.toContain("operatrice.exemple");
    expect(page).not.toContain("externe-compte-sur");

    // Given une fiche dont tous les comptes reposent sur une preuve
    const fiche = base.fiches[0];
    if (fiche === undefined) {
      throw new Error("la fiche n'a pas été posée");
    }
    fiche.comptes = fiche.comptes.filter((candidat) => candidat.matchMethod === "DECLARED");

    // Then rien ne parle plus de rattachement, une réserve qui ne porte sur aucune ligne
    // se lisant comme une réserve sur toutes
    const sansReserve = await rendre();
    expect(sansReserve).not.toContain(MES_COMPTES.consequenceDuRattachementIncertain);
    expect(sansReserve).not.toContain(MES_COMPTES.rattachementIncertain);

    // Given une collecte du référentiel au-delà du seuil admis
    base.perimetre = { startedAt: ilYA(50) };

    // Then l'écran entier s'annonce daté, comptes et dossiers compris, plutôt que de
    // laisser lire ses lignes comme l'état du jour
    const perime = await rendre();
    expect(perime).toContain(MES_COMPTES.perimetre.titre);
    expect(perime).toContain(MES_COMPTES.perimetre.description(50, 24));

    // Then cette bannière-là ne date que ce qui vient du référentiel, et jamais les
    // comptes, dont la fraîcheur se lit système par système au-dessus du tableau : elle
    // les annoncerait périmés le jour où leurs systèmes viennent d'être lus
    for (const phrase of [
      MES_COMPTES.perimetre.titre,
      MES_COMPTES.perimetre.description(null, 24),
      MES_COMPTES.perimetre.description(50, 24),
    ]) {
      expect(phrase).not.toMatch(/comptes?\b/u);
    }
  });
});
