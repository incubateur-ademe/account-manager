import { z } from "zod";

import type {
  CollectError,
  CollectResult,
  Connector,
  ObservedDetail,
  ObservedGrant,
  ObservedIdentity,
  ObservedResource,
} from "@/core/connector";
import { env } from "@/lib/env";

/**
 * Les organisations de l'incubateur. Elles vivent ici et non dans la politique parce
 * qu'elles font partie de la définition du système lui-même : un connecteur GitHub
 * qui viserait d'autres organisations serait un autre connecteur.
 *
 * `incubateur-ademe-admin` n'en fait pas partie malgré ce que laissait entendre le
 * catalogue : c'est un compte, pas une organisation, et il figure d'ailleurs parmi
 * les membres de celle-ci.
 */
const ORGANISATIONS = ["incubateur-ademe"] as const;

const CREDENTIAL = "github-token";
const API = "https://api.github.com";

const RUNBOOK =
  "Retirer la personne dans Settings > People de l'organisation, puis vérifier qu'elle ne figure plus dans la liste des membres ni dans les invitations en attente.";

interface MembreApi {
  id: number;
  login: string;
  /** « Bot » pour une application, « User » sinon. */
  type?: string;
}

interface EquipeApi {
  id: number;
  name: string;
  slug: string;
}

interface InvitationApi {
  id: number;
  login: string | null;
  email: string | null;
  role: string;
  created_at?: string;
  inviter?: { login: string } | null;
  team_count?: number;
  failed_at?: string | null;
  failed_reason?: string | null;
}

/** Le connecteur formate ses propres dates : le socle ne sait pas ce qu'elles disent. */
const DATE_FR = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

/**
 * Une date que le fournisseur rend mal formée ne coûte pas la collecte entière :
 * `Intl` lève sur une date invalide, et rien n'attrape ici, si bien qu'une seule
 * invitation malformée ferait échouer le système au complet et ne daterait plus rien.
 */
function dateLisible(valeur: string): string | null {
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : DATE_FR.format(date);
}

/**
 * La lecture d'une organisation, séparée de son assemblage : ce qui appelle le réseau
 * d'un côté, ce qui décide de l'autre, faute de quoi le coût en requêtes ne s'observe
 * qu'en production.
 */
export type Lecteur = <T>(chemin: string) => Promise<T[]>;

export interface LectureOrganisation {
  membres: { role: "admin" | "member"; membre: MembreApi }[];
  equipes: { equipe: EquipeApi; membres: MembreApi[] }[];
  invitations: InvitationApi[];
  erreurs: CollectError[];
  /** Vrai quand l'organisation n'a rien rendu du tout, donc qu'il n'y a rien à écrire. */
  fatale: boolean;
}

