import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";
import * as analyseDePage from "next/dist/build/analysis/get-page-static-info.js";
import { describe, expect, it } from "vitest";

import { config } from "./proxy";

type CompilationDeMatchers = (
  matchers: readonly string[],
  config: Record<string, unknown>,
) => readonly { regexp: string }[];

/**
 * La compilation passe par la fonction que Next exécute lui-même sur ce champ, et non
 * par une expression rationnelle réécrite ici : un matcher que Next refuserait fait
 * sortir le build par `process.exit`, ce qui ne se relit pas.
 *
 * Elle est interne et absente de ses déclarations, d'où la récupération par son nom
 * plutôt qu'un import nommé : le jour où elle change de place, ce test échoue sur une
 * phrase, et c'est le bon moment pour revérifier la barrière à la main.
 */
const compilerLesMatchers = (analyseDePage as unknown as Record<string, unknown>)[
  "getMiddlewareMatchers"
] as CompilationDeMatchers | undefined;

/**
 * La barrière n'a pas d'autre test, et un matcher faux casse la connexion sans que rien
 * ne le dise : le retour du lien magique est un GET sans cookie, si bien qu'une
 * exclusion trop étroite tue la voie par adresse en silence.
 */
function barre(chemin: string): boolean {
  if (compilerLesMatchers === undefined) {
    throw new Error("Next ne compile plus les matchers par `getMiddlewareMatchers`");
  }
  const [compile] = compilerLesMatchers(config.matcher, {});
  if (!compile) {
    throw new Error("le matcher de la barrière n'a pas compilé");
  }
  return new RegExp(compile.regexp).test(chemin);
}

const SOURCES = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Readonly<Record<string, string>>;

describe("ce que la barrière laisse passer sans cookie de session", () => {
  it("ouvre le retour du lien et sa page d'échec, et ferme la demande de lien", () => {
    // Then le retour du lien magique reste public, sur les deux fournisseurs : c'est un
    // GET sans cookie, et le barrer tuerait la connexion par courriel entière.
    for (const fournisseur of ["nodemailer", ESPACE_MEMBRE_PROVIDER_ID]) {
      expect(barre(`/api/auth/callback/${fournisseur}`)).toBe(false);
    }

    // Then la page d'erreur reste publique : c'est là que le paquet renvoie un lien
    // périmé, sans cookie lui non plus, et la barrer ferait de son adresse la
    // destination du lien suivant, par la `suite` que la redirection recopie.
    expect(barre("/api/auth/error")).toBe(false);

    // Then la demande de lien, elle, passe sous la barrière. C'est la fermeture que ce
    // lot pose : un POST non authentifié y atteignait `sendToken`, dont la destination
    // distingue l'adresse acceptée de l'adresse refusée, `verify-request` contre
    // `error?error=AccessDenied`. Aucune des fermetures de l'écran de connexion ne
    // porte sur ce chemin, qui ne passe pas par `loginAction`.
    expect(barre("/api/auth/signin")).toBe(true);
    expect(barre("/api/auth/signin/nodemailer")).toBe(true);

    // Then les autres actions du paquet aussi, et c'est sans conséquence : elles n'ont
    // d'appelant que le client React de NextAuth, que rien n'importe ici. `signIn`,
    // `signOut`, `auth` et `update` appellent tous `Auth()` en processus.
    for (const action of ["csrf", "session", "signout", "providers", "verify-request"]) {
      expect(barre(`/api/auth/${action}`)).toBe(true);
    }

    // Then l'écran de connexion et la sonde de santé restent publics, et tout le reste
    // de l'application reste derrière : la barrière n'a pas bougé de ce côté.
    expect(barre("/login")).toBe(false);
    expect(barre("/healthz")).toBe(false);
    for (const chemin of ["/", "/dossiers/dos_1", "/moi", "/moi/dossiers/dos_1", "/personnes"]) {
      expect(barre(chemin)).toBe(true);
    }

    // Then la prémisse qui rend sûr de barrer `csrf`, `session`, `signout` et
    // `providers` est vérifiée et non supposée : aucun module ne se sert du client
    // React de NextAuth, seul appelant de ces chemins depuis un navigateur. Le jour où
    // l'un le fait, c'est ici qu'il faut rouvrir, pas au premier bouton qui ne répond
    // plus.
    const sources = Object.entries(SOURCES).filter(([chemin]) => !chemin.endsWith(".test.ts"));
    // Un glob qui cesserait de correspondre rendrait la prémisse vraie sans rien avoir lu,
    // d'où l'ancrage sur le module qui configure l'authentification : c'est le premier où
    // un tel import apparaîtrait, et son absence du relevé est un relevé qui ne vaut rien.
    expect(sources.map(([chemin]) => chemin)).toContain("./lib/auth.ts");
    const clients = sources
      .filter(([, source]) => source.includes("next-auth/react"))
      .map(([chemin]) => chemin);
    expect(clients).toEqual([]);
  });
});
