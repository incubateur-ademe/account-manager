import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { deconnecter } from "@/lib/db";
import { executerSync } from "@/lib/sync/executer";

// Charge la configuration d'environnement comme le fait Next : sans ça, la collecte
// en ligne de commande ne voit rien. Ce corps de module s'exécute après l'évaluation
// de ses imports : tout ce qu'ils tirent de `process.env` doit donc l'être au premier
// appel, jamais dans une constante de module, qui serait calculée avant.
loadEnvConfig(process.cwd(), process.env["NODE_ENV"] !== "production");

async function terminer(echec: boolean): Promise<void> {
  // Une fermeture qui échoue ne change rien à ce qui vient d'être rapporté : la
  // laisser remonter remplacerait le compte rendu par sa propre pile d'appels.
  await deconnecter().catch(() => undefined);
  process.exitCode = echec ? 1 : 0;
}

/**
 * Point d'entrée en ligne de commande, et rien de plus : la collecte elle-même vit
 * dans `executerSync`, que l'application appelle aussi. Deux déclencheurs, une seule
 * façon de collecter, sans quoi ce qui tourne la nuit et ce qu'un opérateur lance à
 * la main finiraient par diverger.
 */
executerSync(new Date(), randomUUID(), (ligne) => {
  console.log(ligne);
})
  .then((compteRendu) => terminer(compteRendu.echec))
  .catch((error: unknown) => {
    console.error("[sync] échec non rattrapé", error);
    return terminer(true);
  });
