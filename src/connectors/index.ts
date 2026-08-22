import type { Connector } from "@/core/connector";
import { configurationDe } from "@/lib/configuration-connecteur";

import { CONTRAT_GITHUB, type ConfigGithub, creerGithub } from "./github";

/**
 * Les connecteurs se déclarent ici et nulle part ailleurs. La valeur de cet outil
 * tient au nombre de systèmes couverts : les énumérer en un seul endroit est ce qui
 * permet de les montrer tous, y compris ceux dont aucune voie automatique n'existe.
 *
 * C'est aussi ici que chacun reçoit sa configuration, sous une forme paresseuse :
 * la politique n'est lue qu'au premier connecteur qui s'en sert.
 */
export const CONNECTEURS: readonly Connector[] = [
  creerGithub(() => configurationDe<ConfigGithub>(CONTRAT_GITHUB)),
];

export function connecteur(key: string): Connector | undefined {
  return CONNECTEURS.find((candidat) => candidat.contract.key === key);
}
