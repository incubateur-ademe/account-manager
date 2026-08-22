import type { ComponentType } from "react";

import type { ConnectorContract } from "@/core/connector";

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
