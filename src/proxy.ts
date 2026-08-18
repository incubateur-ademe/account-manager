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
  // La sonde de sante est hors barriere : elle est interrogee par l'orchestrateur,
  // qui ne porte aucun cookie, et une redirection vers la page de connexion lui
  // ferait conclure que tout va bien.
  matcher: ["/((?!login|api/auth|healthz|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
