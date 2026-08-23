import { chuteExcessive } from "@/core/collecte";
import {
  type ActionDeclaree,
  type Constat,
  constatsDActionsDeclarees,
  constatsDe,
  constatsDIdentites,
  type IdentiteConstatable,
  type PersonneConstatable,
  verrousDeCloture,
} from "@/core/constat";
import type { FindingKind } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { IncubatorStartup } from "@/lib/espace-membre";

/**
 * Les types que la collecte sait produire, et donc les seuls qu'elle a le droit de
 * refermer. Un constat d'une autre origine, posé à la main ou par un futur chemin,
 * ne doit pas se faire clore par une réconciliation qui ignore ce qui l'a levé.
 */
const RECONCILIES = [
  "SCOPE_EXIT",
  "INACTIVE_STARTUP",
  "ORPHAN",
  "UNREGISTERED",
  "OVERDUE_MANUAL_ACTION",
] as const;

export interface ConstatsResult {
  ouverts: number;
  fermes: number;
  actifs: number;
}

export interface StartupsResult {
  revues: number;
  disparues: number;
  /** Vrai quand la chute observée a interdit de conclure à des sorties. */
  chuteRefusee: boolean;
}

/**
 * Le référentiel local des startups, qui sert à juger si une personne travaille
 * encore sur quelque chose de vivant.
 *
 * Une startup retirée de l'incubateur n'était jusqu'ici jamais datée : sa dernière
 * phase connue restait vraie pour toujours, et les constats de phase continuaient de
 * s'appuyer dessus. `vanishedAt` dit maintenant qu'on ne l'observe plus, ce qui n'est
 * pas la même chose que de la déclarer terminée.
 */
export async function syncStartups(
  startups: readonly IncubatorStartup[],
  incubatorGhid: string,
  now: Date,
  options: { daterDisparitions: boolean; maxScopeDrop: number },
): Promise<StartupsResult> {
  for (const startup of startups) {
    const data = {
      name: startup.name,
      incubatorGhid,
      currentPhase: startup.currentPhase,
      phaseStart: startup.phaseStart ? new Date(`${startup.phaseStart}T00:00:00Z`) : null,
      lastSeenAt: now,
      vanishedAt: null,
    };
    await prisma.startup.upsert({
      where: { ghid: startup.ghid },
      update: data,
      create: { ...data, ghid: startup.ghid, firstSeenAt: now },
    });
  }

  if (!options.daterDisparitions) {
    return { revues: startups.length, disparues: 0, chuteRefusee: false };
  }

  // Même garde que sur les identités, et pour la même raison : une clause
  // d'exclusion portant sur une liste vide n'exclut personne, et sortirait d'un coup
  // toutes les startups de l'incubateur.
  const reference = await prisma.startup.count({ where: { incubatorGhid, vanishedAt: null } });
  if (chuteExcessive(reference, startups.length, options.maxScopeDrop)) {
    return { revues: startups.length, disparues: 0, chuteRefusee: true };
  }

  const vues = startups.map((startup) => startup.ghid);
  const parties = await prisma.startup.updateMany({
    where: { incubatorGhid, ghid: { notIn: vues }, vanishedAt: null },
    data: { vanishedAt: now },
  });

  return { revues: startups.length, disparues: parties.count, chuteRefusee: false };
}

/**
 * Les constats sont réconciliés à chaque collecte : ceux qui ne se vérifient plus se
 * ferment tout seuls. Un constat qu'il faut clore à la main pour une situation déjà
 * résolue devient du bruit, et le bruit fait ignorer le reste.
 */
