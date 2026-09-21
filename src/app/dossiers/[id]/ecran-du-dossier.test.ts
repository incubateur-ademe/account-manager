// @vitest-environment jsdom
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Acteur } from "@/core/dossier";
import { ISSUE_DOSSIER } from "@/core/execution";
import { LIBELLE_TIER } from "@/core/lexique";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { CLE_INCUBATEUR, SYSTEME_MODELE } from "@/core/modele-plan";
import { BoutonClore, BoutonConfirmer, Pointage, Validation } from "./Pointage";
import DossierPage from "./page";

/**
 * Ce que l'écran d'un dossier montre d'un vrai plan, rendu comme la fonction
 * asynchrone qu'il est : en parcourant l'arbre que le serveur a produit, plutôt qu'en
 * montant la page entière.
 *
 * Une seule chose s'y monte pour de vrai, le formulaire de pointage, et c'est pour la
 * même raison : ce qu'il enverra se lit dans son DOM, jamais dans les accessoires qu'on
 * lui a passés. Un écran qui relaie à moitié ce qu'il a reçu ne se voit pas autrement.
 *
 * Il couvre les deux passages de la recette que rien ne tenait : la liste numérotée
 * d'un brouillon avec ses badges et ses groupes, et l'étape déclarée qui attend un
 * second regard. Les phrases déjà épinglées dans une table ne se recopient pas ici,
 * elles s'importent : ce qui n'était tenu nulle part, c'est que cet écran-là serve la
 * bonne entrée, au bon moment.
 */

interface EtapeFigeeEnBase {
  id: string;
  ordre: number;
  systemKey: string;
  tier: string;
  label: string;
  capability: string;
  idempotencyKey: string;
  riskLevel: string;
  state: string;
  validation: string;
  expectedActor: Acteur;
  validationBy: Acteur | null;
  declaredBy: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
  validationNote: string | null;
  manual: unknown;
  template: unknown;
  reponse: string | null;
  lastError: string | null;
  executedAt: Date | null;
  grantExpiresAt: Date | null;
}

interface DroitEnBase {
  id: string;
  personId: string;
  reason: string;
  channelEmail: string | null;
  grantedBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  person: {
    username: string;
    fullname: string;
    source: string;
    usernameFabricated: boolean;
    communicationEmail: string | null;
  };
}

/**
 * Hissé en entier, constantes comprises : les doubles s'évaluent au moment où la page
 * importe ce qu'ils remplacent, donc avant toute déclaration du corps de ce fichier.
 */
const { base, dans, EMPREINTE, OPERATRICE, PORTEUR } = vi.hoisted(() => ({
  base: {
    etatDuDossier: "CONFIRMED" as "CONFIRMED" | "CANCELLED" | "DONE" | "WATCH",
    etatDuPlan: "DRAFT" as string,
    confirmePar: null as string | null,
    /** Ce que le calcul du jour rend, et qui dit obsolète le plan dès qu'il en diffère. */
    empreinteRecalculee: "empreinte-du-jour",
    /** Dans combien de jours le plan cesse de valoir, négatif pour un plan périmé. */
    validiteEnJours: 30,
    etapes: [] as unknown[],
    droits: [] as unknown[],
    startups: [] as { ghid: string; name: string }[],
    /** Les ghid que l'écran est allé chercher, seule preuve qu'il nomme qui demande. */
    ghidsDemandes: [] as string[],
  },
  dans: (jours: number) => new Date(Date.now() + jours * 24 * 60 * 60 * 1000),
  EMPREINTE: "empreinte-du-jour",
  OPERATRICE: "operatrice.exemple",
  PORTEUR: "camille.exemple",
}));

vi.mock("@/lib/session", async () =>
  (await import("@/test/doubles/session")).sessionDe({
    username: OPERATRICE,
    nom: "Anne Exemple",
    personId: "personne-operatrice",
  }),
);

