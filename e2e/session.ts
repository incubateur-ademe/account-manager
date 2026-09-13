import type { BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { Client } from "pg";

import { BASE_DE_TEST, SECRET } from "../playwright.config";

/**
 * Fabriquer une session sans passer par la porte, et semer ce qu'elle regardera.
 *
 * Le scénario court-circuite volontairement l'envoi du lien de connexion : ce que ces
 * scénarios prouvent est ce qui se passe APRÈS, quand un cookie existe. La porte
 * elle-même, `deciderConnexion` et l'événement de journal qui l'accompagne, est tenue
 * par ses propres tests unitaires, et une connexion à la main avant une livraison reste
 * nécessaire. Ce raccourci est à connaître, pas à cacher.
 *
 * La stratégie de session est `jwt` (`src/lib/auth.ts`), si bien que les tables
 * `Session` et `VerificationToken` de l'adaptateur ne sont jamais lues : le cookie EST
 * le jeton. Il se fabrique donc avec le même `encode` que le paquet, le sel devant
 * valoir exactement le nom du cookie. Aucune dépendance nouvelle, et l'import passe par
 * `next-auth/jwt` plutôt que par `@auth/core/jwt`, qui ne se résout pas sous
 * l'arborescence stricte de pnpm.
 *
 * Le semis passe par SQL et non par le client Prisma : Playwright transpile en
 * CommonJS, et le client généré porte un `import.meta` qui n'y survit pas. Le détour
 * rend service au passage, en permettant des identifiants lisibles et stables plutôt
 * que des `cuid()` qu'aucune assertion ne pourrait nommer.
 */

/** Sans `Secure`, le serveur de développement parlant en clair. */
const COOKIE = "authjs.session-token";

async function connexion(): Promise<Client> {
  // La base est déjà refusée si elle n'est pas dédiée : la configuration le tranche
  // avant que le serveur ne démarre.
  const client = new Client({ connectionString: BASE_DE_TEST });
  await client.connect();
  return client;
}

/**
 * Vide tout, puis sème. Une seule connexion ouverte et refermée : ces scénarios
 * touchent la base deux fois en tout, et un pool qui survivrait au fichier ferait
 * traîner le processus de Playwright après le dernier scénario.
 */
export async function semer(lignes: (client: Client) => Promise<void>): Promise<void> {
  const client = await connexion();
  try {
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (tables.rows.length === 0) {
      throw new Error(
        "Aucune table dans la base de test : les migrations n'y ont jamais été appliquées. Lancez `pnpm db:deploy:test`.",
      );
    }

    // Un identifiant de table se cite, il ne se colle pas. La source est `pg_tables`,
    // donc le risque est théorique, mais cette requête efface tout.
    const cibles = tables.rows
      .map((table) => `"public"."${table.tablename.replace(/"/gu, '""')}"`)
      .join(", ");
    await client.query(`TRUNCATE TABLE ${cibles} RESTART IDENTITY CASCADE`);
    await lignes(client);
  } finally {
    await client.end();
  }
}

/**
 * Pose le cookie qu'un navigateur aurait reçu au retour du lien.
 *
 * `voie` n'est pas décorative : la qualité d'opérateur ne se calcule que sur un
 * identifiant venu de l'espace-membre (`src/lib/session.ts`), et un jeton muet sur ce
 * point vaut absence de session. Forger `ESPACE_MEMBRE` pour un nom hors allowlist est
 * exactement ce qu'un participant porte, et c'est légitime : c'est la porte qui décide
 * du nom, la garde qui décide du droit.
 */
export async function ouvrirUneSession(
  contexte: BrowserContext,
  qui: { username: string; personId: string | null; nom?: string },
): Promise<void> {
  const jeton = await encode({
    token: {
      name: qui.nom ?? qui.username,
      username: qui.username,
      personId: qui.personId,
      voie: "ESPACE_MEMBRE",
    },
    secret: SECRET,
    salt: COOKIE,
    maxAge: 60 * 60,
  });

  await contexte.addCookies([
    { name: COOKIE, value: jeton, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}
