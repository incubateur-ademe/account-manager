import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Barrière optimiste : elle constate la présence d'une session, elle ne la valide pas.
 * Toute page ou action qui manipule des accès doit appeler auth() de son côté.
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) {
    return NextResponse.next();
  }

  const target = new URL("/login", request.url);
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== "/") {
    target.searchParams.set("suite", from);
  }

  return NextResponse.redirect(target);
}

export const config = {
  // La sonde de santé est hors barrière : elle est interrogée par l'orchestrateur, qui
  // ne porte aucun cookie, et une redirection vers la page de connexion lui ferait
  // conclure que tout va bien.
  //
  // De `/api/auth`, seuls le retour du lien magique et la page d'erreur restent
  // publics, et pas le sous-arbre : deux GET sans cookie, le second étant le sort
  // ordinaire d'un lien périmé, et les barrer tuerait la connexion par courriel. Le
  // reste passe dessous, `signin` compris, où un POST non authentifié atteignait
  // `sendToken` et distinguait l'adresse acceptée de l'adresse refusée par sa seule
  // destination, oracle qu'aucune fermeture de l'écran de connexion ne couvre, ce
  // chemin ne passant pas par `loginAction`. Rien n'y perd d'appelant, le client React
  // de NextAuth n'étant importé nulle part ici, et le test voisin le vérifie.
  //
  // Ce que cette fermeture vaut, exactement : elle tient contre qui ne porte aucun
  // cookie, et contre lui seul. La barrière constate un cookie sans le valider, si bien
  // qu'un cookie inventé la franchit et repose la question à la route.
  matcher: [
    "/((?!login|api/auth/callback|api/auth/error|healthz|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