/**
 * Aucun connecteur : la voie du jour ne se sonde donc pas, et le plan affiché reste
 * celui qui a été figé. C'est exactement ce que la recette lisait, la voie recalculée
 * ayant son propre harnais.
 */
vi.mock("@/connectors", () => ({ CONNECTEURS: [] }));

vi.mock("@/lib/policy", () => ({
  policy: () => ({
    profiles: [],
    scope: { local: [] },
    mail: { domainsLostOnDeparture: ["ademe.fr"] },
    thresholds: { maxPlanSteps: 25 },
  }),
}));

/**
 * Le recalcul est relevé et non joué : ce qu'il rend a son propre harnais, et le
 * sonder ici ferait sortir des appels. Son empreinte vaut celle du plan figé, si bien
 * qu'aucune alerte de dérive ne parasite ce que l'écran dit de sa liste.
 */
vi.mock("@/lib/dossier", () => ({
  calculerPlan: () =>
    Promise.resolve({
      sens: "OFFBOARDING",
      etapes: [],
      ecartees: [],
      empreinte: base.empreinteRecalculee,
      systemes: [],
      sansConnecteur: [],
      nonConfirmes: [],
      refus: [],
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    accessCase: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "dossier-du-depart"
            ? {
                id: "dossier-du-depart",
                kind: "OFFBOARDING",
                state: base.etatDuDossier,
                cancelledReason: null,
                effectiveDate: null,
                firstSignalAt: new Date("2026-03-02T08:30:00Z"),
                profileKey: null,
                person: {
                  id: "personne-camille",
                  username: PORTEUR,
                  fullname: "Camille Exemple",
                },
                // Rendus tous, révoqués compris : la clause de vie de la requête ne se
                // rejoue pas ici, c'est le filtre de l'écran que ce scénario exerce.
                participations: base.droits,
                plans: [
                  {
                    id: "plan-du-depart",
                    state: base.etatDuPlan,
                    planDigest: EMPREINTE,
                    expiresAt: dans(base.validiteEnJours),
                    createdAt: new Date("2026-03-02T09:00:00Z"),
                    createdBy: OPERATRICE,
                    confirmedBy: base.confirmePar,
                    confirmedAt: base.confirmePar ? new Date("2026-03-03T09:00:00Z") : null,
                    steps: base.etapes,
                  },
                ],
              }
            : null,
        ),
    },
    startup: {
      findMany: ({ where }: { where: { ghid: { in: string[] } } }) => {
        base.ghidsDemandes.push(...where.ghid.in);
        return Promise.resolve(base.startups);
      },
    },
  },
}));

const enFrancais = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

interface Noeud {
  type?: unknown;
  props?: Record<string, unknown>;
}

/**
 * Les composants que le parcours appelle lui-même.
 *
 * Un composant nommé dans du JSX n'est pas exécuté, il devient un nœud portant ses
 * accessoires : sans cet appel, ni les badges qu'un opérateur lit, ni la ligne qui dit
 * qui a déclaré, ni la liste des droits ne seraient dans aucun arbre. Le parcours
 * s'arrête là, et c'est voulu : tout ce qu'ils rendent encore est du composant client,
 * qui ne rend qu'au travers de hooks qu'aucun rendu ne porte ici.
 */
const A_DEROULER = new Set(["EtapeOperateur", "Etape", "Participations", "Canal"]);

/**
 * Les accessoires qui portent quelque chose de lisible. Les classes du système de
 * design n'en sont pas : recollées sans séparateur, elles se soudent à la phrase qui
 * les suit et feraient passer un texte absent pour un texte présent.
 */
function emplacements(accessoires: Record<string, unknown>): unknown[] {
  return Object.entries(accessoires).flatMap(([nom, valeur]) =>
    nom === "className" ? [] : [valeur],
  );
}

function deroule(noeud: Noeud): unknown {
  const type = noeud.type;
  return typeof type === "function" && A_DEROULER.has(type.name)
    ? (type as (accessoires: unknown) => unknown)(noeud.props)
    : null;
}

