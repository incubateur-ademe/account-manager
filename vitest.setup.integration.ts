import { afterAll, beforeEach } from "vitest";

import { deconnecter, prisma } from "@/lib/db";

/**
 * Ce qu'un test d'intégration exige avant de toucher quoi que ce soit, et la remise à
 * zéro qu'il obtient sans avoir à y penser.
 *
 * Les deux vivent ensemble parce que l'une garde l'autre. Cet étage efface des tables
 * entre deux scénarios, `AuditEvent` compris, qui est à rétention indéfinie et porte la
 * trace nominative de tout ce que l'outil a jamais fait : une variable d'environnement
 * mal chargée suffirait à vider le journal d'une vraie instance, et c'est le seul
 * endroit du produit où l'effacement ne se rattrape pas. Le refus voyage donc avec la
 * fonction qui efface, plutôt que de vivre à côté d'elle.
 *
 * Le nom de la base doit finir par `_test`, et rien d'autre ne sert de garde : ni le nom
 * de l'hôte, qu'un tunnel déguise, ni `NODE_ENV`, qu'un lanceur pose à côté de la
 * plaque.
 *
 * Le `beforeEach` est posé ici et non dans chaque scénario : rien n'obligerait le
 * prochain à l'appeler, et un scénario qui hérite de l'état du précédent produit
 * l'échec le plus coûteux à diagnostiquer, celui qui dépend de l'ordre.
 *
 * Hors de `src/` à dessein : une fonction qui vide toutes les tables d'un coup n'a rien
 * à faire dans le code qui part en production, et aucun alias ne la rend atteignable
 * depuis là-bas.
 */

const url = process.env["DATABASE_URL"];

if (!url) {
  throw new Error(
    "Aucune base pour les tests d'intégration. Lancez `pnpm test:integration`, qui pose une base dédiée par défaut.",
  );
}

const nom = new URL(url).pathname.replace(/^\//, "");

if (!nom.endsWith("_test")) {
  throw new Error(
    `Refus de jouer les tests d'intégration sur la base « ${nom} » : cet étage efface des tables entre deux scénarios, le journal d'audit compris, et seule une base dont le nom finit par « _test » peut l'accepter.`,
  );
}

/**
 * Les tables sont lues dans le catalogue plutôt qu'écrites ici : une liste à la main se
 * périme à la première migration, et une table oubliée fait fuir l'état d'un scénario
 * dans le suivant.
 *
 * `CASCADE` plutôt qu'un ordre de suppression calculé depuis les clés étrangères :
 * l'ordre juste se recalcule à chaque migration, et se tromper donne une erreur de
 * contrainte au milieu d'une suite, loin du scénario qui l'a causée. `RESTART IDENTITY`
 * n'est pas décoratif non plus : sans lui, un scénario qui compte sur un identifiant
 * séquentiel dépendrait de ceux qui l'ont précédé.
 */
beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;

  if (tables.length === 0) {
    throw new Error(
      "Aucune table dans la base de test : les migrations n'y ont jamais été appliquées. Lancez `pnpm db:deploy:test`.",
    );
  }

  const cibles = tables.map((table) => `"public"."${table.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${cibles} RESTART IDENTITY CASCADE`);
});

afterAll(deconnecter);
