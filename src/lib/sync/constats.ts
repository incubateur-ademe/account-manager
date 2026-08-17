import {
  type Constat,
  constatsDe,
  constatsDIdentites,
  type IdentiteConstatable,
  type PersonneConstatable,
  verrousDeCloture,
} from "@/core/constat";
import type { FindingKind, RiskLevel } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { IncubatorStartup } from "@/lib/espace-membre";

/**
 * Les types que la collecte sait produire, et donc les seuls qu'elle a le droit de
 * refermer. Un constat d'une autre origine, posé à la main ou par un futur chemin,
 * ne doit pas se faire clore par une réconciliation qui ignore ce qui l'a levé.
 */
const RECONCILIES = ["SCOPE_EXIT", "INACTIVE_STARTUP", "ORPHAN", "UNREGISTERED"] as const;

export interface ConstatsResult {
  ouverts: number;
  fermes: number;
  actifs: number;
}

export async function syncStartups(
  startups: readonly IncubatorStartup[],
  incubatorGhid: string,
  now: Date,
): Promise<void> {
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
        severity: constat.severity as RiskLevel,
        personId: personne?.id ?? null,
        externalIdentityId: constat.identiteId ?? null,
        openedAt: now,
        closedAt: null,
        closeReason: null,
      },
      create: {
        kind: constat.kind as FindingKind,
        dedupKey: constat.dedupKey,
        severity: constat.severity as RiskLevel,
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
