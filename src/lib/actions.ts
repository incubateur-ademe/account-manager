import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireOperateur, type Utilisateur } from "@/lib/session";

interface Trace<T> {
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
  /**
   * Un objet et non plus une charge libre : la voie d'identification s'y ajoute, et
   * une charge utile qui ne serait pas un objet n'aurait pas de place où l'accueillir.
   */
  after?: Record<string, unknown>;
  /** Chemins dont l'affichage dépend de cette écriture. */
  revalider?: readonly string[];
  ecrire: (utilisateur: Utilisateur) => Promise<T>;
}

export type ActionTracee<T> = Trace<T> & {
  /**
   * L'acteur que l'appelant a déjà résolu, quand il en a eu besoin avant d'écrire :
   * sa garde a précédé sa trace chez lui, et ce passage ne relit rien. Une seconde
   * résolution serait une seconde lecture du droit, donc un second endroit où il peut
   * être lu autrement que par le premier. Absent, le passage exige l'opérateur
   * courant, qui est le comportement de toujours.
   */
  utilisateur?: Utilisateur;
};

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
 * chemin perdrait sa trace sans que rien ne le signale. C'est aussi pourquoi il
 * s'élargit aux non-opérateurs plutôt que de se doubler d'un second passage.
 *
 * La voie d'identification part avec chaque trace de ce passage, y compris celle d'un
 * opérateur. `actorUsername` dit qui, elle dit comment il l'a prouvé, et c'est la
 * seule chose qui sépare un username beta.gouv d'un identifiant de fiche, lequel se
 * renomme. La dire seulement quand elle surprend ferait de son absence le signal, et
 * une absence ne se distingue pas d'un événement écrit avant qu'elle existe.
 *
 * Les lignes qu'un `ecrire` pose lui-même la portent donc aussi, et c'est à lui de
 * les écrire : rien ne les relie à la trace principale de son geste, ni
 * `correlationId`, qu'aucune de ces actions ne pose, ni autre chose, et le voisinage
 * temporel n'est pas un rattachement. Une trace satellite muette sur la voie serait
 * donc muette pour toujours.
 */
export async function actionTracee<T>(params: ActionTracee<T>): Promise<T> {
  const utilisateur = params.utilisateur ?? (await requireOperateur());

  const trace = {
    actorKind: "HUMAN" as const,
    actorUsername: utilisateur.username,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    correlationId: params.correlationId,
    before: params.before,
    after: { ...params.after, voie: utilisateur.voie },
  };

  audit({ ...trace, result: "SUCCESS" });

  try {
    const resultat = await params.ecrire(utilisateur);
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
