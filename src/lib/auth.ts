import { PrismaAdapter } from "@auth/prisma-adapter";
import { EspaceMembreProvider } from "@incubateur-ademe/next-auth-espace-membre-provider";
import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";

import type { Voie } from "@/core/participation";
import { prisma } from "@/lib/db";
import { webEnv } from "@/lib/env";
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

/**
 * Trente minutes, contre vingt-quatre heures par défaut. Un lien de connexion est un
 * porteur : le transférer transfère l'accès, et celui-ci existe pour être suivi tout de
 * suite. Deux bornes à ne pas confondre, le lien vaut une demi-heure, la session qu'il
 * ouvre vaut la durée du jeton.
 */
const LIEN_VALIDE_SECONDES = 30 * 60;

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
  providers: [
    espaceMembreProvider.ProviderWrapper(
      Nodemailer({ server: webEnv.SMTP_URL, from: webEnv.SMTP_EMAIL_FROM }),
    ),
    // Nu, sans le wrapper de l'espace-membre : celui-ci résout un username auprès de
    // l'annuaire beta.gouv, ce qu'une adresse ne sait pas faire. Il garde donc son
    // identifiant d'origine, et c'est par cet identifiant que les deux portes se
    // distinguent partout ailleurs.
    Nodemailer({
      server: webEnv.SMTP_URL,
      from: webEnv.SMTP_EMAIL_FROM,
      maxAge: LIEN_VALIDE_SECONDES,
    }),
  ],
  callbacks: espaceMembreProvider.CallbacksWrapper(rappelsDeConnexion),
}));
