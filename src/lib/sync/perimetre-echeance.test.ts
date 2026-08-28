import { beforeEach, describe, expect, it, vi } from "vitest";

import { REFUS_D_ECHEANCE } from "@/core/collecte";
import type { MembreDetaille, MembreIncubateur } from "@/core/membre";
import { statutDe } from "@/core/statut";

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
  missionEnd: Date | null;
}

const base = vi.hoisted(() => ({
  runs: [] as RunEnBase[],
  fiches: [] as FicheEnBase[],
  membres: [] as unknown[],
  details: new Map<string, unknown>(),
  pannes: new Set<string>(),
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
      findUnique: ({ where }: { where: { username: string } }) => {
        const trouvee = base.fiches.find((fiche) => fiche.username === where.username);
        return Promise.resolve(trouvee ? { ...trouvee } : null);
      },
      // Prisma laisse intact un champ à `undefined` au lieu de l'écrire, et c'est
      // exactement la sémantique dont cette règle se sert. Un fac-similé qui recopierait
      // tout mentirait dans le sens rassurant.
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
      // Une colonne nullable qu'aucune écriture ne renseigne vaut `null` : la création
      // n'a rien à conserver, c'est ce que le second scénario vient éprouver.
      create: ({ data }: { data: Record<string, unknown> }) => {
        base.sequence += 1;
        const fiche = {
          id: `fiche-${base.sequence}`,
          missionEnd: null,
        } as unknown as FicheEnBase;
        for (const [cle, valeur] of Object.entries(data)) {
          if (valeur !== undefined) {
            Object.assign(fiche, { [cle]: valeur });
          }
        }
        base.fiches.push(fiche);
        return Promise.resolve(fiche);
      },
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
  fetchIncubatorMembers: () => Promise.resolve({ items: base.membres, erreurs: [] }),
  // Deux façons d'échouer, et l'écriture ne doit dépendre ni de l'une ni de l'autre :
  // un 404 rend `null` et laisse le passage complet, tout le reste jette et le dégrade.
  fetchMemberDetail: (username: string) => {
    if (base.pannes.has(username)) {
      return Promise.reject(new Error(`${username} : 500 Internal Server Error`));
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
    scope: { incubator: "mon-incubateur", transverse: [], local: [] },
    thresholds: { maxScopeDrop: 0.2 },
  }),
}));

vi.mock("@/lib/audit", () => ({ audit: () => undefined }));

/** Rattachée par une équipe seule : la liste scopée ne porte aucune de ses missions. */
const PAR_EQUIPE = "camille.exemple";

/** Rattachée par les deux voies, sa mission beta.gouv allant plus loin que sa startup. */
const DEUX_VOIES = "yasmine.exemple";

/** Idem, mais sa fiche complète ne date aucune fin : la liste, elle, en date une. */
const DEUX_VOIES_SANS_FIN = "hugo.exemple";

/** Rattachée par une startup : son échéance ne dépend d'aucune fiche complète. */
const TEMOIN = "elias.exemple";

/**
 * Entrée au périmètre pendant la panne, et des deux voies à dessein : la liste scopée
 * lui date une fin, que la règle refuse d'écrire. Par une équipe seule, elle n'aurait
 * eu aucune date à recevoir avant la règle comme après, et le test se serait donné le
 * seul cas où la règle ne coûte rien.
 */
const ENTRANTE = "sofia.exemple";

/** Le reste du périmètre, qui n'existe que pour qu'aucun garde-fou de chute ne parle. */
const FIGURANTS = ["blandine", "gwendal", "hakim", "ines", "maelys", "noe", "sacha", "solene"];

const FIN_SCOPEE = "2026-09-30T00:00:00.000Z";

function parStartup(prenom: string): MembreIncubateur {
  return {
    username: `${prenom}.exemple`,
    uuid: `uuid-${prenom}`,
    fullname: `${prenom} Exemple`,
    primary_email: `${prenom}.exemple@beta.gouv.fr`,
    attachment: "startups",
    missions: [{ end: FIN_SCOPEE, startups: [{ ghid: "produit-alpha" }] }],
  };
}

function parEquipe(username: string): MembreIncubateur {
  return {
    username,
    uuid: `uuid-${username}`,
    fullname: username,
    primary_email: `${username}@beta.gouv.fr`,
    attachment: "teams",
    missions: [],
  };
}

