"use server";

import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";

import { signIn } from "@/lib/auth";

function isRedirect(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const digest = (error as { digest?: unknown }).digest;
  return error.message === "NEXT_REDIRECT" || String(digest ?? "").startsWith("NEXT_REDIRECT");
}

function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((error as { type?: unknown }).type === "AccessDenied" || error.name === "AccessDenied")
  );
}

/**
 * Le proxy transmet la page demandée avant la redirection vers la connexion, pour
 * y ramener une fois le lien suivi. La valeur vient de l'URL, donc de n'importe
 * qui : seul un chemin de cette application est accepté. `//ailleurs` est une
 * adresse absolue déguisée, et suffirait à faire de cet écran un tremplin vers un
 * site tiers portant notre nom de domaine dans la barre précédente.
 */
function destination(suite: string): string {
  return suite.startsWith("/") && !suite.startsWith("//") ? suite : "/";
}

export async function loginAction(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  const username = String(formData.get("username") ?? "").trim();
  if (!username) {
    return "Renseignez votre nom d'utilisateur beta.gouv.";
  }

  const suite = destination(String(formData.get("suite") ?? ""));

  try {
    await signIn(ESPACE_MEMBRE_PROVIDER_ID, { email: username, redirectTo: suite });
  } catch (error: unknown) {
    if (isRedirect(error)) {
      throw error;
    }
    if (isAccessDenied(error)) {
      return "Ce compte n'est pas autorisé à utiliser cet outil. L'accès est réservé à l'équipe transverse.";
    }
    console.error("[connexion] échec de l'envoi du lien", error);
    return "Connexion impossible. Vérifiez le nom d'utilisateur, ou réessayez dans un instant.";
  }

  return null;
}
