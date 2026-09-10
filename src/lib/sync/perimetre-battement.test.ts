import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AMPLEUR_NON_COMPTEE,
  ageDuReleveDeLaTrace,
  type BlocageInstalle,
  blocagesInstalles,
  fichesSansReponse,
  REFUS_D_ECHEANCE,
  REFUS_DE_DISPARITION,
  REFUS_DE_LECTURE,
  REFUS_DE_RETOUR,
  RELEVE_NON_RENOUVELE,
  refusDeLaTrace,
  refusRepete,
  releveFige,
} from "@/core/collecte";
import type { MembreDetaille, MembreIncubateur } from "@/core/membre";

import { PASSAGES_RELUS } from "@/lib/sync/gardefou";

import { syncPerimetre } from "./perimetre";

interface RunEnBase {
  id: string;
  provider: string;
  capability: string;
  status: string;
  startedAt: Date;
  itemsSeen: number;
  error: unknown;
}

interface FicheEnBase {
  id: string;
  username: string;
  source: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  vanishedAt: Date | null;
  returnedAt: Date | null;
  missionEnd: Date | null;
  /**
   * Ce à quoi une fiche écrite à la main est adossée, et qui la tient en vie faute
   * d'une source amont qui la réclame : un compte qu'une collecte cible voit encore, ou
   * un rattachement qu'on lui a posé jusqu'à telle date. Les deux vivent hors de ce
   * magasin de fiches, et les deux s'éteignent sans qu'aucun passage du périmètre ne
   * tourne : c'est par là que ce qu'une datation toucherait bouge sans que le relevé ni
   * la liste rendue n'aient bougé d'un.
   */
  compteVivant?: boolean;
  rattachementJusqua?: Date | null;
}

interface DroitEnBase {
  accessCaseId: string;
  personId: string;
  /** L'adresse déclarée à l'octroi, que la bascule de la fiche ne touche pas. */
  channelEmail: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  etat: string;
}

/** Une autorisation posée à la main, telle que l'écran des collectes l'écrit. */
interface AutorisationEnBase {
  provider: string;
  famille: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
  /** Les nombres du refus tels que le bandeau les montrait à qui a tranché. */
  observe: number | null;
  reference: number | null;
  datables: number | null;
  consumedAt: Date | null;
  consumedRunId: string | null;
}

const base = vi.hoisted(() => ({
  runs: [] as RunEnBase[],
  fiches: [] as FicheEnBase[],
  droits: [] as DroitEnBase[],
  autorisations: [] as AutorisationEnBase[],
  journal: [] as { action: string; targetId: string | null }[],
  membres: [] as unknown[],
  erreursDeLecture: [] as string[],
  details: new Map<string, unknown>(),
  pannes: new Set<string>(),
  /** La base qui tombe au moment précis où le passage écrit ses disparitions. */
  panneDeDatation: false,
  /** La base qui tombe sur le seul comptage de ce que la datation toucherait. */
  panneDeComptage: false,
  sequence: 0,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    syncRun: {
      create: ({ data }: { data: Omit<RunEnBase, "id" | "itemsSeen" | "error"> }) => {
        base.sequence += 1;
        const run: RunEnBase = { ...data, id: `run-${base.sequence}`, itemsSeen: 0, error: null };
        base.runs.push(run);
        return Promise.resolve(run);
      },
      findFirst: ({
        where,
        orderBy,
      }: {
        where: { provider: string; capability: string; status: string };
        orderBy: OrdreDesPassages;
      }) => {
        const candidats = base.runs
          .filter(
            (run) =>
              run.provider === where.provider &&
              run.capability === where.capability &&
              run.status === where.status,
          )
          .sort(parDate(orderBy));
        return Promise.resolve(candidats[0] ?? null);
      },
      // Deux relectures des passages, le courant excepté, et deux formes de `where`
      // qu'il ne faut pas confondre. L'âge du relevé borne par le relevé lui-même et ne
      // lit que le statut : sa borne n'est jamais une fenêtre de passages, un `take` y
      // plafonnerait le compte sans que rien ne le dise. Le refus répété relit une
      // fenêtre fixe et n'en lit que la trace : ignorer son `take` ferait passer pour
      // installé un refus qui ne l'est pas. Rendre à l'une ce que l'autre demande
      // laisserait chacune des deux vraie pour la mauvaise raison.
      //
      // C'est le `select` qui les sépare, et non la présence d'une borne : faute de
      // relevé, l'âge relit tout ce que ce fournisseur a laissé et part donc sans borne,
      // exactement comme le refus répété.
      findMany: ({
        where,
        orderBy,
        take,
        select,
      }: {
        where: {
          provider: string;
          capability: string;
          id: { not: string };
          startedAt?: { gte: Date };
        };
        orderBy: OrdreDesPassages;
        take?: number;
        select: { status?: true; error?: true };
      }) => {
        const borne = where.startedAt;
        const passages = base.runs
          .filter(
            (run) =>
              run.provider === where.provider &&
              run.capability === where.capability &&
              run.id !== where.id.not &&
              (borne === undefined || run.startedAt.getTime() >= borne.gte.getTime()),
          )
          .sort(parDate(orderBy))
          .map((run) => (select.error ? { error: run.error } : { status: run.status }));
        return Promise.resolve(take === undefined ? passages : passages.slice(0, take));
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const run = base.runs.find((candidat) => candidat.id === where.id);
        if (run) {
          Object.assign(run, {
            status: data["status"] ?? run.status,
            itemsSeen: data["itemsSeen"] ?? run.itemsSeen,
            error: data["error"] ?? run.error,
          });
        }
        return Promise.resolve(run);
      },
    },
    person: {
      // Une copie, comme Prisma : rendre la ligne du magasin par référence la ferait
      // muter sous le nez de l'appelant à l'écriture suivante, et un code qui relit
      // l'état d'avant après avoir écrit passerait pour correct.
      findUnique: ({ where }: { where: { username: string } }) => {
        const trouvee = base.fiches.find((fiche) => fiche.username === where.username);
        if (!trouvee) {
          return Promise.resolve(null);
        }
        // Les droits viennent avec la ligne, comme la jointure du `select` les sert :
        // un double qui les servirait par une seconde requête laisserait passer le
        // défaut que cette lecture groupée existe pour fermer.
        return Promise.resolve({
          ...trouvee,
          participations: base.droits
            .filter((droit) => droit.personId === trouvee.id)
            .map((droit) => ({
              accessCaseId: droit.accessCaseId,
              channelEmail: droit.channelEmail,
              expiresAt: droit.expiresAt,
              revokedAt: droit.revokedAt,
              accessCase: { state: droit.etat },
            })),
        });
      },
      // Prisma laisse intact un champ à `undefined` au lieu de l'écrire, et c'est
      // exactement la sémantique dont `champsCollectes` se sert pour ne pas toucher au
      // retour précédent d'une fiche revue sans retour établi. Un fac-similé qui
      // recopierait tout mentirait dans le sens rassurant.
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const fiche = base.fiches.find((candidate) => candidate.id === where.id);
        if (fiche) {
          for (const [cle, valeur] of Object.entries(data)) {
            if (valeur !== undefined) {
              Object.assign(fiche, { [cle]: valeur });
            }
          }
        }
        return Promise.resolve(fiche);
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        base.sequence += 1;
        const fiche = { id: `fiche-${base.sequence}`, returnedAt: null } as unknown as FicheEnBase;
        for (const [cle, valeur] of Object.entries(data)) {
          if (valeur !== undefined) {
            Object.assign(fiche, { [cle]: valeur });
          }
        }
        base.fiches.push(fiche);
        return Promise.resolve(fiche);
      },
      // Deux appelants, deux formes de `where` : la requête des fiches locales adossées
      // porte `source` et un `OR` sur des relations, celle des dernières vues porte une
      // liste de noms. Les confondre pour rendre toujours une liste vide ne retiendrait
      // jamais personne, et les tests du sursis passeraient pour la mauvaise raison.
      findMany: ({ where }: { where: FiltreDeFiches }) => {
        if (where.OR) {
          return Promise.resolve(
            base.fiches
              .filter((fiche) => adossee(fiche, where))
              .map((fiche) => ({ username: fiche.username })),
          );
        }
        return Promise.resolve(base.fiches.filter((fiche) => retenuePar(fiche, where)));
      },
      // Le comptage et l'écriture reçoivent la même condition, et ce magasin la relit
      // d'une seule façon : deux lectures qui se ressembleraient laisseraient le nombre
      // montré et le geste diverger sans qu'aucun scénario ne puisse le voir.
      count: ({ where }: { where: FiltreDeFiches }) => {
        if (base.panneDeComptage) {
          return Promise.reject(new Error("base indisponible"));
        }
        return Promise.resolve(base.fiches.filter((fiche) => retenuePar(fiche, where)).length);
      },
      updateMany: ({ where, data }: { where: FiltreDeFiches; data: { vanishedAt: Date } }) => {
        if (base.panneDeDatation) {
          return Promise.reject(new Error("base indisponible"));
        }
        const touchees = base.fiches.filter((fiche) => retenuePar(fiche, where));
        for (const fiche of touchees) {
          fiche.vanishedAt = data.vanishedAt;
        }
        return Promise.resolve({ count: touchees.length });
      },
    },
    // Une autorisation n'est éligible que si elle attend encore et si elle a été posée
    // avant que ce passage ne commence : la seconde condition est ce qui empêche un
    // clic pendant une collecte d'autoriser celle qui tourne déjà, et un double qui
    // l'oublierait rendrait le test vert sur une garantie que le code ne donne pas.
    scopeDropOverride: {
      findFirst: ({ where }: { where: AttenteDAutorisation }) =>
        Promise.resolve(base.autorisations.filter((posee) => attendue(posee, where))[0] ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: AttenteDAutorisation;
        data: { consumedAt: Date; consumedRunId: string };
      }) => {
        const prises = base.autorisations.filter((posee) => attendue(posee, where));
        for (const autorisation of prises) {
          autorisation.consumedAt = data.consumedAt;
          autorisation.consumedRunId = data.consumedRunId;
        }
        return Promise.resolve({ count: prises.length });
      },
    },
  },
}));

interface AttenteDAutorisation {
  provider: string;
  famille: string;
  consumedAt?: null;
  createdAt?: { lt: Date };
}

function attendue(posee: AutorisationEnBase, where: AttenteDAutorisation): boolean {
  return (
    posee.provider === where.provider &&
    posee.famille === where.famille &&
    (where.consumedAt === undefined || posee.consumedAt === where.consumedAt) &&
    (where.createdAt === undefined || posee.createdAt.getTime() < where.createdAt.lt.getTime())
  );
}

/** Le sens que la requête demande, et non celui qu'on suppose qu'elle demande. */
interface OrdreDesPassages {
  startedAt: "asc" | "desc";
}

function parDate(
  ordre: OrdreDesPassages,
): (a: { startedAt: Date }, b: { startedAt: Date }) => number {
  return (a, b) =>
    ordre.startedAt === "asc"
      ? a.startedAt.getTime() - b.startedAt.getTime()
      : b.startedAt.getTime() - a.startedAt.getTime();
}

/**
 * Ce qu'une requête sur les fiches énonce, et rien de plus.
 *
 * Les clés sont facultatives parce que c'est exactement ce qui se prouve ici : un
 * double qui rejouerait de son côté la condition qu'il reçoit rendrait sa disparition
 * du code de production invisible, et la garde qu'il sert cesserait d'être gardée.
 */
interface FiltreDeFiches {
  username?: { in?: string[]; notIn?: string[] };
  vanishedAt?: null;
  source?: string | { not: string };
  OR?: readonly AdossementVivant[];
}

/** Les deux façons dont une fiche locale tient encore, telles que la requête les dit. */
interface AdossementVivant {
  identities?: { some: { vanishedAt: null } };
  startupAssignments?: { some: { endedAt: null; until: { gte: Date } } };
}

/**
 * La borne du rattachement est relue dans la condition reçue et non recalculée ici :
 * c'est le passage qui décide du jour contre lequel un rattachement court encore, et un
 * double qui déciderait du sien laisserait passer le jour où les deux divergent.
 */
function adossee(fiche: FicheEnBase, where: FiltreDeFiches): boolean {
  if (typeof where.source === "string" && fiche.source !== where.source) {
    return false;
  }
  return (where.OR ?? []).some((clause) => {
    if (clause.identities) {
      return fiche.compteVivant === true;
    }
    const borne = clause.startupAssignments?.some.until.gte;
    const jusqua = fiche.rattachementJusqua;
    return borne !== undefined && !!jusqua && jusqua.getTime() >= borne.getTime();
  });
}

function retenuePar(fiche: FicheEnBase, where: FiltreDeFiches): boolean {
  if (where.username?.in && !where.username.in.includes(fiche.username)) {
    return false;
  }
  if (where.username?.notIn?.includes(fiche.username)) {
    return false;
  }
  if (where.vanishedAt === null && fiche.vanishedAt !== null) {
    return false;
  }
  if (typeof where.source === "string" && fiche.source !== where.source) {
    return false;
  }
  if (typeof where.source === "object" && fiche.source === where.source.not) {
    return false;
  }
  return true;
}

vi.mock("@/lib/espace-membre", () => ({
  fetchIncubatorStartups: () =>
    Promise.resolve({
      items: [
        {
          ghid: "produit-alpha",
          name: "Produit Alpha",
          currentPhase: "acceleration",
          phaseStart: null,
        },
      ],
      erreurs: [],
    }),
  fetchIncubatorMembers: () =>
    Promise.resolve({ items: base.membres, erreurs: base.erreursDeLecture }),
  // Deux façons de ne pas rendre une fiche, et elles ne mènent pas au même endroit : un
  // 404 rend `null` et nomme celle que la source ne connaît pas, une panne jette et ne
  // dit rien de la personne.
  fetchMemberDetail: (username: string) => {
    if (base.pannes.has(username)) {
      return Promise.reject(new Error("500 Internal Server Error"));
    }
    return Promise.resolve(base.details.get(username) ?? null);
  },
  mapLimit: async <T, R>(
    valeurs: readonly T[],
    _limite: number,
    travail: (valeur: T) => Promise<R>,
  ) => {
    const sorties: R[] = [];
    for (const valeur of valeurs) {
      sorties.push(await travail(valeur));
    }
    return sorties;
  },
}));

vi.mock("@/lib/policy", () => ({
  policy: () => ({
    scope: { incubator: "mon-incubateur", transverse: ["dominique.exemple"], local: [] },
    thresholds: { maxScopeDrop: 0.2 },
  }),
}));

