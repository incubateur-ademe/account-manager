import { z } from "zod";

import type {
  CollectError,
  CollectResult,
  Connector,
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
}

interface InvitationApi {
  id: number;
  login: string | null;
  email: string | null;
  role: string;
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

async function lireOrganisation(
  org: string,
  identites: Map<string, ObservedIdentity>,
  acces: ObservedGrant[],
): Promise<void> {
  for (const role of ["admin", "member"] as const) {
    const membres = await lireTout<MembreApi>(`/orgs/${org}/members?role=${role}`);

    for (const membre of membres) {
      const externalId = String(membre.id);
      identites.set(externalId, { externalId, idKind: "opaque", handle: membre.login });
      acces.push({ identityExternalId: externalId, resourceExternalId: org, role });
    }
  }

  // Une invitation en attente est un accès qui n'attend qu'un clic, et elle ne périme
  // jamais d'elle-même : l'ignorer laisserait une porte ouverte que rien ne referme.
  const invitations = await lireTout<InvitationApi>(`/orgs/${org}/invitations`);

  for (const invitation of invitations) {
    const externalId = invitation.login
      ? `invite-${invitation.id}`
      : `email:${invitation.email ?? invitation.id}`;

    identites.set(externalId, {
      externalId,
      idKind: invitation.login ? "opaque" : "email",
      handle: invitation.login ?? invitation.email ?? `invitation ${invitation.id}`,
      ...(invitation.email ? { emails: [invitation.email] } : {}),
    });

    acces.push({
      identityExternalId: externalId,
      resourceExternalId: org,
      role: `invite:${invitation.role}`,
    });
  }
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

  list: async (): Promise<CollectResult> => {
    const identites = new Map<string, ObservedIdentity>();
    const acces: ObservedGrant[] = [];
    const ressources: ObservedResource[] = [];
    const erreurs: CollectError[] = [];

    for (const org of ORGANISATIONS) {
      try {
        await lireOrganisation(org, identites, acces);
        ressources.push({
          externalId: org,
          label: `Organisation ${org}`,
          url: `https://github.com/${org}`,
        });
      } catch (cause: unknown) {
        // Une organisation illisible n'invalide pas l'autre, mais empêche de conclure
        // que ce qui manque a disparu : le socle s'en chargera à partir du statut.
        erreurs.push({
          scope: "organisation",
          itemRef: org,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    if (erreurs.length === ORGANISATIONS.length) {
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
      : {
          status: "partial",
          errors: [erreurs[0] as CollectError, ...erreurs.slice(1)],
          ...payload,
        };
  },

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
