import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { CONNECTEURS } from "@/connectors";
import { accountsSchema, configSchema } from "@/core/policy";

/**
 * Les schémas Zod restent la seule vérité : ce sont eux qui valident au démarrage et
 * refusent de lancer l'application sur une politique douteuse. Les JSON Schema en
 * sont dérivés, jamais écrits à la main, sans quoi ils deviendraient une seconde
 * vérité qui divergerait au premier champ ajouté.
 *
 * Ils servent la saisie assistée dans l'éditeur, et surtout ils rendent ces fichiers
 * validables depuis un dépôt qui n'a pas le code sous la main.
 *
 * `io: "input"` décrit ce qu'un fichier a le droit de contenir, et non ce que le parseur
 * rend une fois les défauts appliqués. Sans lui, tout champ pourvu d'un `.default()`
 * ressort obligatoire : l'éditeur refusait alors des fichiers que le démarrage accepte,
 * ce qui est exactement l'inverse du service attendu d'un schéma.
 */
const FICHIERS = [
  { nom: "accounts", titre: "Personnes suivies et comptes de service", schema: accountsSchema },
  { nom: "config", titre: "Règles du gestionnaire de comptes", schema: configSchema },
] as const;

/**
 * Le noeud `connectors` du schéma Zod est un dictionnaire libre : il ne peut pas
 * connaître les connecteurs sans les importer, et l'importerait alors dans le socle
 * de politique. Ici, la commande a le droit de les voir, et la saisie assistée
 * devient réelle au lieu de proposer un objet vide.
 *
 * `additionalProperties: false` fait refuser par l'éditeur ce que le démarrage refuse
 * déjà : une clé qu'aucun connecteur ne porte.
 */
function composerConnecteurs(): Record<string, unknown> {
  const configurables = CONNECTEURS.map((connecteur) => connecteur.contract).filter(
    (contrat) => contrat.configSchema,
  );

  return {
    type: "object",
    // Le noeud est reconstruit a la main, il faut donc lui redonner ce que
    // `z.toJSONSchema` aurait pose : sans ce defaut, `connectors` serait le seul champ
    // du fichier a etre requis sans que l'editeur sache quoi proposer.
    default: {},
    description:
      "Réglages propres à chaque connecteur, sous sa clé. Une clé qu'aucun connecteur ne porte fait refuser le démarrage.",
    properties: Object.fromEntries(
      configurables.map((contrat) => {
        // Un `.transform()` ferait lever ici, sur une commande qui n'a aucun rapport
        // apparent avec le connecteur fautif : le contrat l'interdit pour cette raison.
        const { $schema: _dialecte, ...sousSchema } = z.toJSONSchema(
          contrat.configSchema as z.ZodType,
          { io: "input" },
        );
        return [contrat.key, sousSchema];
      }),
    ),
    additionalProperties: false,
  };
}

for (const { nom, titre, schema } of FICHIERS) {
  const destination = resolve(process.cwd(), `config/${nom}.schema.json`);
  const rendu = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: titre,
    ...z.toJSONSchema(schema, { io: "input" }),
  } as { properties?: Record<string, unknown> };

  if (nom === "config" && rendu.properties) {
    rendu.properties["connectors"] = composerConnecteurs();
  }

  writeFileSync(destination, `${JSON.stringify(rendu, null, 2)}\n`);
  console.log(`[politique] ${nom} : schéma écrit dans ${destination}`);
}