// Un enregistreur et non un puits : ce que ce passage signale d'une fiche adoptée est
// un fait de production, et il n'a aucune autre sortie que le journal.
vi.mock("@/lib/audit", () => ({
  audit: (input: { action: string; targetId?: string | null }) => {
    base.journal.push({ action: input.action, targetId: input.targetId ?? null });
  },
}));

const RATTACHES = [
  "blandine",
  "elias",
  "gwendal",
  "hakim",
  "ines",
  "maelys",
  "noe",
  "sacha",
  "solene",
  "tiphaine",
  "yanis",
  "zoe",
];

/** Déclarée transverse : sa seule voie vers le périmètre est sa fiche complète. */
const TRANSVERSE = "dominique.exemple";

/** Rattachée par une équipe : dans la liste scopée, mais son échéance vit à part. */
const PAR_EQUIPE = "camille.exemple";

/** Rattachée par une startup : elle n'entre que par la liste scopée, et sans un mot. */
const OMISE = "elias.exemple";

const membre = (prenom: string): MembreIncubateur => ({
  username: `${prenom}.exemple`,
  uuid: `uuid-${prenom}`,
  fullname: `${prenom} Exemple`,
  primary_email: `${prenom}.exemple@beta.gouv.fr`,
  attachment: "startups",
  missions: [{ end: "2027-06-30", startups: [{ ghid: "produit-alpha" }] }],
});

const MEMBRE_PAR_EQUIPE: MembreIncubateur = {
  username: PAR_EQUIPE,
  uuid: "uuid-camille",
  fullname: "Camille Exemple",
  primary_email: `${PAR_EQUIPE}@beta.gouv.fr`,
  attachment: "teams",
  missions: [],
};

const FICHE_TRANSVERSE: MembreDetaille = {
  username: TRANSVERSE,
  uuid: "uuid-dominique",
  fullname: "Dominique Exemple",
  primary_email: `${TRANSVERSE}@beta.gouv.fr`,
  missions: [{ end: "2027-12-31" }],
};

const FICHE_PAR_EQUIPE: MembreDetaille = {
  username: PAR_EQUIPE,
  uuid: "uuid-camille",
  fullname: "Camille Exemple",
  primary_email: `${PAR_EQUIPE}@beta.gouv.fr`,
  missions: [{ end: "2027-12-31" }],
};

/**
 * Des nuits consécutives du traitement quotidien, à son heure de cron. Il en faut plus
 * que la fenêtre des refus répétés : l'âge d'un relevé se borne par le relevé et non
 * par un nombre de passages, et une histoire qui s'arrêterait avant ce plafond-là
 * laisserait passer celui qu'on a justement refusé de poser.
 */
const NUITS = Array.from(
  { length: 16 },
  (_, index) => new Date(Date.UTC(2026, 8, 1 + index, 4, 30, 0)),
);

function quand(index: number): Date {
  const passage = NUITS[index];
  if (!passage) {
    throw new Error("nuit inconnue");
  }
  return passage;
}

/** Un compte de service : nommé en base, réclamé par aucune source, hors périmètre. */
const SERVICE = "sauvegardes.ovh";

function poserCompteDeService(): void {
  base.sequence += 1;
  base.fiches.push({
    id: `fiche-${base.sequence}`,
    username: SERVICE,
    source: "SERVICE",
    firstSeenAt: quand(0),
    lastSeenAt: quand(0),
    vanishedAt: null,
    returnedAt: null,
    missionEnd: null,
  });
}

/**
 * Une fiche écrite à la main pour nommer un compte. Aucune source amont ne la réclame :
 * elle ne vit que par ce à quoi elle est adossée, et le jour où plus rien ne la tient,
 * la collecte suivante la constate partie.
 */
function poserFicheLocale(username: string): FicheEnBase {
  base.sequence += 1;
  const fiche: FicheEnBase = {
    id: `fiche-${base.sequence}`,
    username,
    source: "LOCAL",
    firstSeenAt: quand(0),
    lastSeenAt: quand(0),
    vanishedAt: null,
    returnedAt: null,
    missionEnd: null,
    compteVivant: true,
  };
  base.fiches.push(fiche);
  return fiche;
}

/**
 * Un passage de collecte, et les quatre façons d'y perdre quelqu'un.
 *
 * `fiche` et `parEquipe` disent ce que la source répond sur une fiche complète : un 404
 * nomme celle qui manque, c'est le chemin de l'aveu d'ignorance ; une fiche muette
 * jette, et ne dit rien du tout, ce qui n'est pas la même information et n'appelle pas
 * la même conclusion. `omis` fait manquer une personne à une réponse par ailleurs
 * valide, sans 404, sans erreur et sans trace : c'est le chemin silencieux, et c'est
 * celui qui concerne l'incubateur entier. `lecture` dégrade le passage, et c'est le
 * seul de ces chemins qui le dégrade.
 */
async function nuit(
  index: number,
  options: {
    fiche?: "présente" | "absente" | "muette";
    parEquipe?: "présente" | "absente" | "muette";
    omis?: readonly string[];
    renforts?: readonly string[];
    lecture?: "intacte" | "amputée";
  } = {},
) {
  const omis = options.omis ?? [];
  const presents = RATTACHES.filter((prenom) => !omis.includes(`${prenom}.exemple`));
  base.membres = [...presents, ...(options.renforts ?? [])].map(membre);
  if (options.parEquipe) {
    base.membres.push(MEMBRE_PAR_EQUIPE);
  }
  base.pannes = new Set(
    [
      options.fiche === "muette" ? TRANSVERSE : null,
      options.parEquipe === "muette" ? PAR_EQUIPE : null,
    ].filter((nom): nom is string => nom !== null),
  );
  base.details = new Map<string, unknown>();
  if (options.fiche === undefined || options.fiche === "présente") {
    base.details.set(TRANSVERSE, FICHE_TRANSVERSE);
  }
  if (options.parEquipe === "présente") {
    base.details.set(PAR_EQUIPE, FICHE_PAR_EQUIPE);
  }
  base.erreursDeLecture =
    options.lecture === "amputée"
      ? ["membres de l'incubateur : élément 4 illisible (username requis)"]
      : [];

  return syncPerimetre(quand(index), `correlation-${index}`);
}

function fiche(username: string): FicheEnBase {
  const trouvee = base.fiches.find((candidate) => candidate.username === username);
  if (!trouvee) {
    throw new Error(`la fiche de ${username} devrait exister`);
  }
  return trouvee;
}

/**
 * Ce que la fiche d'une personne relit de la trace pour parler d'elle nommément, par la
 * fonction même que l'écran appelle : le passage qui écrit et l'écran qui relit sont
 * ainsi tenus de s'accorder ici, et non chacun de son côté.
 */
function nommeesSansReponse(runId: string): readonly string[] {
  return fichesSansReponse(base.runs.find((run) => run.id === runId)?.error);
}

/** Le relevé contre lequel la nuit suivante décidera, et dont le gel gèle tout. */
function releveDeReference(): { itemsSeen: number; startedAt: Date } | null {
  const complets = base.runs
    .filter((run) => run.status === "OK")
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return complets[0] ?? null;
}

/**
 * Depuis combien de passages ce run dit que le relevé n'a pas été renouvelé, relu par
 * la fonction même que la fiche d'une personne appelle : la trace n'a pas deux
 * lecteurs qui s'accordent chacun de son côté.
 */
function ageDuReleveDit(runId: string): number | null {
  return ageDuReleveDeLaTrace(base.runs.find((run) => run.id === runId)?.error);
}

/**
 * Ce que l'ancienne mesure de l'installation aurait compté : les refus du plancher
 * retombés à l'identique d'affilée, le plus récent en tête. Relu ici pour que les
 * scénarios puissent montrer les deux comptes côte à côte, là où ils divergent.
 */
function refusIdentiques(runIds: readonly string[]): number {
  const lus = runIds.map((id) =>
    refusDeLaTrace(base.runs.find((run) => run.id === id)?.error, "perimetre"),
  );
  const dernier = lus[0];
  return dernier ? refusRepete(dernier, lus.slice(1)) : 0;
}

/** Les nombres que le bandeau montrait à qui a tranché, et que sa décision emporte. */
interface NombresMontres {
  observe: number;
  reference: number;
  /**
   * Combien de fiches la datation toucherait, tel que le bandeau l'annonçait. C'est ce
   * nombre qui dit ce qui arrivera à des personnes : les deux autres comparent des
   * tailles de listes, et leur écart est plus étroit que le geste.
   */
  datables: number;
}

/**
 * Ce qu'une opératrice pose depuis l'écran des collectes, avant la nuit qu'elle
 * autorise : posée pendant la collecte, elle vaudrait pour la suivante, l'écran
 * promettant d'autoriser la prochaine et non celle qui tourne.
 *
 * Les nombres se disent à chaque appel, et c'est ce que ces scénarios ont à dire : ce
 * contre quoi la borne mesure est ce que l'écran montrait, et un harnais qui le
 * redéduirait de la trace du dernier passage rejouerait la mesure qu'on vient d'ôter du
 * code.
 */
function autoriser(index: number, raison: string, montre: NombresMontres): void {
  poser(new Date(quand(index).getTime() - 3_600_000), raison, montre);
}

/** La même décision, cliquée alors que la collecte de cette nuit-là tourne déjà. */
function autoriserPendant(index: number, raison: string, montre: NombresMontres): void {
  poser(new Date(quand(index).getTime() + 3_600_000), raison, montre);
}

/** Une ligne d'avant la migration : elle attend, et rien ne dit sur quoi. */
function autoriserSansNombres(index: number, raison: string): void {
  poser(new Date(quand(index).getTime() - 3_600_000), raison, null);
}

function poser(createdAt: Date, raison: string, montre: NombresMontres | null): void {
  base.autorisations.push({
    provider: "espace-membre",
    famille: "perimetre",
    reason: raison,
    createdBy: "capucine.exemple",
    createdAt,
    observe: montre?.observe ?? null,
    reference: montre?.reference ?? null,
    datables: montre?.datables ?? null,
    consumedAt: null,
    consumedRunId: null,
  });
}

/**
 * Ce que l'écran des collectes annonce en tête, par la fonction même qu'il appelle et
 * sur les runs dans l'ordre où il les lui donne. Un blocage installé qui ne se dit que
 * dans une ligne de journal parmi soixante cesse d'être lu, et c'est la moitié du
 * problème que la sortie nominative résout.
 */
function blocagesAnnonces(): BlocageInstalle[] {
  return blocagesInstalles(
    [...base.runs]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .map((run) => ({ provider: run.provider, error: run.error })),
  );
}

/** Ce que la colonne « Ce qui a été dit » de l'écran des collectes affiche du run. */
function ceQuiAEteDit(runId: string): string[] {
  const trace = base.runs.find((run) => run.id === runId)?.error;
  if (!trace || typeof trace !== "object" || !("messages" in trace)) {
    return [];
  }
  const brut = (trace as { messages: unknown }).messages;
  return Array.isArray(brut) ? brut.map(String) : [];
}

/**
 * `returnedAt` est la seule colonne qui dise qu'un séjour a recommencé, et deux règles
 * s'y adossent : le constat d'arrivée sans onboarding, et la borne qui empêche une
 * action déclarée d'être démentie indéfiniment. Ce qu'un battement de collecte y écrit
 * n'est donc pas du bruit de plus, c'est une arrivée à traiter au nom de quelqu'un qui
 * n'a pas bougé, et un démenti éteint pour de bon.
 */