/**
 * Le texte que l'écran a placé dans son arbre. Recollé sans séparateur, comme un
 * navigateur le ferait : « {n} étape{s} restante{s} » est une phrase et non cinq mots.
 * Il lit tous les emplacements et pas les seuls enfants, une phrase servie en
 * accessoire n'étant l'enfant de rien.
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
  const accessoires = (noeud as Noeud).props;
  if (accessoires === undefined) {
    return [];
  }
  const suite = deroule(noeud as Noeud);
  return suite === null ? emplacements(accessoires).flatMap(textesRendus) : textesRendus(suite);
}

const texteRendu = (noeud: unknown): string =>
  textesRendus(noeud).join("").replace(/\s+/gu, " ").trim();

function noeudsRendus(noeud: unknown, retient: (candidat: Noeud) => boolean): Noeud[] {
  if (Array.isArray(noeud)) {
    return noeud.flatMap((enfant) => noeudsRendus(enfant, retient));
  }
  if (noeud === null || typeof noeud !== "object") {
    return [];
  }
  const candidat = noeud as Noeud;
  if (candidat.props === undefined) {
    return [];
  }
  const suite = deroule(candidat);
  return [
    ...(retient(candidat) ? [candidat] : []),
    ...(suite === null
      ? emplacements(candidat.props).flatMap((valeur) => noeudsRendus(valeur, retient))
      : noeudsRendus(suite, retient)),
  ];
}

const parType = (attendu: unknown) => (candidat: Noeud) => candidat.type === attendu;

const parNom = (attendu: string) => (candidat: Noeud) =>
  typeof candidat.type === "function" && candidat.type.name === attendu;

interface LigneRendue {
  id: string;
  badges: string[];
  texte: string;
  controle: Noeud | undefined;
  /** Le formulaire de pointage tel qu'il a été accroché, prêt à être monté. */
  pointage: Noeud | undefined;
}

/** Chaque étape du plan telle que l'écran la rend, dans son ordre de lecture. */
function lignesRendues(page: unknown): LigneRendue[] {
  return noeudsRendus(page, parNom("EtapeOperateur")).map((noeud) => {
    const rendu = deroule(noeud);
    return {
      id: (noeud.props as { etape: { id: string } }).etape.id,
      badges: noeudsRendus(rendu, parType(Badge)).map((badge) =>
        texteRendu(badge.props?.["children"]),
      ),
      texte: texteRendu(rendu),
      controle: noeudsRendus(rendu, parType(Validation))[0],
      pointage: noeudsRendus(rendu, parType(Pointage))[0],
    };
  });
}

/** La numérotation des listes, telle que `start` la décide groupe par groupe. */
const departsDeNumerotation = (page: unknown): unknown[] =>
  noeudsRendus(page, parType("ol")).map((liste) => liste.props?.["start"]);

const titresDeGroupe = (page: unknown): string[] =>
  noeudsRendus(page, parType("h3")).map((titre) => texteRendu(titre.props?.["children"]));

function etape(
  champs: Partial<EtapeFigeeEnBase> & { id: string; label: string },
): EtapeFigeeEnBase {
  return {
    ordre: 0,
    systemKey: SYSTEME_MODELE,
    tier: "manual",
    capability: "revoke",
    idempotencyKey: `cle-${champs.id}`,
    riskLevel: "LOW",
    state: "PENDING",
    validation: "NONE",
    expectedActor: "OPERATOR",
    validationBy: null,
    declaredBy: null,
    validatedBy: null,
    validatedAt: null,
    validationNote: null,
    manual: null,
    template: null,
    reponse: null,
    lastError: null,
    executedAt: null,
    grantExpiresAt: null,
    ...champs,
  };
}

