import { redirect } from "next/navigation";

import { estOperateur } from "@/core/identite";
import { auth } from "@/lib/auth";
import { webEnv } from "@/lib/env";

export interface Operateur {
  username: string;
  email: string | null;
  nom: string | null;
}

/**
 * Le proxy ne fait que constater la présence d'un cookie, il ne le valide pas.
 * Toute page ou action qui lit ou modifie des accès doit donc appeler ceci : c'est
 * ici, et nulle part ailleurs, que la session est réellement vérifiée.
 *
 * L'appartenance à l'allowlist est revérifiée à chaque passage, et non tenue pour
 * acquise depuis la connexion. La session est un jeton signé qui porte le username
 * pour des semaines : sans cette relecture, retirer quelqu'un d'`OPERATORS` ne lui
 * retirerait rien avant l'expiration de son jeton.
 */
export async function requireOperateur(): Promise<Operateur> {
  const session = await auth();
  const username = session?.user?.username;

  if (!username || !estOperateur(username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES)) {
    redirect("/login");
  }

  return {
    username,
    email: session.user.email ?? null,
    nom: session.user.name ?? null,
  };
}

/**
 * Même relecture de l'allowlist, sans redirection : l'appelant se contente de
 * savoir qui est là, typiquement pour afficher un nom. Répondre `null` plutôt que
 * de rediriger laisse ce cas décider lui-même.
 */
export async function operateurCourant(): Promise<Operateur | null> {
  const session = await auth();
  const username = session?.user?.username;

  if (!username || !estOperateur(username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES)) {
    return null;
  }

  return {
    username,
    email: session.user.email ?? null,
    nom: session.user.name ?? null,
  };
}
