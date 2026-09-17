import { z } from "zod";

import type { OpenEngagement } from "@/core/connector";
import type { SensDossier } from "@/core/dossier";
import type { Profil } from "@/core/policy";

/**
 * Ce qu'un opérateur a demandé, tel qu'il l'a demandé, figé à l'ouverture du geste.
 *
 * Elle est à son recalcul ce que `AccessCase.profileKey` est à celui d'une arrivée : la
 * seule entrée dont l'empreinte redécoule, et la raison pour laquelle elle se fige plutôt
 * que de se relire. Un geste recalculé sur ce que l'opérateur voudrait aujourd'hui
 * comparerait une empreinte à elle-même, et la garde d'écart ne garderait plus rien.
 *
 * Elle porte les trois champs d'un accès de profil, sous les mêmes noms, plus la
 * justification qu'un profil n'a pas à porter : le profil est sa propre justification, un
 * geste n'en a aucun.
 */
export const intentionDUnGeste = z.strictObject({
  systeme: z.string().min(1),
  scope: z.unknown(),
  expiresInDays: z.number().int().positive().optional(),
  justification: z.string().min(1),
});

export type IntentionDUnGeste = z.infer<typeof intentionDUnGeste>;

/**
 * L'étoile est la marque réservée du dépôt pour ce qui n'est pas une clé de la politique,
 * sur le modèle de `CLE_INCUBATEUR`.
 */
export const CLE_GESTE = "*geste";

/**
 * Le sens d'un geste, qui est un octroi par construction : il n'en coupe aucun.
 *
 * Dit une fois et lu partout, parce que deux endroits en dépendent sans se voir, le
 * calcul et le constat qu'un pointage oppose au sens. Le laisser au premier ferait du
 * second un pointage sans sens, où « déjà absent » se consignerait sous un octroi.
 */
export const SENS_D_UN_GESTE: SensDossier = "ONBOARDING";

/** Un profil d'une seule ligne, qui n'existe que le temps d'un calcul. */
export function profilDUnGeste(intention: IntentionDUnGeste): Profil {
  return {
    key: CLE_GESTE,
    label: "Geste hors dossier",
    accesses: [
      {
        system: intention.systeme,
        scope: intention.scope,
        ...(intention.expiresInDays === undefined
          ? {}
          : { expiresInDays: intention.expiresInDays }),
      },
    ],
  };
}

/**
 * L'ancrage d'un plan, tel qu'il se lit en base : un dossier, ou une personne visée.
 *
 * Il se construit d'un coup plutôt que de se retester à chaque endroit, parce que deux
 * colonnes nullables corrélées ne se laissent pas affiner ensemble : un appelant qui les
 * regarde séparément finit par redemander au typecheck de croire ce qu'une garde plus
 * haut a déjà établi.
 */
export type AncrageLu<Dossier, Sujet> =
  | { sorte: "dossier"; dossier: Dossier }
  | { sorte: "geste"; sujet: Sujet };

export function ancrageLu<Dossier, Sujet>(
  dossier: Dossier | null,
  sujet: Sujet | null,
): AncrageLu<Dossier, Sujet> | null {
  if (dossier !== null) {
    return { sorte: "dossier", dossier };
  }
  if (sujet !== null) {
    return { sorte: "geste", sujet };
  }
  return null;
}

/** Une étape de plan telle que la requête des engagements la rend. */
export interface LigneDEngagement {
  engagementKey: string | null;
  capability: string;
  systemKey: string;
  label: string;
  params: unknown;
  grantExpiresAt: Date | null;
  executedAt: Date | null;
}

export interface EngagementOuvert extends OpenEngagement {
  systemKey: string;
}

function parametres(params: unknown): Record<string, unknown> {
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

/**
 * Le dernier geste soldé de chaque clé gagne, et rien d'autre ne décide.
 *
 * Les lignes arrivent de la plus récente à la plus ancienne, et c'est l'appelant qui en
 * répond : la première rencontrée pour une clé est celle qui dit son état, les suivantes
 * sont son passé. Une différence d'ensembles, les clés jamais fermées moins les clés
 * fermées, dirait le contraire : un accès ouvert, repris, puis rouvert en ressortirait
 * fermé.
 *
 * À égalité exacte de date, l'octroi l'emporte sur la coupure, et c'est l'ordre secondaire
 * de la requête qui le pose : deux étapes du même passage d'exécution qui touchent la même
 * clé signent la faute de la clé de trop, et conclure « encore ouvert » fait apparaître une
 * ligne de plus au départ, là où conclure « fermé » ferait disparaître un accès sans bruit.
 */
export function dernierGesteSolde(
  lignes: readonly LigneDEngagement[],
  maintenant: Date,
): readonly EngagementOuvert[] {
  const vues = new Map<string, LigneDEngagement & { engagementKey: string; executedAt: Date }>();

  for (const ligne of lignes) {
    const { engagementKey, executedAt } = ligne;
    // Une étape que rien n'a exécutée est écartée avant le pli, et non après : la laisser
    // prendre la place de sa clé la ferait disparaître du résultat, c'est-à-dire déclarer
    // fermé un accès qu'une étape antérieure a ouvert. Le tri de la requête range bien ces
    // lignes en dernier, mais une garde qui ne tient que chez l'appelant n'en est pas une.
    if (engagementKey === null || executedAt === null || vues.has(engagementKey)) {
      continue;
    }
    vues.set(engagementKey, { ...ligne, engagementKey, executedAt });
  }

  return [...vues.values()]
    .filter((ligne) => ligne.capability === "grant")
    .filter(
      (ligne) =>
        ligne.grantExpiresAt === null || ligne.grantExpiresAt.getTime() > maintenant.getTime(),
    )
    .map((ligne) => ({
      key: ligne.engagementKey,
      systemKey: ligne.systemKey,
      label: ligne.label,
      params: parametres(ligne.params),
      openedAt: ligne.executedAt,
      ...(ligne.grantExpiresAt === null ? {} : { expiresAt: ligne.grantExpiresAt }),
    }));
}
