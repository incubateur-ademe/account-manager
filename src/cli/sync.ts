import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { prisma } from "@/lib/db";
import { executerSync } from "@/lib/sync/executer";

// Charge la configuration d'environnement comme le fait Next : sans ça, la collecte
// en ligne de commande ne voit rien. L'accès à env étant différé, l'ordre
// d'évaluation des imports ne pose pas de problème.
loadEnvConfig(process.cwd(), process.env["NODE_ENV"] !== "production");

/**
 * Point d'entrée en ligne de commande, et rien de plus : la collecte elle-même vit
 * dans `executerSync`, que l'application appelle aussi. Deux déclencheurs, une seule
 * façon de collecter, sans quoi ce qui tourne la nuit et ce qu'un opérateur lance à
 * la main finiraient par diverger.
 */
executerSync(new Date(), randomUUID(), (ligne) => {
  console.log(ligne);
})
  .then(async (compteRendu) => {
    await prisma.$disconnect();
    process.exitCode = compteRendu.echec ? 1 : 0;
  })
  .catch(async (error: unknown) => {
    console.error("[sync] échec non rattrapé", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
