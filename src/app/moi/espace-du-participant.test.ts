import { beforeEach, describe, expect, it, vi } from "vitest";

import DossierDuParticipantPage, { EtapeDuParticipant } from "@/app/moi/dossiers/[id]/page";
import type { Acteur, Verdict } from "@/core/dossier";
import { dossiersOuvertsPour } from "@/lib/participation";

/**
 * Ce qu'un non-opérateur voit de l'outil, des deux côtés de la frontière : la liste de
 * `/moi`, que `dossiersOuvertsPour` filtre, et la route dédiée, qui garde puis projette.
 *
 * Posé sur cet espace-là parce que c'est lui qu'il décrit, les deux écrans qu'il
 * parcourt étant les deux seuls que cette route rend : une session valide n'y montre
 * rien de plus que ce qu'un droit vivant couvre.
 */
interface DroitEnBase {
  accessCaseId: string;
  personId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface EtapeEnBase {
  id: string;
  label: string;
  state: string;
  validation: string;
  expectedActor: Acteur;
  validationBy: Acteur | null;
  declaredBy: string | null;
  reponse: string | null;
  template: unknown;
}

interface DossierEnBase {
  id: string;
  kind: "ONBOARDING" | "OFFBOARDING";
  state: "WATCH" | "CANDIDATE" | "CONFIRMED" | "CANCELLED" | "DONE";
  /** La fiche du porteur, seul ancrage de son rôle : son identifiant, lui, se renomme. */
  porteur: string;
  nomComplet: string;
  etatDuPlan: string;
  etapes: readonly EtapeEnBase[];
}

const base = vi.hoisted(() => ({
  utilisateur: {
    username: "lead.exemple",
    email: null as string | null,
    nom: null as string | null,
    personId: "personne-lead" as string | null,
    voie: "ADRESSE" as "ADRESSE" | "ESPACE_MEMBRE",
    operateur: false,
  },
  droits: [] as DroitEnBase[],
  dossiers: [] as DossierEnBase[],
  /** Ce que la page a lu, pour dire si la garde a bien parlé avant la requête. */
  lectures: [] as string[],
  /** Les colonnes d'étape que la requête a demandées, seule garde qui tienne. */
  colonnes: [] as string[],
}));

vi.mock("@/lib/session", () => ({
  requireUtilisateur: () => Promise.resolve(base.utilisateur),
}));

function dossierDe(id: string): DossierEnBase | undefined {
  return base.dossiers.find((dossier) => dossier.id === id);
}

vi.mock("@/lib/db", () => ({
  prisma: {
    caseParticipation: {
      findUnique: ({
        where,
      }: {
        where: { accessCaseId_personId: { accessCaseId: string; personId: string } };
      }) => {
        const cle = where.accessCaseId_personId;
        base.lectures.push(`droit:${cle.accessCaseId}`);
        const droit = base.droits.find(
          (candidat) =>
            candidat.accessCaseId === cle.accessCaseId && candidat.personId === cle.personId,
        );
        const dossier = droit && dossierDe(droit.accessCaseId);
        return Promise.resolve(
          droit && dossier
            ? {
                expiresAt: droit.expiresAt,
                revokedAt: droit.revokedAt,
                accessCase: { state: dossier.state },
              }
            : null,
        );
      },
      findMany: ({ where }: { where: { personId: string } }) => {
        base.lectures.push("droits");
        return Promise.resolve(
          base.droits
            .filter((droit) => droit.personId === where.personId)
            .map((droit) => {
              const dossier = dossierDe(droit.accessCaseId);
              if (dossier === undefined) {
                throw new Error(`dossier absent du dépôt de test : ${droit.accessCaseId}`);
              }
              return {
                expiresAt: droit.expiresAt,
                revokedAt: droit.revokedAt,
                accessCase: {
                  id: dossier.id,
                  kind: dossier.kind,
                  state: dossier.state,
                  person: { fullname: dossier.nomComplet },
                },
              };
            }),
        );
      },
    },
    accessCase: {
      findUnique: ({
        where,
        select,
      }: {
        where: { id: string };
        select: { plans: { select: { steps: { select: Record<string, boolean> } } } };
      }) => {
        base.lectures.push(`dossier:${where.id}`);
        base.colonnes = Object.keys(select.plans.select.steps.select).sort();
        const dossier = dossierDe(where.id);
        return Promise.resolve(
          dossier === undefined
            ? null
            : {
                id: dossier.id,
                kind: dossier.kind,
                state: dossier.state,
                person: { id: dossier.porteur, fullname: dossier.nomComplet },
                plans: [
                  { id: `plan-${dossier.id}`, state: dossier.etatDuPlan, steps: dossier.etapes },
                ],
              },
        );
      },
    },
  },
}));

function dans(jours: number): Date {
  return new Date(Date.now() + jours * 24 * 60 * 60 * 1000);
}

/**
 * Les identifiants d'étape que la page a effectivement placés dans son arbre.
 *
 * Un composant nommé dans du JSX n'est pas appelé, il devient un nœud portant ses
 * accessoires : le parcours lit donc ce que la page a décidé de rendre, sans harnais
 * de rendu et sans rien exécuter de ce qui est en aval.
 */
interface EtapeRendue {
  id: string;
  /** Le formulaire de pointage a été offert. */
  pointable: boolean;
  /** Ce que la page a décidé du second regard, ou rien si elle n'en offre aucun. */
  controle: Verdict | null;
}

function etapesRendues(noeud: unknown): EtapeRendue[] {
  if (Array.isArray(noeud)) {
    return noeud.flatMap(etapesRendues);
  }
  if (noeud === null || typeof noeud !== "object") {
    return [];
  }
  const accessoires = (noeud as { props?: Record<string, unknown> }).props;
  if (accessoires === undefined) {
    return [];
  }
  const etape = accessoires["etape"] as { id?: unknown } | undefined;
  return [
    ...(typeof etape?.id === "string"
      ? [
          {
            id: etape.id,
            pointable: accessoires["pointable"] === true,
            controle: (accessoires["controle"] ?? null) as Verdict | null,
          },
        ]
      : []),
    ...etapesRendues(accessoires["children"]),
  ];
}

const idsRendus = (noeud: unknown): string[] => etapesRendues(noeud).map(({ id }) => id);

/**
 * Le texte que la page a placé dans son arbre, phrases composées comprises.
 *
 * Même parcours qu'`etapesRendues`, et deux différences qui portent. Il lit tous les
 * emplacements et pas les seuls enfants, une phrase servie en accessoire n'étant
 * l'enfant de rien. Et il appelle `EtapeDuParticipant`, un composant nommé en JSX
 * n'étant pas appelé : sans cet appel, ce que la page dit d'une étape refusée ne serait
 * dans aucun arbre. Il s'arrête là, et c'est voulu : ce que celui-là rend est du
 * composant client, qui ne rend qu'au travers de hooks qu'aucun rendu ne porte ici.
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
  if ((noeud as { type?: unknown }).type === EtapeDuParticipant) {
    return textesRendus(
      EtapeDuParticipant(accessoires as Parameters<typeof EtapeDuParticipant>[0]),
    );
  }
  return Object.values(accessoires).flatMap((valeur) => textesRendus(valeur));
}

/** Le même texte, lu comme un écran le rend : les blancs du JSX ne disent rien. */
const texteRendu = (noeud: unknown): string =>
  textesRendus(noeud).join(" ").replace(/\s+/gu, " ").trim();

function etape(champs: Partial<EtapeEnBase> & { id: string; expectedActor: Acteur }): EtapeEnBase {
  return {
    label: `Étape ${champs.id}`,
    state: "PENDING",
    validation: "NONE",
    validationBy: null,
    declaredBy: null,
    reponse: null,
    template: null,
    ...champs,
  };
}

const REFUS_404 = "NEXT_HTTP_ERROR_FALLBACK;404";

function rendre(id: string): Promise<unknown> {
  return DossierDuParticipantPage({ params: Promise.resolve({ id }) });
}

beforeEach(() => {
  base.utilisateur = {
    username: "lead.exemple",
    email: null,
    nom: null,
    personId: "personne-lead",
    voie: "ADRESSE",
    operateur: false,
  };
  base.droits.length = 0;
  base.dossiers.length = 0;
  base.lectures.length = 0;
  base.colonnes.length = 0;

  base.dossiers.push({
    id: "dossier-1",
    kind: "OFFBOARDING",
    state: "CONFIRMED",
    porteur: "personne-camille",
    nomComplet: "Camille Exemple",
    etatDuPlan: "EXECUTING",
    etapes: [
      etape({ id: "etape-deleguee", expectedActor: "DELEGATE" }),
      etape({ id: "etape-de-l-equipe", expectedActor: "OPERATOR" }),
      etape({ id: "etape-du-porteur", expectedActor: "SUBJECT" }),
    ],
  });
});

describe("ce qu'un droit vivant ouvre, et ce qu'il n'ouvre plus", () => {
  it("ne liste que les dossiers qu'un droit vivant couvre, jamais ceux qu'il a couverts", async () => {
    // Given cinq droits sur cinq dossiers : un vivant, un révoqué, un périmé, un sur
    // un dossier soldé et un sur un dossier annulé
    const etats = [
      { id: "dossier-vivant", etat: "CONFIRMED" as const, revoque: false, jours: 7 },
      { id: "dossier-revoque", etat: "CONFIRMED" as const, revoque: true, jours: 7 },
      { id: "dossier-perime", etat: "CONFIRMED" as const, revoque: false, jours: -1 },
      { id: "dossier-solde", etat: "DONE" as const, revoque: false, jours: 7 },
      { id: "dossier-annule", etat: "CANCELLED" as const, revoque: false, jours: 7 },
    ];
    base.dossiers.length = 0;
    for (const { id, etat, revoque, jours } of etats) {
      base.dossiers.push({
        id,
        kind: "OFFBOARDING",
        state: etat,
        porteur: `personne-porteur-de-${id}`,
        nomComplet: `Porteur de ${id}`,
        etatDuPlan: "EXECUTING",
        etapes: [],
      });
      base.droits.push({
        accessCaseId: id,
        personId: "personne-lead",
        expiresAt: dans(jours),
        revokedAt: revoque ? new Date() : null,
      });
    }

    // When l'écran de son espace demande ce qui lui est ouvert
    const ouverts = await dossiersOuvertsPour("personne-lead");

    // Then seul le droit vivant en sort, avec le nom de la personne concernée et son
    // terme : les quatre autres sont exactement ce qu'une session encore valide ferait
    // lire à quelqu'un dont l'accès est fini, nom complet compris
    expect(ouverts).toEqual([
      {
        id: "dossier-vivant",
        sens: "OFFBOARDING",
        etat: "CONFIRMED",
        porteur: "Porteur de dossier-vivant",
        expiresAt: expect.any(Date),
      },
    ]);

    // Then une session que la voie espace-membre a posée ne désigne aucune fiche, donc
    // n'ouvre rien, et rien n'est même allé le demander
    base.lectures.length = 0;
    await expect(dossiersOuvertsPour(null)).resolves.toEqual([]);
    expect(base.lectures).toEqual([]);
  });

  it("garde la route dédiée sur le droit, et n'y montre que ce qui nomme le lecteur", async () => {
    // Given une session valide, mais aucun droit sur ce dossier
    // When la route dédiée est demandée en devinant l'identifiant du dossier
    // Then elle refuse par un `notFound`, et non par une redirection qui affirmerait à
    // tort que la connexion a échoué
    await expect(rendre("dossier-1")).rejects.toThrow(REFUS_404);

    // Then le refus tombe avant la requête : sans quoi l'existence du dossier se lirait
    // au temps de réponse, et le narrowing du `select` ne protégerait rien
    expect(base.lectures).toEqual(["droit:dossier-1"]);

    // Given ce même lecteur, désormais titulaire d'un droit vivant
    base.droits.push({
      accessCaseId: "dossier-1",
      personId: "personne-lead",
      expiresAt: dans(7),
      revokedAt: null,
    });

    // When il ouvre la route
    const page = await rendre("dossier-1");

    // Then il n'y voit que l'étape que le modèle lui confie : celle de l'équipe et
    // celle de la personne concernée ne lui sont pas refusées, leur existence même ne
    // le regarde pas
    expect(idsRendus(page)).toEqual(["etape-deleguee"]);

    // When son droit est révoqué alors que sa session reste parfaitement valide
    const droit = base.droits[0];
    if (droit === undefined) {
      throw new Error("le droit n'a pas été posé");
    }
    droit.revokedAt = new Date();

    // Then la route se referme au rechargement suivant, sans attendre l'expiration de
    // quoi que ce soit, et l'échéance passée fait exactement pareil
    await expect(rendre("dossier-1")).rejects.toThrow(REFUS_404);
    droit.revokedAt = null;
    droit.expiresAt = dans(-1);
    await expect(rendre("dossier-1")).rejects.toThrow(REFUS_404);

    // Given le porteur du dossier lui-même, à qui l'équipe a ouvert le sien, et dont la
    // fiche a été renommée depuis qu'il s'est connecté : son jeton porte encore l'ancien
    // identifiant, et ce renommage est le seul que ce dépôt autorise
    droit.expiresAt = dans(7);
    droit.personId = "personne-camille";
    base.utilisateur = {
      ...base.utilisateur,
      personId: "personne-camille",
      username: "camille.exempl",
    };

    // Then il y est le porteur et non un délégué, sa fiche le désignant là où son nom ne
    // le désigne plus, donc il n'y voit que ce que ce rôle-là attend
    expect(idsRendus(await rendre("dossier-1"))).toEqual(["etape-du-porteur"]);
  });

  it("lui donne à signer ce qu'un autre a déclaré, sans lui ouvrir ni le geste ni le reste", async () => {
    // Given un droit vivant, et un plan dont deux étapes de la personne concernée
    // attendent un second regard : l'une celui d'un délégué, l'autre celui d'un
    // opérateur. Une troisième le nommera contrôleur, mais personne ne l'a déclarée.
    const plan = (declarant: string) => [
      etape({ id: "etape-deleguee", expectedActor: "DELEGATE" }),
      etape({
        id: "charte",
        expectedActor: "SUBJECT",
        validationBy: "DELEGATE",
        validation: "AWAITING",
        state: "SUCCEEDED",
        declaredBy: declarant,
        reponse: "signée le 3 septembre",
      }),
      etape({
        id: "badge",
        expectedActor: "SUBJECT",
        validationBy: "OPERATOR",
        validation: "AWAITING",
        state: "SUCCEEDED",
        declaredBy: declarant,
      }),
      etape({
        id: "materiel-plus-tard",
        expectedActor: "SUBJECT",
        validationBy: "DELEGATE",
        validation: "NONE",
      }),
      etape({
        id: "cle-ecartee",
        expectedActor: "SUBJECT",
        validationBy: "DELEGATE",
        validation: "AWAITING",
        state: "SKIPPED",
        declaredBy: "operatrice.exemple",
      }),
    ];
    const dossier = base.dossiers[0];
    if (dossier === undefined) {
      throw new Error("le dossier n'a pas été posé");
    }
    dossier.etapes = plan("camille.exemple");
    base.droits.push({
      accessCaseId: "dossier-1",
      personId: "personne-lead",
      expiresAt: dans(7),
      revokedAt: null,
    });

    // When il ouvre la route
    // Then il y voit deux étapes et deux seulement : celle que le plan lui confie, et
    // celle qu'il doit signer. Celle qu'un opérateur contrôle ne le regarde pas, celle
    // dont il sera le contrôleur non plus tant que personne n'a parlé, et l'étape
    // qu'un opérateur a écartée pas davantage : sa raison vit dans une note libre que
    // cette route ne lit pas, et un avis se demande sur ce qu'on montre.
    expect(idsRendus(await rendre("dossier-1"))).toEqual(["etape-deleguee", "charte"]);

    // Then la sienne se pointe et ne se signe pas ; celle qu'il contrôle se signe et ne
    // se pointe pas. Un écran qui offrirait ce second geste mentirait : `peutPointer`
    // le refuse à qui n'est pas l'acteur attendu, et l'action fait foi.
    expect(etapesRendues(await rendre("dossier-1"))).toEqual([
      { id: "etape-deleguee", pointable: true, controle: null },
      { id: "charte", pointable: false, controle: { possible: true } },
    ]);

    // Then rien ne lui est dit d'un plan qui se pointe, et rien de ce qui n'est pas
    // montré : ses deux listes portent une étape, et cette phrase-là parle du dossier
    // entier
    const texteNominal = texteRendu(await rendre("dossier-1"));
    expect(texteNominal).not.toContain("rien ne s'y pointe");
    expect(texteNominal).not.toContain("ne vous est pas montré");
    expect(texteNominal).toContain("Cocher une étape n'exécute rien");

    // Then la requête n'a demandé que ces colonnes-là, et c'est cette liste qui garde la
    // route plutôt que l'écran : `declaredBy` s'y lit pour la seule garde de signature,
    // et rien ne le rend, la note libre et le nom du signataire n'y sont pas.
    expect(base.colonnes).toEqual([
      "declaredBy",
      "expectedActor",
      "id",
      "label",
      "reponse",
      "state",
      "template",
      "validation",
      "validationBy",
    ]);

    // Given ce même plan, mais clos : `validerEtape` refuse alors sur `planPointable`,
    // avant même de regarder qui signe
    dossier.etatDuPlan = "EXECUTED";

    // Then l'écran ne lui offre pas plus la signature qu'il ne lui offre le pointage :
    // un plan clos ne se signe pas, et proposer le geste pour le refuser au clic est
    // exactement ce que cette page évite partout ailleurs
    expect(etapesRendues(await rendre("dossier-1"))).toEqual([
      { id: "etape-deleguee", pointable: false, controle: null },
      { id: "charte", pointable: false, controle: null },
    ]);

    // Then les deux sections disent pourquoi rien ne s'y fait, et chacune de son geste :
    // un geste absent sans explication se cherche, et celle qui se tairait laisserait un
    // titre qui réclame un regard au-dessus de zéro commande
    const texteDuPlanClos = texteRendu(await rendre("dossier-1"));
    expect(texteDuPlanClos).toContain(
      "Ces étapes vous reviennent, mais rien ne s'y pointe. Ce plan est clos.",
    );
    expect(texteDuPlanClos).toContain("Rien ne s'y signe pour autant. Ce plan est clos.");

    // Given ce plan encore en brouillon plutôt que clos
    dossier.etatDuPlan = "DRAFT";

    // Then les deux raisons changent avec lui : elles sortent de `planPointable`, qui
    // est la garde que le serveur opposera, et non d'une seconde table d'états qui
    // ferait dire « approuvé » à un plan qui est fini
    const texteDuBrouillon = texteRendu(await rendre("dossier-1"));
    expect(texteDuBrouillon).toContain(
      "Ces étapes vous reviennent, mais rien ne s'y pointe. Ce plan doit d'abord être confirmé.",
    );
    expect(texteDuBrouillon).toContain(
      "Rien ne s'y signe pour autant. Ce plan doit d'abord être confirmé.",
    );
    dossier.etatDuPlan = "EXECUTING";

    // Given que c'est lui qui a déclaré l'étape dont il est le contrôleur
    dossier.etapes = plan("lead.exemple");

    // Then elle lui reste montrée, et la signature lui est refusée là où elle se
    // demande : personne ne valide sa propre déclaration, et cette règle-là se dit sur
    // l'écran plutôt que de tomber au clic
    expect(etapesRendues(await rendre("dossier-1"))).toEqual([
      { id: "etape-deleguee", pointable: true, controle: null },
      {
        id: "charte",
        pointable: false,
        controle: {
          possible: false,
          raison: "Personne ne valide sa propre déclaration : cette étape attend un autre regard.",
        },
      },
    ]);

    // Given le porteur du dossier, à qui l'équipe a ouvert le sien
    dossier.etapes = plan("camille.exemple");
    const droit = base.droits[0];
    if (droit === undefined) {
      throw new Error("le droit n'a pas été posé");
    }
    droit.personId = "personne-camille";
    base.utilisateur = {
      ...base.utilisateur,
      personId: "personne-camille",
      username: "camille.exemple",
    };

    // Then il voit ses deux étapes et n'en signe aucune, pas même celle qu'il a
    // déclarée : la personne concernée ne contrôle pas ce qu'on déclare sur son propre
    // dossier, et rien ici ne le lui propose
    expect(etapesRendues(await rendre("dossier-1"))).toEqual([
      { id: "charte", pointable: true, controle: null },
      { id: "badge", pointable: true, controle: null },
      { id: "materiel-plus-tard", pointable: true, controle: null },
      { id: "cle-ecartee", pointable: true, controle: null },
    ]);

    // Then rien ne lui est dit de ce qui n'est pas montré : il ne contrôle rien, mais
    // quatre étapes lui reviennent, et une seule liste vide ne fait pas un dossier vide
    expect(texteRendu(await rendre("dossier-1"))).not.toContain("ne vous est pas montré");

    // Given une de ses étapes que le contrôle vient de refuser
    dossier.etapes = [
      etape({
        id: "charte",
        expectedActor: "SUBJECT",
        validationBy: "DELEGATE",
        validation: "REFUSED",
        declaredBy: "camille.exemple",
      }),
    ];

    // Then le refus se dit et le renvoie vers le contrôle de son étape, jamais vers
    // l'équipe transverse : depuis qu'un écran ouvre le refus à un délégué, c'est son
    // lead qui a pu le prononcer, et cette route ne lit ni la note libre ni le nom du
    // signataire
    const texteDuRefus = texteRendu(await rendre("dossier-1"));
    expect(texteDuRefus).toContain(
      "Déclaration refusée. L'étape est de nouveau à faire : qui contrôle cette étape vous dira ce qui manque.",
    );
    expect(texteDuRefus).not.toContain(
      "l'équipe transverse de l'incubateur vous dira ce qui manque",
    );

    // Given le lead de nouveau, et le jour où le dossier s'ouvre : le plan ne lui confie
    // aucune étape, et celle qu'il signera n'a encore été déclarée par personne
    droit.personId = "personne-lead";
    base.utilisateur = {
      ...base.utilisateur,
      personId: "personne-lead",
      username: "lead.exemple",
    };
    dossier.etapes = [
      etape({ id: "etape-de-l-equipe", expectedActor: "OPERATOR" }),
      etape({ id: "charte", expectedActor: "SUBJECT", validationBy: "DELEGATE" }),
    ];

    // Then ses deux listes sont vides, la page le dit de chacune, et elle ne le renvoie
    // vers personne : ce qu'elle ne montre pas est ici l'étape de la personne concernée,
    // celle-là même qu'il signera dès qu'elle sera déclarée, et lui dire que le dossier
    // est entre les mains de l'équipe transverse serait faux le jour où il l'ouvre
    const texteAVide = texteRendu(await rendre("dossier-1"));
    expect(idsRendus(await rendre("dossier-1"))).toEqual([]);
    expect(texteAVide).toContain("Aucune étape de ce dossier ne vous revient.");
    expect(texteAVide).toContain(
      "Rien n'attend non plus votre regard. Cette page ne montre que ce qui vous revient et ce que vous avez à signer : le reste de ce dossier ne vous est pas montré.",
    );
    expect(texteAVide).not.toContain("entre les mains de l'équipe transverse");
    expect(texteAVide).not.toContain("n'attend de geste de votre part");

    // Given que la personne concernée a déclaré cette étape, et qu'elle attend
    // désormais sa signature
    dossier.etapes = [
      etape({ id: "etape-de-l-equipe", expectedActor: "OPERATOR" }),
      etape({
        id: "charte",
        expectedActor: "SUBJECT",
        validationBy: "DELEGATE",
        validation: "AWAITING",
        state: "SUCCEEDED",
        declaredBy: "camille.exemple",
      }),
    ];

    // Then elle lui apparaît, rien ne lui revient toujours, et la phrase sur ce qui
    // n'est pas montré se tait : elle parle du dossier entier, et il y a désormais
    // quelque chose à montrer
    const texteDUneSeuleListe = texteRendu(await rendre("dossier-1"));
    expect(idsRendus(await rendre("dossier-1"))).toEqual(["charte"]);
    expect(texteDUneSeuleListe).toContain("Aucune étape de ce dossier ne vous revient.");
    expect(texteDUneSeuleListe).not.toContain("ne vous est pas montré");
  });
});
