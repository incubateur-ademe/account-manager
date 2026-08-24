import type { ComponentType } from "react";

import type { ConnectorContract } from "@/core/connector";

import type { TuileDeConnecteur } from "./contrat";

export interface ProprietesEcran {
  contrat: ConnectorContract;
  /** Résolue par la page, défauts compris. Indéfinie quand le connecteur ne se règle pas. */
  configuration: unknown;
}

type ChargeurEcran = () => Promise<{ default: ComponentType<ProprietesEcran> }>;

/**
 * L'import ne va que dans un sens : `src/ui/` connaît `src/connectors/`, jamais
 * l'inverse. Un chargeur plutôt qu'un composant importé garde le graphe statique
 * propre, et laisse la collecte en ligne de commande ignorer que tout ceci existe.
 */
const ECRANS: Readonly<Record<string, ChargeurEcran>> = {
  github: () => import("./github/Ecran"),
};

type ChargeurTuiles = () => Promise<{ tuiles: readonly TuileDeConnecteur[] }>;

/**
 * Ce qu'un connecteur pose sur le tableau de bord. Même indirection que les écrans, et
 * pour la même raison : la collecte en ligne de commande ne doit jamais charger de
 * composant.
 */
const TUILES: Readonly<Record<string, ChargeurTuiles>> = {
  github: () => import("./github/tuiles"),
};

export function tuilesDe(cle: string): ChargeurTuiles | undefined {
  return Object.hasOwn(TUILES, cle) ? TUILES[cle] : undefined;
}

export function clesAvecTuiles(): readonly string[] {
  return Object.keys(TUILES);
}

export function ecranDe(cle: string): ChargeurEcran | undefined {
  // `Object.hasOwn` et non un accès direct : sans lui, une clé nommée « constructor »
  // ou « toString » rendrait un membre du prototype, donc une page pour un connecteur
  // qui n'existe pas.
  return Object.hasOwn(ECRANS, cle) ? ECRANS[cle] : undefined;
}

export function clesAvecEcran(): readonly string[] {
  return Object.keys(ECRANS);
}

/**
 * Une seule règle, deux appelants : le lien depuis l'écran Systèmes et le refus de la
 * route. Deux règles séparées divergeraient, donc donneraient un lien mort d'un côté
 * ou une page devinable de l'autre.
 */
export function aUnePage(contrat: ConnectorContract): boolean {
  return (
    ecranDe(contrat.key) !== undefined ||
    contrat.configSchema !== undefined ||
    (contrat.features?.length ?? 0) > 0
  );
}
