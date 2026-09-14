import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import type { Voie } from "@/core/participation";
import { prisma } from "@/lib/db";
import { webEnv } from "@/lib/env";
import { espaceMembreProvider, fournisseursDuLien } from "@/lib/fournisseurs";
import { rappelsDeConnexion } from "@/lib/rappels-connexion";

declare module "next-auth" {
  interface User {
    username?: string | null;
    isBetaGouvMember?: boolean;
  }
  interface Session {
    user: {
      id: string;
      username: string;
      email?: string | null;
      name?: string | null;
      /** La fiche que cette session désigne, quand l'identification en a résolu une. */
      personId?: string | null;
      /**
       * Par quelle porte l'identité a été prouvée. Absente d'un jeton antérieur à sa
       * création.
       */
      voie?: Voie;
    };
  }
}

// Config sous forme de fonction : l'environnement n'est lu qu'à la première
// requête, pas pendant la collecte des routes au build.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: espaceMembreProvider.AdapterWrapper(PrismaAdapter(prisma)),
  session: { strategy: "jwt" as const },
  // Explicite plutôt que lu dans l'environnement par NextAuth lui-même : le schéma
  // de env.ts fait foi sur la liste des variables attendues, et une variable qu'il
  // ignore est une variable que personne ne valide.
  trustHost: webEnv.AUTH_TRUST_HOST,
  pages: { signIn: "/login" },
  providers: fournisseursDuLien(),
  callbacks: espaceMembreProvider.CallbacksWrapper(rappelsDeConnexion),
}));
