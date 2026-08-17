import type { z } from "zod";

import type { AuditInput } from "@/core/audit";

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
  /** Valide les scopes de grant. Converti en JSON Schema par z.toJSONSchema pour générer les formulaires. */
  scopeSchema: z.ZodType;
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

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------

export interface ObservedIdentity {
  externalId: string;
  idKind: "opaque" | "email" | "upn";
  handle: string;
  /** Sert au rapprochement initial. Une personne porte souvent plusieurs adresses. */
  emails?: readonly string[];
  lastActivityAt?: Date;
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

export type SubjectRef = { kind: "person"; username: string } | { kind: "service"; key: string };

export interface Intent {
  kind: "grant" | "revoke";
  subject: SubjectRef;
  scope?: unknown;
}

export interface ManualTask {
  title: string;
  runbook: string;
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
}

export type PrecheckResult =
  | { state: "READY" }
  | { state: "ALREADY_ABSENT" }
  | { state: "STALE"; expected: unknown; actual: unknown };

export type StepOutcome =
  | { state: "SUCCEEDED"; reversibleUntil?: Date; evidence?: string }
  | { state: "ALREADY_ABSENT" }
  | { state: "FAILED"; error: string; retryable: boolean };

export interface RunContext {
  runId: string;
  now: Date;
  /** Forcé à true par ACTIONS_ENABLED=false, sans modification de code. */
  dryRun: boolean;
  audit: (event: AuditInput) => void;
}

export interface Connector {
  readonly contract: ConnectorContract;

  probe: () => Promise<readonly CredentialProbe[]>;

  list?: (ctx: RunContext) => Promise<CollectResult>;

  plan: (intent: Intent, ctx: RunContext) => Promise<readonly PlannedStep[]>;

  /** Séparé de execute pour que le socle traite ALREADY_ABSENT et STALE de façon uniforme, sans que chaque connecteur ait à le savoir. */
  precheck?: (step: PlannedStep, ctx: RunContext) => Promise<PrecheckResult>;

  /** Absent quand aucune voie automatique n'existe : le socle produit alors la tâche manuelle du step. */
  execute?: (step: PlannedStep, ctx: RunContext) => Promise<StepOutcome>;
}
