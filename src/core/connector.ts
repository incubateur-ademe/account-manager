import type { z } from "zod";

import type { AuditInput } from "@/core/audit";
import type { Acteur } from "@/core/dossier";
import type { OrigineFigee } from "@/core/modele-plan";

export type Capability = "list" | "grant" | "revoke" | "verify";

export type Tier = "auto" | "assisted" | "manual" | "none";

export type RiskLevel = "low" | "medium" | "high";

export type NonEmptyArray<T> = readonly [T, ...T[]];

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface CredentialRef {
  id: string;
  source: "env" | "fgp";
  /** Portée réelle en clair. Un credential plus large que son usage est une dette assumée, pas une découverte au prochain audit. */
  scopeNote: string;
  /** Rattaché à une personne physique : meurt avec son départ ou sa déconnexion. */
  nominative: boolean;
}

export interface CredentialProbe {
  id: string;
  available: boolean;
  unavailableReason?: string;
  checkedAt: Date;
}

// ---------------------------------------------------------------------------
// Déclaration
// ---------------------------------------------------------------------------

export interface CapabilityDecl {
  /** Vide signifie inconditionnel : c'est le cas du chemin manuel, toujours disponible. */
  requires: readonly string[];
  /** "none" ne se déclare jamais, il résulte de l'absence de toute voie praticable. */
  tier: Exclude<Tier, "none">;
  reversibleForDays?: number;
  slaHours?: number;
  /** API non officielle, non versionnée ou non documentée. */
  fragile?: boolean;
  runbook?: string;
}

export interface ConnectorFeature {
  key: string;
  label: string;
  requires: readonly string[];
  /** Segment de route sous `/systemes/<key>/`, où l'écran de la fonctionnalité vit. */
  entrypoint: string;
}

export interface ConnectorContract {
  key: string;
  label: string;
  criticality: RiskLevel;
  /** Requis même quand tout est automatique : un chemin auto qui tombe redevient un chemin manuel. */
  runbook: string;
  credentials: readonly CredentialRef[];
  /** Ordonné du meilleur tier au moins bon. Une capability absente vaut "none". */
  capabilities: Partial<Record<Capability, NonEmptyArray<CapabilityDecl>>>;
  /**
   * Valide les scopes de grant, et fait foi sur ceux qu'un profil de la politique
   * déclare pour ce système. Converti en JSON Schema par `z.toJSONSchema` pour
   * générer les formulaires et pour afficher le scope attendu.
   *
   * Déclaratif, sans `.transform()`, pour la même raison que `configSchema`. Il ne
   * connaît pas la configuration résolue : ce qui s'y vérifie est la forme, jamais
   * l'appartenance d'une valeur à une liste déclarée ailleurs.
   *
   * Strict, y compris quand il n'attend aucun champ : dans un profil écrit à la
   * main, une clé inconnue est une faute de frappe, et un scope recopié d'un autre
   * système passerait sans un mot sous un schéma qui se contente de l'ignorer.
   */
  scopeSchema: z.ZodType;
  /**
   * Contrat de la clé `connectors.<key>` du fichier de politique. Absent quand le
   * connecteur ne se règle pas, auquel cas y poser une entrée est un refus.
   *
   * Aucun secret : ce fichier est versionné dans un dépôt lisible, et la page du
   * connecteur affiche la configuration résolue telle quelle. Les credentials
   * restent dans l'environnement.
   *
   * Déclaratif, sans `.transform()` : `z.toJSONSchema` lève dessus, et la saisie
   * assistée du fichier de politique en dérive.
   */
  configSchema?: z.ZodType;
  /** Fonctionnalités hors socle, qui ne passent ni par Person ni par AccessGrant. */
  features?: readonly ConnectorFeature[];
}

// ---------------------------------------------------------------------------
// Résolution du tier effectif
// ---------------------------------------------------------------------------

