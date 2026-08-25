import type { Connector } from "@/core/connector";
import type { ExamenDeScope, SystemeOffrantOctroi } from "@/core/octroi";
import { configurationDe } from "@/lib/configuration-connecteur";

import { CONTRAT_GITHUB, type ConfigGithub, creerGithub, examinerScopeGithub } from "./github";
import { notion } from "./notion";

const configGithub = () => configurationDe<ConfigGithub>(CONTRAT_GITHUB);

/**
 * Les connecteurs se déclarent ici et nulle part ailleurs. La valeur de cet outil
 * tient au nombre de systèmes couverts : les énumérer en un seul endroit est ce qui
 * permet de les montrer tous, y compris ceux dont aucune voie automatique n'existe.
 *
 * C'est aussi ici que chacun reçoit sa configuration, sous une forme paresseuse :
 * la politique n'est lue qu'au premier connecteur qui s'en sert.
 */
export const CONNECTEURS: readonly Connector[] = [creerGithub(configGithub), notion];

/**
 * Ce que chaque connecteur sait des scopes qu'un profil lui adresse et qui ne tient
 * pas dans son contrat, lequel est statique quand la configuration ne l'est pas. Un
 * connecteur absent de ce dictionnaire n'a rien à ajouter au verdict de son schéma.
 */
const EXAMENS: Readonly<Record<string, (scope: unknown) => ExamenDeScope>> = {
  github: (scope) => examinerScopeGithub(configGithub().organisations)(scope),
};

/**
 * Le catalogue que `verifierProfils` attend, assemblé depuis le registre : la fonction
 * est pure et ne connaît ni les connecteurs ni la politique, c'est ici qu'ils se
 * rencontrent.
 */
export function catalogueDOctroi(): readonly SystemeOffrantOctroi[] {
  return CONNECTEURS.map(({ contract }) => {
    const examinerScope = EXAMENS[contract.key];

    return {
      key: contract.key,
      scopeSchema: contract.scopeSchema,
      octroiDeclare: contract.capabilities.grant !== undefined,
      ...(examinerScope ? { examinerScope } : {}),
    };
  });
}

export function connecteur(key: string): Connector | undefined {
  return CONNECTEURS.find((candidat) => candidat.contract.key === key);
}