export async function syncConstats(
  personnes: readonly PersonneConstatable[],
  startups: readonly IncubatorStartup[],
  identites: readonly IdentiteConstatable[],
  phasesTerminales: readonly string[],
  now: Date,
  correlationId: string,
): Promise<ConstatsResult> {
  const phaseParStartup = new Map(startups.map((s) => [s.ghid, s.currentPhase]));
  const constats = [
    ...constatsDe(personnes, phaseParStartup, phasesTerminales, now),
    ...constatsDIdentites(identites),
    ...constatsDActionsDeclarees(await actionsDeclarees()),
  ];
  const parCle = new Map<string, Constat>(constats.map((c) => [c.dedupKey, c]));

  const existants = await prisma.finding.findMany({
    where: { closedAt: null, kind: { in: [...RECONCILIES] } },
    select: { id: true, dedupKey: true },
  });
  const clesExistantes = new Set(existants.map((f) => f.dedupKey));

  // Un opérateur a jugé ces situations traitées. Les rouvrir chaque nuit tant
  // qu'elles durent reviendrait à lui resservir un travail qu'il a déjà fait, et
  // c'est ainsi qu'une file cesse d'être lue.
  const clos = await prisma.finding.findMany({
    where: {
      closedBy: { not: null },
      closedAt: { not: null },
      kind: { in: [...RECONCILIES] },
    },
    select: { id: true, dedupKey: true },
  });

  const { verrouilles, aRearmer } = verrousDeCloture(clos, new Set(parCle.keys()));

  if (aRearmer.length > 0) {
    await prisma.finding.updateMany({
      where: { id: { in: aRearmer.map((f) => f.id) } },
      data: { closedBy: null },
    });
  }

  let ouverts = 0;
  for (const constat of constats) {
    if (clesExistantes.has(constat.dedupKey) || verrouilles.has(constat.dedupKey)) {
      continue;
    }
    const personne = constat.username
      ? await prisma.person.findUnique({
          where: { username: constat.username },
          select: { id: true },
        })
      : null;
    // Une situation qui s'était résolue peut se reproduire : quelqu'un revient dans
    // le périmètre puis en ressort, une startup quitte une phase terminale puis y
    // retombe. La clé de déduplication reste la même, et elle est unique sur toute la
    // table, pas seulement sur les constats ouverts. Créer sans plus de précaution
    // ferait échouer la collecte entière au moment précis où elle a quelque chose à
    // signaler. Le constat est donc rouvert, sa date d'ouverture disant depuis quand
    // dure l'épisode en cours ; les précédents restent dans le journal.
    await prisma.finding.upsert({
      where: { dedupKey: constat.dedupKey },
      update: {
        kind: constat.kind as FindingKind,
        severity: constat.severity,
        personId: personne?.id ?? null,
        externalIdentityId: constat.identiteId ?? null,
        openedAt: now,
        closedAt: null,
        closeReason: null,
      },
      create: {
        kind: constat.kind as FindingKind,
        dedupKey: constat.dedupKey,
        severity: constat.severity,
        personId: personne?.id ?? null,
        externalIdentityId: constat.identiteId ?? null,
        openedAt: now,
      },
    });
    ouverts += 1;
    audit({
      actorKind: "SYSTEM",
      action: "finding.open",
      targetType: "finding",
      targetId: constat.dedupKey,
      correlationId,
      after: { detail: constat.detail },
      result: "SUCCESS",
    });
  }

  const aFermer = existants.filter((f) => !parCle.has(f.dedupKey));
  for (const finding of aFermer) {
    await prisma.finding.update({
      where: { id: finding.id },
      data: { closedAt: now, closeReason: "ne se vérifie plus à la collecte" },
    });
    audit({
      actorKind: "SYSTEM",
      action: "finding.close",
      targetType: "finding",
      targetId: finding.dedupKey,
      correlationId,
      result: "SUCCESS",
    });
  }

  return { ouverts, fermes: aFermer.length, actifs: constats.length };
}

/**
 * Ce qu'on a déclaré avoir fait, confronté à ce qu'on observe.
 *
 * Une étape pointée « faite » n'est qu'une parole tant qu'une lecture du système ne
 * l'a pas confirmée. On rapproche donc chaque déclaration de deux choses : le compte
 * de la personne sur ce système existe-t-il encore, et l'a-t-on relu depuis.
 */
async function actionsDeclarees(): Promise<ActionDeclaree[]> {
  const etapes = await prisma.planStep.findMany({
    where: { state: "SUCCEEDED", executedAt: { not: null } },
    select: {
      label: true,
      systemKey: true,
      executedAt: true,
      plan: {
        select: {
          departureCase: {
            select: {
              person: {
                select: {
                  username: true,
                  identities: { select: { provider: true, vanishedAt: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const relectures = new Map<string, Date>();
  for (const releve of await prisma.syncRun.findMany({
    where: { capability: "list", status: "OK" },
    distinct: ["provider"],
    orderBy: { startedAt: "desc" },
    select: { provider: true, startedAt: true },
  })) {
    relectures.set(releve.provider, releve.startedAt);
  }

  const declarees: ActionDeclaree[] = [];

  for (const etape of etapes) {
    const personne = etape.plan.departureCase?.person;
    if (!personne || !etape.executedAt) {
      continue;
    }

    declarees.push({
      label: etape.label,
      systemKey: etape.systemKey,
      username: personne.username,
      declareeLe: etape.executedAt,
      compteToujoursLa: personne.identities.some(
        (identite) => identite.provider === etape.systemKey && identite.vanishedAt === null,
      ),
      relueLe: relectures.get(etape.systemKey) ?? null,
    });
  }

  return declarees;
}
