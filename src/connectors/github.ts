import { z } from "zod";

import type {
  CollectError,
  CollectResult,
  Connector,
  ConnectorContract,
  ObservedDetail,
  ObservedGrant,
  ObservedIdentity,
  ObservedResource,
  PlannedStep,
  PrecheckResult,
  RiskLevel,
  RunContext,
  StepOutcome,
  SubjectRef,
} from "@/core/connector";
import type { ExamenDeScope } from "@/core/octroi";
import { env } from "@/lib/env";

/**
 * Les organisations suivies sont déclarées dans la politique : un connecteur GitHub
 * qui vise d'autres organisations est le même connecteur autrement configuré, pas un
 * autre connecteur. Omettre la clé revient exactement à écrire ce défaut.
 *
 * `incubateur-ademe-admin` n'en fait pas partie malgré ce que laissait entendre le
 * catalogue : c'est un compte, pas une organisation, et il figure d'ailleurs parmi
 * les membres de celle-ci.
 *
 * Le `.min(1)` n'est pas décoratif : une liste vide ferait une collecte qui ne lit
 * rien, et un inventaire vide se distingue mal d'un départ collectif.
 */
const CONFIG = z.strictObject({
  organisations: z
    .array(z.string().min(1))
    .min(1, "au moins une organisation, sinon la collecte ne lit rien")
    .default(["incubateur-ademe"])
    .meta({
      description:
        "Organisations GitHub dont les comptes sont relevés. En retirer une fait disparaître les comptes qui n'y sont plus vus, et l'offboarding suivra.",
      examples: [["incubateur-ademe"]],
    }),
});

export type ConfigGithub = z.infer<typeof CONFIG>;

const CREDENTIAL = "github-token";

/**
 * Un second jeton, et non un droit de plus sur le premier : la collecte tourne toutes
 * les nuits sans personne pour la surveiller, elle n'a aucune raison de détenir de
 * quoi écrire.
 */
const CREDENTIAL_ADMIN = "github-token-admin";

const API = "https://api.github.com";

/**
 * `fetch` n'a aucun délai par défaut. Une réponse qui ne vient jamais gèlerait la
 * collecte entière, qui tourne la nuit sans personne pour la relancer, et cette
 * lecture-ci enchaîne une requête par équipe : une seule suffirait à tout bloquer.
 */
const DELAI_MS = 15_000;

const RUNBOOK =
  "Retirer la personne dans Settings > People de l'organisation, puis vérifier qu'elle ne figure plus dans la liste des membres ni dans les invitations en attente.";

const RUNBOOK_OCTROI =
  "Inviter la personne dans Settings > People de l'organisation, avec le rôle demandé, puis vérifier qu'elle figure parmi les membres avec ce rôle ou parmi les invitations en attente. Une invitation reste en attente tant qu'elle n'est pas acceptée : c'est un accès accordé, pas un accès en suspens.";

/**
 * Strict, et sans clé facultative : dans un profil écrit à la main, une clé inconnue
 * est une faute de frappe, et une faute de frappe ignorée en silence donne un octroi
 * qui ne fait pas ce que son auteur croit avoir écrit.
 *
 * L'organisation reste une chaîne libre plutôt qu'une énumération : les organisations
 * suivies sont déclarées dans la politique, donc inconnues à la compilation. Qu'une
 * valeur figure bien parmi elles se vérifie contre la configuration résolue, ailleurs :
 * ce schéma est statique et déclaratif, il ne connaît aucune configuration.
 */
const SCOPE = z.strictObject({
  organisation: z
    .string()
    .min(1)
    .meta({
      description:
        "Organisation GitHub visée par l'octroi. Elle doit figurer parmi celles déclarées sous connectors.github.organisations.",
      examples: ["incubateur-ademe"],
    }),
  role: z.enum(["member", "admin"]).meta({
    description:
      "Rôle dans l'organisation. « admin » porte sur l'organisation entière, ses dépôts et ses membres compris.",
    examples: ["member"],
  }),
});

export type ScopeGithub = z.infer<typeof SCOPE>;

/**
 * Un membre ordinaire d'une organisation n'ouvre pas ce qu'ouvre son administration,
 * qui porte sur l'organisation entière, ses dépôts et ses membres.
 *
 * Écrit une fois : c'est ce risque qui fait exiger une échéance à la construction du
 * plan, et c'est lui que l'étape porte ensuite. Deux expressions de la même règle
 * finiraient par diverger, et un accès élevé se retrouverait sans terme.
 */
