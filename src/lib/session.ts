import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export interface Operateur {
  username: string;
  email: string | null;
  nom: string | null;
}

/**
 * Le proxy ne fait que constater la présence d'un cookie, il ne le valide pas.
 * Toute page ou action qui lit ou modifie des accès doit donc appeler ceci : c'est
 * ici, et nulle part ailleurs, que la session est réellement vérifiée.
 */
export async function requireOperateur(): Promise<Operateur> {
  const session = await auth();
  const username = session?.user?.username;

  if (!username) {
    redirect("/connexion");
  }

  return {
    username,
    email: session.user.email ?? null,
    nom: session.user.name ?? null,
  };
}

export async function operateurCourant(): Promise<Operateur | null> {
  const session = await auth();
  const username = session?.user?.username;
  if (!username) {
    return null;
  }
  return {
    username,
    email: session.user.email ?? null,
    nom: session.user.name ?? null,
  };
}