describe("ce qu'une absence doit avoir duré pour valoir un départ", () => {
  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.sequence = 0;
  });

  it("perd trois personnes par trois chemins, n'en fait disparaître qu'une, et ne fait revenir personne", async () => {
    // Given un périmètre entier, vu et daté par un premier passage complet, dont une
    // rattachée par une équipe et un déclaré transverse.
    const premier = await nuit(0, { parEquipe: "présente" });
    expect(premier.status).toBe("OK");
    expect(premier.seen).toBe(14);
    expect(premier.retenues).toEqual([]);

    // When la nuit suivante perd trois personnes par trois chemins : la fiche du
    // déclaré transverse répond 404, celle de la rattachée par équipe aussi, et une
    // troisième manque simplement à une réponse par ailleurs valide. Rien ne se
    // dégrade pour autant, et c'est là le piège : un 404 n'alimente pas `errors`, une
    // omission ne laisse aucune trace, le passage reste complet et aucun seuil de
    // chute n'est franchi.
    const muet = await nuit(1, {
      fiche: "absente",
      parEquipe: "absente",
      omis: [OMISE],
    });

    expect(muet.status).toBe("OK");
    expect(muet.errors).toEqual([]);
    expect(muet.introuvables).toEqual([PAR_EQUIPE, TRANSVERSE]);

    // Then le transverse est retenu : le passage l'a nommément demandé, la source a
    // répondu qu'elle ne le connaissait pas, et un aveu d'ignorance d'un seul passage
    // ne vaut pas départ. Sa disparition n'est pas datée, et la trace du run le dit,
    // dans la colonne que l'écran des collectes lit déjà, sans que le statut bascule.
    expect(muet.retenues).toEqual([TRANSVERSE]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(ceQuiAEteDit(muet.runId)).toEqual([
      `${REFUS_DE_DISPARITION} : ${TRANSVERSE} ; aucune disparition datée`,
      `${REFUS_D_ECHEANCE} : ${PAR_EQUIPE} ; fiche complète non lue`,
    ]);

    // Then la rattachée par équipe n'est ni perdue ni retenue : la liste scopée la rend
    // encore, seule sa fiche complète manque, donc elle reste du périmètre et il n'y a
    // aucune disparition à retenir pour elle. La retenir ferait mentir la trace. Ce que
    // le passage dit d'elle plus haut est l'autre refus, celui de son échéance.
    expect(fiche(PAR_EQUIPE).lastSeenAt).toEqual(NUITS[1]);
    expect(fiche(PAR_EQUIPE).vanishedAt).toBeNull();

    // Then son échéance est conservée telle que le passage précédent l'avait lue. Le
    // sursis n'y est pour rien, il épargne des existences et non des champs : c'est une
    // règle distincte qui retient cette écriture, et le passage la nomme dans sa trace
    // à côté de ce qu'il a refusé de faire disparaître. Ce trou-là était asséré ouvert
    // ici, il est refermé.
    expect(fiche(PAR_EQUIPE).missionEnd).toEqual(new Date("2027-12-31T00:00:00Z"));
    expect(muet.echeancesNonEcrites).toEqual([PAR_EQUIPE]);

    // Then l'omise, elle, disparaît le soir même : rien ne la nomme, son absence ne se
    // distingue pas d'un départ, et retarder chaque disparition retarderait chaque
    // révocation, donc chaque coupure. C'est le chemin large, celui qui concerne
    // l'incubateur entier, et le seul filet qui l'attende est la règle de durée.
    expect(muet.vanished).toBe(1);
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);

    // When tout redevient lisible au passage suivant.
    const retrouve = await nuit(2, { parEquipe: "présente" });

    // Then le passage dit ce qu'il a refusé, et pour qui : il vient d'effacer la
    // disparition de l'omise sans dater son retour, et sans cette phrase la nuit
    // ressemblerait à une nuit où rien ne s'est passé. La date que porte la phrase est
    // ce qui sépare ce battement d'une nuit, voulu, d'une absence longue perdue.
    expect(retrouve.retenues).toEqual([]);
    expect(retrouve.retoursNonDates).toEqual([{ username: OMISE, disparueLe: NUITS[1] }]);
    expect(ceQuiAEteDit(retrouve.runId)).toEqual([
      `${REFUS_DE_RETOUR} : ${OMISE} (disparue le 2026-09-02) ; absence non confirmée`,
    ]);

    // Then personne n'est réputé revenu : le transverse n'est jamais parti, et
    // l'absence de l'omise n'a été constatée que par le passage qui l'a datée. Leur
    // première vue n'a pas bougé, c'est le même séjour pour les deux.
    for (const username of [TRANSVERSE, OMISE]) {
      expect(fiche(username).vanishedAt).toBeNull();
      expect(fiche(username).returnedAt).toBeNull();
      expect(fiche(username).lastSeenAt).toEqual(NUITS[2]);
      expect(fiche(username).firstSeenAt).toEqual(NUITS[0]);
    }
    expect(base.fiches.filter((candidate) => candidate.returnedAt !== null)).toEqual([]);
  });

  it("date le retour d'une absence qu'un second passage complet a constatée", async () => {
    // Given une disparition du chemin silencieux, datée par un passage complet.
    await nuit(0);
    await nuit(1, { omis: [OMISE] });
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);

    // When un second passage complet la cherche et ne la trouve pas. La disparition ne
    // se redate pas, elle se confirme : c'est cette confirmation, et rien d'autre, qui
    // sépare un départ d'un battement.
    const confirmation = await nuit(2, { omis: [OMISE] });
    expect(confirmation.status).toBe("OK");
    expect(confirmation.vanished).toBe(0);
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);
    expect(fiche(OMISE).returnedAt).toBeNull();

    // Then sa réapparition est un vrai retour, et elle se date. La première vue ne
    // bouge toujours pas : c'est justement pourquoi le retour se date ailleurs.
    await nuit(3);

    expect(fiche(OMISE).vanishedAt).toBeNull();
    expect(fiche(OMISE).returnedAt).toEqual(NUITS[3]);
    expect(fiche(OMISE).firstSeenAt).toEqual(NUITS[0]);
  });

  it("date ce retour même quand le passage qui le constate est dégradé", async () => {
    // Given la même absence, confirmée par un second passage complet.
    await nuit(0);
    await nuit(1, { omis: [OMISE] });
    await nuit(2, { omis: [OMISE] });
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);

    // When elle reparaît sur un passage que la liste des membres a rendu incomplet.
    const degrade = await nuit(3, { lecture: "amputée" });
    expect(degrade.status).toBe("PARTIAL");

    // Then le retour est daté quand même, et ce n'est pas un oubli de symétrie : une
    // absence se conclut d'un silence, qu'un passage tronqué imite trait pour trait,
    // alors qu'une présence se constate et qu'aucun passage tronqué n'invente
    // personne. Refuser ici serait pire que ne rien faire, la disparition étant
    // effacée sans condition par ce même passage : le retour serait perdu pour de bon.
    expect(fiche(OMISE).vanishedAt).toBeNull();
    expect(fiche(OMISE).returnedAt).toEqual(NUITS[3]);
  });

  it("perd le retour tant qu'aucun passage complet ne vient, quelle que soit la durée", async () => {
    // Given une disparition datée par un passage complet, sur une personne réellement
    // partie : son départ a été constaté, et son retour rouvrira des accès.
    await nuit(0);
    await nuit(1, { omis: [OMISE] });
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);

    // When aucun des passages suivants ne parvient à se dire complet. Ce n'est pas un
    // incident d'une nuit : un seul enregistrement mal formé en amont dégrade toutes
    // les nuits et ne se répare pas tout seul. Le dernier passage complet reste donc
    // celui qui a daté la disparition, et l'absence a beau durer, rien ne la confirme.
    for (const index of [2, 3, 4, 5, 6, 7]) {
      const passage = await nuit(index, { omis: [OMISE], lecture: "amputée" });
      expect(passage.status).toBe("PARTIAL");
    }
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);

    // Then son retour n'est pas daté, et une semaine de plus n'y changerait rien : ce
    // qui manque n'est pas du temps mais un passage complet. La disparition vient
    // d'être effacée par le passage qui la revoit, donc plus rien ne la portera. Ce
    // n'est pas le prix d'une absence de deux nuits, c'est celui de toute absence
    // qu'aucun passage complet n'a traversée, et il est gravé ici pour que personne ne
    // le découvre en production. Le relâcher coûterait plus cher : un passage qui
    // refuse de conclure parce que le périmètre a fondu confirmerait alors les
    // absences qu'il vient justement de refuser de dater, et un faux retour éteint
    // pour toujours le démenti d'une action déclarée.
    const retour = await nuit(8);

    expect(fiche(OMISE).vanishedAt).toBeNull();
    expect(fiche(OMISE).returnedAt).toBeNull();

    // Then la perte est au moins dite : la trace nomme la personne et la date de sa
    // disparition, sept nuits plus tôt, ce qui la distingue du battement d'une nuit
    // que cette règle est faite pour taire.
    expect(ceQuiAEteDit(retour.runId)).toEqual([
      `${REFUS_DE_RETOUR} : ${OMISE} (disparue le 2026-09-02) ; absence non confirmée`,
    ]);
  });
});

/**
 * Le sursis d'une fiche non lue n'est pas une exemption, et c'est tout l'enjeu de ces
 * deux scénarios. L'épargner sans condition ferait qu'une fiche réellement supprimée
 * en amont ne recevrait plus jamais de départ, donc aucune révocation, sans autre
 * trace qu'une ligne de console : un faux positif bruyant échangé contre un faux
 * négatif muet, sur le constat le plus important du produit.
 */
describe("ce qu'un passage finit par conclure d'une fiche qu'il n'a jamais su lire", () => {
  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.sequence = 0;
  });

  it("date la disparition au deuxième passage complet qui ne l'a pas lue, sans compter les dégradés", async () => {
    // Given une fiche vue par un premier passage complet, puis retenue par le suivant.
    await nuit(0);
    const sursis = await nuit(1, { fiche: "absente" });
    expect(sursis.retenues).toEqual([TRANSVERSE]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();

    // When le passage qui aurait pu confirmer l'angle mort se dégrade sur un membre
    // illisible. Il ne date aucune disparition, donc il n'en confirme aucune non plus,
    // et il ne prolonge pas le sursis pour autant : il ne compte pas. Faire confirmer
    // une absence par un passage qui vient de dire qu'il ne se fiait pas à sa lecture
    // serait rouvrir le défaut du mauvais côté.
    const degrade = await nuit(2, { fiche: "absente", lecture: "amputée" });
    expect(degrade.status).toBe("PARTIAL");
    expect(degrade.retenues).toEqual([]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();

    // Then le passage complet suivant conclut : la dernière vue de la fiche est
    // désormais antérieure au dernier passage complet, l'angle mort a duré, et ce
    // n'est plus un incident d'une nuit mais une fiche que la source ne rend plus.
    const conclu = await nuit(3, { fiche: "absente" });
    expect(conclu.status).toBe("OK");
    expect(conclu.retenues).toEqual([]);
    expect(conclu.vanished).toBe(1);
    expect(fiche(TRANSVERSE).vanishedAt).toEqual(NUITS[3]);
    expect(ceQuiAEteDit(conclu.runId)).toEqual([]);

    // Then les passages d'après ne redatent rien : ce qui est conclu l'est une fois
    // pour toutes, et la sortie du référentiel suit son cours.
    const encore = await nuit(4, { fiche: "absente" });
    expect(encore.retenues).toEqual([]);
    expect(encore.vanished).toBe(0);
    expect(fiche(TRANSVERSE).vanishedAt).toEqual(NUITS[3]);

    // Then sa réapparition est un vrai retour, et elle se date : le sursis n'a rien
    // supprimé, il a décalé. La première vue ne bouge pas, c'est le même séjour.
    await nuit(5);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(fiche(TRANSVERSE).returnedAt).toEqual(NUITS[5]);
    expect(fiche(TRANSVERSE).firstSeenAt).toEqual(NUITS[0]);
  });

  it("ne laisse pas une nuit sans réponse consommer le sursis d'un aveu, ni dater un compte de service", async () => {
    // Given un premier passage complet, et un compte de service que rien du périmètre
    // ne réclame : aucune liste ne le rend, aucune fiche complète ne le nomme, et il
    // n'a jamais à recevoir de disparition.
    poserCompteDeService();
    const premier = await nuit(0);
    expect(premier.seen).toBe(13);
    expect(fiche(TRANSVERSE).lastSeenAt).toEqual(NUITS[0]);

    // When la nuit suivante n'obtient aucune réponse sur la fiche du transverse. Le
    // passage se dit complet, c'est le chemin que ce lot vient d'ouvrir, et il retient
    // la fiche sans borne parce qu'il n'a rien appris d'elle.
    const muette = await nuit(1, { fiche: "muette" });
    expect(muette.status).toBe("OK");
    expect(muette.retenuesSansReponse).toEqual([TRANSVERSE]);
    expect(nommeesSansReponse(muette.runId)).toEqual([TRANSVERSE]);

    // Then le relevé qu'elle laisse compte treize et non douze : la retenue dit qu'on
    // ne conclut rien de cette fiche, pas qu'elle est absente, et un relevé qui la
    // retrancherait abaisserait le plancher de toutes les nuits de la panne.
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[1] });

    // When la source répond enfin, et répond qu'elle ne connaît pas la fiche.
    const aveu = await nuit(2, { fiche: "absente" });

    // Then la fiche est retenue, et c'est là que les deux retenues se composent : la
    // nuit muette a beau avoir été complète, elle n'a pas lu cette fiche, donc elle
    // n'a pas fait courir l'horloge de son sursis. Sans cela un seul aveu suffirait à
    // dater, là où la règle en demande deux, et la sortie de périmètre qui suit coupe
    // des accès.
    expect(aveu.status).toBe("OK");
    expect(aveu.retenues).toEqual([TRANSVERSE]);
    expect(aveu.vanished).toBe(0);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(ceQuiAEteDit(aveu.runId)).toEqual([
      `${REFUS_DE_DISPARITION} : ${TRANSVERSE} ; aucune disparition datée`,
    ]);

    // When un second passage complet la nomme absente à son tour.
    const conclu = await nuit(3, { fiche: "absente" });

    // Then la disparition se date : la grâce ne se représente pas, le passage
    // précédent ayant nommé la fiche dans ses introuvables et non dans ses
    // sans-réponse. Deux aveux, pas un de plus, pas un de moins.
    expect(conclu.vanished).toBe(1);
    expect(fiche(TRANSVERSE).vanishedAt).toEqual(NUITS[3]);

    // When la source recommence à jeter sur une fiche désormais datée disparue.
    const apres = await nuit(4, { fiche: "muette" });

    // Then rien n'est retenu en son nom et la trace ne la nomme pas : elle est passée
    // sous l'autorité du constat de sortie, et l'annoncer retenue promettrait une
    // suite que plus aucun passage ne lui donnera.
    expect(apres.retenuesSansReponse).toEqual([]);
    expect(nommeesSansReponse(apres.runId)).toEqual([]);

    // Then le compte de service n'a été daté par aucun de ces cinq passages, alors
    // qu'aucun ne l'a jamais rendu : il n'est du périmètre d'aucune source, et la
    // seule chose qui l'en protège est le filtre de la requête qui date.
    expect(fiche(SERVICE).vanishedAt).toBeNull();
  });

  it("rend son sursis entier à la fiche qui sort d'une série sans réponse", async () => {
    // Given une fiche vue par un premier passage complet.
    await nuit(0);

    // When trois passages complets d'affilée n'obtiennent aucune réponse sur elle. Le
    // relevé avance à chaque fois, sa dernière vue reste à la première nuit, et la
    // trace la nomme chaque fois.
    for (const index of [1, 2, 3]) {
      const passage = await nuit(index, { fiche: "muette" });
      expect(passage.status).toBe("OK");
      expect(passage.retenuesSansReponse).toEqual([TRANSVERSE]);
    }
    expect(fiche(TRANSVERSE).lastSeenAt).toEqual(NUITS[0]);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[3] });

    // When la source répond enfin, et répond 404.
    const aveu = await nuit(4, { fiche: "absente" });

    // Then elle est retenue, et non datée le soir même : trois passages complets se
    // sont écoulés sans rien dire d'elle, et leur laisser consommer le sursis ferait
    // dater un départ sur un unique aveu, en silence, au sortir d'une panne.
    expect(aveu.retenues).toEqual([TRANSVERSE]);
    expect(aveu.vanished).toBe(0);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();

    // Then le second aveu conclut, comme sur une fiche qui n'aurait jamais connu la
    // panne : le sursis a été rendu entier, il n'a pas été rouvert.
    const conclu = await nuit(5, { fiche: "absente" });
    expect(conclu.vanished).toBe(1);
    expect(fiche(TRANSVERSE).vanishedAt).toEqual(NUITS[5]);
  });

  it("recule d'un passage le seuil du retour sur ce chemin, et c'est le prix", async () => {
    // Given une fiche retenue puis datée disparue par le passage complet suivant : sa
    // disparition porte le troisième passage, et non le deuxième, où elle a commencé.
    await nuit(0);
    await nuit(1, { fiche: "absente" });
    await nuit(2, { fiche: "absente" });
    expect(fiche(TRANSVERSE).vanishedAt).toEqual(NUITS[2]);

    // When elle reparaît aussitôt : aucun passage complet n'est venu depuis la date de
    // sa disparition, celui qui l'a posée étant le dernier.
    await nuit(3);

    // Then aucun retour n'est daté, alors que la fiche a bel et bien manqué deux
    // passages. C'est le prix du sursis, il ne se paie que sur le chemin du 404, et il
    // demande trois passages d'absence au lieu de deux pour qu'un retour se date.
    // L'erreur va dans le sens sûr : un retour manqué laisse trop peu d'accès et se
    // réclame tout seul, là où un faux retour éteint sans bruit le démenti d'une
    // action déclarée.
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(fiche(TRANSVERSE).returnedAt).toBeNull();
    expect(fiche(TRANSVERSE).firstSeenAt).toEqual(NUITS[0]);
  });
});

