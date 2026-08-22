import { z } from "zod";

import { type Lecture, lireChaque } from "@/core/lecture";
import { jourParis, type MembreDetaille, type MembreIncubateur } from "@/core/membre";
import { env } from "@/lib/env";

export class EspaceMembreError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "EspaceMembreError";
  }
}

/**
 * `fetch` n'a aucun délai par défaut, et sans borne une réponse qui ne vient jamais
 * gèlerait la collecte avant même qu'elle n'atteigne le moindre connecteur. Plus large
 * qu'ailleurs parce que le périmètre arrive en un seul appel, qui ramène tout.
 */
const DELAI_MS = 30_000;

async function get(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${env.ESPACE_MEMBRE_URL}${path}`, {
      headers: { "X-Api-Key": env.ESPACE_MEMBRE_API_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (cause: unknown) {
    throw new EspaceMembreError(path, null, cause instanceof Error ? cause.message : String(cause));
  }

  if (!response.ok) {
    throw new EspaceMembreError(path, response.status, `${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Ce que l'espace-membre garantit, et rien de plus : les champs déclarés
 * obligatoires de son côté le sont ici, les autres restent facultatifs. Un
 * identifiant qui disparaît ou change de forme est un changement de contrat, et
 * c'est précisément ce qu'il faut voir. Sans cette frontière, un champ renommé
 * chez eux se lirait ici comme une valeur absente : tout le monde deviendrait sans
 * échéance, plus personne n'expirerait, et aucune erreur ne serait levée.
 */
const missionSchema = z.object({
  end: z.string().nullish(),
  startups: z.array(z.object({ ghid: z.string().nullish() })).nullish(),
});

const membreSchema = z.object({
  uuid: z.string(),
  username: z.string().min(1),
  fullname: z.string(),
  github: z.string().nullish(),
  primary_email: z.string().nullish(),
  secondary_email: z.string().nullish(),
  communication_email: z.string(),
  missions: z.array(missionSchema),
});

const membreIncubateurSchema = membreSchema.extend({
  attachment: z.enum(["startups", "teams", "both"]),
  teams: z.array(z.string()).nullish(),
});

const phaseSchema = z.object({ name: z.string().nullish(), start: z.string().nullish() });

const startupSchema = z.object({
  ghid: z.string().min(1),
  name: z.string().nullish(),
  phases: z.array(phaseSchema).nullish(),
  current_phase: z.string().nullish(),
});

export interface IncubatorStartup {
  ghid: string;
  name: string;
  currentPhase: string | null;
  phaseStart: string | null;
}

/**
 * Les phases arrivent ordonnées chronologiquement et datées à la seconde, alors que
 * le reste du système raisonne en jours. On les ramène donc au jour parisien, comme
 * toute date qui sert à décider d'une échéance.
 */
export async function fetchIncubatorStartups(ghid: string): Promise<Lecture<IncubatorStartup>> {
  const brut = await get(`/api/protected/incubators/${encodeURIComponent(ghid)}/startups`);
  const { items, erreurs } = lireChaque(brut, startupSchema, "startups de l'incubateur");

  return {
    erreurs,
    items: items.map((startup) => {
      const derniere = (startup.phases ?? []).at(-1);
      return {
        ghid: startup.ghid,
        name: startup.name ?? startup.ghid,
        currentPhase: startup.current_phase ?? null,
        phaseStart: jourParis(derniere?.start),
      };
    }),
  };
}

/**
 * Le périmètre entier en un appel : l'espace-membre sait désormais dire qui relève
 * d'un incubateur, y compris par la voie des équipes. On ne passe pas `status`, dont
 * le défaut retourne aussi les missions terminées : masquer les partants reviendrait
 * à ne jamais leur couper leurs accès.
 */
export async function fetchIncubatorMembers(ghid: string): Promise<Lecture<MembreIncubateur>> {
  const brut = await get(`/api/protected/incubators/${encodeURIComponent(ghid)}/members`);
  return lireChaque(brut, membreIncubateurSchema, "membres de l'incubateur");
}

/**
 * La fiche complète, dont les missions ne sont pas restreintes à un incubateur. Elle
 * n'est demandée que pour les personnes rattachées par une équipe : la liste scopée
 * ne leur associe aucune mission, et leur échéance beta.gouv est justement ce qui
 * fait foi pour elles.
 */
export async function fetchMemberDetail(username: string): Promise<MembreDetaille | null> {
  let brut: unknown;
  try {
    brut = await get(`/api/protected/members/${encodeURIComponent(username)}`);
  } catch (error: unknown) {
    if (error instanceof EspaceMembreError && error.status === 404) {
      return null;
    }
    throw error;
  }

  const lu = membreSchema.safeParse(brut);
  if (!lu.success) {
    throw new EspaceMembreError(
      `/api/protected/members/${username}`,
      null,
      `fiche illisible (${lu.error.issues.map((issue) => issue.path.join(".")).join(", ")})`,
    );
  }
  return lu.data;
}

/**
 * Concurrence bornée plutôt qu'un Promise.all sur toute la population : une centaine
 * de requêtes simultanées sur une API sans limitation de débit est une façon de la
 * faire tomber, et il n'y a rien à gagner à aller plus vite qu'un job nocturne.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  });

  await Promise.all(runners);
  return results;
}
