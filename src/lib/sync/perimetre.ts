import type { Attachment } from "@/core/appartenance";
import {
  autrePassageCompletDepuis,
  chuteExcessive,
  FOURNISSEUR_PERIMETRE,
  REFUS_D_ECHEANCE,
  REFUS_DE_DISPARITION,
  REFUS_DE_RETOUR,
} from "@/core/collecte";
import {
  emailDeContact,
  type MembreDetaille,
  rattachementDe,
  rattachementDeclare,
} from "@/core/membre";
import { declaresManquants } from "@/core/perimetre";
import { jourUTC } from "@/core/statut";
import type { PersonSource } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  fetchIncubatorMembers,
  fetchIncubatorStartups,
  fetchMemberDetail,
  type IncubatorStartup,
  mapLimit,
} from "@/lib/espace-membre";
import { policy } from "@/lib/policy";

const CONCURRENCE = 8;

export interface PerimetreSyncResult {
  /** La trace de ce passage, pour qui a quelque chose à y ajouter après coup. */
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  seen: number;
  created: number;
  updated: number;
  vanished: number;
  missingDeclared: string[];
  introuvables: string[];
  /** Celles que ce passage a refusé de faire disparaître, faute de les avoir lues. */
  retenues: string[];
  /** Celles dont il a effacé la disparition sans dater le retour, faute de confirmation. */
  retoursNonDates: RetourNonDate[];
  /** Celles dont il n'a pas écrit l'échéance, faute d'avoir obtenu la fiche qui la porte. */
  echeancesNonEcrites: string[];
  errors: string[];
  startups: IncubatorStartup[];
}

/**
 * Une fiche revue dont le retour n'a pas été daté, et la disparition qu'elle portait.
 *
 * La disparition n'existe plus nulle part une fois ce passage écrit : elle est
 * reprise ici parce que c'est la seule chose qui dise combien de temps l'absence
 * avait duré, et donc si ce refus est le battement d'une nuit qu'on voulait taire ou
 * le retour réel qu'on a accepté de perdre.
 */
export interface RetourNonDate {
  username: string;
  disparueLe: Date;
}

/**
 * Ce qu'un passage sait d'une personne, et ce qu'il ne sait pas.
 *
 * Un champ qui admet `undefined` le dit au sens fort : ce passage n'a pas su lire la
 * source qui le porte, il n'a donc rien à en écrire, et la collecte cesse d'affirmer
 * par défaut ce qu'elle n'a pas constaté. `missionEnd` est le seul dans ce cas, la
 * fiche complète étant la seule à le porter pour qui relève d'une équipe. Le jour où
 * un deuxième champ passera par elle, il hérite du silence en élargissant son propre
 * type : rien plus bas ne regarde les champs un par un.
 */
export interface PersonneResolue {
  username: string;
  betaUuid: string | null;
  fullname: string;
  githubLogin: string | null;
  primaryEmail: string | null;
  communicationEmail: string | null;
  missionEnd: string | null | undefined;
  attachment: Attachment;
  startups: string[];
  source: PersonSource;
}

function toDate(iso: string | null | undefined): Date | null | undefined {
  if (iso === undefined) {
    return undefined;
  }
  return iso === null ? null : new Date(`${iso}T00:00:00Z`);
}

/**
 * Tout ce que la collecte réécrit sur une fiche, et rien d'autre.
 *
 * Extrait pour être lisible d'un coup d'œil et vérifiable par un test : c'est la
 * liste qui dit ce qu'un opérateur ne peut pas saisir durablement sur une fiche
 * collectée. Le jour où quelqu'un ajoute un champ à `Person`, c'est ici qu'on voit
 * si la collecte s'est mise à écraser une décision.
 */
