import { beforeEach, describe, expect, it, vi } from "vitest";

import { REFUS_D_ECHEANCE, REFUS_DE_DISPARITION, REFUS_DE_RETOUR } from "@/core/collecte";
import type { MembreDetaille, MembreIncubateur } from "@/core/membre";

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
}

const base = vi.hoisted(() => ({
  runs: [] as RunEnBase[],
  fiches: [] as FicheEnBase[],
  membres: [] as unknown[],
  erreursDeLecture: [] as string[],
  details: new Map<string, unknown>(),
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
      }: {
        where: { provider: string; capability: string; status: string };
      }) => {
        const candidats = base.runs
          .filter(
            (run) =>
              run.provider === where.provider &&
              run.capability === where.capability &&
              run.status === where.status,
          )
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return Promise.resolve(candidats[0] ?? null);
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
        return Promise.resolve(trouvee ? { ...trouvee } : null);
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
      // à un compte porte `source`, celle des dernières vues porte une liste de noms.
      // Les confondre pour rendre toujours une liste vide ne retiendrait jamais
      // personne, et les tests du sursis passeraient pour la mauvaise raison.
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        const parNom = where["username"] as { in: string[] } | undefined;
        if (!parNom) {
          return Promise.resolve([]);
        }
        return Promise.resolve(
          base.fiches.filter(
            (fiche) =>
              parNom.in.includes(fiche.username) &&
              fiche.vanishedAt === null &&
              fiche.source !== "SERVICE",
          ),
        );
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { username: { notIn: string[] } };
        data: { vanishedAt: Date };
      }) => {
        const touchees = base.fiches.filter(
          (fiche) =>
            !where.username.notIn.includes(fiche.username) &&
            fiche.vanishedAt === null &&
            fiche.source !== "SERVICE",
        );
        for (const fiche of touchees) {
          fiche.vanishedAt = data.vanishedAt;
        }
        return Promise.resolve({ count: touchees.length });
      },
    },
  },
}));

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
  fetchMemberDetail: (username: string) => Promise.resolve(base.details.get(username) ?? null),
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

vi.mock("@/lib/audit", () => ({ audit: () => undefined }));

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

/** Dix nuits consécutives du traitement quotidien, à son heure de cron. */
const NUITS = Array.from(
  { length: 10 },
  (_, index) => new Date(Date.UTC(2026, 8, 1 + index, 4, 30, 0)),
);

/**
 * Un passage de collecte, et les trois façons d'y perdre quelqu'un.
 *
 * `fiche` et `parEquipe` disent si la source répond encore sur une fiche complète : un
 * 404 nomme celle qui manque, c'est le chemin de l'aveu d'ignorance. `omis` fait
 * manquer une personne à une réponse par ailleurs valide, sans 404, sans erreur et
 * sans trace : c'est le chemin silencieux, et c'est celui qui concerne l'incubateur
 * entier. `lecture` dégrade le passage sans rien lui faire perdre.
 */
async function nuit(
  index: number,
  options: {
    fiche?: "présente" | "absente";
    parEquipe?: "présente" | "absente";
    omis?: readonly string[];
    lecture?: "intacte" | "amputée";
  } = {},
) {
  const omis = options.omis ?? [];
  base.membres = RATTACHES.filter((prenom) => !omis.includes(`${prenom}.exemple`)).map(membre);
  if (options.parEquipe) {
    base.membres.push(MEMBRE_PAR_EQUIPE);
  }
  base.details = new Map<string, unknown>();
  if (options.fiche !== "absente") {
    base.details.set(TRANSVERSE, FICHE_TRANSVERSE);
  }
  if (options.parEquipe === "présente") {
    base.details.set(PAR_EQUIPE, FICHE_PAR_EQUIPE);
  }
  base.erreursDeLecture =
    options.lecture === "amputée"
      ? ["membres de l'incubateur : élément 4 illisible (username requis)"]
      : [];

  const passage = NUITS[index];
  if (!passage) {
    throw new Error("nuit inconnue");
  }
  return syncPerimetre(passage, `correlation-${index}`);
}

function fiche(username: string): FicheEnBase {
  const trouvee = base.fiches.find((candidate) => candidate.username === username);
  if (!trouvee) {
    throw new Error(`la fiche de ${username} devrait exister`);
  }
  return trouvee;
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
