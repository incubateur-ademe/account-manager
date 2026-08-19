import { type Appartenance, appartenanceDe, type EtatAppartenance } from "@/core/appartenance";
import { enCours, type RattachementManuel } from "@/core/rattachement-startup";
import type { Attachment, ScopeDecision } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/**
 * Ce qu'une ligne `Person` doit porter pour qu'on puisse en dériver l'appartenance.
 * Seul endroit qui connaît la forme des lignes : le noyau, lui, ne voit que des
 * listes et une décision.
 */
export interface LigneAppartenance {
  attachment: Attachment;
  startups: readonly string[];
  startupAssignments: readonly RattachementManuel[];
  scopeOverride: {
    decision: ScopeDecision;
    reason: string;
    createdBy: string;
    createdAt: Date;
  } | null;
}

export const SELECTION_APPARTENANCE = {
  attachment: true,
  startups: true,
  startupAssignments: {
    where: { endedAt: null },
    select: { startupGhid: true, until: true, endedAt: true },
  },
  scopeOverride: {
    select: { decision: true, reason: true, createdBy: true, createdAt: true },
  },
} as const;

export function etatDepuisLaLigne(ligne: LigneAppartenance, aujourdHui: Date): EtatAppartenance {
  return {
    attachment: ligne.attachment,
    startupsCollectees: ligne.startups,
    startupsManuelles: ligne.startupAssignments
      .filter((rattachement) => enCours(rattachement, aujourdHui))
      .map((rattachement) => rattachement.startupGhid),
    surcharge:
      ligne.scopeOverride === null
        ? null
        : {
            sens: ligne.scopeOverride.decision,
            par: ligne.scopeOverride.createdBy,
            depuis: ligne.scopeOverride.createdAt,
            raison: ligne.scopeOverride.reason,
          },
  };
}

export function appartenanceDeLaLigne(
  ligne: LigneAppartenance,
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
  aujourdHui: Date,
): Appartenance {
  return appartenanceDe(etatDepuisLaLigne(ligne, aujourdHui), phaseParStartup, phasesTerminales);
}

/**
 * Dix-neuf startups : une lecture complète en une requête, plutôt qu'une par
 * personne affichée.
 */
export async function phasesDesStartups(): Promise<Map<string, string | null>> {
  const startups = await prisma.startup.findMany({ select: { ghid: true, currentPhase: true } });
  return new Map(startups.map((startup) => [startup.ghid, startup.currentPhase]));
}
