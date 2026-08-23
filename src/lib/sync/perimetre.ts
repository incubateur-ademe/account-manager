import type { Attachment } from "@/core/appartenance";
import { chuteExcessive, FOURNISSEUR_PERIMETRE } from "@/core/collecte";
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
  status: "OK" | "PARTIAL" | "FAILED";
  seen: number;
  created: number;
  updated: number;
  vanished: number;
  missingDeclared: string[];
  introuvables: string[];
  errors: string[];
  startups: IncubatorStartup[];
}

export interface PersonneResolue {
  username: string;
  betaUuid: string | null;
  fullname: string;
  githubLogin: string | null;
  primaryEmail: string | null;
  communicationEmail: string | null;
  missionEnd: string | null;
  attachment: Attachment;
  startups: string[];
  source: PersonSource;
}

function toDate(iso: string | null): Date | null {
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
export function champsCollectes(personne: PersonneResolue, now: Date) {
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
    missionEnd: toDate(personne.missionEnd),
    attachment: personne.attachment,
    startups: personne.startups,
    source: personne.source,
    lastSeenAt: now,
    vanishedAt: null,
  };
}

async function upsert(personne: PersonneResolue, now: Date): Promise<"created" | "updated"> {
  const data = champsCollectes(personne, now);

  const existing = await prisma.person.findUnique({
    where: { username: personne.username },
    select: { id: true },
  });

  if (existing) {
    await prisma.person.update({ where: { id: existing.id }, data });
    return "updated";
  }

  await prisma.person.create({
    data: { ...data, username: personne.username, firstSeenAt: now },
  });
  return "created";
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

    for (const personne of resolues) {
      try {
        const outcome = await upsert(personne, now);
        if (outcome === "created") {
          created += 1;
        } else {
          updated += 1;
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
      status: "FAILED",
      seen: 0,
      created,
      updated,
      vanished: 0,
      missingDeclared: absents,
      introuvables,
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
    const reference = await dernierPerimetreComplet();

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

      const gone = await prisma.person.updateMany({
        where: { username: { notIn: known }, vanishedAt: null, source: { not: "SERVICE" } },
        data: { vanishedAt: now },
      });
      vanished = gone.count;
    }
  }

  const result: PerimetreSyncResult = {
    status,
    seen: resolues.length,
    created,
    updated,
    vanished,
    missingDeclared: absents,
    introuvables,
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

async function dernierPerimetreComplet(): Promise<number> {
  const dernier = await prisma.syncRun.findFirst({
    where: { provider: FOURNISSEUR_PERIMETRE, capability: "list", status: "OK" },
    orderBy: { startedAt: "desc" },
    select: { itemsSeen: true },
  });
  return dernier?.itemsSeen ?? 0;
}

async function closeRun(id: string, now: Date, result: PerimetreSyncResult): Promise<void> {
  await prisma.syncRun.update({
    where: { id },
    data: {
      finishedAt: now,
      status: result.status,
      itemsSeen: result.seen,
      error: result.errors.length > 0 ? { messages: result.errors } : undefined,
    },
  });
}