function desDeuxVoies(username: string): MembreIncubateur {
  return {
    username,
    uuid: `uuid-${username}`,
    fullname: username,
    primary_email: `${username}@beta.gouv.fr`,
    attachment: "both",
    missions: [{ end: FIN_SCOPEE, startups: [{ ghid: "produit-alpha" }] }],
  };
}

function ficheComplete(username: string, fin: string | null): MembreDetaille {
  return {
    username,
    uuid: `uuid-${username}`,
    fullname: username,
    primary_email: `${username}@beta.gouv.fr`,
    missions: [{ end: fin }],
  };
}

const FICHES = new Map<string, MembreDetaille>([
  [PAR_EQUIPE, ficheComplete(PAR_EQUIPE, "2027-03-31T00:00:00.000Z")],
  [DEUX_VOIES, ficheComplete(DEUX_VOIES, "2028-06-30T00:00:00.000Z")],
  [DEUX_VOIES_SANS_FIN, ficheComplete(DEUX_VOIES_SANS_FIN, null)],
  [ENTRANTE, ficheComplete(ENTRANTE, "2029-01-31T00:00:00.000Z")],
]);

const NUITS = Array.from(
  { length: 4 },
  (_, index) => new Date(Date.UTC(2026, 8, 1 + index, 4, 30)),
);

/**
 * Un passage de collecte, et les deux façons d'y perdre une fiche complète.
 *
 * `chemin` dit laquelle : `"404"` nomme la fiche manquante et laisse le passage
 * complet, `"panne"` jette et le dégrade.
 */
async function nuit(
  index: number,
  options: {
    sansFiche?: readonly string[];
    chemin?: "404" | "panne";
    entrante?: boolean;
    finRevue?: { qui: string; date: string };
  } = {},
) {
  base.membres = [
    ...FIGURANTS.map(parStartup),
    parStartup("elias"),
    parEquipe(PAR_EQUIPE),
    desDeuxVoies(DEUX_VOIES),
    desDeuxVoies(DEUX_VOIES_SANS_FIN),
    ...(options.entrante ? [desDeuxVoies(ENTRANTE)] : []),
  ];

  const absentes = new Set(options.sansFiche ?? []);
  base.pannes = new Set(options.chemin === "panne" ? absentes : []);
  base.details = new Map<string, unknown>();
  for (const [nom, fiche] of FICHES) {
    if (!absentes.has(nom)) {
      base.details.set(
        nom,
        options.finRevue?.qui === nom ? ficheComplete(nom, options.finRevue.date) : fiche,
      );
    }
  }

  const passage = NUITS[index];
  if (!passage) {
    throw new Error("nuit inconnue");
  }
  return syncPerimetre(passage, `correlation-${index}`);
}

