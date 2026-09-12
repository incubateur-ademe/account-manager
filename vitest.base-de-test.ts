import { prisma } from "@/lib/db";

/**
 * La remise à zéro entre deux scénarios d'intégration.
 *
 * Hors de `src/` à dessein : une fonction qui vide toutes les tables d'un coup n'a rien
 * à faire dans le code qui part en production, même inutilisée. Elle vit avec les
 * autres passages de mise en place, et `@test` la désigne depuis les scénarios.
 *
 * Le client est celui de l'application, et non un second ouvert pour l'occasion : un
 * scénario doit exercer le même chemin que le produit, adaptateur compris. Il lit
 * `DATABASE_URL`, que le passage de mise en place de cet étage a déjà refusé si la base
 * n'est pas dédiée.
 */

/**
 * Les tables sont lues dans le catalogue plutôt qu'écrites ici : une liste à la main se
 * périme à la première migration, et une table oubliée fait fuir l'état d'un scénario
 * dans le suivant, ce qui produit l'échec le plus coûteux à diagnostiquer qui soit,
 * celui qui dépend de l'ordre.
 *
 * `_prisma_migrations` est la seule exclue : la vider ferait croire à Prisma que rien
 * n'a jamais été appliqué.
 */
async function tables(): Promise<string[]> {
  const lignes = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  return lignes.map((ligne) => ligne.tablename);
}

/**
 * Vide tout, en un seul ordre.
 *
 * `CASCADE` plutôt qu'un ordre de suppression calculé depuis les clés étrangères :
 * l'ordre juste se recalcule à chaque migration, et se tromper donne une erreur de
 * contrainte au milieu d'une suite, loin du scénario qui l'a causée. `RESTART IDENTITY`
 * n'est pas décoratif non plus : sans lui, un scénario qui compte sur un identifiant
 * séquentiel dépendrait de ceux qui l'ont précédé.
 */
export async function viderLaBase(): Promise<void> {
  const noms = await tables();
  if (noms.length === 0) {
    throw new Error(
      "Aucune table dans la base de test : les migrations n'y ont jamais été appliquées. Lancez `pnpm db:deploy` en pointant DATABASE_URL sur elle.",
    );
  }

  const cibles = noms.map((nom) => `"public"."${nom}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${cibles} RESTART IDENTITY CASCADE`);
}