export interface ResolvedCapability {
  capability: Capability;
  tier: Tier;
  decl?: CapabilityDecl;
  runbook: string;
  /** Renseigné quand une voie meilleure existe mais n'est pas praticable. Affiché dans le plan. */
  degradedFrom?: { tier: Tier; missing: readonly string[] };
}

export function resolveCapability(
  capability: Capability,
  decls: readonly CapabilityDecl[] | undefined,
  probes: readonly CredentialProbe[],
  contractRunbook: string,
): ResolvedCapability {
  const available = new Set(probes.filter((p) => p.available).map((p) => p.id));
  const missingOf = (decl: CapabilityDecl) => decl.requires.filter((id) => !available.has(id));

  const best = decls?.[0];
  const degradation = (from: CapabilityDecl) => ({
    degradedFrom: { tier: from.tier, missing: missingOf(from) },
  });

  for (const decl of decls ?? []) {
    if (missingOf(decl).length > 0) {
      continue;
    }
    return {
      capability,
      tier: decl.tier,
      decl,
      runbook: decl.runbook ?? contractRunbook,
      ...(best && decl !== best ? degradation(best) : {}),
    };
  }

  return {
    capability,
    tier: "none",
    runbook: contractRunbook,
    ...(best ? degradation(best) : {}),
  };
}

export interface ResolvedFeature {
  feature: ConnectorFeature;
  available: boolean;
  /** Credentials qui manquent. Vide quand la fonctionnalité est praticable. */
  missing: readonly string[];
}

/**
 * Même règle que pour les capacités : ce qui est indisponible se dit, il ne se cache
 * pas. Une fonctionnalité qu'on masque faute de credential laisse croire qu'elle
 * n'existe pas, là où elle attend seulement un secret.
 *
 * De la donnée pure, sans le moindre composant : la ligne de commande doit pouvoir
 * dire qu'une fonctionnalité est indisponible sans charger d'interface.
 */
export function resolveFeatures(
  features: readonly ConnectorFeature[] | undefined,
  probes: readonly CredentialProbe[],
): readonly ResolvedFeature[] {
  const available = new Set(probes.filter((probe) => probe.available).map((probe) => probe.id));

  return (features ?? []).map((feature) => {
    const missing = feature.requires.filter((id) => !available.has(id));
    return { feature, available: missing.length === 0, missing };
  });
}

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------

/**
 * Ce qu'un connecteur sait d'un compte et qu'aucune ressource ni aucun accès ne dit,
 * déjà rédigé pour être lu par un humain.
 *
 * Le socle ne l'interprète pas : il ne choisit ni l'ordre, ni le libellé, ni le
 * format, faute de quoi il faudrait qu'il connaisse chaque clé de chaque système,
 * c'est-à-dire qu'il interprète.
 */
export interface ObservedDetail {
  label: string;
  value: string;
}

export interface ObservedIdentity {
  externalId: string;
  idKind: "opaque" | "email" | "upn";
  handle: string;
  /** Sert au rapprochement initial. Une personne porte souvent plusieurs adresses. */
  emails?: readonly string[];
  lastActivityAt?: Date;
  /** Rendu tel quel, dans cet ordre, jamais interprété. Ce qui est un accès n'entre pas ici. */
  details?: readonly ObservedDetail[];
}

export interface ObservedResource {
  externalId: string;
  label: string;
  url?: string;
}

export interface ObservedGrant {
  identityExternalId: string;
  resourceExternalId?: string;
  role: string;
  lastActivityAt?: Date;
}

export interface CollectError {
  scope: string;
  message: string;
  itemRef?: string;
}

interface CollectPayload {
  itemsSeen: number;
  identities: readonly ObservedIdentity[];
  resources: readonly ObservedResource[];
  grants: readonly ObservedGrant[];
}

/** L'invariant « un run ok n'a avalé aucune erreur » est porté par le type, pas par la discipline de chaque connecteur. */
export type CollectResult =
  | ({ status: "ok"; errors?: undefined } & CollectPayload)
  | ({ status: "partial"; errors: NonEmptyArray<CollectError> } & CollectPayload)
  | { status: "failed"; errors: NonEmptyArray<CollectError> };