function echeance(username: string): Date | null {
  const trouvee = base.fiches.find((candidate) => candidate.username === username);
  if (!trouvee) {
    throw new Error(`la fiche de ${username} devrait exister`);
  }
  return trouvee.missionEnd;
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

const SEUILS = { graceDays: 15, soonDays: 30, staleDays: 180 };
const LE_JOUR_DIT = new Date("2026-09-02T12:00:00Z");

/**
 * L'échéance décide qui sort. Sans elle, une personne est `SANS_ECHEANCE` : jamais
 * `BIENTOT`, jamais `EN_SURSIS`, jamais `A_TRAITER`, donc aucune file ne la propose et
 * aucun opérateur n'ouvre son départ. Aucun constat ne prend le relais, `SCOPE_EXIT`
 * naissant d'une disparition et non d'une échéance. Ce qu'un passage écrit ici sans
 * l'avoir lu se paie donc en accès qui restent ouverts, sans que rien ne le dise.
 */
describe("ce qu'un passage écrit d'une échéance qu'il n'a pas su relire", () => {
  beforeEach(() => {
    base.runs.length = 0;
    base.fiches.length = 0;
    base.pannes = new Set();
    base.sequence = 0;
  });

  it("la garde sur les deux voies, ne gèle rien d'autre, le dit, et dégèle dès que la source répond", async () => {
    // Given un périmètre entier et lisible, avec les trois formes du piège côte à côte :
    // une rattachée par une équipe seule, dont la liste ne porte aucune mission ; une
    // rattachée par les deux voies dont la mission beta.gouv déborde sa startup de
    // vingt et un mois ; une autre des deux voies dont la fiche ne date aucune fin. Et
    // un témoin qui n'entre que par la liste scopée.
    const premier = await nuit(0);
    expect(premier.status).toBe("OK");
    expect(premier.echeancesNonEcrites).toEqual([]);
    expect(echeance(PAR_EQUIPE)).toEqual(new Date("2027-03-31T00:00:00Z"));
    expect(echeance(DEUX_VOIES)).toEqual(new Date("2028-06-30T00:00:00Z"));
    expect(echeance(DEUX_VOIES_SANS_FIN)).toBeNull();
    expect(echeance(TEMOIN)).toEqual(new Date("2026-09-30T00:00:00Z"));

    // When la nuit suivante ne rend plus aucune de leurs fiches complètes. Le piège est
    // là : la liste scopée les rend toutes les trois, elles restent du périmètre, le
    // passage est complet, aucune erreur n'est levée et aucun seuil n'est franchi.
    const muet = await nuit(1, {
      sansFiche: [PAR_EQUIPE, DEUX_VOIES, DEUX_VOIES_SANS_FIN],
      chemin: "404",
    });

    expect(muet.status).toBe("OK");
    expect(muet.errors).toEqual([]);
    expect(muet.vanished).toBe(0);

    // Then les trois échéances sont exactement celles de la veille. Aucune n'est
    // effacée, ce qui rendrait la première sans échéance à jamais ; aucune n'est
    // raccourcie à la seule voie startup ; aucune n'est inventée là où la fiche n'en
    // portait pas. Une date vieille d'un jour est strictement plus informative qu'une
    // date fausse ou qu'un vide.
    expect(echeance(PAR_EQUIPE)).toEqual(new Date("2027-03-31T00:00:00Z"));
    expect(echeance(DEUX_VOIES)).toEqual(new Date("2028-06-30T00:00:00Z"));
    expect(echeance(DEUX_VOIES_SANS_FIN)).toBeNull();

    // Then leurs statuts n'ont pas bougé non plus, et c'est ce qui se voit vraiment :
    // sans cette règle les trois basculaient la même nuit, deux vers un départ
    // prématuré et une hors de toutes les files.
    expect(statutDe(echeance(PAR_EQUIPE), LE_JOUR_DIT, SEUILS)).toBe("ACTIF");
    expect(statutDe(echeance(DEUX_VOIES), LE_JOUR_DIT, SEUILS)).toBe("ACTIF");
    expect(statutDe(echeance(DEUX_VOIES_SANS_FIN), LE_JOUR_DIT, SEUILS)).toBe("SANS_ECHEANCE");

    // Then le silence est ciblé et non général : le témoin est réécrit comme toutes les
    // nuits, et les trois autres aussi pour tout le reste de leur fiche. Une collecte
    // qui cesserait d'écrire dès qu'une lecture manque serait une autre panne.
    expect(echeance(TEMOIN)).toEqual(new Date("2026-09-30T00:00:00Z"));
    expect(muet.updated).toBe(12);

    // Then le passage dit ce qu'il a gardé, et pour qui, sans nommer le témoin : une
    // échéance conservée ressemble trait pour trait à une échéance fraîche, si bien que
    // sans cette phrase, la nuit où les accès cessent d'expirer ressemble à une nuit
    // ordinaire.
    expect(muet.echeancesNonEcrites).toEqual([PAR_EQUIPE, DEUX_VOIES, DEUX_VOIES_SANS_FIN]);
    expect(ceQuiAEteDit(muet.runId)).toEqual([
      `${REFUS_D_ECHEANCE} : ${PAR_EQUIPE}, ${DEUX_VOIES}, ${DEUX_VOIES_SANS_FIN} ; fiche complète non lue`,
    ]);

    // When la source répond de nouveau, et l'échéance de la première a été raccourcie
    // en amont entre-temps.
    const relu = await nuit(2, {
      finRevue: { qui: PAR_EQUIPE, date: "2026-09-15T00:00:00.000Z" },
    });

    // Then la conservation n'était qu'un sursis : le passage suivant écrit ce qu'il
    // lit, y compris un raccourcissement qui fait sortir quelqu'un. Rien n'a été perdu,
    // seulement retardé d'une nuit, et le passage cesse de le dire.
    expect(echeance(PAR_EQUIPE)).toEqual(new Date("2026-09-15T00:00:00Z"));
    expect(statutDe(echeance(PAR_EQUIPE), LE_JOUR_DIT, SEUILS)).toBe("BIENTOT");
    expect(relu.echeancesNonEcrites).toEqual([]);
    expect(ceQuiAEteDit(relu.runId)).toEqual([]);
  });

  it("conserve pareil quand la lecture jette au lieu de répondre, et n'a rien à conserver d'une entrante", async () => {
    // Given le même périmètre, vu et daté par un passage complet.
    await nuit(0);
    expect(echeance(DEUX_VOIES)).toEqual(new Date("2028-06-30T00:00:00Z"));

    // When la fiche complète ne répond plus par un 404 mais par une panne, qui jette :
    // le passage se dégrade et nomme les personnes dans ses erreurs. C'est le chemin le
    // plus fréquent des deux, et le garde-fou de dégradation ne le couvre pas : il
    // protège les disparitions, pas les colonnes, l'écriture ayant lieu avant lui. Et
    // pendant cette panne, une personne rattachée par une équipe entre au périmètre.
    const panne = await nuit(1, {
      sansFiche: [PAR_EQUIPE, DEUX_VOIES, DEUX_VOIES_SANS_FIN, ENTRANTE],
      chemin: "panne",
      entrante: true,
    });

    expect(panne.status).toBe("PARTIAL");
    expect(panne.errors).toHaveLength(4);

    // Then ce qui était connu est conservé, exactement comme sur l'autre chemin : ce
    // qui décide n'est pas la façon dont la lecture a manqué, c'est qu'on écrive sans
    // elle.
    expect(echeance(PAR_EQUIPE)).toEqual(new Date("2027-03-31T00:00:00Z"));
    expect(echeance(DEUX_VOIES)).toEqual(new Date("2028-06-30T00:00:00Z"));

    // Then l'entrante naît sans échéance, et c'est le prix de la règle, asséré ici et
    // non découvert en production. La liste scopée lui datait une fin au 30 septembre,
    // celle de sa seule voie startup, quand son rattachement à une équipe la retient
    // au-delà : l'écrire proposerait un départ dans vingt-huit jours au nom de
    // quelqu'un qui vient d'arriver. Ne rien écrire la laisse hors de toutes les files
    // tant que sa fiche restera illisible : les autres traversent la panne avec leur
    // dernière échéance lue, elle n'en a aucune, et le passage qui saura la lire est le
    // premier à pouvoir lui en donner une. On échange un départ prématuré contre un
    // accès qui n'expire pas, et l'échange ne vaut que parce que le second se dit.
    expect(panne.created).toBe(1);
    expect(echeance(ENTRANTE)).toBeNull();
    expect(statutDe(echeance(ENTRANTE), LE_JOUR_DIT, SEUILS)).toBe("SANS_ECHEANCE");

    // Then elle est donc nommée au même titre que les autres : le refus porte sur
    // l'écriture et non sur la valeur gardée, si bien qu'il dit aussi celle qui n'avait
    // rien à garder. C'est tout ce qu'on peut faire pour elle.
    expect(panne.echeancesNonEcrites).toContain(ENTRANTE);

    // Then la trace porte les deux natures d'incident sans que l'une chasse l'autre :
    // les erreurs de lecture, qui l'ont dégradé, et le refus d'écriture, qui ne dégrade
    // rien mais que personne ne verrait autrement.
    expect(ceQuiAEteDit(panne.runId)).toHaveLength(5);
    expect(ceQuiAEteDit(panne.runId).at(-1)).toBe(
      `${REFUS_D_ECHEANCE} : ${PAR_EQUIPE}, ${DEUX_VOIES}, ${DEUX_VOIES_SANS_FIN}, ${ENTRANTE} ; fiche complète non lue`,
    );

    // When la source guérit.
    await nuit(2, { entrante: true });

    // Then l'entrante reçoit enfin son échéance : la règle ne perd rien, elle attend.
    expect(echeance(ENTRANTE)).toEqual(new Date("2029-01-31T00:00:00Z"));
  });
});