/**
 * Une lecture de fiche qui n'aboutit pas est le seul chemin de ce module où la
 * prudence changeait de camp. Elle dégradait le passage, donc le relevé cessait
 * d'avancer, donc les garde-fous qui s'y adossent se taisaient tous à la fois, et un
 * seul enregistrement amont durablement mal formé y suffisait, indéfiniment. Pire, sur
 * un déclaré transverse, la dégradation était en même temps le seul filet : le passage
 * ne le résolvait pas, ne l'avouait pas non plus, et un passage laissé complet l'aurait
 * daté disparu sur une panne d'une nuit, puis mené vers une coupure d'accès.
 *
 * La règle qui sort de là vaut dans les deux sens, et ces trois scénarios la gravent :
 * ce qui dégrade un passage est ce qu'il ne peut pas nommer.
 */
describe("ce qu'un passage conclut d'une fiche qui ne lui a pas répondu", () => {
  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.sequence = 0;
  });

  it("ne date jamais le départ d'un déclaré transverse muet, et date les vrais départs de la nuit", async () => {
    // Given un périmètre entier, vu et daté par un premier passage complet, dont un
    // déclaré transverse qui n'entre au périmètre que par sa fiche complète.
    const premier = await nuit(0, { parEquipe: "présente" });
    expect(premier.status).toBe("OK");
    expect(releveDeReference()?.itemsSeen).toBe(14);

    // When la lecture de sa fiche cesse de répondre, et la même nuit une personne s'en
    // va vraiment, par le chemin silencieux qui concerne l'incubateur entier.
    const muette = await nuit(1, { fiche: "muette", parEquipe: "présente", omis: [OMISE] });

    // Then le passage reste complet. C'est l'inverse d'avant, et c'est ce qui compte :
    // une lecture qui jette portait le passage en `PARTIAL`, le relevé cessait
    // d'avancer, et le plancher de chute, la règle du retour, le sursis, la datation
    // des sorties de startups, le verdict des arrivées et le bandeau d'une fiche non
    // rendue se taisaient tous ensemble, pour tout le monde, jusqu'à ce que l'amont
    // guérisse.
    expect(muette.status).toBe("OK");
    expect(muette.errors).toEqual([]);
    expect(releveDeReference()?.startedAt).toEqual(NUITS[1]);

    // Then il n'est pas daté disparu pour autant, et c'est l'autre moitié de la règle :
    // le passage ne l'a pas résolu, la source ne l'a pas dit inconnu, et rien ne
    // permet de conclure. Le laisser tomber dans l'`updateMany` aurait levé la sortie
    // du référentiel, en gravité haute, sur une panne d'une nuit.
    expect(muette.retenuesSansReponse).toEqual([TRANSVERSE]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();

    // Then le vrai départ de la nuit est daté, lui, et c'est le prix que le gel faisait
    // payer aux quatre-vingt-quinze autres pour épargner celui-là.
    expect(muette.vanished).toBe(1);
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);

    // Then la retenue se dit trois fois, chacune pour un lecteur différent : la phrase
    // du refus dans la colonne que l'écran des collectes lit, ce que la source a
    // répondu en échouant, qui est la seule chose qui distingue la panne d'une nuit de
    // l'enregistrement mal formé, et la liste en clair que la fiche d'une personne
    // relit pour parler d'elle nommément.
    expect(ceQuiAEteDit(muette.runId)).toEqual([
      `${TRANSVERSE} : 500 Internal Server Error`,
      `${REFUS_DE_LECTURE} : ${TRANSVERSE} ; aucune disparition datée tant que la lecture échoue`,
    ]);
    expect(muette.lecturesManquees).toEqual([
      { username: TRANSVERSE, message: "500 Internal Server Error" },
    ]);
    expect(nommeesSansReponse(muette.runId)).toEqual([TRANSVERSE]);

    // When la panne s'installe : quatre nuits de plus, à l'identique.
    for (const index of [2, 3, 4, 5]) {
      const encore = await nuit(index, {
        fiche: "muette",
        parEquipe: "présente",
        omis: [OMISE],
      });

      // Then le relevé avance à chaque passage, et la retenue se redit à chaque
      // passage. Elle n'a pas de borne, et ce n'est pas l'exemption que le sursis du
      // 404 s'interdit : une suppression en amont répond 404, elle nomme la fiche
      // qu'elle a supprimée, donc aucun départ réel n'emprunte ce chemin-ci.
      expect(encore.status).toBe("OK");
      expect(releveDeReference()?.startedAt).toEqual(NUITS[index]);
      expect(encore.retenuesSansReponse).toEqual([TRANSVERSE]);
      expect(nommeesSansReponse(encore.runId)).toEqual([TRANSVERSE]);
      expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    }

    // When la source répond de nouveau.
    const guerie = await nuit(6, { parEquipe: "présente", omis: [OMISE] });

    // Then rien n'a été perdu et rien n'a été inventé : sa dernière vue reprend, son
    // séjour n'a jamais été interrompu, donc aucun retour n'est à dater, et le passage
    // cesse de dire ce qu'il refusait.
    expect(guerie.retenuesSansReponse).toEqual([]);
    expect(fiche(TRANSVERSE).lastSeenAt).toEqual(NUITS[6]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(fiche(TRANSVERSE).returnedAt).toBeNull();
    expect(fiche(TRANSVERSE).firstSeenAt).toEqual(NUITS[0]);
    expect(ceQuiAEteDit(guerie.runId)).toEqual([]);
    expect(nommeesSansReponse(guerie.runId)).toEqual([]);
  });

  it("ne retient rien et ne dégrade rien pour une rattachée que la liste scopée rend encore", async () => {
    // Given le même périmètre complet, avec une personne rattachée par une équipe : la
    // liste scopée la rend, mais elle ne porte aucune de ses missions, si bien que sa
    // fiche complète est la seule chose à dater sa fin.
    await nuit(0, { parEquipe: "présente" });
    expect(fiche(PAR_EQUIPE).missionEnd).toEqual(new Date("2027-12-31T00:00:00Z"));

    // When c'est sa fiche à elle qui ne répond plus, la même nuit qu'un vrai départ.
    const muette = await nuit(1, { parEquipe: "muette", omis: [OMISE] });

    // Then le passage reste complet, et sur ce chemin la dégradation était une perte
    // pure : la liste scopée la rend encore, elle reste du périmètre, sa dernière vue
    // avance, et rien de ce que le passage ignore d'elle ne concerne son existence.
    expect(muette.status).toBe("OK");
    expect(muette.errors).toEqual([]);
    expect(fiche(PAR_EQUIPE).lastSeenAt).toEqual(NUITS[1]);
    expect(fiche(PAR_EQUIPE).vanishedAt).toBeNull();

    // Then elle n'est retenue par aucun des deux sursis, et l'annoncer ferait mentir la
    // trace : on ne retient que ce qu'on allait faire disparaître. C'est le même filtre
    // qui sépare les deux populations qu'une fiche complète concerne, et il n'y en a
    // pas d'autre.
    expect(muette.retenues).toEqual([]);
    expect(muette.retenuesSansReponse).toEqual([]);
    expect(nommeesSansReponse(muette.runId)).toEqual([]);

    // Then son échéance est conservée telle que le dernier passage l'a lue, par la
    // règle qui protège cette colonne et qui, elle, n'a jamais eu besoin de dégrader
    // quoi que ce soit pour le faire.
    expect(fiche(PAR_EQUIPE).missionEnd).toEqual(new Date("2027-12-31T00:00:00Z"));
    expect(muette.echeancesNonEcrites).toEqual([PAR_EQUIPE]);

    // Then le vrai départ de la nuit est daté, et le relevé avance : voilà ce que la
    // dégradation coûtait ici, et ce qu'elle ne protégeait pas.
    expect(muette.vanished).toBe(1);
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[1]);
    expect(releveDeReference()?.startedAt).toEqual(NUITS[1]);

    // Then la trace porte les deux natures de fait sans que l'une chasse l'autre : ce
    // que la source a répondu en échouant, et le refus d'écriture qu'il a entraîné. Pas
    // de refus de disparition, il n'y en avait aucune à refuser.
    expect(ceQuiAEteDit(muette.runId)).toEqual([
      `${PAR_EQUIPE} : 500 Internal Server Error`,
      `${REFUS_D_ECHEANCE} : ${PAR_EQUIPE} ; fiche complète non lue`,
    ]);
  });

  it("dégrade encore quand la réponse perd quelqu'un sans pouvoir le nommer", async () => {
    // Given un périmètre entier, vu et daté par un premier passage complet.
    await nuit(0);

    // When la réponse de la liste perd une personne de la seule façon qui ne la nomme
    // pas : son enregistrement est illisible, la lecture l'écarte de la réponse et ne
    // garde de lui qu'un rang dans un message. C'est le cas couplé, celui que le
    // harnais découple partout ailleurs, et il n'était couvert par aucun test.
    const amputee = await nuit(1, { omis: [OMISE], lecture: "amputée" });

    // Then le passage se dégrade, et il le doit : rien ne distingue cet élément écarté
    // d'un départ, aucun identifiant ne le désigne, et il n'y a donc personne à
    // retenir. Le refus de conclure est ici le seul filet qui existe, et le retirer
    // daterait un départ sur un défaut de sérialisation amont. C'est voulu, et c'est
    // gravé ici pour que personne ne le prenne pour un oubli de symétrie.
    expect(amputee.status).toBe("PARTIAL");
    expect(amputee.errors).toHaveLength(1);
    expect(amputee.vanished).toBe(0);
    expect(fiche(OMISE).vanishedAt).toBeNull();
    expect(releveDeReference()?.startedAt).toEqual(NUITS[0]);

    // When la nuit suivante perd exactement la même personne de la même façon
    // silencieuse, mais ne perd de fiche complète que celle qu'elle peut nommer.
    const nommee = await nuit(2, { fiche: "muette", omis: [OMISE] });

    // Then le verdict s'inverse, et c'est toute la règle : la même perte, le même
    // nombre de personnes en moins, et deux conclusions opposées, parce que l'une est
    // nommable et l'autre non. Le déclaré transverse est retenu, l'omise est datée.
    expect(nommee.status).toBe("OK");
    expect(nommee.retenuesSansReponse).toEqual([TRANSVERSE]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(nommee.vanished).toBe(1);
    expect(fiche(OMISE).vanishedAt).toEqual(NUITS[2]);
  });
});

/**
 * L'adoption d'une fiche fabriquée est le seul événement de ce module qu'aucun humain
 * ne déclenche et qui retire pourtant un accès : la collecte réécrit les adresses d'une
 * fiche locale devenue membre et cesse de la dire modifiable, si bien qu'un lien de
 * connexion cesse de fonctionner au milieu d'un dossier.
 */
describe("ce qu'un passage signale quand il adopte une fiche fabriquée", () => {
  const APRES = new Date(Date.UTC(2026, 9, 1));

  function ficheLocale(username: string, id: string): FicheEnBase {
    return {
      id,
      username,
      source: "LOCAL",
      firstSeenAt: NUITS[0] ?? new Date(),
      lastSeenAt: NUITS[0] ?? new Date(),
      vanishedAt: null,
      returnedAt: null,
      missionEnd: null,
    };
  }

  const basculesSignalees = () =>
    base.journal.filter((trace) => trace.action === "participation.canal-bascule");

  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.droits.length = 0;
    base.journal.length = 0;
  });

  it("le dit du droit que l'adoption prive de son canal, et se tait le reste du temps", async () => {
    // Given quatre fiches fabriquées ici dont l'amont connaît désormais l'identifiant :
    // la première porte un droit vivant sans canal déclaré, la deuxième un droit vivant
    // octroyé avec son adresse, la troisième un droit révoqué, la quatrième rien
    base.fiches.push(
      ficheLocale("zoe.exemple", "fiche-avec-droit"),
      ficheLocale("ines.exemple", "fiche-canal-declare"),
      ficheLocale("yanis.exemple", "fiche-droit-mort"),
      ficheLocale("sacha.exemple", "fiche-sans-droit"),
    );
    base.droits.push(
      {
        accessCaseId: "dossier-de-zoe",
        personId: "fiche-avec-droit",
        channelEmail: null,
        expiresAt: APRES,
        revokedAt: null,
        etat: "CONFIRMED",
      },
      {
        accessCaseId: "dossier-d-ines",
        personId: "fiche-canal-declare",
        channelEmail: "ines@perso.example",
        expiresAt: APRES,
        revokedAt: null,
        etat: "CONFIRMED",
      },
      {
        accessCaseId: "dossier-de-yanis",
        personId: "fiche-droit-mort",
        channelEmail: null,
        expiresAt: APRES,
        revokedAt: NUITS[0] ?? null,
        etat: "CONFIRMED",
      },
    );

    // When la collecte passe
    await nuit(0);

    // Then les quatre sont adoptées : leur source bascule, leurs adresses saisies sont
    // écrasées, et une adresse portée par une fiche cesse d'ouvrir quoi que ce soit
    expect(fiche("zoe.exemple").source).toBe("BETA");
    expect(fiche("ines.exemple").source).toBe("BETA");
    expect(fiche("yanis.exemple").source).toBe("BETA");
    expect(fiche("sacha.exemple").source).toBe("BETA");

    // Then une seule ligne est écrite, et c'est celle qui appelle un geste : le
    // signalement dit qu'un accès vient de se fermer sans que personne l'ait décidé,
    // il ne décrit pas la collecte. Un droit octroyé avec son adresse traverse la
    // bascule intact, un droit mort et une fiche sans droit n'appellent rien, et les
    // signaler tous noierait celui qui compte.
    //
    // Then le sujet est le droit et se nomme comme chez ses trois voisins du même
    // registre, dossier puis détenteur : la seule fiche ne dirait pas lequel rouvrir.
    expect(basculesSignalees()).toEqual([
      { action: "participation.canal-bascule", targetId: "dossier-de-zoe:zoe.exemple" },
    ]);

    // Then le passage lui-même a bien eu lieu, et sa ligne de fin est là comme
    // toujours : le signalement s'ajoute au journal, il ne le remplace pas
    expect(base.journal.some((trace) => trace.action === "sync.perimetre")).toBe(true);

    // When un second passage repasse sur les mêmes fiches, désormais collectées
    base.journal.length = 0;
    await nuit(1);

    // Then plus rien n'est signalé : la bascule est un franchissement et non un état,
    // et le redire chaque nuit ferait de ce signal un bruit qu'on cesse de lire
    expect(basculesSignalees()).toEqual([]);
  });
});

