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
 * gèlerait la collecte avant même qu'elle n'atteigne le moindre connecteur. Le délai
 * vaut pour une page.
 */
const DELAI_MS = 30_000;

const ORIGINE_CANONIQUE = "https://espace-membre.beta.gouv.fr";

/** Le maximum que l'API accepte. */
const TAILLE_DE_PAGE = 100;

/**
 * La clé part dans un en-tête que `fetch` recopie d'une redirection à l'autre. Une seule
 * est suivie, en HTTPS, et seulement vers l'origine configurée ou l'origine canonique.
 * L'ancienne adresse de l'espace-membre redirige encore vers la nouvelle. Une redirection
 * vers HTTP emporterait la clé en clair, une redirection vers un tiers la lui remettrait.
 */
async function appeler(adresse: string, path: string, redirection: boolean): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(adresse, {
      headers: {
        authorization: `Bearer ${env.ESPACE_MEMBRE_API_KEY}`,
        accept: "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (cause: unknown) {
    throw new EspaceMembreError(path, null, cause instanceof Error ? cause.message : String(cause));
  }

  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  const suite = response.headers.get("location");
  const cible = suite === null ? null : new URL(suite, adresse);
  // Calculées à l'appel : `src/cli/sync.ts` charge l'environnement après ses imports.
  const origines = new Set([new URL(env.ESPACE_MEMBRE_URL).origin, ORIGINE_CANONIQUE]);
  if (cible === null || cible.protocol !== "https:" || !origines.has(cible.origin) || redirection) {
    throw new EspaceMembreError(
      path,
      response.status,
      `redirection refusée vers ${cible?.origin ?? "une adresse absente"}`,
    );
  }
  return appeler(cible.href, path, true);
}

const problemeSchema = z.object({ title: z.string().optional(), detail: z.string().optional() });

/** Les refus suivent la RFC 9457, et leur `detail` distingue une clé morte d'une portée manquante. */
async function refus(path: string, response: Response): Promise<EspaceMembreError> {
  const corps = problemeSchema.safeParse(await response.json().catch(() => null));
  const precision = corps.success ? (corps.data.detail ?? corps.data.title) : undefined;
  return new EspaceMembreError(
    path,
    response.status,
    `${response.status} ${response.statusText}${precision ? ` (${precision})` : ""}`,
  );
}

async function get(path: string): Promise<unknown> {
  const response = await appeler(`${env.ESPACE_MEMBRE_URL}${path}`, path, false);

  if (!response.ok) {
    throw await refus(path, response);
  }

  return await response.json();
}

const unitaireSchema = z.object({ data: z.unknown() });

const collectionSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({
    total: z.number().int().min(0),
    offset: z.number().int().min(0),
    perimeter: z.string(),
  }),
});

function illisible(path: string, quoi: string, erreur: z.ZodError): EspaceMembreError {
  const champs = erreur.issues.map((issue) => issue.path.join(".") || "(racine)").join(", ");
  return new EspaceMembreError(path, null, `${quoi} illisible (${champs})`);
}

/**
 * Une collection entière, page après page, ou une erreur.
 *
 * Une personne absente d'une page se lirait comme un départ. D'où quatre refus : un
 * total qui bouge entre deux pages, une page qui ne commence pas où on l'a demandée,
 * une page vide avant le total annoncé, un même `uuid` lu deux fois. Le dernier voit
 * un ordre qui change entre deux pages. Un départ et une arrivée croisés entre deux
 * pages restent invisibles ici.
 *
 * Le périmètre de la clé s'applique en plus du chemin. Une clé limitée à une startup
 * rendrait, sous un succès, les seuls membres de cette startup, et le reste de
 * l'incubateur passerait pour parti. Seuls le périmètre global et celui de
 * l'incubateur demandé sont donc admis.
 */