function planDuDepart(): EtapeFigeeEnBase[] {
  return [
    etape({
      id: "etape-charte",
      label: "Rendre la charte signée",
      expectedActor: "SUBJECT",
      validationBy: "OPERATOR",
      template: {
        owner: CLE_INCUBATEUR,
        stepKey: "charte",
        saisie: { libelle: "Date de restitution de la charte", obligatoire: true },
      },
    }),
    etape({
      id: "etape-badge",
      label: "Restituer le badge",
      riskLevel: "HIGH",
      validationBy: "OPERATOR",
      template: {
        owner: CLE_INCUBATEUR,
        stepKey: "badge",
        saisie: { libelle: "Date de restitution", obligatoire: true },
      },
    }),
    etape({
      id: "etape-astreinte",
      label: "Sortir du tour d'astreinte",
      expectedActor: "DELEGATE",
      template: { owner: "oxygene", stepKey: "astreinte" },
    }),
    etape({
      id: "etape-github",
      label: "Retirer de l'organisation GitHub",
      systemKey: "github",
      idempotencyKey: "cle-github",
    }),
  ];
}

const rendre = (): Promise<unknown> =>
  DossierPage({
    params: Promise.resolve({ id: "dossier-du-depart" }),
    searchParams: Promise.resolve({}),
  });

beforeEach(() => {
  base.etatDuDossier = "CONFIRMED";
  base.etatDuPlan = "DRAFT";
  base.confirmePar = null;
  base.empreinteRecalculee = EMPREINTE;
  base.validiteEnJours = 30;
  base.etapes = planDuDepart();
  base.startups = [{ ghid: "oxygene", name: "Oxygène" }];
  base.ghidsDemandes.length = 0;
  base.droits = [
    {
      id: "droit-vivant",
      personId: "personne-lea",
      reason: "Doit constater la restitution du badge",
      channelEmail: "lea.exemple@beta.gouv.fr",
      grantedBy: OPERATRICE,
      expiresAt: dans(7),
      revokedAt: null,
      person: {
        username: "lea.exemple",
        fullname: "Léa Exemple",
        source: "MANUAL",
        usernameFabricated: false,
        communicationEmail: null,
      },
    },
    {
      id: "droit-retire",
      personId: "personne-noe",
      reason: "N'a plus à intervenir",
      channelEmail: "noe.exemple@beta.gouv.fr",
      grantedBy: OPERATRICE,
      expiresAt: dans(7),
      revokedAt: new Date("2026-03-04T09:00:00Z"),
      person: {
        username: "noe.exemple",
        fullname: "Noé Exemple",
        source: "MANUAL",
        usernameFabricated: false,
        communicationEmail: null,
      },
    },
    {
      id: "droit-perime",
      personId: "personne-sacha",
      reason: "Avait deux jours pour le faire",
      channelEmail: "sacha.exemple@beta.gouv.fr",
      grantedBy: OPERATRICE,
      expiresAt: dans(-1),
      revokedAt: null,
      person: {
        username: "sacha.exemple",
        fullname: "Sacha Exemple",
        source: "MANUAL",
        usernameFabricated: false,
        communicationEmail: null,
      },
    },
  ] satisfies DroitEnBase[];
});

afterEach(cleanup);

/** Le formulaire de pointage d'une ligne, monté pour de vrai. */
const monterLePointage = (ligne: LigneRendue | undefined) =>
  render(ligne?.pointage as ReactElement);

/** Ce qu'un formulaire monté enverra à son action. */
const envoiDe = (formulaire: HTMLElement | null): Record<string, FormDataEntryValue> =>
  Object.fromEntries(new FormData(formulaire as HTMLFormElement));