function risqueDuRole(role: ScopeGithub["role"]): RiskLevel {
  return role === "admin" ? "high" : "medium";
}

/**
 * Ce que `SCOPE` ne peut pas dire de lui-même : les organisations suivies sont
 * déclarées dans la politique, donc inconnues à la compilation, et le schéma reste
 * statique pour que `z.toJSONSchema` le rende. L'appartenance se vérifie donc ici,
 * contre la configuration résolue, et le connecteur est le seul à savoir lequel de ses
 * champs de scope en dépend.
 *
 * Le scope arrive tel que `SCOPE` l'a rendu et jamais autrement : c'est le contrat de
 * `examinerScope`, qui n'est appelé qu'après validation.
 */
export function examinerScopeGithub(
  organisations: readonly string[],
): (scope: unknown) => ExamenDeScope {
  return (scope) => {
    const { organisation, role } = scope as ScopeGithub;

    return {
      refus: organisations.includes(organisation)
        ? []
        : [
            `scope.organisation : « ${organisation} » ne figure pas parmi les organisations déclarées sous connectors.github.organisations (${organisations.join(", ")}).`,
          ],
      risque: risqueDuRole(role),
      libelle: `le rôle ${role} sur l'organisation ${organisation}`,
      // L'organisation seule : une place d'un rôle et une place d'un autre sont la même
      // place, et un profil qui demanderait les deux en verrait une rester en écart.
      cible: `organisation:${organisation}`,
    };
  };
}

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
        signal: AbortSignal.timeout(DELAI_MS),
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
export async function collecter(
  lire: Lecteur,
  organisations: readonly string[],
): Promise<CollectResult> {
  const identites = new Map<string, ObservedIdentity>();
  const ressources: ObservedResource[] = [];
  const acces: ObservedGrant[] = [];
  const erreurs: CollectError[] = [];
  let rendues = 0;

  for (const org of organisations) {
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

// ---------------------------------------------------------------------------
// L'octroi : ce qu'une arrivée demande, et ce qui l'exécute
// ---------------------------------------------------------------------------

const ACTION_OCTROI = "inviter-dans-l-organisation";

/**
 * La fenêtre pendant laquelle un octroi se défait sans dommage, déclarée une fois et
 * portée à la fois par la capacité et par l'étape : c'est elle qui décide de l'ordre
 * d'exécution, et deux valeurs qui divergeraient feraient exécuter en premier ce qu'on
 * croit le plus facile à défaire.
 */
const REVERSIBLE_JOURS = 7;

const REVERSIBLE_MS = REVERSIBLE_JOURS * 24 * 60 * 60_000;

/**
 * Les étapes qu'un accès de profil ouvre sur GitHub, décidées sans rien lire.
 *
 * Une seule étape par accès : un scope nomme une organisation et un rôle, et un profil
 * qui vise deux organisations porte deux accès.
 *
 * Deux choses la font dégrader en manuel, et elles ne se confondent pas. Sans jeton
 * d'écriture, aucune voie automatique n'existe, et l'étape doit dire exactement ce que
 * la résolution de capacité dit aux écrans, faute de quoi elle annoncerait un geste
 * que la boucle tenterait pour rien. Sans identifiant GitHub sûr, il n'y a personne à
 * inviter : ce qui manque là est une donnée, le connecteur en répond seul, et une
 * ressemblance n'ouvre jamais un accès sur le compte d'un autre.
 */
export function planifierOctroiGithub(
  scope: ScopeGithub,
  sujet: SubjectRef,
  ecriturePossible: boolean,
): readonly PlannedStep[] {
  const { organisation, role } = scope;
  const qui = sujet.kind === "person" ? sujet.username : sujet.key;
  const compte = sujet.kind === "person" ? (sujet.handles?.["github"] ?? null) : null;
  const auto = ecriturePossible && compte !== null;

  const pourquoi =
    compte === null
      ? ` Aucun identifiant GitHub sûr n'est connu pour ${qui} : c'est à l'opérateur de désigner le compte, personne ici ne le devine.`
      : ` Aucune voie automatique n'est praticable, il manque : ${CREDENTIAL_ADMIN}.`;

  return [
    {
      systemKey: "github",
      capability: "grant",
      tier: auto ? "auto" : "manual",
      action: ACTION_OCTROI,
      label: `Inviter ${qui}${compte === null ? "" : ` (compte ${compte})`} dans l'organisation ${organisation} avec le rôle ${role}`,
      params: { organisation, role, beneficiaire: qui, compte },
      riskLevel: risqueDuRole(role),
      expectedState: { membre: true, role },
      // Sur l'identifiant beta.gouv et non sur le compte GitHub : c'est le pivot
      // d'identité, et une clé qui suivrait le compte ferait perdre de vue le geste le
      // jour où le compte se découvre entre la confirmation et l'exécution. Le compte
      // visé, lui, est dans les paramètres, donc dans l'empreinte : s'il change, le
      // plan confirmé ne décrit plus ce qui a été approuvé, et c'est exact.
      idempotencyKey: `github:${organisation}:grant:${qui}:${role}`,
      ...(auto ? { reversibleForDays: REVERSIBLE_JOURS } : {}),
      ...(auto
        ? {}
        : {
            manual: {
              title: `Inviter ${qui} dans ${organisation} avec le rôle ${role}`,
              runbook: `${RUNBOOK_OCTROI}${pourquoi}`,
              deeplink: `https://github.com/orgs/${organisation}/people`,
              doneWhen: `${qui} figure parmi les membres de ${organisation} avec le rôle ${role}, ou parmi les invitations en attente de l'organisation : une invitation en attente est un accès accordé, elle n'attend qu'une acceptation.`,
            },
          }),
    },
  ];
}

interface CibleDOctroi {
  organisation: string;
  compte: string;
  role: string;
}

/**
 * Ce qu'une étape d'octroi vise, relu depuis les paramètres figés à sa construction.
 *
 * Nul dès que l'étape n'est pas un octroi écrit par ce connecteur, ou qu'aucun compte
 * GitHub ne lui a été désigné : le précheck n'a alors rien à constater et l'exécution
 * n'a personne à inviter. Une étape de retrait porte l'identifiant beta.gouv et non le
 * login GitHub, et déduire l'un de l'autre serait exactement la ressemblance sur
 * laquelle ce produit refuse d'agir.
 */
function cibleDOctroi(step: PlannedStep): CibleDOctroi | null {
  if (step.action !== ACTION_OCTROI) {
    return null;
  }

  const organisation = step.params["organisation"];
  const compte = step.params["compte"];
  const role = step.params["role"];

  if (typeof organisation !== "string" || organisation.length === 0) {
    return null;
  }
  if (typeof compte !== "string" || compte.length === 0) {
    return null;
  }
  if (typeof role !== "string" || role.length === 0) {
    return null;
  }

  return { organisation, compte, role };
}

function cheminDAppartenance(cible: CibleDOctroi): string {
  return `/orgs/${encodeURIComponent(cible.organisation)}/memberships/${encodeURIComponent(cible.compte)}`;
}

export interface ReponseGithub {
  statut: number;
  corps: unknown;
}

/**
 * Un appel unitaire, séparé de son interprétation pour la même raison que la lecture
 * l'est de l'assemblage : ce qui décide doit se prouver sans réseau.
 */
export type Sonde = (chemin: string) => Promise<ReponseGithub>;

export type Ecriture = (chemin: string, corps: unknown) => Promise<ReponseGithub>;

interface Appartenance {
  etat: string | null;
  role: string | null;
}

/**
 * Le vocabulaire des invitations et celui des adhésions ne coïncident pas : ce que
 * l'un appelle « direct_member », l'autre l'appelle « member ». Les tenir pour
 * distincts ferait passer chaque invitation ordinaire pour un écart de rôle.
 */
function roleLu(valeur: unknown): string | null {
  if (typeof valeur !== "string" || valeur.length === 0) {
    return null;
  }
  return valeur === "direct_member" ? "member" : valeur;
}

function appartenanceLue(corps: unknown): Appartenance {
  const objet =
    typeof corps === "object" && corps !== null ? (corps as Record<string, unknown>) : {};
  const etat = objet["state"];

  return {
    etat: typeof etat === "string" && etat.length > 0 ? etat : null,
    role: roleLu(objet["role"]),
  };
}

/** Les deux états sous lesquels GitHub rend un accès accordé, accepté ou non. */
const ETATS_PRESENTS: readonly string[] = ["active", "pending"];

/**
 * Ce que la lecture d'une appartenance dit de l'étape, et rien d'autre : pure, sans
 * horloge ni réseau, parce que c'est la ligne qui arrête l'escalade silencieuse et
 * qu'elle doit se prouver sans rien brancher.
 *
 * Un `PUT` sur une adhésion existante avec un autre rôle ne proteste pas : il change le
 * rôle en place et répond 200. C'est une escalade de privilège que rien ne signalerait,
 * et `STALE` est ce qui l'empêche. Cette ligne ne s'assouplit jamais au motif que
 * l'étape serait idempotente : elle ne l'est pas.
 *
 * Une réponse dont l'état ne se lit pas vaut écart et non absence : ne pas savoir
 * n'autorise pas à écrire.
 */
export function interpreterAppartenance(
  statut: number,
  corps: unknown,
  attendu: { role: string },
): PrecheckResult {
  // Ni membre, ni invité : il reste quelque chose à faire, et c'est le seul cas où
  // l'écriture est sûre de n'écraser aucun rôle en place.
  if (statut === 404) {
    return { state: "READY" };
  }

  if (statut !== 200) {
    throw new GithubError(
      "memberships",
      `${statut} : l'appartenance n'a pas pu être constatée, rien n'est décidé dessus`,
    );
  }

  const lue = appartenanceLue(corps);

  if (lue.etat !== null && ETATS_PRESENTS.includes(lue.etat) && lue.role === attendu.role) {
    return { state: "ALREADY_PRESENT" };
  }

  return {
    state: "STALE",
    expected: { etat: "active ou pending", role: attendu.role },
    actual: { etat: lue.etat, role: lue.role },
  };
}

/**
 * Le précheck, qui est une lecture et rien d'autre.
 *
 * Il tourne dans les deux régimes, simulation comprise, et jusque sur une étape
 * manuelle : éviter d'envoyer un humain faire ce qui est déjà fait en est le meilleur
 * usage.
 */
export async function constaterAppartenance(
  sonder: Sonde,
  step: PlannedStep,
): Promise<PrecheckResult> {
  const cible = cibleDOctroi(step);

  // Rien à constater n'est pas un échec : l'étape reste ce qu'elle était, et la main
  // qui la coche décidera. Lever ici ferait compter un échec à chaque passage sur une
  // étape dont on sait déjà qu'elle est manuelle.
  if (!cible) {
    return { state: "READY" };
  }

  const { statut, corps } = await sonder(cheminDAppartenance(cible));

  return interpreterAppartenance(statut, corps, { role: cible.role });
}

function messageDuCorps(corps: unknown): string | null {
  if (typeof corps !== "object" || corps === null) {
    return null;
  }

  const dit = (corps as Record<string, unknown>)["message"];
  return typeof dit === "string" && dit.length > 0 ? dit : null;
}

/** Les statuts dont la cause peut disparaître d'elle-même, et eux seuls. */
function reprenable(statut: number): boolean {
  return statut === 408 || statut === 429 || statut >= 500;
}

/**
 * Ce qu'un octroi écrit devient dans le dossier. Pure, horloge comprise : la fenêtre de
 * réversibilité se compte depuis l'instant du run, qui arrive par paramètre.
 *
 * Un `PUT` sur quelqu'un qui n'est pas membre n'ouvre pas un accès, il envoie une
 * invitation, et l'évidence le dit en toutes lettres : sans quoi le dossier annoncerait
 * un accès ouvert que personne n'a encore accepté.
 */
export function interpreterOctroi(statut: number, corps: unknown, maintenant: Date): StepOutcome {
  if (statut < 200 || statut >= 300) {
    const dit = messageDuCorps(corps);

    return {
      state: "FAILED",
      error: `GitHub a répondu ${statut}${dit === null ? "" : ` : ${dit}`}`,
      retryable: reprenable(statut),
    };
  }

  const lue = appartenanceLue(corps);
  const role = lue.role ?? "inconnu";

  const evidence =
    lue.etat === "pending"
      ? `Invitation envoyée avec le rôle ${role}. Elle reste en attente tant que la personne ne l'a pas acceptée, et c'est déjà un accès accordé.`
      : lue.etat === "active"
        ? `Adhésion active avec le rôle ${role}.`
        : `GitHub a répondu ${statut} sans état lisible : l'écriture a eu lieu, l'état constaté reste à vérifier.`;

  return {
    state: "SUCCEEDED",
    reversibleUntil: new Date(maintenant.getTime() + REVERSIBLE_MS),
    evidence,
  };
}

const REFUS_SIMULATION =
  "ACTIONS_ENABLED n'autorise aucune écriture : une exécution a été demandée en simulation, et aucun appel n'est parti. Le garde-fou est ici autant que chez l'appelant, pour qu'aucun appelant n'ait à s'en souvenir.";

/**
 * L'octroi écrit, et les trois refus qui le précèdent.
 *
 * La simulation d'abord, avant même de regarder ce que l'étape demande : ce qui ne
 * part pas ne peut pas partir par erreur. Puis le credential, dont l'absence est
 * définitive au sens de la reprise, la même exécution échouant de la même façon. Puis
 * l'étape elle-même : un connecteur qui exécuterait un geste qu'il ne reconnaît pas
 * écrirait au hasard sur un système tiers.
 */
export async function executerOctroi(
  ecrire: Ecriture,
  ecriturePossible: boolean,
  step: PlannedStep,
  ctx: RunContext,
): Promise<StepOutcome> {
  if (ctx.dryRun) {
    throw new Error(REFUS_SIMULATION);
  }

  if (!ecriturePossible) {
    return {
      state: "FAILED",
      error: `${CREDENTIAL_ADMIN} n'est pas configuré : aucune écriture n'est possible sur les membres de l'organisation, et l'étape est à faire à la main. ${RUNBOOK_OCTROI}`,
      retryable: false,
    };
  }

  if (step.action !== ACTION_OCTROI) {
    return {
      state: "FAILED",
      error: `Le connecteur GitHub ne sait pas exécuter l'action « ${step.action} » : elle ne vient pas de lui, et la reprendre telle quelle échouerait de la même façon.`,
      retryable: false,
    };
  }

  const cible = cibleDOctroi(step);

  if (!cible) {
    return {
      state: "FAILED",
      error: `Cette étape ne désigne aucun compte GitHub sûr : il n'y a personne à inviter, et c'est à l'opérateur de le faire. ${RUNBOOK_OCTROI}`,
      retryable: false,
    };
  }

  let reponse: ReponseGithub;
  try {
    reponse = await ecrire(cheminDAppartenance(cible), { role: cible.role });
  } catch (cause: unknown) {
    // Une panne de transport ne dit rien de l'écriture, et surtout pas qu'elle n'a pas
    // eu lieu : la reprise repassera par le précheck, qui constatera.
    return { state: "FAILED", error: message(cause), retryable: true };
  }

  return interpreterOctroi(reponse.statut, reponse.corps, ctx.now);
}

/**
 * Un appel unitaire qui rend le statut au lieu de lever dessus : ce qu'une lecture
 * d'appartenance doit décider tient dans le code de retour, un 404 y disant « personne
 * n'est là » et non « la lecture a échoué ».
 */
async function appeler(
  methode: "GET" | "PUT",
  chemin: string,
  jeton: string | undefined,
  corps?: unknown,
): Promise<ReponseGithub> {
  if (!jeton) {
    throw new GithubError(chemin, "aucun jeton GitHub configuré");
  }

  let reponse: Response;
  try {
    reponse = await fetch(`${API}${chemin}`, {
      method: methode,
      headers: {
        authorization: `Bearer ${jeton}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(corps === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (cause: unknown) {
    throw new GithubError(chemin, message(cause));
  }

  return { statut: reponse.status, corps: analyser(await reponse.text().catch(() => "")) };
}

/**
 * Un corps illisible n'est pas une panne : plusieurs réponses de l'API n'en portent
 * aucun, et leur statut suffit à les interpréter.
 */
function analyser(texte: string): unknown {
  try {
    return texte.length > 0 ? JSON.parse(texte) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * La lecture qui autorise une écriture passe par le jeton qui écrira, et ne se rabat
 * sur celui de collecte qu'à défaut : un 404 ne vaut « personne n'est là » que lu par
 * ce jeton-là. Deux jetons émis séparément peuvent voir deux périmètres
 * d'organisations, et GitHub rend 404 aussi bien pour « aucune adhésion » que pour
 * « hors du périmètre de ce jeton ». Lu par le plus étroit des deux, ce 404 ferait
 * passer un membre en place pour un absent, et l'écriture élèverait son rôle au lieu
 * de l'inviter.
 *
 * Le repli garde exactement ce qui le justifie : sans jeton d'écriture, l'étape est
 * manuelle et aucune écriture ne peut suivre le constat, donc le précheck tourne quand
 * même et évite d'envoyer quelqu'un faire ce qui est déjà fait.
 */
const sonder: Sonde = (chemin) =>
  appeler("GET", chemin, env.GITHUB_ADMIN_TOKEN ?? env.GITHUB_TOKEN);

const ecrire: Ecriture = (chemin, corps) => appeler("PUT", chemin, env.GITHUB_ADMIN_TOKEN, corps);

export const CONTRAT_GITHUB: ConnectorContract = {
  key: "github",
  label: "GitHub",
  criticality: "high",
  runbook: RUNBOOK,
  credentials: [
    {
      id: CREDENTIAL,
      source: "env",
      scopeNote:
        "Jeton fine-grained restreint, en lecture seule, aux organisations déclarées sous connectors.github.organisations. Seul système du catalogue dont le fournisseur sait émettre un credential nativement restreint, donc sans proxy.",
      nominative: false,
    },
    {
      id: CREDENTIAL_ADMIN,
      source: "env",
      scopeNote:
        "Jeton fine-grained restreint aux mêmes organisations, mais porteur de l'écriture sur leurs membres : il sait inviter, changer un rôle et retirer. Distinct du jeton de lecture pour que la collecte nocturne n'en dispose jamais.",
      nominative: false,
    },
  ],
  capabilities: {
    list: [{ requires: [CREDENTIAL], tier: "auto" }],
    // La voie manuelle est inconditionnelle et reste déclarée sous la voie
    // automatique : un chemin auto qui tombe redevient un chemin manuel, et sans
    // elle un jeton d'administration absent ferait disparaître l'octroi au lieu de le
    // dégrader.
    grant: [
      {
        requires: [CREDENTIAL_ADMIN],
        tier: "auto",
        reversibleForDays: REVERSIBLE_JOURS,
        runbook: RUNBOOK_OCTROI,
      },
      { requires: [], tier: "manual", runbook: RUNBOOK_OCTROI },
    ],
    // Aucune voie automatique en v1 : retirer quelqu'un d'une organisation se fait
    // à la main, et le socle rend la tâche plutôt qu'un appel d'API.
    revoke: [{ requires: [], tier: "manual", runbook: RUNBOOK }],
  },
  scopeSchema: SCOPE,
  configSchema: CONFIG,
};

/**
 * Le connecteur reçoit sa configuration, il ne va pas la chercher : c'est ce qui le
 * laisse testable sans système de fichiers, dans le sens où sa lecture va déjà.
 *
 * L'accesseur est paresseux parce que ce module est importé par la collecte, par le
 * web et par la génération de schéma : résoudre à l'import exigerait une politique
 * valide du simple fait de charger le module.
 */
export function creerGithub(lireConfig: () => ConfigGithub): Connector {
  return {
    contract: CONTRAT_GITHUB,

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
        {
          id: CREDENTIAL_ADMIN,
          available: Boolean(env.GITHUB_ADMIN_TOKEN),
          ...(env.GITHUB_ADMIN_TOKEN
            ? {}
            : { unavailableReason: "GITHUB_ADMIN_TOKEN absent de l'environnement" }),
          checkedAt: new Date(),
        },
      ]),

    list: (): Promise<CollectResult> => collecter(lireTout, lireConfig().organisations),

    plan: (intent) => {
      if (intent.subject.kind !== "person") {
        return Promise.resolve([]);
      }

      // Un octroi ne se décide qu'avec son scope, et le scope vient du profil : il
      // passe donc par `planifierOctroi`, qui appelle la même fonction que voici. Sans
      // scope, aucune étape : émettre ici une adhésion par défaut donnerait à toute
      // arrivée un accès que personne n'a demandé, et ferait sortir le même octroi
      // sous deux clés que le dédoublonnage ne rapprocherait pas.
      if (intent.kind === "grant") {
        const lu = SCOPE.safeParse(intent.scope);

        return Promise.resolve(
          lu.success
            ? planifierOctroiGithub(lu.data, intent.subject, Boolean(env.GITHUB_ADMIN_TOKEN))
            : [],
        );
      }

      const username = intent.subject.username;

      return Promise.resolve(
        lireConfig().organisations.map((org) => ({
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

    /**
     * Le tier se décide ici parce que le connecteur est le seul à connaître les deux
     * faits qui le fixent : son credential d'écriture, qu'il sonde déjà, et
     * l'identifiant sûr que le socle lui passe ou ne lui passe pas.
     */
    planifierOctroi: (scope, sujet) =>
      planifierOctroiGithub(scope as ScopeGithub, sujet, Boolean(env.GITHUB_ADMIN_TOKEN)),

    precheck: (step) => constaterAppartenance(sonder, step),

    execute: (step, ctx) => executerOctroi(ecrire, Boolean(env.GITHUB_ADMIN_TOKEN), step, ctx),
  };
}