export function champsCollectes(personne: PersonneResolue, now: Date, retour: boolean) {
  return {
    // Le jour où une source amont connaît cet identifiant, il cesse d'être une
    // construction locale et redevient un pivot que rien n'a le droit de renommer.
    // Sans cette ligne, une fiche fabriquée puis adoptée resterait renommable.
    usernameFabricated: false,
    betaUuid: personne.betaUuid,
    fullname: personne.fullname,
    githubLogin: personne.githubLogin,
    primaryEmail: personne.primaryEmail,
    communicationEmail: personne.communicationEmail,
    // `undefined` ne touche à rien, comme pour le retour plus bas : une échéance que ce
    // passage n'a pas su lire garde celle du dernier passage qui l'a lue. L'effacer
    // ferait passer une lecture manquée pour une absence de fin de mission, et une
    // personne sans échéance ne remonte plus jamais, par aucun statut.
    missionEnd: toDate(personne.missionEnd),
    attachment: personne.attachment,
    startups: personne.startups,
    source: personne.source,
    lastSeenAt: now,
    vanishedAt: null,
    // Une fiche revue après une disparition confirmée est un retour, et c'est la
    // seule chose qui en tienne lieu : `firstSeenAt` ne bougera plus. La disparition
    // étant effacée sur la ligne du dessus, ce passage est le dernier instant où le
    // retour peut se dater, d'où le verdict en paramètre : la règle est chez
    // l'appelant, seul à savoir ce que les passages précédents ont constaté.
    // `undefined` ne touche à rien : une fiche revue sans retour établi garde la date
    // de son retour précédent, et une fiche créée ici n'en a aucune, n'étant revenue
    // de nulle part.
    returnedAt: retour ? now : undefined,
  };
}

async function upsert(
  personne: PersonneResolue,
  now: Date,
  dernierPassageComplet: Date | null,
): Promise<{ issue: "created" | "updated"; retourNonDate: Date | null }> {
  const existing = await prisma.person.findUnique({
    where: { username: personne.username },
    select: { id: true, vanishedAt: true },
  });

  if (existing) {
    // Relevée avant l'écriture, qui l'efface sans condition : ce passage est le dernier
    // à savoir qu'il y avait une disparition, et sans retour daté, rien après lui ne
    // pourra dire qu'elle a existé.
    const disparueLe = existing.vanishedAt;
    const retour = autrePassageCompletDepuis(disparueLe, dernierPassageComplet);
    await prisma.person.update({
      where: { id: existing.id },
      data: champsCollectes(personne, now, retour),
    });
    return { issue: "updated", retourNonDate: retour ? null : disparueLe };
  }

  await prisma.person.create({
    data: {
      ...champsCollectes(personne, now, false),
      username: personne.username,
      firstSeenAt: now,
    },
  });
  return { issue: "created", retourNonDate: null };
}

/**
 * Le périmètre vient en entier de l'espace-membre, qui sait qui relève d'un
 * incubateur, y compris quand une startup en compte plusieurs. Le miroir public n'est
 * plus interrogé : ses vingt-quatre heures de latence n'ont pas leur place là où on
 * décide de couper des accès, et lui seul ignorait la co-incubation.
 */