// ---------------------------------------------------------------------------
// Planification et exécution
// ---------------------------------------------------------------------------

export type SubjectRef =
  | {
      kind: "person";
      username: string;
      /**
       * Les identifiants de la personne sur les systèmes, indexés par clé de système,
       * et seulement ceux dont on répond. Une identité rapprochée par ressemblance
       * n'y entre jamais : accorder un accès d'administration au compte de quelqu'un
       * d'autre parce qu'il lui ressemble est plus grave que de couper le mauvais.
       *
       * Une clé absente vaut « aucun identifiant fiable », et le connecteur dégrade
       * alors son octroi en manuel de lui-même : ce qui manque ici est une donnée, pas
       * un credential, donc ce n'est pas à `resolveCapability` de le dire.
       */
      handles?: Readonly<Record<string, string>>;
    }
  | { kind: "service"; key: string };

export interface Intent {
  kind: "grant" | "revoke";
  subject: SubjectRef;
  scope?: unknown;
}

export interface ManualTask {
  title: string;
  /**
   * Obligatoire pour un connecteur, qui doit dire comment faire ce que son API ne
   * fait pas. Facultatif pour une étape déclarée dans un modèle, dont le critère de
   * complétion suffit souvent à dire ce qu'il y a à faire.
   */
  runbook?: string;
  deeplink?: string;
  /** Ce que l'opérateur doit constater pour cocher. Sans ça, « fait » ne veut rien dire. */
  doneWhen: string;
}

export interface PlannedStep {
  systemKey: string;
  capability: Capability;
  tier: Tier;
  action: string;
  /** Figé à la création du plan et jamais recalculé : ce qui est confirmé doit rester lisible dans deux ans. */
  label: string;
  params: Record<string, unknown>;
  riskLevel: RiskLevel;
  expectedState: unknown;
  reversibleForDays?: number;
  idempotencyKey: string;
  /** Présent dès que le tier n'est pas "auto". */
  manual?: ManualTask;
  /**
   * Le terme décidé de l'octroi, posé par le socle depuis le profil et jamais par un
   * connecteur : c'est la politique qui décide de la durée d'un accès, pas le système
   * qui l'ouvre.
   *
   * Hors de `params`, donc hors de l'empreinte, et c'est voulu : la date est absolue
   * et comptée depuis l'instant du calcul, si bien qu'un plan recalculé une seconde
   * plus tard se déclarerait obsolète tout seul.
   */
  grantExpiresAt?: Date;
  /**
   * L'origine déclarée de l'étape : quel modèle l'a demandée, sous quelle clé, et
   * quelle saisie elle attendait. Un connecteur ne le pose jamais, et son absence
   * signifie exactement « cette étape vient d'un système ».
   */
  template?: OrigineFigee;
  /**
   * Qui doit faire ce geste, et qui doit contrôler ce qui en sera déclaré. Absents,
   * l'étape revient à l'opérateur et se croit sur parole, ce qu'ont toujours été les
   * étapes qu'un connecteur calcule.
   *
   * Dans l'empreinte, à la différence de `grantExpiresAt` : qui doit agir et qui doit
   * contrôler font partie de ce qu'un opérateur approuve en confirmant, là où une
   * échéance absolue comptée depuis l'instant du calcul rendrait tout plan obsolète
   * une seconde plus tard.
   */
  expectedActor?: Acteur;
  validationBy?: Acteur;
}

/**
 * `ALREADY_PRESENT` est le symétrique d'`ALREADY_ABSENT` et jamais une relecture de
 * celui-ci : sous une étape d'octroi, l'écran afficherait « déjà absent ».
 */
export type PrecheckResult =
  | { state: "READY" }
  | { state: "ALREADY_ABSENT" }
  | { state: "ALREADY_PRESENT" }
  | { state: "STALE"; expected: unknown; actual: unknown };