async function lireCollection(path: string, incubateur: string): Promise<unknown[]> {
  const admis = new Set(["global", `incubator/${incubateur}`]);
  const elements: unknown[] = [];
  let total: number | null = null;

  while (total === null || elements.length < total) {
    const lu = collectionSchema.safeParse(
      await get(`${path}?limit=${TAILLE_DE_PAGE}&offset=${elements.length}`),
    );
    if (!lu.success) {
      throw illisible(path, "enveloppe de collection", lu.error);
    }
    const { data, meta } = lu.data;

    if (!admis.has(meta.perimeter)) {
      throw new EspaceMembreError(
        path,
        null,
        `la clé porte le périmètre ${meta.perimeter}, seuls ${[...admis].join(" et ")} lisent l'incubateur entier`,
      );
    }
    if (total !== null && meta.total !== total) {
      throw new EspaceMembreError(
        path,
        null,
        `le total a changé en cours de lecture (${total} puis ${meta.total})`,
      );
    }
    if (meta.offset !== elements.length) {
      throw new EspaceMembreError(
        path,
        null,
        `page rendue au décalage ${meta.offset} au lieu de ${elements.length}`,
      );
    }
    if (data.length === 0 && elements.length < meta.total) {
      throw new EspaceMembreError(
        path,
        null,
        `page vide après ${elements.length} éléments sur ${meta.total}`,
      );
    }

    total = meta.total;
    elements.push(...data);
  }

  const vus = new Set<unknown>();
  for (const element of elements) {
    const uuid =
      typeof element === "object" && element !== null && "uuid" in element
        ? element.uuid
        : undefined;
    if (uuid === undefined) {
      continue;
    }
    if (vus.has(uuid)) {
      throw new EspaceMembreError(
        path,
        null,
        `${String(uuid)} rendu deux fois en cours de lecture`,
      );
    }
    vus.add(uuid);
  }

  if (elements.length !== total) {
    throw new EspaceMembreError(
      path,
      null,
      `${elements.length} éléments rendus pour un total de ${total}`,
    );
  }
  return elements;
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

export const membreSchema = z.object({
  uuid: z.string(),
  username: z.string().min(1),
  fullname: z.string(),
  github: z.string().nullish(),
  primary_email: z.string().nullish(),
  secondary_email: z.string().nullish(),
  // Facultatif tant que tous les environnements de l'espace-membre ne le rendent pas.
  communication_email: z.enum(["primary", "secondary"]).nullish(),
  missions: z.array(missionSchema),
});

export const membreIncubateurSchema = membreSchema.extend({
  attachment: z.enum(["startups", "teams", "both"]),
  teams: z.array(z.string()).nullish(),
});

const phaseSchema = z.object({ name: z.string().nullish(), start: z.string().nullish() });

export const startupSchema = z.object({
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
  const brut = await lireCollection(
    `/api/v1/incubators/${encodeURIComponent(ghid)}/startups`,
    ghid,
  );
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
 * Le périmètre entier : l'espace-membre sait dire qui relève d'un incubateur, y compris
 * par la voie des équipes. On ne passe pas `status`, dont le défaut retourne aussi les
 * missions terminées. Masquer les partants reviendrait à ne jamais leur couper leurs
 * accès.
 */
export async function fetchIncubatorMembers(ghid: string): Promise<Lecture<MembreIncubateur>> {
  const brut = await lireCollection(`/api/v1/incubators/${encodeURIComponent(ghid)}/members`, ghid);
  return lireChaque(brut, membreIncubateurSchema, "membres de l'incubateur");
}

/**
 * La fiche complète, dont les missions ne sont pas restreintes à un incubateur. Elle
 * n'est demandée que pour les personnes rattachées par une équipe : la liste scopée
 * ne leur associe aucune mission, et leur échéance beta.gouv est justement ce qui
 * fait foi pour elles.
 *
 * Seul le 404 dit qu'une fiche n'existe pas. L'API répond 403 à une clé sans la portée
 * ou dont le périmètre ne couvre pas la fiche, et lire ce refus comme une absence
 * rangerait parmi les introuvables quelqu'un qui est simplement hors de vue.
 */
export async function fetchMemberDetail(username: string): Promise<MembreDetaille | null> {
  const path = `/api/v1/members/${encodeURIComponent(username)}`;
  let brut: unknown;
  try {
    brut = await get(path);
  } catch (error: unknown) {
    if (error instanceof EspaceMembreError && error.status === 404) {
      return null;
    }
    if (error instanceof EspaceMembreError && error.status === 403) {
      throw new EspaceMembreError(
        path,
        403,
        `fiche refusée, hors du périmètre de la clé ou sans la portée members:read, ${error.message}`,
      );
    }
    throw error;
  }

  const enveloppe = unitaireSchema.safeParse(brut);
  if (!enveloppe.success) {
    throw illisible(path, "enveloppe de fiche", enveloppe.error);
  }
  const lu = membreSchema.safeParse(enveloppe.data.data);
  if (!lu.success) {
    throw illisible(path, "fiche", lu.error);
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
