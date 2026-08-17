import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { accountsSchema, configSchema } from "@/core/policy";

/**
 * Les schémas Zod restent la seule vérité : ce sont eux qui valident au démarrage et
 * refusent de lancer l'application sur une politique douteuse. Les JSON Schema en
 * sont dérivés, jamais écrits à la main, sans quoi ils deviendraient une seconde
 * vérité qui divergerait au premier champ ajouté.
 *
 * Ils servent la saisie assistée dans l'éditeur, et surtout ils rendent ces fichiers
 * validables depuis un dépôt qui n'a pas le code sous la main.
 */
const FICHIERS = [
  { nom: "accounts", titre: "Personnes suivies et comptes de service", schema: accountsSchema },
  { nom: "config", titre: "Règles du gestionnaire de comptes", schema: configSchema },
] as const;

for (const { nom, titre, schema } of FICHIERS) {
  const destination = resolve(process.cwd(), `config/${nom}.schema.json`);
  const rendu = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: titre,
    ...z.toJSONSchema(schema),
  };

  writeFileSync(destination, `${JSON.stringify(rendu, null, 2)}\n`);
  console.log(`[politique] ${nom} : schéma écrit dans ${destination}`);
}
