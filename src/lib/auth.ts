import { PrismaAdapter } from "@auth/prisma-adapter";
import { EspaceMembreProvider } from "@incubateur-ademe/next-auth-espace-membre-provider";
import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";

import { candidateUsernames, resolveOperator } from "@/core/identite";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { webEnv } from "@/lib/env";

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
    };
  }
}

/**
 * Les membres inactifs sont acceptés à dessein : quelqu'un dont la mission vient
 * d'expirer doit pouvoir ouvrir l'outil pour traiter son propre offboarding.
 * L'allowlist des opérateurs reste le seul filtre d'accès.
 */
const espaceMembreProvider = EspaceMembreProvider({
  fetch,
  fetchOptions: { next: { revalidate: 300 } },
  authOptions: { allowInactive: true },
});

// Config sous forme de fonction : l'environnement n'est lu qu'à la première
// requête, pas pendant la collecte des routes au build.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: espaceMembreProvider.AdapterWrapper(PrismaAdapter(prisma)),
  session: { strategy: "jwt" as const },
  // Explicite plutôt que lu dans l'environnement par NextAuth lui-même : le schéma
  // de env.ts fait foi sur la liste des variables attendues, et une variable qu'il
  // ignore est une variable que personne ne valide.
  trustHost: webEnv.AUTH_TRUST_HOST,
  pages: { signIn: "/connexion" },
  providers: [
    espaceMembreProvider.ProviderWrapper(
      Nodemailer({ server: webEnv.EMAIL_SERVER, from: webEnv.EMAIL_FROM }),
    ),
  ],
  callbacks: espaceMembreProvider.CallbacksWrapper({
    signIn({ user }) {
      const match = resolveOperator(user, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES);

      audit({
        actorKind: "HUMAN",
        actorUsername: match?.username ?? candidateUsernames(user)[0],
        action: match?.viaBreakGlass ? "auth.signin.break_glass" : "auth.signin",
        targetType: "session",
        result: match ? "SUCCESS" : "FAILURE",
      });

      return match !== null;
    },
    jwt({ token, user }) {
      // L'identité de session est celle que l'allowlist a validée, jamais un
      // candidat arbitraire : un utilisateur autorisé par un champ ne doit pas
      // pouvoir siéger sous l'identité portée par un autre.
      const match = user
        ? resolveOperator(user, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES)
        : null;
      if (match) {
        token["username"] = match.username;
      }
      return token;
    },
    session({ session, token }) {
      const username = token["username"];
      if (typeof username === "string") {
        session.user.username = username;
      }
      return session;
    },
  }),
}));