/**
 * Le gel du relevé a cinq causes et une seule signature. Un élément de liste
 * illisible, une écriture qui lève, une lecture de liste qui n'aboutit pas, le
 * plancher de chute qui refuse, et le plancher qui refuse encore parce que son propre
 * refus a figé sa référence : cinq portes, et derrière chacune le même effet, un
 * dernier passage complet qui cesse d'avancer et toutes les règles qui s'y adossent
 * qui se taisent ensemble, pour tout le monde. Aucune ne peut le signaler elle-même,
 * chacune se taisant précisément parce que le relevé est vieux.
 *
 * Ce qui se compte ici est donc l'effet et non la cause, et c'est ce qui sépare une
 * nuit ratée, qui arrive, d'une série qui n'en est plus une.
 */
describe("ce qu'un passage dit du relevé qu'il n'a pas renouvelé", () => {
  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.sequence = 0;
  });

  it("compte l'âge du relevé en passages quelle qu'en soit la cause, et ne l'annonce qu'installé", async () => {
    // Given un premier passage complet, qui pose le relevé contre lequel tout se
    // décidera. Il n'a rien à dire de son propre âge, étant lui-même le relevé.
    const premier = await nuit(0);
    expect(premier.status).toBe("OK");
    expect(premier.seen).toBe(13);
    expect(ceQuiAEteDit(premier.runId)).toEqual([]);
    expect(ageDuReleveDit(premier.runId)).toBeNull();

    // When une nuit se rate sur un enregistrement amont illisible, ce qui est le
    // chemin le plus large et le plus déterministe.
    const une = await nuit(1, { lecture: "amputée" });

    // Then le passage dit qu'il n'a pas renouvelé le relevé, nomme celui contre lequel
    // les règles continuent de décider, et le compte en passages : sans cette ligne,
    // les seuls messages du run sont ceux de la lecture ratée, qui ne disent rien de
    // ce que le passage vient de suspendre pour tout le monde.
    expect(une.status).toBe("PARTIAL");
    expect(ceQuiAEteDit(une.runId)).toEqual([
      "membres de l'incubateur : élément 4 illisible (username requis)",
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-01, laissé un passage en arrière`,
    ]);

    // Then une seule nuit ne s'annonce pas au nom des personnes : le compte est porté
    // en clair dans la trace, mais il ne franchit pas encore le seuil au-delà duquel
    // la fiche de quelqu'un en parle. Une lecture peut échouer une nuit pour une
    // raison qui passera, et un avertissement posé sur quatre-vingt-quinze fiches à
    // chaque incident d'une nuit cesse d'être lu.
    expect(ageDuReleveDit(une.runId)).toBe(1);
    expect(releveFige(1)).toBe(false);

    // When la nuit suivante se rate par une porte entièrement différente : la réponse
    // est valide, rien n'est illisible, mais le périmètre a fondu d'un tiers et le
    // plancher de chute refuse de dater. C'est le verrou qui s'entretient lui-même, sa
    // référence étant l'effectif d'un relevé que son propre refus empêche d'avancer.
    const chute = await nuit(2, {
      omis: [OMISE, "zoe.exemple", "yanis.exemple", "sacha.exemple"],
    });

    // Then le compte continue, et c'est tout l'intérêt de le tenir sur le relevé
    // plutôt que sur un refus nommé : deux causes qui n'ont rien à voir se suivent, et
    // un compteur de répétitions serait reparti de zéro à la seconde alors que l'effet
    // ne s'est pas interrompu une nuit.
    expect(chute.status).toBe("PARTIAL");
    expect(chute.vanished).toBe(0);
    expect(ageDuReleveDit(chute.runId)).toBe(2);
    expect(ceQuiAEteDit(chute.runId)).toEqual([
      "chute du périmètre : 9 personnes contre 13 au dernier relevé complet, aucune disparition datée",
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-01, laissé 2 passages en arrière`,
    ]);

    // When une troisième nuit passe sans relevé complet.
    const installe = await nuit(3, { lecture: "amputée" });

    // Then la phrase change de nature : ce n'est plus un incident, et elle le dit. Le
    // relevé nommé est toujours le même, trois passages en arrière, et le nombre est
    // ce qui distingue cette ligne de la même ligne d'avant-hier.
    expect(ageDuReleveDit(installe.runId)).toBe(3);
    expect(releveFige(3)).toBe(true);
    expect(ceQuiAEteDit(installe.runId).at(-1)).toBe(
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-01, laissé 3 passages en arrière : ce n'est plus un incident, et plus rien de ce qui s'y adosse ne décide sur l'état du jour`,
    );

    // Then rien n'a été daté pendant les trois nuits, ce qui est exactement l'état que
    // ce compte sert à rendre visible : le gel est silencieux parce qu'il n'écrit rien.
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);

    // When l'amont guérit et un passage se dit complet.
    const guerie = await nuit(4);

    // Then il ne dit plus rien du relevé, et pour cause : il en est un. Le relevé
    // avance, et ce que le passage a suspendu reprend.
    expect(guerie.status).toBe("OK");
    expect(ceQuiAEteDit(guerie.runId)).toEqual([]);
    expect(ageDuReleveDit(guerie.runId)).toBeNull();
    expect(releveDeReference()?.startedAt).toEqual(NUITS[4]);

    // Then la nuit ratée suivante repart de un, et nomme le relevé neuf : le compte
    // dit l'âge du relevé et non l'historique des nuits ratées, si bien qu'une série
    // interrompue par un passage complet n'est pas une série.
    const apres = await nuit(5, { lecture: "amputée" });

    expect(ageDuReleveDit(apres.runId)).toBe(1);
    expect(ceQuiAEteDit(apres.runId).at(-1)).toBe(
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-05, laissé un passage en arrière`,
    );

    // When la série dure au-delà de la fenêtre que relit l'idiome voisin des refus
    // répétés.
    for (const index of [6, 7, 8, 9, 10, 11, 12, 13]) {
      await nuit(index, { lecture: "amputée" });
    }
    const vieux = await nuit(14, { lecture: "amputée" });

    // Then le compte annoncé est celui qu'on a lu, et non celui d'une fenêtre : la
    // borne est le relevé lui-même, et un plafond de passages donnerait un nombre
    // faux en le donnant pour exact. C'est la seule assertion qui distingue les deux,
    // toute histoire plus courte que ce plafond laissant les deux réponses égales.
    expect(ageDuReleveDit(vieux.runId)).toBe(10);
    expect(PASSAGES_RELUS).toBeLessThan(10);
    expect(ceQuiAEteDit(vieux.runId).at(-1)).toBe(
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-05, laissé 10 passages en arrière : ce n'est plus un incident, et plus rien de ce qui s'y adosse ne décide sur l'état du jour`,
    );
  });
});

/**
 * Le plancher de chute est le seul garde-fou de ce module qui entretienne sa propre
 * référence. Il compare l'effectif du jour à celui du dernier passage complet, et son
 * refus dégrade le passage qui le prononce : un passage dégradé ne devient jamais ce
 * relevé, donc la chute se rejoue demain contre l'effectif d'avant-hier, à l'identique
 * et pour toujours. Aucune donnée périmée n'est en cause, aucune correction en amont
 * n'y peut rien, et ce qu'il gèle n'est pas un fournisseur mais le relevé auquel tout
 * ce module s'adosse.
 *
 * Sa sortie est donc la même que celle des systèmes cibles, et pour la même raison :
 * une décision d'opérateur, motivée, consommée en un passage, jamais un réglage. Rien
 * ne se lève tout seul, une chute pouvant aussi bien être une source qui répond mal.
 */
