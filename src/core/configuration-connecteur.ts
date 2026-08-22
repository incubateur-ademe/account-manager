import type { ConnectorContract } from "@/core/connector";

/**
 * Ce que chaque connecteur configurable lira, et ce qui empêche de démarrer.
 *
 * Les deux voyagent ensemble parce qu'une configuration à demi valide n'existe pas :
 * l'appelant qui trouve une erreur refuse tout, il ne trie pas.
 */
export interface ConfigurationsResolues {
  valeurs: ReadonlyMap<string, unknown>;
  erreurs: readonly string[];
}

function chemin(cle: string, segments: readonly PropertyKey[]): string {
  return [`connectors.${cle}`, ...segments.map(String)].join(".");
}

/**
 * Croise ce que le YAML déclare avec ce que chaque contrat accepte.
 *
 * Rend toutes les erreurs d'un coup : un fichier de configuration se corrige en une
 * passe, pas en cinq allers-retours dont chacun révèle la faute suivante.
 *
 * Fonction pure, sans système de fichiers ni base : c'est ce qui permet à
 * `pnpm policy:check` de tourner depuis le dépôt de configuration.
 */
export function resoudreConfigurations(
  contrats: readonly ConnectorContract[],
  brut: Readonly<Record<string, unknown>>,
): ConfigurationsResolues {
  const parCle = new Map(contrats.map((contrat) => [contrat.key, contrat]));
  const connues = contrats
    .filter((contrat) => contrat.configSchema)
    .map((contrat) => contrat.key)
    .sort();

  const valeurs = new Map<string, unknown>();
  const erreurs: string[] = [];

  for (const cle of Object.keys(brut)) {
    const contrat = parCle.get(cle);

    if (!contrat) {
      erreurs.push(
        `  connectors.${cle} : aucun connecteur ne porte cette clé. Connecteurs configurables : ${
          connues.length > 0 ? connues.join(", ") : "aucun"
        }.`,
      );
      continue;
    }

    if (!contrat.configSchema) {
      erreurs.push(`  connectors.${cle} : ce connecteur ne se configure pas.`);
    }
  }

  for (const contrat of contrats) {
    if (!contrat.configSchema) {
      continue;
    }

    // Un connecteur absent du fichier reçoit quand même son schéma, appliqué à un
    // objet vide : les défauts jouent, et ne rien déclarer revient exactement à
    // déclarer le défaut. Sans ça, un connecteur configurable cesserait de
    // fonctionner le jour où le mécanisme arrive.
    const lu = contrat.configSchema.safeParse(brut[contrat.key] ?? {});

    if (lu.success) {
      valeurs.set(contrat.key, lu.data);
      continue;
    }

    for (const probleme of lu.error.issues) {
      erreurs.push(`  ${chemin(contrat.key, probleme.path)} : ${probleme.message}`);
    }
  }

  return { valeurs, erreurs };
}