class GithubError extends Error {
  constructor(
    readonly chemin: string,
    message: string,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

/**
 * GitHub pagine à cent par défaut et ne dit pas combien il reste. Demander la page
 * suivante jusqu'à ce qu'elle soit incomplète est le seul moyen de savoir qu'on a
 * tout vu : s'arrêter à la première page ferait passer les absents pour des partis.
 */
async function lireTout<T>(chemin: string): Promise<T[]> {
  const jeton = env.GITHUB_TOKEN;
  if (!jeton) {
    throw new GithubError(chemin, "aucun jeton GitHub configuré");
  }

  const tout: T[] = [];
  const parPage = 100;

  for (let page = 1; page <= 50; page += 1) {
    const separateur = chemin.includes("?") ? "&" : "?";
    const url = `${API}${chemin}${separateur}per_page=${parPage}&page=${page}`;

    let reponse: Response;
    try {
      reponse = await fetch(url, {
        headers: {
          authorization: `Bearer ${jeton}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      });
    } catch (cause: unknown) {
      throw new GithubError(chemin, cause instanceof Error ? cause.message : String(cause));
    }

    if (!reponse.ok) {
      throw new GithubError(chemin, `${reponse.status} ${reponse.statusText}`);
    }

    const lot = (await reponse.json()) as T[];
    if (!Array.isArray(lot)) {
      throw new GithubError(chemin, "une liste était attendue");
    }

    tout.push(...lot);
    if (lot.length < parPage) {
      return tout;
    }
  }

  // Cinquante pages valent cinq mille comptes : bien au-delà du parc réel, donc le
  // signaler vaut mieux que de rendre un inventaire tronqué pour complet.
  throw new GithubError(chemin, "pagination anormalement longue, collecte interrompue");
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Les membres, les équipes et les invitations d'une organisation.
 *
 * Une équipe illisible n'interrompt pas les autres : elle prive d'un accès, pas de
 * l'inventaire. Des membres ou des invitations illisibles, en revanche, laissent une
 * organisation dont on ne sait plus rien, et conclure à partir de là ferait passer
 * les absents pour des partis.
 */
export async function lireOrganisation(org: string, lire: Lecteur): Promise<LectureOrganisation> {
  const lecture: LectureOrganisation = {
    membres: [],
    equipes: [],
    invitations: [],
    erreurs: [],
    fatale: false,
  };

  try {
    for (const role of ["admin", "member"] as const) {
      const membres = await lire<MembreApi>(`/orgs/${org}/members?role=${role}`);
      for (const membre of membres) {
        lecture.membres.push({ role, membre });
      }
    }

    // Une invitation en attente est un accès qui n'attend qu'un clic, et elle ne
    // périme jamais d'elle-même : l'ignorer laisserait une porte ouverte que rien ne
    // referme.
    lecture.invitations = await lire<InvitationApi>(`/orgs/${org}/invitations`);
  } catch (cause: unknown) {
    lecture.erreurs.push({ scope: "organisation", itemRef: org, message: message(cause) });
    lecture.fatale = true;
    return lecture;
  }

  // Une séquence pour la liste, une par équipe, jamais une par compte : c'est ce qui
  // garde le coût proportionnel au nombre d'équipes et non à celui des personnes.
  let equipes: EquipeApi[];
  try {
    equipes = await lire<EquipeApi>(`/orgs/${org}/teams`);
  } catch (cause: unknown) {
    lecture.erreurs.push({ scope: "equipes", itemRef: org, message: message(cause) });
    return lecture;
  }

  for (const equipe of equipes) {
    try {
      const membres = await lire<MembreApi>(`/orgs/${org}/teams/${equipe.slug}/members`);
      lecture.equipes.push({ equipe, membres });
    } catch (cause: unknown) {
      lecture.erreurs.push({
        scope: "equipe",
        itemRef: `${org}/${equipe.slug}`,
        message: message(cause),
      });
    }
  }

  return lecture;
}

/**
 * Ce qu'un compte porte et qu'aucun accès ne dit. Le rôle dans l'organisation n'y
 * entre pas, l'accès le porte déjà, et `site_admin` désigne le personnel de GitHub et
 * non un propriétaire d'organisation.
 */
function detailsDuMembre(membre: MembreApi): readonly ObservedDetail[] | undefined {
  // Un compte d'utilisateur ne porte rien : une métadonnée qui vaudrait « utilisateur »
  // sur chaque ligne cesserait d'être lue dès la deuxième.
  return membre.type === "Bot" ? [{ label: "Type de compte", value: "robot" }] : undefined;
}

/**
 * Les circonstances d'une invitation, que son accès ne dit pas : quand, par qui, vers
 * combien d'équipes, et si elle a échoué.
 */
function detailsDeLInvitation(invitation: InvitationApi): readonly ObservedDetail[] {
  const details: ObservedDetail[] = [];

  const creee = invitation.created_at ? dateLisible(invitation.created_at) : null;
  if (creee) {
    details.push({ label: "Invitée le", value: creee });
  }
  if (invitation.inviter?.login) {
    details.push({ label: "Invitée par", value: invitation.inviter.login });
  }
  if (invitation.team_count) {
    details.push({ label: "Équipes visées", value: String(invitation.team_count) });
  }
  if (invitation.failed_at) {
    const echec = invitation.failed_reason || dateLisible(invitation.failed_at);
    details.push({ label: "Invitation en échec", value: echec || "raison inconnue" });
  }

  return details;
}

/**
 * Ce qui est un accès reste un accès : une équipe est une ressource, y appartenir est
 * un accès, et le socle sait déjà les rapprocher, les faire disparaître et les
 * afficher. Les ranger en métadonnées en ferait une donnée que rien ne réconcilie.
 */
export function assemblerOrganisation(
  org: string,
  lecture: LectureOrganisation,
): { identites: ObservedIdentity[]; ressources: ObservedResource[]; acces: ObservedGrant[] } {
  const identites = new Map<string, ObservedIdentity>();
  const acces: ObservedGrant[] = [];
  const ressources: ObservedResource[] = [
    { externalId: org, label: `Organisation ${org}`, url: `https://github.com/${org}` },
  ];

  for (const { role, membre } of lecture.membres) {
    const externalId = String(membre.id);
    const details = detailsDuMembre(membre);

    identites.set(externalId, {
      externalId,
      idKind: "opaque",
      handle: membre.login,
      ...(details ? { details } : {}),
    });
    acces.push({ identityExternalId: externalId, resourceExternalId: org, role });
  }

  for (const { equipe, membres } of lecture.equipes) {
    // Sur l'identifiant et non sur le slug : renommer une équipe change son slug,
    // donc la clé, donc l'identité de la ressource, et tous les accès qu'elle portait
    // se feraient dater disparus sans que personne n'ait rien perdu. Le dièse écarte
    // toute collision avec la clé de l'organisation comme avec la ressource
    // synthétique du socle.
    const cle = `${org}#${equipe.id}`;
    ressources.push({
      externalId: cle,
      label: `Équipe ${equipe.name}`,
      url: `https://github.com/orgs/${org}/teams/${equipe.slug}`,
    });

    for (const membre of membres) {
      const externalId = String(membre.id);

      // Un membre d'équipe absent des membres de l'organisation n'est pas une
      // contradiction du fournisseur : c'est quelqu'un ajouté entre deux appels
      // successifs. L'adopter coûte moins qu'un écart signalé pour une course de
      // quelques secondes.
      if (!identites.has(externalId)) {
        const details = detailsDuMembre(membre);
        identites.set(externalId, {
          externalId,
          idKind: "opaque",
          handle: membre.login,
          ...(details ? { details } : {}),
        });
      }

      acces.push({ identityExternalId: externalId, resourceExternalId: cle, role: "member" });
    }
  }

  for (const invitation of lecture.invitations) {
    const externalId = invitation.login
      ? `invite-${invitation.id}`
      : `email:${invitation.email ?? invitation.id}`;
    const details = detailsDeLInvitation(invitation);

    identites.set(externalId, {
      externalId,
      idKind: invitation.login ? "opaque" : "email",
      handle: invitation.login ?? invitation.email ?? `invitation ${invitation.id}`,
      ...(invitation.email ? { emails: [invitation.email] } : {}),
      ...(details.length > 0 ? { details } : {}),
    });

    acces.push({
      identityExternalId: externalId,
      resourceExternalId: org,
      role: `invite:${invitation.role}`,
    });
  }

  return { identites: [...identites.values()], ressources, acces };
}

/**
 * Le statut se lit sur ce qui a été rendu, jamais sur un décompte d'erreurs.
 *
 * Il comptait les organisations en erreur et les comparait à leur nombre : sur une
 * seule organisation, la moindre équipe illisible aurait suffi à déclarer la collecte
 * en échec, donc à ne rien écrire et à ne rien faire disparaître. Ce qui décide est
 * qu'il reste quelque chose à écrire.
 */
export async function collecter(lire: Lecteur): Promise<CollectResult> {
  const identites = new Map<string, ObservedIdentity>();
  const ressources: ObservedResource[] = [];
  const acces: ObservedGrant[] = [];
  const erreurs: CollectError[] = [];
  let rendues = 0;

  for (const org of ORGANISATIONS) {
    const lecture = await lireOrganisation(org, lire);
    erreurs.push(...lecture.erreurs);

    if (lecture.fatale) {
      continue;
    }

    rendues += 1;
    const assemblee = assemblerOrganisation(org, lecture);
    for (const identite of assemblee.identites) {
      identites.set(identite.externalId, identite);
    }
    ressources.push(...assemblee.ressources);
    acces.push(...assemblee.acces);
  }

  if (rendues === 0) {
    return { status: "failed", errors: [erreurs[0] as CollectError, ...erreurs.slice(1)] };
  }

  const payload = {
    itemsSeen: identites.size,
    identities: [...identites.values()],
    resources: ressources,
    grants: acces,
  };

  return erreurs.length === 0
    ? { status: "ok", ...payload }
    : { status: "partial", errors: [erreurs[0] as CollectError, ...erreurs.slice(1)], ...payload };
}

export const github: Connector = {
  contract: {
    key: "github",
    label: "GitHub",
    criticality: "high",
    runbook: RUNBOOK,
    credentials: [
      {
        id: CREDENTIAL,
        source: "env",
        scopeNote:
          "Jeton fine-grained restreint aux organisations incubateur-ademe et incubateur-ademe-admin, en lecture seule. Seul système du catalogue dont le fournisseur sait émettre un credential nativement restreint, donc sans proxy.",
        nominative: false,
      },
    ],
    capabilities: {
      list: [{ requires: [CREDENTIAL], tier: "auto" }],
      // Aucune voie automatique en v1 : retirer quelqu'un d'une organisation se fait
      // à la main, et le socle rend la tâche plutôt qu'un appel d'API.
      revoke: [{ requires: [], tier: "manual", runbook: RUNBOOK }],
    },
    scopeSchema: z.object({ organisation: z.enum(ORGANISATIONS).optional() }),
  },

  probe: () =>
    Promise.resolve([
      {
        id: CREDENTIAL,
        available: Boolean(env.GITHUB_TOKEN),
        ...(env.GITHUB_TOKEN
          ? {}
          : { unavailableReason: "GITHUB_TOKEN absent de l'environnement" }),
        checkedAt: new Date(),
      },
    ]),

  list: (): Promise<CollectResult> => collecter(lireTout),

  plan: (intent) => {
    if (intent.kind !== "revoke" || intent.subject.kind !== "person") {
      return Promise.resolve([]);
    }

    const username = intent.subject.username;

    return Promise.resolve(
      ORGANISATIONS.map((org) => ({
        systemKey: "github",
        capability: "revoke" as const,
        tier: "manual" as const,
        action: "retirer-de-l-organisation",
        label: `Retirer ${username} de l'organisation ${org}`,
        params: { organisation: org, username },
        riskLevel: "high" as const,
        expectedState: { membre: false },
        idempotencyKey: `github:${org}:revoke:${username}`,
        manual: {
          title: `Retirer ${username} de ${org}`,
          runbook: RUNBOOK,
          deeplink: `https://github.com/orgs/${org}/people`,
          doneWhen: `${username} n'apparaît plus dans les membres de ${org}, ni dans les invitations en attente.`,
        },
      })),
    );
  },
};