describe("ce qui sort le plancher du périmètre du refus qu'il s'entretient", () => {
  /** Quatre départs sur treize : le périmètre passe sous le plancher de la politique. */
  const CHUTE = [OMISE, "zoe.exemple", "yanis.exemple", "sacha.exemple"];

  /** Trois de plus, pour repasser sous un plancher que le dégel vient d'abaisser. */
  const RECHUTE = [...CHUTE, "noe.exemple", "solene.exemple", "tiphaine.exemple"];

  /** Un de plus que la chute, et deux de moins que le creux qui l'a précédée. */
  const CINQ = [...CHUTE, "noe.exemple"];

  /** Le creux : ce que l'amont rendait de moins quelques passages plus tôt. */
  const SIX = [...CINQ, "solene.exemple"];

  /** Dix départs sur treize : une chute d'une tout autre ampleur que celle qu'on a lue. */
  const EFFONDREMENT = [
    "blandine",
    "elias",
    "gwendal",
    "hakim",
    "ines",
    "maelys",
    "noe",
    "sacha",
    "solene",
    "tiphaine",
  ].map((prenom) => `${prenom}.exemple`);

  /** Onze départs sur treize : l'effondrement que personne n'a examiné. */
  const EFFONDREMENT_TOTAL = [...EFFONDREMENT, "yanis.exemple"];

  /** Sept arrivées que seules des nuits dégradées ont vues. */
  const RENFORTS = ["aurele", "bastien", "chloe", "damien", "eva", "fanny", "gaspard"];

  /** Dix-sept arrivées que seules des nuits dégradées ont vues. */
  const VAGUE = [
    "aurele",
    "bastien",
    "chloe",
    "damien",
    "eva",
    "fanny",
    "gaspard",
    "helene",
    "ismael",
    "jonas",
    "kenza",
    "lucie",
    "marius",
    "nadia",
    "oscar",
    "prune",
    "quentin",
  ];

  const levees = () => base.journal.filter((trace) => trace.action === "sync.gardefou.leve");
  const perimees = () => base.journal.filter((trace) => trace.action === "sync.gardefou.perime");

  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.autorisations.length = 0;
    base.journal.length = 0;
    base.panneDeDatation = false;
    base.panneDeComptage = false;
    base.sequence = 0;
  });

  it("refuse à l'identique tant que personne ne tranche, puis date et fait avancer le relevé", async () => {
    // Given un premier passage complet : treize personnes, et le relevé contre lequel
    // le plancher comparera tant qu'aucun autre passage ne se dira complet.
    const premier = await nuit(0);
    expect(premier.seen).toBe(13);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });

    // When quatre personnes s'en vont réellement la même nuit, ce qui fait passer le
    // périmètre sous le plancher. La réponse est valide, rien n'est illisible : c'est
    // exactement la situation que ce garde-fou existe pour ne pas conclure trop vite.
    const chute = await nuit(1, { omis: CHUTE });

    // Then aucune disparition n'est datée, et le passage se dégrade en le disant. Il
    // dit aussi, du même coup, qu'il vient de laisser le relevé où il était.
    expect(chute.status).toBe("PARTIAL");
    expect(chute.vanished).toBe(0);
    expect(chute.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    expect(ceQuiAEteDit(chute.runId)).toEqual([
      "chute du périmètre : 9 personnes contre 13 au dernier relevé complet, aucune disparition datée",
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-01, laissé un passage en arrière`,
    ]);

    // When deux nuits de plus passent, à l'identique. Elles le sont nécessairement :
    // les quatre personnes ne reviendront pas, et la référence à laquelle on les
    // compare est celle d'un relevé que ce refus empêche d'avancer.
    await nuit(2, { omis: CHUTE });
    const installe = await nuit(3, { omis: CHUTE });

    // Then le refus s'annonce comme installé, avec son compte de passages, et l'écran
    // des collectes le porte en tête au lieu de le laisser dans une ligne de journal
    // parmi soixante.
    expect(ceQuiAEteDit(installe.runId).at(0)).toBe(
      "chute du périmètre : 9 personnes contre 13 au dernier relevé complet, aucune disparition datée : ce refus retombe à l'identique depuis 3 passages, il ne se dénouera pas seul",
    );
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 3,
      },
    ]);

    // Then le verrou est bien celui que le document décrit : la référence n'a pas
    // bougé d'un passage, personne n'est daté, et rien dans ce qui précède ne peut
    // dénouer cela. Ce n'est pas une donnée périmée qu'une correction en amont
    // réparerait, c'est le refus qui entretient ce contre quoi il refuse.
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);

    // When une opératrice pose une autorisation motivée, avant la nuit suivante.
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const degel = await nuit(4, { omis: CHUTE });

    // Then ce passage-là date, une fois : les quatre départs réels reçoivent enfin
    // leur date, et le passage se dit complet.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    for (const username of CHUTE) {
      expect(fiche(username).vanishedAt).toEqual(NUITS[4]);
    }

    // Then le relevé avance, et c'est ce qui brise le verrou pour de bon plutôt que
    // pour une nuit : la référence des passages suivants est l'effectif d'aujourd'hui.
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9, startedAt: NUITS[4] });
    expect(blocagesAnnonces()).toEqual([]);

    // Then la nuit ne ressemble pas à une nuit ordinaire dans la colonne où on relit
    // les passages, et le journal garde qui a décidé quoi. L'autorisation, elle, est
    // consommée : elle a nommé le passage qui l'a prise.
    expect(ceQuiAEteDit(degel.runId)).toEqual([
      "chute du périmètre : 9 personnes contre 13 au dernier relevé complet, datation autorisée à la main pour ce passage",
    ]);
    expect(levees()).toEqual([{ action: "sync.gardefou.leve", targetId: "espace-membre" }]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: degel.runId });

    // When la nuit suivante repasse sur le même périmètre, désormais de neuf personnes.
    const stable = await nuit(5, { omis: CHUTE });

    // Then le garde-fou n'a plus rien à refuser : ce qu'il comparait à treize, il le
    // compare maintenant à neuf, et il se tait.
    expect(stable.status).toBe("OK");
    expect(stable.chuteRefusee).toBeNull();
    expect(ceQuiAEteDit(stable.runId)).toEqual([]);

    // Then la décision d'hier reste hors d'atteinte : consommée, elle n'est ni reprise
    // par ce passage ni écartée par lui, et elle nomme toujours le seul passage qui
    // l'ait dépensée. Un passage qui la ramasserait une seconde fois en ferait un
    // réglage, c'est-à-dire l'exact contraire de ce qu'une autorisation est.
    expect(perimees()).toEqual([]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: degel.runId });

    // When trois personnes de plus s'en vont, et le périmètre repasse sous le plancher.
    const rechute = await nuit(6, { omis: RECHUTE });

    // Then il refuse de nouveau, et c'est ce qui sépare une autorisation d'un réglage :
    // elle valait un passage, celui qui l'a prise, et rien après lui.
    expect(rechute.status).toBe("PARTIAL");
    expect(rechute.vanished).toBe(0);
    expect(rechute.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 6,
      reference: 9,
      datables: 3,
    });
    expect(levees()).toHaveLength(1);
  });

  it("ne lève pas une chute plus profonde que celle qu'on a montrée à qui décidait", async () => {
    // Given un relevé de treize, et quatre départs que le plancher refuse de dater.
    await nuit(0);
    const refus = await nuit(1, { omis: CHUTE });
    expect(refus.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // Given une opératrice qui tranche sur ces nombres-là, et sur eux seuls : la
    // raison qu'elle écrit parle de quatre départs vérifiés un par un.
    autoriser(2, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When la nuit suivante subit un effondrement d'une tout autre ampleur : la liste
    // ne rend plus que trois personnes.
    const effondrement = await nuit(2, { omis: EFFONDREMENT });

    // Then rien n'est daté. La décision valait pour une chute qu'on avait sous les
    // yeux, et six personnes que personne n'a examinées ne reçoivent pas leur sortie
    // de périmètre, en gravité haute, sur une phrase écrite pour d'autres nombres.
    expect(effondrement.status).toBe("PARTIAL");
    expect(effondrement.vanished).toBe(0);
    expect(effondrement.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 3,
      reference: 13,
      datables: 10,
    });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);

    // Then la décision est écartée, et le journal le dit sous le nom de qui l'avait
    // prise : la laisser attendre interdirait d'en poser une autre, l'écran refusant
    // une seconde autorisation tant que la première attend.
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: effondrement.runId });

    // When une seconde décision est posée sur les nombres que l'écran annonce ce
    // soir-là, ceux de l'effondrement, et que l'amont retrouve entre-temps l'ampleur
    // d'avant-hier.
    autoriser(3, "sortie d'une startup entière, dix départs vérifiés ce matin", {
      observe: 3,
      reference: 13,
      datables: 10,
    });
    const degel = await nuit(3, { omis: CHUTE });

    // Then celle-là lève et date les quatre départs du soir : la borne écarte ce qui
    // est plus profond que l'ampleur examinée, elle n'écarte pas ce qui l'est moins, et
    // elle n'éteint pas la sortie.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    expect(levees()).toHaveLength(1);
  });

  it("écarte la décision qu'un passage complet ne trouve plus rien à lever", async () => {
    // Given un relevé de treize, quatre départs refusés, et une opératrice qui tranche.
    await nuit(0);
    await nuit(1, { omis: CHUTE });
    autoriser(2, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When l'amont se répare de lui-même : la nuit suivante retrouve les treize, se
    // dit complète, et n'a plus rien à refuser.
    const guerie = await nuit(2);
    expect(guerie.status).toBe("OK");
    expect(guerie.chuteRefusee).toBeNull();
    expect(guerie.chuteLevee).toBeNull();
    expect(guerie.vanished).toBe(0);

    // Then la décision n'est pas dépensée comme une levée, elle est écartée : écrire
    // au journal qu'un garde-fou a été levé sur un passage qui n'a rien refusé serait
    // faux, et c'est bien la prochaine collecte que l'écran promettait.
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: guerie.runId });

    // When cinq nuits ordinaires passent, puis un effondrement d'une tout autre nature.
    for (const index of [3, 4, 5, 6, 7]) {
      await nuit(index);
    }
    const effondrement = await nuit(8, { omis: EFFONDREMENT });

    // Then il ne trouve plus rien qui dorme : dix personnes ne sont pas datées
    // disparues sur une décision prise six passages plus tôt, pour quatre départs et
    // pour la nuit d'après.
    expect(effondrement.status).toBe("PARTIAL");
    expect(effondrement.vanished).toBe(0);
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);
  });

  it("ne dépense pas la décision quand la datation n'aboutit pas", async () => {
    // Given un relevé de treize, quatre départs refusés, et une opératrice qui tranche.
    await nuit(0);
    await nuit(1, { omis: CHUTE });
    autoriser(2, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When la base tombe au moment précis où le passage écrit ses disparitions.
    base.panneDeDatation = true;
    await expect(nuit(2, { omis: CHUTE })).rejects.toThrow("base indisponible");

    // Then personne n'est daté, et la décision attend toujours. Dépensée avant la
    // datation, elle serait perdue pour rien : il faudrait la reposer sans rien savoir
    // de plus qu'hier, et le journal affirmerait qu'un garde-fou a été levé sur un
    // passage qui n'a rien conclu.
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([]);
    expect(base.autorisations[0]).toMatchObject({ consumedAt: null, consumedRunId: null });

    // When la base répond de nouveau, la nuit suivante.
    base.panneDeDatation = false;
    const degel = await nuit(3, { omis: CHUTE });

    // Then la décision lève ce passage-là, et les quatre départs sont datés : rien
    // n'aura été perdu de la panne, sinon une nuit.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    expect(levees()).toHaveLength(1);
  });

  it("ne vaut que pour un passage commencé après elle, et n'est pas perdue pour autant", async () => {
    // Given un relevé de treize et quatre départs que le plancher refuse.
    await nuit(0);
    await nuit(1, { omis: CHUTE });

    // Given une opératrice qui clique alors que la collecte de la nuit suivante tourne
    // déjà : elle décide sur un état que cette collecte a cessé de lire.
    autoriserPendant(2, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const pendant = await nuit(2, { omis: CHUTE });

    // Then cette nuit-là refuse encore, et ne touche à rien : ni levée, ni mise à
    // l'écart, la décision n'étant d'aucun des deux côtés de la borne de ce passage.
    expect(pendant.status).toBe("PARTIAL");
    expect(pendant.vanished).toBe(0);
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([]);
    expect(base.autorisations[0]).toMatchObject({ consumedAt: null, consumedRunId: null });

    // When la nuit d'après commence, celle-ci après elle.
    const apres = await nuit(3, { omis: CHUTE });

    // Then elle lève, une fois : rien n'est perdu pour avoir été décidé à la mauvaise
    // minute, c'est simplement la collecte suivante qui conclut.
    expect(apres.status).toBe("OK");
    expect(apres.vanished).toBe(4);
    expect(levees()).toHaveLength(1);
  });

  it("ne date rien d'une nuit dont une lecture a manqué, et n'y dépense pas l'autorisation", async () => {
    // Given un relevé de treize, quatre départs que le plancher refuse, et une
    // autorisation posée sur ces nombres-là : c'est ce que l'écran montre, et il ne
    // propose la sortie que sous un refus.
    await nuit(0);
    const refus = await nuit(1, { omis: CHUTE });
    expect(refus.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    autoriser(2, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When la nuit suivante perd les mêmes quatre personnes et rend en plus un
    // enregistrement illisible, que la lecture écarte sans pouvoir le nommer.
    const amputee = await nuit(2, { omis: CHUTE, lecture: "amputée" });

    // Then rien n'est daté, et l'autorisation n'y est pour rien : le plancher n'a même
    // pas été consulté. C'est l'invariant dur de ce lot, et il tient par construction
    // plutôt que par vigilance, la sortie n'existant que sous un passage complet. Une
    // autorisation qui ferait dater ici dirait « conclus des départs sur une lecture
    // que tu n'as pas comprise », ce qu'aucune décision d'opérateur ne peut vouloir
    // dire.
    expect(amputee.status).toBe("PARTIAL");
    expect(amputee.vanished).toBe(0);
    expect(amputee.chuteRefusee).toBeNull();
    expect(amputee.chuteLevee).toBeNull();
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);

    // Then elle n'est pas dépensée pour autant : consommée sans rien dater, elle
    // aurait fait écrire au journal qu'on a autorisé ce qui n'a pas eu lieu, et il
    // aurait fallu la reposer sans rien savoir de plus qu'hier.
    expect(base.autorisations[0]).toMatchObject({ consumedAt: null, consumedRunId: null });

    // When la nuit suivante lit la liste entière sans rien perdre d'illisible, mais la
    // fiche du déclaré transverse cesse de répondre : le passage est complet, et il
    // reste une personne dont il ne sait rien.
    const muette = await nuit(3, { fiche: "muette", omis: CHUTE });

    // Then l'autorisation, toujours en attente, lève le plancher de ce passage-ci, et
    // les quatre départs réels sont datés.
    expect(muette.status).toBe("OK");
    expect(muette.vanished).toBe(4);
    expect(levees()).toHaveLength(1);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: muette.runId });

    // Then elle ne lève que ce garde-fou, et c'est l'autre moitié de l'invariant : la
    // fiche dont la lecture n'a pas répondu est retenue par une règle qu'aucune
    // autorisation ne regarde. Personne n'a autorisé quoi que ce soit à son sujet, et
    // ce qui la protège n'est pas un statut de run mais le fait que le passage ne
    // sache rien d'elle.
    expect(muette.retenuesSansReponse).toEqual([TRANSVERSE]);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(nommeesSansReponse(muette.runId)).toEqual([TRANSVERSE]);

    // Then la chute annoncée est de neuf et non de huit, alors que le passage n'a
    // résolu que huit personnes : celle qu'il retient faute de réponse est du
    // périmètre auquel il croit, il vient de refuser de la dater, et l'en retrancher
    // reviendrait à la compter partie du même souffle. Le relevé qu'il laisse porte le
    // même nombre, sans quoi le plancher de demain se comparerait à un effectif que la
    // panne aurait creusé.
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9, startedAt: NUITS[3] });

    // Then la trace dit les deux à la fois, sans que l'une chasse l'autre : ce que la
    // source a répondu en échouant, la décision qui a fait dater cette nuit-là, et le
    // refus que cette décision n'a pas levé.
    expect(ceQuiAEteDit(muette.runId)).toEqual([
      `${TRANSVERSE} : 500 Internal Server Error`,
      "chute du périmètre : 9 personnes contre 13 au dernier relevé complet, datation autorisée à la main pour ce passage",
      `${REFUS_DE_LECTURE} : ${TRANSVERSE} ; aucune disparition datée tant que la lecture échoue`,
    ]);
  });

  it("annonce le même effectif quelle que soit la façon dont une fiche manque, et laisse la sortie s'ouvrir", async () => {
    // Given un premier passage complet : treize personnes, et le relevé contre lequel
    // le plancher comparera tant qu'aucun autre passage ne se dira complet.
    await nuit(0);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });

    // When quatre personnes s'en vont réellement et que, les mêmes nuits, la fiche du
    // déclaré transverse cesse d'être lisible : la source échoue tantôt en jetant,
    // tantôt en répondant qu'elle ne connaît pas la fiche.
    const muette = await nuit(1, { fiche: "muette", omis: CHUTE });
    const avouee = await nuit(2, { fiche: "absente", omis: CHUTE });

    // Then les deux nuits ne retiennent pas la fiche par la même règle, et le disent :
    // l'une n'a rien appris d'elle, l'autre a reçu un aveu d'ignorance, et ce n'est
    // pas le même sursis.
    expect(muette.retenuesSansReponse).toEqual([TRANSVERSE]);
    expect(muette.retenues).toEqual([]);
    expect(avouee.retenues).toEqual([TRANSVERSE]);
    expect(avouee.retenuesSansReponse).toEqual([]);

    // Then elles annoncent pourtant le même effectif, et c'est ce qui se joue ici : une
    // fiche retenue est une fiche dont le passage ne conclut rien, quelle que soit la
    // façon dont il en est arrivé là. La retrancher un soir sur deux ferait osciller le
    // nombre montré à l'opératrice sans qu'aucun départ ne l'explique.
    expect(muette.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    expect(avouee.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When l'alternance dure une nuit de plus.
    const installe = await nuit(3, { fiche: "muette", omis: CHUTE });

    // Then le refus s'annonce installé et le bandeau s'ouvre. Un effectif qui oscille
    // ne retombe jamais deux fois sur les mêmes nombres, donc ne s'installe jamais :
    // le relevé gèlerait sans fin pendant que la seule sortie reste hors d'atteinte,
    // pour la seule raison que la source échoue de deux façons.
    expect(installe.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 3,
      },
    ]);

    // When une opératrice tranche sur les nombres que ce bandeau lui montre.
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const degel = await nuit(4, { fiche: "absente", omis: CHUTE });

    // Then les quatre départs réels reçoivent leur date, la fiche retenue non, et le
    // relevé avance en la comptant encore : neuf personnes tenues pour présentes, dont
    // une dont ce passage n'a rien conclu.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    expect(fiche(TRANSVERSE).vanishedAt).toBeNull();
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9, startedAt: NUITS[4] });

    // Then compter n'aura pas été conclure : le sursis de l'aveu se borne toujours à un
    // passage, et le suivant, qui ne la rend pas davantage, la date.
    const conclu = await nuit(5, { fiche: "absente", omis: CHUTE });
    expect(conclu.status).toBe("OK");
    expect(conclu.retenues).toEqual([]);
    expect(conclu.vanished).toBe(1);
    expect(fiche(TRANSVERSE).vanishedAt).toEqual(NUITS[5]);
  });

  it("mesure l'ampleur contre les nombres que la décision emporte, et non contre le dernier refus enregistré", async () => {
    // Given un relevé de treize et trois nuits que le plancher refuse à l'identique :
    // le bandeau s'ouvre, et il annonce neuf personnes contre treize.
    await nuit(0);
    for (const index of [1, 2, 3]) {
      await nuit(index, { omis: CHUTE });
    }
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 3,
      },
    ]);

    // Given une nuit qui creuse la chute pendant que l'écran ouvert devant l'opératrice
    // continue d'annoncer neuf : deux personnes de plus manquent à l'appel, et ce
    // refus-là est désormais le dernier que la base porte.
    const creux = await nuit(4, { omis: SIX });
    expect(creux.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 7,
      reference: 13,
      datables: 6,
    });

    // Given l'opératrice qui tranche sur les nombres qu'elle a sous les yeux, et sur eux
    // seuls : neuf contre treize, quatre départs qu'elle est allée vérifier un par un.
    autoriser(5, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When la chute du soir se place entre les deux : plus profonde que les neuf
    // examinés, moins profonde que les sept du creux.
    const rechute = await nuit(5, { omis: CINQ });

    // Then rien n'est daté. Mesurée contre le dernier refus que la base porte, cette
    // chute passait : huit est au-dessus des sept du creux, et la décision aurait daté
    // une personne que personne n'a jamais eue sous les yeux, en gravité haute. Mesurée
    // contre ce que la décision emporte, elle est écartée.
    expect(rechute.status).toBe("PARTIAL");
    expect(rechute.vanished).toBe(0);
    expect(rechute.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 8,
      reference: 13,
      datables: 5,
    });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);

    // Then la décision est écartée sous le nom de qui l'avait prise, et non dépensée :
    // la laisser attendre interdirait d'en poser une autre sur les nombres du soir.
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: rechute.runId });

    // When l'opératrice reprend sur les nombres du jour, que le bandeau annonce
    // désormais.
    autoriser(6, "cinq départs, dont le cinquième vérifié ce matin", {
      observe: 8,
      reference: 13,
      datables: 5,
    });
    const degel = await nuit(6, { omis: CINQ });

    // Then celle-là lève et date : la borne écarte les décisions dépassées, elle
    // n'éteint pas la sortie.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(5);
    expect(levees()).toHaveLength(1);

    // When une ligne d'avant la migration attend à son tour : trois personnes de plus
    // s'en vont, le plancher refuse contre le relevé de huit que le dégel a laissé, et
    // la décision qui attend ne dit pas sur quels nombres elle a été prise.
    const apresLeDegel = [...CINQ, "blandine.exemple", "gwendal.exemple", "hakim.exemple"];
    const apres = await nuit(7, { omis: apresLeDegel });
    expect(apres.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 5,
      reference: 8,
      datables: 3,
    });
    autoriserSansNombres(8, "décision d'avant que la ligne ne porte les nombres");
    const sansMesure = await nuit(8, { omis: apresLeDegel });

    // Then elle est écartée, et non levée : une décision qu'on ne sait pas mesurer ne
    // date rien, exactement comme celle dont l'ampleur montrée est dépassée. C'est le
    // seul comportement qui tienne l'invariant, et il vaut aussi pour les lignes que la
    // migration a laissées derrière elle.
    expect(sansMesure.status).toBe("PARTIAL");
    expect(sansMesure.vanished).toBe(0);
    expect(levees()).toHaveLength(1);
    expect(perimees()).toHaveLength(2);
  });

  it("écarte l'effondrement qu'aucune décision n'a examiné, si vieux que soit le refus montré", async () => {
    // Given un relevé de treize, trois nuits que le plancher refuse, et le bandeau qui
    // s'ouvre sur ces nombres-là.
    await nuit(0);
    for (const index of [1, 2, 3]) {
      await nuit(index, { omis: CHUTE });
    }
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 3,
      },
    ]);

    // Given une opératrice qui tranche sur ce que ce bandeau lui montre.
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When il passe autant de nuits dégradées que la fenêtre des refus répétés compte
    // de passages. Aucune n'atteint le plancher, donc aucune n'écrit de refus, donc
    // aucune ne résout la décision : elle attend toujours, et le refus qu'on lui avait
    // montré est sorti de la fenêtre que relit la phrase des chutes.
    for (const index of [4, 5, 6, 7, 8, 9, 10, 11]) {
      const degradee = await nuit(index, { omis: CHUTE, lecture: "amputée" });
      expect(degradee.chuteRefusee).toBeNull();
    }
    expect(base.autorisations[0]).toMatchObject({ consumedAt: null, consumedRunId: null });

    // When la nuit suivante est complète, et onze personnes manquent au lieu de quatre.
    const effondrement = await nuit(12, { omis: EFFONDREMENT_TOTAL });

    // Then personne n'est daté. La décision porte les neuf qu'on lui a montrés, la
    // chute du soir en compte deux, elle est donc plus profonde que ce qui a été
    // examiné : onze sorties de périmètre en gravité haute ne se prononcent pas sur
    // une phrase écrite pour quatre départs vérifiés un par un. L'âge du refus montré
    // n'y est pour rien, et c'est ce qui change ici : la mesure voyage avec la
    // décision, elle ne se cherche plus dans une fenêtre de passages.
    expect(effondrement.status).toBe("PARTIAL");
    expect(effondrement.vanished).toBe(0);
    expect(effondrement.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 2,
      reference: 13,
      datables: 11,
    });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);

    // Then la décision est écartée sous le nom de qui l'avait prise, et non laissée en
    // attente : l'écran refuse une seconde autorisation tant que la première attend, et
    // une borne qui enfermerait celle qui décide ne protégerait plus personne.
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: effondrement.runId });

    // When elle reprend sur les nombres du jour, que le bandeau annonce désormais.
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 2,
        reference: 13,
        datables: 11,
        passages: 12,
      },
    ]);
    autoriser(13, "sortie d'une startup entière, onze départs vérifiés ce matin", {
      observe: 2,
      reference: 13,
      datables: 11,
    });
    const degel = await nuit(13, { omis: EFFONDREMENT_TOTAL });

    // Then celle-là lève et date : la borne écarte les décisions dépassées, elle
    // n'éteint pas la sortie.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(11);
    expect(levees()).toHaveLength(1);
  });

  it("garde sa mesure au travers d'une fenêtre entière de nuits dégradées", async () => {
    // Given un relevé de treize, trois nuits que le plancher refuse, et une opératrice
    // qui tranche sur les nombres du bandeau.
    await nuit(0);
    for (const index of [1, 2, 3]) {
      await nuit(index, { omis: CHUTE });
    }
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // When il passe autant de nuits dégradées que la fenêtre des refus répétés compte
    // de passages, les quatre mêmes personnes manquant toujours : aucune n'atteint le
    // plancher, aucune n'écrit de refus, aucune ne résout la décision.
    for (const index of [4, 5, 6, 7, 8, 9, 10, 11]) {
      const degradee = await nuit(index, { omis: CHUTE, lecture: "amputée" });
      expect(degradee.chuteRefusee).toBeNull();
    }
    expect(base.autorisations[0]).toMatchObject({ consumedAt: null, consumedRunId: null });

    // When la nuit suivante est complète, et ce sont les quatre mêmes qui manquent.
    const degel = await nuit(12, { omis: CHUTE });

    // Then la décision lève et date, alors que rien de la chute n'a bougé depuis
    // qu'elle a été prise. C'est ce qu'une mesure cherchée dans la fenêtre des
    // passages relus perdait : le refus montré en sortait, l'ampleur n'était plus
    // retrouvable, et la décision était écartée sans qu'aucun nombre n'ait changé. Un
    // motif de nuits dégradées un peu plus long que cette fenêtre refermait ainsi la
    // seule sortie du gel, et l'élargir n'aurait fait que déplacer la frontière.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    for (const username of CHUTE) {
      expect(fiche(username).vanishedAt).toEqual(NUITS[12]);
    }
    expect(levees()).toEqual([{ action: "sync.gardefou.leve", targetId: "espace-membre" }]);
    expect(perimees()).toEqual([]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: degel.runId });

    // Then le relevé avance, et le bandeau se referme : la sortie a bien dénoué le gel
    // plutôt que de le reporter d'une nuit.
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9, startedAt: NUITS[12] });
    expect(blocagesAnnonces()).toEqual([]);
  });

  it("laisse derrière lui un relevé qui compte la fiche retenue, et le plancher de demain avec", async () => {
    // Given un premier passage complet de treize personnes.
    await nuit(0);

    // When la source répond qu'elle ne connaît pas la fiche du déclaré transverse, sans
    // que personne ne s'en aille par ailleurs.
    const aveu = await nuit(1, { fiche: "absente" });

    // Then le passage est complet, la fiche est retenue, et le relevé qu'il laisse
    // compte treize et non douze.
    expect(aveu.status).toBe("OK");
    expect(aveu.retenues).toEqual([TRANSVERSE]);
    expect(aveu.vanished).toBe(0);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[1] });

    // When quatre personnes s'en vont réellement la nuit suivante, la fiche du
    // transverse répondant de nouveau.
    const chute = await nuit(2, { omis: CHUTE });

    // Then le plancher refuse, et c'est le relevé de la veille qui le lui permet : un
    // relevé amputé de la fiche retenue l'aurait abaissé juste assez pour que ces
    // quatre départs passent sans que personne ne les examine.
    expect(chute.status).toBe("PARTIAL");
    expect(chute.vanished).toBe(0);
    expect(chute.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
  });

  it("ouvre la sortie même quand une nuit dégradée casse la série des refus identiques", async () => {
    // Given un relevé complet de treize personnes.
    await nuit(0);

    // When quatre personnes s'en vont réellement et ne reviennent pas, et qu'une nuit
    // sur trois se dégrade en plus par la porte de la liste illisible. C'est le motif
    // qui refermait la sortie : la nuit dégradée n'atteint jamais le plancher, sa trace
    // ne porte donc aucun refus, et le compte des refus identiques y repart de zéro.
    const chute = await nuit(1, { omis: CHUTE });
    const cassure = await nuit(2, { omis: CHUTE, lecture: "amputée" });
    const reprise = await nuit(3, { omis: CHUTE });

    expect(chute.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    expect(cassure.chuteRefusee).toBeNull();
    expect(reprise.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // Then les trois nuits ont laissé le relevé vieillir, chacune pour sa raison, et
    // c'est le même effet pour les trois : les règles adossées au périmètre décident
    // toujours contre le relevé de la première nuit.
    expect([chute, cassure, reprise].map((passage) => ageDuReleveDit(passage.runId))).toEqual([
      1, 2, 3,
    ]);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });

    // Then la sortie s'offre, et ce n'est pas l'ancien compte qui l'ouvre : les refus
    // identiques n'en sont qu'à un, la nuit dégradée du milieu ayant cassé la série. Le
    // nombre annoncé est l'âge du relevé, qui voit les cinq portes du gel là où le compte
    // des refus n'en voit qu'une.
    expect(refusIdentiques([reprise.runId, cassure.runId, chute.runId])).toBe(1);
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 3,
      },
    ]);

    // When une opératrice tranche sur les nombres que ce bandeau lui montre.
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const degel = await nuit(4, { omis: CHUTE });

    // Then ce passage-là date, une fois, et le relevé avance : le motif qui gelait tout
    // est rompu, et le bandeau se referme sur des nombres que plus rien ne refuse.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9, startedAt: NUITS[4] });
    expect(blocagesAnnonces()).toEqual([]);
    expect(levees()).toEqual([{ action: "sync.gardefou.leve", targetId: "espace-membre" }]);
  });

  it("n'offre rien quand le relevé gèle sans que le plancher en soit l'obstacle", async () => {
    // Given un relevé complet, puis trois nuits que la seule porte de la liste illisible
    // dégrade : personne ne s'en va, le périmètre ne fond pas, et le plancher n'a rien à
    // refuser. Le relevé gèle quand même, et tout ce qui s'y adosse avec lui.
    await nuit(0);
    const gelees = [];
    for (const index of [1, 2, 3]) {
      const passage = await nuit(index, { lecture: "amputée" });
      expect(passage.status).toBe("PARTIAL");
      expect(passage.chuteRefusee).toBeNull();
      gelees.push(passage);
    }

    // Then le gel est bien installé, et la fiche de chaque personne l'annonce déjà.
    expect(gelees.map((passage) => ageDuReleveDit(passage.runId))).toEqual([1, 2, 3]);
    expect(releveFige(3)).toBe(true);

    // Then le bandeau ne s'offre pas pour autant, et c'est le cas inverse de celui que
    // l'âge ouvre : le plancher n'est pas l'obstacle de ces nuits-là, le lever ne
    // renouvellerait aucun relevé, et la décision attendrait un refus que personne n'a
    // prononcé. Ce qui gèle ici se répare en amont, pas sous un nom d'opérateur.
    expect(blocagesAnnonces()).toEqual([]);

    // When une opératrice pose quand même une autorisation, sans que rien ne l'y invite.
    autoriser(4, "décision posée alors que rien ne la réclamait", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const encore = await nuit(4, { lecture: "amputée" });

    // Then elle dort, entière : la nuit reste dégradée par sa propre cause, rien n'est
    // daté, rien n'est consommé, et rien n'est périmé non plus, faute d'un passage qui
    // ait consulté le garde-fou auquel elle se rapporte.
    expect(encore.vanished).toBe(0);
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(base.autorisations[0]).toMatchObject({ consumedAt: null, consumedRunId: null });
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([]);
  });
  it("annonce ce que la datation toucherait, et non l'écart que les deux listes laissent deviner", async () => {
    // Given un relevé complet de treize personnes, celui contre lequel le plancher
    // comparera tant qu'aucun autre passage ne se dira complet.
    await nuit(0);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });

    // Given trois nuits dégradées pendant lesquelles sept personnes arrivent. C'est le
    // seul chemin praticable, et il suffit : la résolution amont tourne avant que le
    // statut du passage ne soit connu, si bien que ces nuits-là font naître sept fiches
    // sans que le relevé bouge d'un.
    for (const index of [1, 2, 3]) {
      await nuit(index, { omis: CHUTE, lecture: "amputée", renforts: RENFORTS });
    }
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt === null)).toHaveLength(20);

    // When une nuit complète ne rend plus ni les quatre partants ni les sept arrivants.
    const refus = await nuit(4, { omis: CHUTE });

    // Then le bandeau dit les deux tailles de listes, neuf contre treize, et il dit
    // aussi ce que la datation toucherait, qui est onze. Les deux mondes ne coïncident
    // pas : l'écart des listes se lit à quatre, le geste en date onze, et sans ce
    // troisième nombre c'est l'inférence de qui lit qui décide de l'ampleur.
    expect(refus.status).toBe("PARTIAL");
    expect(refus.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 11,
    });
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 11,
        passages: 4,
      },
    ]);

    // When une opératrice tranche sur les quatre départs que l'écart lui suggérait, et
    // sur eux seuls.
    autoriser(5, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const ecartee = await nuit(5, { omis: CHUTE });

    // Then rien n'est daté. C'est le geste que ce lot ferme : les nombres du plancher
    // sont ceux qu'elle a examinés, et pourtant onze fiches seraient constatées parties,
    // dont sept que personne n'a jamais eues sous les yeux.
    expect(ecartee.status).toBe("PARTIAL");
    expect(ecartee.vanished).toBe(0);
    expect(base.fiches.filter((candidate) => candidate.vanishedAt !== null)).toEqual([]);
    expect(levees()).toEqual([]);

    // Then la décision est écartée sous le nom de qui l'avait prise, et non laissée en
    // attente : l'écran refuse une seconde autorisation tant que la première attend, et
    // la borne enfermerait celle qui décide au lieu de la protéger.
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);
    expect(base.autorisations[0]).toMatchObject({ consumedRunId: ecartee.runId });

    // When elle reprend sur les nombres du jour, que le bandeau lui montre en entier.
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 11,
        passages: 5,
      },
    ]);
    autoriser(6, "onze départs, les sept arrivées de la panne comprises, vérifiés ce matin", {
      observe: 9,
      reference: 13,
      datables: 11,
    });
    const degel = await nuit(6, { omis: CHUTE });

    // Then celle-là lève et date les onze, qui est exactement le geste examiné : la
    // borne écarte ce qu'on n'a pas regardé, elle n'éteint pas la sortie.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(11);
    expect(levees()).toHaveLength(1);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9, startedAt: NUITS[6] });
    expect(blocagesAnnonces()).toEqual([]);
  });

  it("écarte la décision qu'une fiche adossée a débordée sans que ni le relevé ni la liste ne bougent", async () => {
    // Given un relevé complet de treize personnes, et une fiche écrite à la main pour
    // nommer un compte partagé. Aucune source amont ne la réclame : elle ne tient que
    // par ce compte, et elle n'entre dans aucun des deux nombres du plancher.
    const partage = poserFicheLocale("compte.partage");
    await nuit(0);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });

    // When quatre personnes s'en vont d'un coup, et que le refus s'installe.
    let refus = await nuit(1, { omis: CHUTE });
    for (const index of [2, 3]) {
      refus = await nuit(index, { omis: CHUTE });
    }

    // Then le bandeau annonce quatre, et il a raison : la fiche adossée est encore
    // tenue, donc la datation ne la toucherait pas.
    expect(refus.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 3,
      },
    ]);

    // When l'opératrice tranche sur ces quatre départs, puis le dernier compte de la
    // fiche adossée s'éteint. Rien de ce que le plancher regarde n'a bougé : la source
    // rend toujours les mêmes neuf personnes, et le relevé est toujours celui de treize.
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    partage.compteVivant = false;
    const ecartee = await nuit(4, { omis: CHUTE });

    // Then la décision est écartée sans rien dater, et c'est le seul axe où le troisième
    // nombre est le seul garde. Les deux autres sont identiques à ceux qu'elle a
    // examinés, si bien qu'une borne qui ne mesurerait que la taille des listes aurait
    // levé et daté cinq personnes, dont une que le bandeau n'a jamais montrée et qu'un
    // opérateur avait écrite à la main.
    expect(ecartee.status).toBe("PARTIAL");
    expect(ecartee.vanished).toBe(0);
    expect(ecartee.chuteRefusee).toMatchObject({ observe: 9, reference: 13, datables: 5 });
    expect(partage.vanishedAt).toBeNull();
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);

    // When elle reprend sur les cinq que le bandeau annonce désormais.
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "releve",
        observe: 9,
        reference: 13,
        datables: 5,
        passages: 4,
      },
    ]);
    autoriser(5, "quatre départs et le compte partagé fermé, vérifiés ce matin", {
      observe: 9,
      reference: 13,
      datables: 5,
    });
    const degel = await nuit(5, { omis: CHUTE });

    // Then celle-là lève et date les cinq, la fiche adossée comprise : la borne écarte
    // ce que personne n'a regardé, elle n'interdit pas de le regarder.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(5);
    expect(partage.vanishedAt).toEqual(NUITS[5]);
    expect(levees()).toHaveLength(1);
  });

  it("refuse sans rien dater quand le comptage lui-même ne répond pas", async () => {
    // Given un relevé complet de treize personnes.
    await nuit(0);

    // When la base cesse de répondre au seul comptage de ce que la datation toucherait,
    // la nuit où quatre personnes s'en vont.
    base.panneDeComptage = true;
    const aveugle = await nuit(1, { omis: CHUTE });

    // Then le passage se referme quand même, et il refuse : ce comptage est une requête
    // de plus sur un chemin qui vit hors du filet du passage, et un refus est déjà la
    // conclusion sûre. Le faire échouer ici ajouterait un mode d'échec à un passage qui
    // a tout ce qu'il lui faut pour conclure ce qu'il conclut.
    expect(aveugle.status).toBe("PARTIAL");
    expect(aveugle.vanished).toBe(0);
    expect(aveugle.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
    });
    expect(aveugle.chuteRefusee?.datables).toBeUndefined();
    // Then il le dit, à côté du refus qu'il explique. C'est la seule ligne qui sépare
    // ces nuits-là de nuits de refus ordinaires : sans elle, une opératrice verrait ses
    // décisions écartées l'une après l'autre sans que rien nulle part ne dise que c'est
    // le comptage qui manque.
    expect(ceQuiAEteDit(aveugle.runId)).toEqual([
      "chute du périmètre : 9 personnes contre 13 au dernier relevé complet, aucune disparition datée",
      `${AMPLEUR_NON_COMPTEE} : ce qu'une datation toucherait n'a pas pu être compté, aucune décision ne se mesurera tant que ce compte échouera`,
      `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du 2026-09-01, laissé un passage en arrière`,
    ]);

    // When une opératrice tranche quand même, et que la panne dure.
    autoriser(2, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const encore = await nuit(2, { omis: CHUTE });

    // Then rien ne lève : pas de nombre veut dire pas d'ampleur à mesurer, donc pas de
    // datation. C'est le même sens sûr que pour les deux autres nombres, et la décision
    // est écartée plutôt que laissée à dormir, faute de quoi la sortie se refermerait.
    expect(encore.vanished).toBe(0);
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([{ action: "sync.gardefou.perime", targetId: "espace-membre" }]);
    expect(ceQuiAEteDit(encore.runId)).toContain(
      `${AMPLEUR_NON_COMPTEE} : ce qu'une datation toucherait n'a pas pu être compté, aucune décision ne se mesurera tant que ce compte échouera`,
    );

    // When la base répond de nouveau et que l'opératrice reprend sur les nombres du jour.
    base.panneDeComptage = false;
    const revenue = await nuit(3, { omis: CHUTE });
    expect(revenue.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "releve",
      observe: 9,
      reference: 13,
      datables: 4,
    });
    autoriser(4, "les mêmes quatre départs, vérifiés une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const degel = await nuit(4, { omis: CHUTE });

    // Then celle-là lève et date : la panne aura coûté des nuits, pas la sortie.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    expect(levees()).toHaveLength(1);
  });
  it("refuse la datation en bloc que deux relevés semblables laissaient passer, et la rouvre une fois examinée", async () => {
    // Given un relevé complet de treize personnes, celui contre lequel le premier
    // déclencheur comparera tant qu'aucun autre passage ne se dira complet.
    await nuit(0);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });

    // Given trois nuits dégradées pendant lesquelles dix-sept personnes arrivent. La
    // résolution amont tourne avant que le statut du passage ne soit connu : ces nuits
    // font naître dix-sept fiches sans que le relevé bouge d'un.
    for (const index of [1, 2, 3]) {
      await nuit(index, { lecture: "amputée", renforts: VAGUE });
    }
    expect(releveDeReference()).toMatchObject({ itemsSeen: 13, startedAt: NUITS[0] });
    expect(base.fiches.filter((candidate) => candidate.vanishedAt === null)).toHaveLength(30);

    // When une nuit complète rend les treize du relevé, et plus aucun des renforts.
    const refus = await nuit(4);

    // Then les deux tailles de listes se ressemblent trait pour trait, treize contre
    // treize, et le déclencheur du relevé n'a rien à dire. C'est la base qui parle :
    // dix-sept fiches partiraient d'un seul geste, sur une population de trente.
    expect(refus.seen).toBe(13);
    expect(refus.status).toBe("PARTIAL");
    expect(refus.vanished).toBe(0);
    expect(refus.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "population",
      observe: 13,
      reference: 30,
      datables: 17,
    });

    // Then la trace le dit dans les termes de ce côté-là : la phrase du relevé y
    // annoncerait un dernier passage complet qui n'a rien à voir avec ce refus.
    expect(ceQuiAEteDit(refus.runId)).toContain(
      "chute du périmètre : la datation ferait partir 17 personnes sur les 30 tenues pour présentes, il n'en resterait que 13, aucune disparition datée",
    );

    // Then le bandeau s'ouvre, et il porte le côté jusqu'à l'écran qui le rédige.
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "population",
        observe: 13,
        reference: 30,
        datables: 17,
        passages: 4,
      },
    ]);

    // When une opératrice tranche sur les dix-sept, qui est le geste qu'on lui montre.
    autoriser(5, "les dix-sept renforts de la panne, tous sortis du dispositif", {
      observe: 13,
      reference: 30,
      datables: 17,
    });
    const degel = await nuit(5);

    // Then la datation a lieu, et elle vaut exactement ce qui a été examiné.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(17);
    expect(levees()).toHaveLength(1);
    expect(blocagesAnnonces()).toEqual([]);

    // Then le motif se referme et ne revient pas : ce déclencheur-là compare à une
    // population que la datation vient de ramener à treize, et sa référence se corrige
    // donc d'elle-même dès qu'un passage date. Trois nuits de plus pour le dire.
    for (const index of [6, 7, 8]) {
      const apres = await nuit(index);
      expect(apres.status).toBe("OK");
      expect(apres.chuteRefusee).toBeNull();
      expect(apres.vanished).toBe(0);
    }
    expect(blocagesAnnonces()).toEqual([]);
  });

  it("ne date rien la nuit où le comptage tombe sans que le relevé ait rien à redire, et n'y dépense pas la décision qui attend", async () => {
    // Given le même creux que ci-dessus : un relevé de treize, trois nuits dégradées
    // qui font naître dix-sept fiches, et une population de trente qu'aucune liste ne
    // réclame plus qu'à moitié.
    await nuit(0);
    for (const index of [1, 2, 3]) {
      await nuit(index, { lecture: "amputée", renforts: VAGUE });
    }
    expect(base.fiches.filter((candidate) => candidate.vanishedAt === null)).toHaveLength(30);

    // Given une opératrice qui a déjà tranché sur les dix-sept, sur les nombres mêmes
    // que le refus de ce soir montrerait.
    autoriser(4, "les dix-sept renforts de la panne, tous sortis du dispositif", {
      observe: 13,
      reference: 30,
      datables: 17,
    });

    // When la base cesse de répondre au seul comptage de ce qu'une datation ferait, la
    // nuit où une réponse par ailleurs complète rend les treize du relevé.
    base.panneDeComptage = true;
    const aveugle = await nuit(4);

    // Then rien n'est daté. Les deux tailles de listes se ressemblent, donc le premier
    // déclencheur n'a rien à redire, et sans ce compte le second n'a rien contre quoi
    // juger le geste du soir : le passage se dégrade au lieu de conclure. Le laisser
    // passer daterait les dix-sept d'un coup, sur une nuit que personne n'a examinée,
    // ce qui est exactement ce que ce déclencheur existe pour retenir.
    expect(aveugle.seen).toBe(13);
    expect(aveugle.status).toBe("PARTIAL");
    expect(aveugle.vanished).toBe(0);
    expect(aveugle.chuteRefusee).toBeNull();
    expect(base.fiches.filter((candidate) => candidate.vanishedAt === null)).toHaveLength(30);

    // Then il le dit, et c'est la seule ligne qui sépare cette nuit-là d'une nuit
    // complète ordinaire : sans elle, une nuit qui n'a rien conclu ne se distingue plus
    // d'une nuit où il n'y avait rien à conclure.
    expect(ceQuiAEteDit(aveugle.runId)).toContain(
      `${AMPLEUR_NON_COMPTEE} : ce qu'une datation toucherait n'a pas pu être compté, aucune disparition datée`,
    );

    // Then rien n'est offert à l'écran, et c'est juste : aucun garde-fou n'a refusé, il
    // n'y a donc rien à lever et rien sur quoi trancher.
    expect(blocagesAnnonces()).toEqual([]);

    // Then la décision qui attendait attend toujours : cette nuit n'a rien constaté de
    // l'état auquel elle se rapporte, et la périmer là-dessus la ferait perdre pour
    // rien, sur une panne qui ne dit rien de ce qu'elle a examiné.
    expect(levees()).toEqual([]);
    expect(perimees()).toEqual([]);
    expect(base.autorisations.filter((posee) => posee.consumedAt === null)).toHaveLength(1);

    // When la base répond de nouveau, sur le même creux.
    base.panneDeComptage = false;
    const degel = await nuit(5);

    // Then le second déclencheur refuse comme il l'aurait fait la veille, la décision
    // d'hier le lève, et les dix-sept partent : la panne aura coûté une nuit, pas la
    // sortie.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(17);
    expect(levees()).toHaveLength(1);
    expect(blocagesAnnonces()).toEqual([]);
  });

  it("ouvre la sortie au refus qui tombe avant que le moindre passage ne se soit dit complet", async () => {
    // Given trois nuits dégradées, et pas une seule qui se soit dite complète : treize
    // fiches naissent, et aucun relevé n'existe. C'est ce que voit une installation
    // neuve, une base restaurée sans historique de passages, ou un fournisseur qu'on
    // vient de changer.
    for (const index of [0, 1, 2]) {
      await nuit(index, { lecture: "amputée" });
    }
    expect(releveDeReference()).toBeNull();
    expect(base.fiches.filter((candidate) => candidate.vanishedAt === null)).toHaveLength(13);

    // When une nuit par ailleurs complète cesse de rendre quatre personnes sur treize.
    const refus = await nuit(3, { omis: CHUTE });

    // Then c'est la population qui refuse, et elle seule : le premier déclencheur
    // compare à un relevé qui n'existe pas, donc à zéro, et rien ne tombe jamais de
    // zéro. Le second, lui, ne lit pas le relevé.
    expect(refus.status).toBe("PARTIAL");
    expect(refus.vanished).toBe(0);
    expect(refus.chuteRefusee).toEqual({
      famille: "perimetre",
      cote: "population",
      observe: 9,
      reference: 13,
      datables: 4,
    });

    // Then l'âge se compte quand même, et c'est ce qui ouvre la sortie. Se taire faute
    // de relevé enfermerait l'opératrice pour de bon : le refus dégrade le passage, un
    // passage dégradé ne se dit pas complet, et sans passage complet il n'y aurait ni
    // âge, ni bandeau, ni formulaire. La seule issue restante serait une datation en
    // bloc, le jour où l'amont rerendrait les manquants, sans que personne ait rien
    // examiné.
    expect(ageDuReleveDit(refus.runId)).toBe(4);
    expect(releveFige(4)).toBe(true);
    expect(ceQuiAEteDit(refus.runId)).toContain(
      `${RELEVE_NON_RENOUVELE} : aucun passage ne s'est encore dit complet, et les règles adossées au périmètre décident donc sans relevé depuis 4 passages : ce n'est plus un incident, et plus rien de ce qui s'y adosse ne décide sur l'état du jour`,
    );
    expect(blocagesAnnonces()).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        cote: "population",
        observe: 9,
        reference: 13,
        datables: 4,
        passages: 4,
      },
    ]);

    // When une opératrice tranche sur les quatre que le bandeau lui montre.
    autoriser(4, "quatre fins de mission groupées, vérifiées une par une", {
      observe: 9,
      reference: 13,
      datables: 4,
    });
    const degel = await nuit(4, { omis: CHUTE });

    // Then les quatre partent, et le passage laisse enfin le premier relevé complet
    // derrière lui : le motif se referme, et les deux déclencheurs ont désormais chacun
    // leur référence.
    expect(degel.status).toBe("OK");
    expect(degel.vanished).toBe(4);
    expect(levees()).toHaveLength(1);
    expect(releveDeReference()).toMatchObject({ itemsSeen: 9 });
    expect(blocagesAnnonces()).toEqual([]);

    const apres = await nuit(5, { omis: CHUTE });
    expect(apres.status).toBe("OK");
    expect(apres.chuteRefusee).toBeNull();
  });
});