export async function syncPerimetre(
  now: Date,
  correlationId: string,
): Promise<PerimetreSyncResult> {
  const run = await prisma.syncRun.create({
    data: { provider: FOURNISSEUR_PERIMETRE, capability: "list", status: "FAILED", startedAt: now },
  });

  const errors: string[] = [];
  const introuvables: string[] = [];
  let created = 0;
  let updated = 0;
  let vanished = 0;
  const resolues: PersonneResolue[] = [];
  let precedent: PassageComplet | null = null;
  let retenues: string[] = [];
  const retoursNonDates: RetourNonDate[] = [];
  const echeancesNonEcrites: string[] = [];
  let absents: string[] = [];
  let startups: IncubatorStartup[] = [];

  try {
    const config = policy();
    const [lectureStartups, lectureMembres] = await Promise.all([
      fetchIncubatorStartups(config.scope.incubator),
      fetchIncubatorMembers(config.scope.incubator),
    ]);

    // Ce que l'espace-membre a renvoyé d'illisible ne fait pas échouer la collecte,
    // mais l'empêche de se dire complète : aucune disparition ne sera datée sur la
    // foi d'une réponse qu'on n'a comprise qu'à moitié.
    errors.push(...lectureStartups.erreurs, ...lectureMembres.erreurs);

    startups = lectureStartups.items;
    const membres = lectureMembres.items;

    const ghids = new Set(startups.map((startup) => startup.ghid));
    const rattaches = new Set(membres.map((membre) => membre.username));

    // La liste scopée n'associe aucune mission à qui relève de l'incubateur par une
    // équipe : sa fiche complète est la seule à porter son échéance.
    const aDetailler = [
      ...new Set([
        ...membres.filter((membre) => membre.attachment !== "startups").map((m) => m.username),
        ...config.scope.transverse.filter((username) => !rattaches.has(username)),
      ]),
    ];

    const details = new Map<string, MembreDetaille>();
    await mapLimit(aDetailler, CONCURRENCE, async (username) => {
      try {
        const detail = await fetchMemberDetail(username);
        if (detail) {
          details.set(username, detail);
        } else {
          introuvables.push(username);
        }
      } catch (error: unknown) {
        errors.push(`${username} : ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    for (const membre of membres) {
      const rattachement = rattachementDe(membre, ghids, details.get(membre.username));
      // Relevé sur le verdict de la résolution et non sur la carte des fiches lues :
      // c'est la même décision qui se dit ici et s'écrit plus bas, et deux façons de
      // la recalculer finiraient par ne plus désigner les mêmes personnes. Pris avant
      // l'écriture, donc sans savoir s'il y avait une valeur précédente : une fiche
      // créée cette nuit y est aussi, sans rien à conserver, et c'est celle qui a le
      // plus besoin d'être nommée puisque rien ne la rattrapera.
      if (rattachement.missionEnd === undefined) {
        echeancesNonEcrites.push(membre.username);
      }
      resolues.push({
        username: membre.username,
        betaUuid: membre.uuid ?? null,
        fullname: membre.fullname ?? membre.username,
        githubLogin: membre.github ?? null,
        primaryEmail: membre.primary_email ?? null,
        communicationEmail: emailDeContact(membre),
        missionEnd: rattachement.missionEnd,
        attachment: rattachement.attachment,
        startups: rattachement.startups,
        source: "BETA" as PersonSource,
      });
    }

    // Déclarés transverses que l'espace-membre ne rattache pas encore à une équipe de
    // l'incubateur : la politique fait autorité sur leur appartenance.
    for (const username of config.scope.transverse) {
      if (rattaches.has(username)) {
        continue;
      }
      const detail = details.get(username);
      if (!detail) {
        continue;
      }
      const rattachement = rattachementDeclare(detail);
      resolues.push({
        username,
        betaUuid: detail.uuid ?? null,
        fullname: detail.fullname ?? username,
        githubLogin: detail.github ?? null,
        primaryEmail: detail.primary_email ?? null,
        communicationEmail: emailDeContact(detail),
        missionEnd: rattachement.missionEnd,
        attachment: rattachement.attachment,
        startups: rattachement.startups,
        source: "BETA" as PersonSource,
      });
    }

    // Suivies à la main faute de fiche : on ne les ajoute que si l'espace-membre ne
    // les connaît pas, sa version étant toujours la plus fraîche.
    const connus = new Set(resolues.map((personne) => personne.username));
    for (const entry of config.scope.local) {
      if (connus.has(entry.username)) {
        continue;
      }
      resolues.push({
        username: entry.username,
        betaUuid: null,
        fullname: entry.username,
        githubLogin: null,
        primaryEmail: null,
        communicationEmail: null,
        missionEnd: entry.until,
        attachment: "NONE",
        startups: [],
        source: "LOCAL" as PersonSource,
      });
    }

    absents = declaresManquants(
      resolues.map((personne) => personne.username),
      config.scope.transverse,
    );

    // Le dernier passage complet sert trois fois : son effectif borne la chute, son
    // instant dit si une disparition a duré et si un angle mort a duré. Un seul relevé
    // pour les trois, sinon des garde-fous qui se réclament du même passage finissent
    // par ne plus parler du même. Le passage courant ne s'y voit pas : il s'ouvre en
    // `FAILED` et n'est promu qu'à sa clôture.
    precedent = await dernierPassageComplet();

    for (const personne of resolues) {
      try {
        const { issue, retourNonDate } = await upsert(personne, now, precedent?.startedAt ?? null);
        if (issue === "created") {
          created += 1;
        } else {
          updated += 1;
        }
        if (retourNonDate !== null) {
          retoursNonDates.push({ username: personne.username, disparueLe: retourNonDate });
        }
      } catch (error: unknown) {
        errors.push(
          `${personne.username} : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
    const failed: PerimetreSyncResult = {
      runId: run.id,
      status: "FAILED",
      seen: 0,
      created,
      updated,
      vanished: 0,
      missingDeclared: absents,
      introuvables,
      retenues: [],
      retoursNonDates,
      echeancesNonEcrites,
      errors,
      startups,
    };
    await closeRun(run.id, now, failed);
    return failed;
  }

  let status: PerimetreSyncResult["status"] = errors.length === 0 ? "OK" : "PARTIAL";

  // Un run dégradé ne fait disparaître personne : une collecte tronquée conclurait
  // à tort que la moitié de l'incubateur est partie.
  if (status === "OK") {
    const reference = precedent?.itemsSeen ?? 0;

    if (chuteExcessive(reference, resolues.length, policy().thresholds.maxScopeDrop)) {
      // Une réponse valide mais amputée ne se distingue d'un départ collectif que par
      // son ampleur : dans le doute, on ne date aucune disparition.
      errors.push(
        `chute du périmètre : ${resolues.length} personnes contre ${reference} au dernier relevé complet, aucune disparition datée`,
      );
      status = "PARTIAL";
    } else {
      // Une fiche créée à la main pour nommer un compte n'existe que par lui : elle
      // n'est réclamée par aucune source amont, et la faire disparaître à la collecte
      // suivante reviendrait à effacer chaque nuit ce qu'un opérateur vient d'écrire.
      // Elle vit donc tant que son compte est observé, ou tant qu'un rattachement
      // qu'on lui a posé court encore : dire qu'une personne est là jusqu'à telle
      // date et la faire disparaître la nuit même serait se contredire.
      //
      // `source: "LOCAL"` reste en tête et hors du `OR` : une personne venue de
      // l'espace-membre qui en sort doit continuer de lever `SCOPE_EXIT`, qui est le
      // constat le plus important du système.
      const adossees = await prisma.person.findMany({
        where: {
          source: "LOCAL",
          OR: [
            { identities: { some: { vanishedAt: null } } },
            {
              startupAssignments: {
                some: { endedAt: null, until: { gte: new Date(jourUTC(now)) } },
              },
            },
          ],
        },
        select: { username: true },
      });

      const known = [
        ...resolues.map((personne) => personne.username),
        ...adossees.map((personne) => personne.username),
      ];

      // Une fiche que ce passage sait n'avoir pas lue rejoint les connues : il l'a
      // demandée, la source a répondu qu'elle ne la connaissait pas, et un aveu
      // d'ignorance ne vaut pas un départ tant qu'il n'a pas duré. C'est l'inverse
      // d'une disparition ordinaire, qui se conclut d'un silence.
      retenues = await fichesRetenues(introuvables, known, precedent?.startedAt ?? null);

      const gone = await prisma.person.updateMany({
        where: {
          username: { notIn: [...known, ...retenues] },
          vanishedAt: null,
          source: { not: "SERVICE" },
        },
        data: { vanishedAt: now },
      });
      vanished = gone.count;
    }
  }

  const result: PerimetreSyncResult = {
    runId: run.id,
    status,
    seen: resolues.length,
    created,
    updated,
    vanished,
    missingDeclared: absents,
    introuvables,
    retenues,
    retoursNonDates,
    echeancesNonEcrites,
    errors,
    startups,
  };
  await closeRun(run.id, now, result);
  audit({
    actorKind: "SYSTEM",
    action: "sync.perimetre",
    targetType: "perimetre",
    correlationId,
    after: result,
    result: status === "OK" ? "SUCCESS" : "FAILURE",
  });
  return result;
}

/**
 * Les fiches que ce passage sait n'avoir pas lues, et dont il n'a donc rien à conclure
 * ce soir.
 *
 * Un 404 de la source n'est pas un silence : le passage nomme la fiche qui lui manque,
 * et il conclurait un départ d'un aveu d'ignorance. La borne est celle du retour, lue
 * sur la dernière vue au lieu de la disparition : tant qu'aucun autre passage complet
 * n'est venu depuis, l'angle mort n'a pas duré et la fiche est retenue ; dès qu'un
 * autre est venu sans la rendre lisible, elle reçoit sa disparition. Le sursis dure
 * donc un passage complet et pas un de plus, et c'est ce qui le sépare d'une
 * exemption : une fiche réellement supprimée en amont garde son départ, avec un
 * passage de retard, là où l'épargner sans condition le lui retirerait pour toujours.
 *
 * Rien n'est retenu de ce que la collecte a résolu par ailleurs, une personne
 * rattachée par une équipe restant du périmètre même quand sa fiche complète manque,
 * ni de ce qui a déjà disparu, ni d'un compte de service, que l'`updateMany` épargne
 * de toute façon : dans les trois cas il n'y a rien à retenir, et l'annoncer ferait
 * mentir la trace.
 */
async function fichesRetenues(
  introuvables: readonly string[],
  known: readonly string[],
  dernierPassage: Date | null,
): Promise<string[]> {
  const deja = new Set(known);
  const candidates = introuvables.filter((username) => !deja.has(username));
  if (candidates.length === 0) {
    return [];
  }

  const fiches = await prisma.person.findMany({
    where: { username: { in: candidates }, vanishedAt: null, source: { not: "SERVICE" } },
    select: { username: true, lastSeenAt: true },
  });

  return fiches
    .filter((fiche) => !autrePassageCompletDepuis(fiche.lastSeenAt, dernierPassage))
    .map((fiche) => fiche.username);
}

/** Le dernier passage dont on a le droit de tirer des conclusions. */
export interface PassageComplet {
  itemsSeen: number;
  startedAt: Date;
}

export async function dernierPassageComplet(): Promise<PassageComplet | null> {
  return prisma.syncRun.findFirst({
    where: { provider: FOURNISSEUR_PERIMETRE, capability: "list", status: "OK" },
    orderBy: { startedAt: "desc" },
    select: { itemsSeen: true, startedAt: true },
  });
}

/** Le jour d'un instant, dans la forme que les messages du dépôt emploient déjà. */
function jour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function closeRun(id: string, now: Date, result: PerimetreSyncResult): Promise<void> {
  // Ce qu'un passage a dit, et non ce qui l'a dégradé : ni une fiche retenue ni un
  // retour non daté ne sont des lectures ratées, ce sont des conclusions qu'on s'est
  // refusées sur quelqu'un de nommé. Les compter dans `errors` basculerait le run en
  // `PARTIAL` et lui ferait perdre tous les vrais départs de la nuit. Les dire ici les
  // met dans la colonne que l'écran des collectes lit déjà, comme le refus de vague.
  //
  // Le second refus a plus besoin de cette ligne que le premier : une fiche retenue
  // garde sa disparition en attente, alors qu'un retour non daté a effacé la sienne,
  // et sans cette phrase rien ne distinguerait plus une absence de trois semaines
  // d'une fiche qui n'a pas bougé.
  const dits = [...result.errors];
  if (result.retenues.length > 0) {
    // Point-virgule et non virgule : les noms en portent déjà, et la conclusion se
    // lirait comme un nom de plus dès qu'il y en a deux.
    dits.push(`${REFUS_DE_DISPARITION} : ${result.retenues.join(", ")} ; aucune disparition datée`);
  }
  if (result.retoursNonDates.length > 0) {
    const revenues = result.retoursNonDates
      .map((retour) => `${retour.username} (disparue le ${jour(retour.disparueLe)})`)
      .join(", ");
    dits.push(`${REFUS_DE_RETOUR} : ${revenues} ; absence non confirmée`);
  }
  if (result.echeancesNonEcrites.length > 0) {
    dits.push(
      `${REFUS_D_ECHEANCE} : ${result.echeancesNonEcrites.join(", ")} ; fiche complète non lue`,
    );
  }

  await prisma.syncRun.update({
    where: { id },
    data: {
      finishedAt: now,
      status: result.status,
      itemsSeen: result.seen,
      error: dits.length > 0 ? { messages: dits } : undefined,
    },
  });
}

/**
 * Ajoute un refus à la trace d'un passage déjà clos, sans toucher à son statut.
 *
 * Les arrivées se jugent après la clôture du run, une fois les systèmes cibles lus, et
 * leur refus n'est pas un échec de lecture : le périmètre a bien été collecté, c'est
 * ce qu'on a le droit d'en conclure qui est en cause. Le statut ne bascule donc pas,
 * et cette ligne est la seule trace du refus. Elle rejoint les messages du run parce
 * que c'est là que l'écran des collectes va les chercher.
 */
export async function noterRefusDArrivees(runId: string, message: string): Promise<void> {
  const run = await prisma.syncRun.findUnique({ where: { id: runId }, select: { error: true } });
  if (!run) {
    return;
  }

  // La trace repart de l'objet relu au lieu d'être réécrite : elle porte aussi les
  // refus de datation, qu'un refus d'arrivées effacerait en la remplaçant, et une
  // trace amputée fait mentir l'écran qui la lit plutôt que de le faire échouer.
  const trace =
    run.error !== null && typeof run.error === "object" && !Array.isArray(run.error)
      ? run.error
      : {};
  const existants = "messages" in trace ? trace["messages"] : null;

  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      error: { ...trace, messages: [...(Array.isArray(existants) ? existants : []), message] },
    },
  });
}
