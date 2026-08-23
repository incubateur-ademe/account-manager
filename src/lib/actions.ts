import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { type Operateur, requireOperateur } from "@/lib/session";

export interface ActionTracee<T> {
  /** Verbe journalisé, du même vocabulaire que les actions de collecte. */
  action: string;
  targetType: string;
  targetId: string;
  /**
   * Relie les traces d'un même geste porté sur plusieurs personnes. Un geste unitaire
   * n'en pose pas : chaque événement reste lisible seul, et le journal sait déjà
   * rassembler une exécution par ce champ.
   */
  correlationId?: string;
  before?: unknown;
  after?: unknown;
  /** Chemins dont l'affichage dépend de cette écriture. */
  revalider?: readonly string[];
  ecrire: (operateur: Operateur) => Promise<T>;
}

/**
 * Passage obligé de toute écriture déclenchée par un humain : elle vérifie la
 * session, journalise nominativement, puis écrit.
 *
 * L'ordre n'est pas décoratif. Une action dont la trace serait posée après coup
 * serait, en cas de panne au mauvais moment, une action que personne ne pourrait
 * plus expliquer ni attribuer. Le journal reste en revanche en fire-and-forget :
 * son indisponibilité ne doit jamais empêcher de traiter un accès.
 *
 * Exister en un seul exemplaire est le point : une écriture qui contournerait ce
 * chemin perdrait sa trace sans que rien ne le signale.
 */
export async function actionTracee<T>(params: ActionTracee<T>): Promise<T> {
  const operateur = await requireOperateur();

  const trace = {
    actorKind: "HUMAN" as const,
    actorUsername: operateur.username,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    correlationId: params.correlationId,
    before: params.before,
    after: params.after,
  };

  audit({ ...trace, result: "SUCCESS" });

  try {
    const resultat = await params.ecrire(operateur);
    for (const chemin of params.revalider ?? []) {
      revalidatePath(chemin);
    }
    return resultat;
  } catch (error: unknown) {
    // L'intention est déjà au journal : sans cette seconde trace, elle y figurerait
    // comme un fait accompli alors que rien n'a été écrit.
    audit({ ...trace, result: "FAILURE" });
    throw error;
  }
}
