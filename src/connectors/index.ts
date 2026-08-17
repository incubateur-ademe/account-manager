import type { Connector } from "@/core/connector";

import { github } from "./github";

/**
 * Les connecteurs se déclarent ici et nulle part ailleurs. La valeur de cet outil
 * tient au nombre de systèmes couverts : les énumérer en un seul endroit est ce qui
 * permet de les montrer tous, y compris ceux dont aucune voie automatique n'existe.
 */
export const CONNECTEURS: readonly Connector[] = [github];

export function connecteur(key: string): Connector | undefined {
  return CONNECTEURS.find((candidat) => candidat.contract.key === key);
}