describe("l'écran d'un dossier, avec un vrai plan", () => {
  it("rend le brouillon d'un départ : sa liste numérotée, ses badges, ses groupes et ses droits vivants", async () => {
    // Given un départ dont le plan porte quatre étapes figées, venues de trois
    // demandeurs : deux de l'incubateur, une d'une startup, une d'un système couvert.
    // Personne n'a encore confirmé ce plan.
    // When l'écran du dossier se rend
    const page = await rendre();
    const texte = texteRendu(page);
    const lignes = lignesRendues(page);

    // Then il nomme le dossier par son sens et la personne qu'il concerne, et il
    // titre sa liste par ce que ce sens-là demande de faire
    expect(texte).toContain(`${LIBELLE_DOSSIER.OFFBOARDING.nom} de Camille Exemple`);
    expect(texte).toContain(LIBELLE_DOSSIER.OFFBOARDING.aFaire);
    expect(texte).not.toContain(LIBELLE_DOSSIER.OFFBOARDING.restant);
    expect(texte).not.toContain(LIBELLE_DOSSIER.ONBOARDING.cocher);
    expect(texte).toContain(LIBELLE_DOSSIER.OFFBOARDING.cocher);

    // Then les quatre étapes sont là, dans l'ordre figé, et aucune n'a disparu en route
    expect(lignes.map(({ id }) => id)).toEqual([
      "etape-charte",
      "etape-badge",
      "etape-astreinte",
      "etape-github",
    ]);
    expect(texte).toContain("Restituer le badge");

    // Then chaque ligne porte l'état et la voie que les tables décident, dans cet
    // ordre : l'état d'abord, l'acteur quand il n'est pas l'équipe, puis le tier figé.
    // Un opérateur ne porte pas de badge d'acteur, c'est le cas nominal.
    expect(lignes.map(({ badges }) => badges)).toEqual([
      ["à faire", "à la personne concernée", LIBELLE_TIER.manual.libelle],
      ["à faire", LIBELLE_TIER.manual.libelle, "risque élevé"],
      ["à faire", "à un délégué", LIBELLE_TIER.manual.libelle],
      ["à faire", LIBELLE_TIER.manual.libelle],
    ]);

    // Then aucune ne s'annonce automatique : sur un départ, rien ne l'est, et l'écran
    // ne doit pas servir l'entrée qui promettrait un geste que la boucle ne fera pas
    expect(texte).not.toContain(LIBELLE_TIER.auto.libelle);

    // Then la valeur qu'une étape déclarée réclame se lit sur sa ligne, et sur elle
    // seule : l'étape du système couvert n'en demande aucune
    expect(lignes[1]?.texte).toContain("Valeur demandée : Date de restitution");
    expect(lignes[3]?.texte).not.toContain("Valeur demandée");

    // Then les trois demandeurs font trois groupes, chacun nommé par qui demande, et
    // la startup y est nommée plutôt que réduite à son ghid
    expect(base.ghidsDemandes).toEqual(["oxygene"]);
    expect(titresDeGroupe(page)).toEqual([
      "Ce que l'incubateur demande",
      "Ce que la startup Oxygène demande",
      "Sur les systèmes couverts",
    ]);

    // Then la numérotation continue d'un groupe à l'autre plutôt que de repartir de
    // un : les deux étapes de l'incubateur sont 1 et 2, celle de la startup est 3
    expect(departsDeNumerotation(page)).toEqual([1, 3, 4]);

    // Then la phrase du brouillon paraît, avec le geste qu'elle annonce, et rien ne
    // se pointe encore : un plan que personne n'a confirmé n'offre aucune case
    expect(texte).toContain(
      "Confirmer, c'est dire que vous répondez de cette liste. Elle ne bougera plus ensuite, et chaque étape pourra être cochée.",
    );
    expect(noeudsRendus(page, parType(BoutonConfirmer))).toHaveLength(1);
    expect(texte).not.toContain("Le dossier se clôt quand il n'en reste aucune.");

    // Then la section des droits nomme celui qui est vivant, son motif, qui l'a
    // accordé et jusqu'à quand, et elle ne dit rien du droit retiré ni du droit périmé
    const droits = texteRendu(noeudsRendus(page, parNom("Participations"))[0]);
    expect(droits).toContain("Qui d'autre agit sur ce dossier");
    expect(droits).toContain("Léa Exemple");
    expect(droits).toContain("lea.exemple");
    expect(droits).toContain(
      `jusqu'au ${enFrancais.format((base.droits[0] as DroitEnBase).expiresAt)}`,
    );
    expect(droits).toContain(
      `« Doit constater la restitution du badge », accordé par ${OPERATRICE}.`,
    );
    expect(droits).not.toContain("Noé Exemple");
    expect(droits).not.toContain("Sacha Exemple");
    expect(droits).not.toContain("Personne pour l'instant");

    // Then le dossier étant décidé et pas encore clos, il s'ouvre encore à quelqu'un
    expect(droits).not.toContain("Ce dossier ne s'ouvre plus à personne");
  });

  it("montre ce qu'une étape déclarée attend : le second regard, et le refus de le donner soi-même", async () => {
    // Given ce même départ, désormais confirmé, dont deux étapes ont été déclarées et
    // attendent le regard d'un opérateur : la charte par la personne concernée, le
    // badge par l'opératrice qui lit l'écran.
    base.etatDuPlan = "EXECUTING";
    base.confirmePar = OPERATRICE;
    const declaree = new Date("2026-03-05T14:00:00Z");
    base.etapes = planDuDepart().map((ligne) =>
      ligne.id === "etape-charte"
        ? {
            ...ligne,
            state: "SUCCEEDED",
            validation: "AWAITING",
            declaredBy: PORTEUR,
            executedAt: declaree,
            reponse: "Rendue en main propre",
          }
        : ligne.id === "etape-badge"
          ? {
              ...ligne,
              state: "SUCCEEDED",
              validation: "AWAITING",
              declaredBy: OPERATRICE,
              executedAt: declaree,
              reponse: "5 mars 2026",
            }
          : ligne,
    );

    // When l'écran se rend
    const page = await rendre();
    const texte = texteRendu(page);
    const lignes = lignesRendues(page);
    const badge = lignes.find(({ id }) => id === "etape-badge");
    const charte = lignes.find(({ id }) => id === "etape-charte");

    // Then l'étape déclarée porte le badge de l'attente en plus de son état, et la
    // voie figée reste la sienne
    expect(badge?.badges).toEqual([
      "fait",
      "en attente de validation",
      LIBELLE_TIER.manual.libelle,
      "risque élevé",
    ]);

    // Then sa ligne dit quand elle a été déclarée et par qui, et elle dit « déclarée »
    // et non « pointée » : ce qui a été dit n'est pas encore ce qui a été constaté
    expect(badge?.texte).toContain(`Déclarée le ${enFrancais.format(declaree)} par ${OPERATRICE}.`);
    expect(badge?.texte).not.toContain("Pointée le");
    expect(badge?.texte).toContain("Valeur saisie : 5 mars 2026");
    expect(charte?.texte).toContain("Valeur saisie : Rendue en main propre");
    expect(badge?.texte).toContain(
      "Cette déclaration attend le regard d'un opérateur. Tant qu'il n'a pas eu lieu, l'étape n'est pas terminée et le dossier ne se clôt pas.",
    );

    // Then le formulaire d'avis est bien là, mais grisé, et il dit pourquoi : celle
    // qui lit est celle qui a déclaré, et la règle se lit sur l'écran plutôt que de
    // tomber au clic
    expect(badge?.controle?.props).toMatchObject({
      etapeId: "etape-badge",
      ecart: false,
      possible: false,
      raison: "Personne ne valide sa propre déclaration. Cette étape attend un autre regard.",
    });

    // Then l'étape que quelqu'un d'autre a déclarée s'offre au contraire à son regard,
    // sans raison à afficher
    expect(charte?.controle?.props).toMatchObject({
      etapeId: "etape-charte",
      possible: true,
      raison: null,
    });

    // Then le formulaire de pointage de cette étape, monté, réclame bien la valeur que
    // le modèle demande et repart de celle qui a déjà été déclarée : c'est ce
    // `FormData` que l'action recevra, et un accessoire relayé à moitié ne se voit
    // nulle part ailleurs
    const pointage = monterLePointage(badge);
    expect(pointage.getByLabelText("Date de restitution")).toBeDefined();
    expect(envoiDe(pointage.container.querySelector("form"))).toEqual({
      etapeId: "etape-badge",
      pointage: "fait",
      reponse: "5 mars 2026",
    });

    // Then les deux étapes qui n'attendent rien n'offrent aucun avis : un second
    // regard se demande sur une déclaration, pas sur une étape à faire
    expect(lignes.filter(({ controle }) => controle !== undefined).map(({ id }) => id)).toEqual([
      "etape-charte",
      "etape-badge",
    ]);

    // Then le compte des restantes tient l'attente pour non soldée, et le dit à part :
    // rien n'y reste à faire, c'est le contrôle qui manque
    expect(texte).toContain(
      "4 étapes restantes. Le dossier se clôt quand il n'en reste aucune. 2 d'entre elles attendent un second regard : une déclaration que personne n'a contrôlée ne termine pas son étape.",
    );

    // Then aucun bouton de clôture n'est offert : un dossier dont une déclaration
    // attend un regard ne se clôt pas, et proposer le geste pour le refuser au clic
    // est exactement ce que cet écran évite. Le composant reste monté avec son verdict
    // à faux, faute de quoi une clôture réussie démonterait son dialogue encore ouvert
    expect(noeudsRendus(page, parType(BoutonClore)).map(({ props }) => props)).toEqual([
      { dossierId: "dossier-du-depart", cloturable: false },
    ]);
    expect(texte).not.toContain("Clore le dossier");

    // Then la phrase du brouillon a disparu avec lui, et le titre de la liste dit
    // désormais ce qu'il reste plutôt que ce qu'il faudra
    expect(texte).not.toContain("Confirmer, c'est dire que vous répondez de cette liste.");
    expect(noeudsRendus(page, parType(BoutonConfirmer))).toEqual([]);
    expect(texte).toContain(LIBELLE_DOSSIER.OFFBOARDING.restant);
  });
});

