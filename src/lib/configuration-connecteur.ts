import {
  type ConfigurationsResolues,
  resoudreConfigurations,
} from "@/core/configuration-connecteur";
import type { ConnectorContract } from "@/core/connector";
import { policy } from "@/lib/policy";

/**
 * Ce module ne doit jamais importer `@/connectors` : les connecteurs l'utilisent,
 * et la boucle ainsi fermée rendrait un module partiellement initialisé, c'est-à-dire
 * un `undefined` à un endroit sans rapport avec la cause.
 */

let resolues: Map<string, unknown> | undefined;

function resoudre(contrats: readonly ConnectorContract[]): ConfigurationsResolues {
  return resoudreConfigurations(contrats, policy().connectors);
}

function refuser(erreurs: readonly string[]): never {
  throw new Error(
    `Configuration de connecteur invalide :\n${erreurs.join("\n")}\n\nElle se corrige dans la clé connectors du fichier config.yaml de la politique.`,
  );
}

/**
 * À appeler avant que quoi que ce soit ne collecte. Sans ce point d'appel, la
 * politique étant lue paresseusement, une configuration fausse ne se manifesterait
 * qu'au premier accès : au milieu d'une collecte nocturne, ou sur l'écran d'un
 * opérateur qui n'a rien demandé.
 */
export function verifierConfigurations(contrats: readonly ConnectorContract[]): void {
  const { valeurs, erreurs } = resoudre(contrats);

  if (erreurs.length > 0) {
    refuser(erreurs);
  }

  resolues = new Map(valeurs);
}

export function configurationDe<T>(contrat: ConnectorContract): T {
  if (!contrat.configSchema) {
    throw new Error(`Le connecteur ${contrat.key} ne déclare aucune configuration.`);
  }

  const connue = resolues?.get(contrat.key);
  if (connue !== undefined) {
    return connue as T;
  }

  // Le web n'appelle pas `verifierConfigurations` : une page qui calcule un plan de
  // départ doit pouvoir résoudre la configuration du seul connecteur qu'elle
  // interroge, sans exiger que tous les autres soient chargés.
  //
  // D'où la restriction à la seule entrée du contrat demandé : lui donner tout le
  // dictionnaire ferait déclarer orpheline la clé légitime de chaque autre connecteur,
  // et une page tomberait sur une configuration parfaitement valide. La cohérence
  // d'ensemble reste le travail de `pnpm policy:check` et de la collecte.
  const declare = policy().connectors;
  const { valeurs, erreurs } = resoudreConfigurations(
    [contrat],
    Object.hasOwn(declare, contrat.key) ? { [contrat.key]: declare[contrat.key] } : {},
  );

  if (erreurs.length > 0) {
    refuser(erreurs);
  }

  resolues ??= new Map();
  const valeur = valeurs.get(contrat.key);
  resolues.set(contrat.key, valeur);

  return valeur as T;
}