export type StepOutcome =
  | { state: "SUCCEEDED"; reversibleUntil?: Date; evidence?: string }
  | { state: "ALREADY_ABSENT" }
  | { state: "ALREADY_PRESENT" }
  | { state: "FAILED"; error: string; retryable: boolean };

export interface RunContext {
  runId: string;
  now: Date;
  /** Forcé à true par ACTIONS_ENABLED=false, sans modification de code. */
  dryRun: boolean;
  audit: (event: AuditInput) => void;
}

/**
 * Ce qu'un connecteur constate du système distant avant de le lire, et qui n'est ni
 * un credential ni un compte : la forme de la réponse.
 */
export interface Diagnosis {
  /** Vide quand tout est conforme. Non vide, la lecture n'a pas lieu. */
  findings: readonly CollectError[];
}

export interface Connector {
  readonly contract: ConnectorContract;

  probe: () => Promise<readonly CredentialProbe[]>;

  /**
   * Ausculte le système distant avant de le lire, et décide si la lecture a lieu.
   *
   * Une collecte ne voit que ce qui la casse : un champ requis qui disparaît fait
   * écarter les fiches, donc rend un run non `ok`, donc n'efface personne. Un champ
   * facultatif qui disparaît, lui, ne casse rien et dérive en silence, en laissant
   * pour seul signe des rattachements qui cessent lentement de se faire.
   *
   * Chaque connecteur choisit donc à sa conception : porter un diagnostic quand ce
   * qu'il lit est trop peu spécifié pour se fier au hasard, ou laisser la collecte
   * échouer d'elle-même quand elle suffit. Un diagnostic qui rapporte quoi que ce
   * soit interdit la lecture plutôt que de la laisser conclure sur une forme dont on
   * ne sait plus ce qu'elle veut dire.
   */
  diagnose?: (ctx: RunContext) => Promise<Diagnosis>;

  list?: (ctx: RunContext) => Promise<CollectResult>;

  plan: (intent: Intent, ctx: RunContext) => Promise<readonly PlannedStep[]>;

  /**
   * Les étapes qu'un accès de profil ouvre, décidées sans rien lire.
   *
   * Synchrone quand `plan` ne l'est pas, et ce n'est pas un raccourci : `plan` a le
   * droit d'interroger son système pour affiner ce qu'il propose, décider des étapes
   * d'un octroi ne lit rien. Un assemblage d'arrivée se prouve ainsi sans rien
   * brancher, et son empreinte ne dépend ni de l'horloge ni du réseau.
   *
   * Le scope arrive tel que `scopeSchema` l'a rendu, jamais autrement, et le sujet
   * complet : c'est sous `handles` que le connecteur trouve, ou ne trouve pas,
   * l'identifiant dont le socle répond. Une clé absente le fait dégrader en manuel de
   * lui-même, ce qui manque étant une donnée et non un credential.
   *
   * Absent, chaque accès de profil visant ce système sort en étape manuelle portant le
   * runbook du contrat : une ligne d'arrivée qui manque est le mode de panne que ce
   * produit existe pour éviter. Présent, il devient la seule voie de ce qui dépend du
   * profil, et `plan` cesse d'émettre le même geste sur un octroi sans scope, faute de
   * quoi le même octroi serait proposé deux fois sous deux clés que le dédoublonnage
   * ne rapprocherait pas.
   */
  planifierOctroi?: (scope: unknown, subject: SubjectRef) => readonly PlannedStep[];

  /** Séparé de execute pour que le socle traite ALREADY_ABSENT, ALREADY_PRESENT et STALE de façon uniforme, sans que chaque connecteur ait à le savoir. */
  precheck?: (step: PlannedStep, ctx: RunContext) => Promise<PrecheckResult>;

  /** Absent quand aucune voie automatique n'existe : le socle produit alors la tâche manuelle du step. */
  execute?: (step: PlannedStep, ctx: RunContext) => Promise<StepOutcome>;
}