describe("ce que l'écran dit d'un plan confirmé que le calcul du jour dément", () => {
  it("annonce que son lancement refusera, nomme la sortie, et ne la redit pas quand la date la porte déjà", async () => {
    // Given un plan confirmé, dont le recalcul du jour rend une autre empreinte : une
    // tolérance permanente livrée depuis, une collecte passée, peu importe la cause
    base.etatDuPlan = "EXECUTING";
    base.confirmePar = OPERATRICE;
    base.empreinteRecalculee = "une-autre-empreinte";

    // When l'écran du dossier se rend
    const texte = texteRendu(await rendre());

    // Then il dit que le plan ne partira pas, et non que ce qui a changé se traite
    // ailleurs : le lancement refuse sur cette empreinte, et l'annoncer autrement ferait
    // découvrir le refus au clic
    expect(texte).toContain("Ce plan ne décrit plus la situation");
    expect(texte).toContain("Il ne partira pas et ne se recalcule plus.");

    // Then il nomme la sortie, la même que le refus du serveur : un plan confirmé n'a
    // pas de recalcul, donc un écran qui s'arrêterait au constat laisserait le dossier
    // sans geste
    expect(texte).toContain(ISSUE_DOSSIER);
    expect(texte.split(ISSUE_DOSSIER).length - 1).toBe(1);

    // When ce même plan a aussi dépassé sa date de validité
    base.validiteEnJours = -1;
    const deuxCauses = texteRendu(await rendre());

    // Then les deux encarts se disent, et la sortie ne s'écrit qu'une fois : elle est
    // la même pour les deux causes, et deux encarts voisins qui la répètent se lisent
    // comme deux gestes différents
    expect(deuxCauses).toContain("Ce plan ne décrit plus la situation");
    expect(deuxCauses).toContain("Ce plan a dépassé sa date de validité");
    expect(deuxCauses.split(ISSUE_DOSSIER).length - 1).toBe(1);
    expect(deuxCauses).toContain("L'issue est dite plus bas, avec la date qui la motive.");
  });
});
