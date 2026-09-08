import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

/**
 * Le module d'authentification ne s'importe pas hors de Next : `next-auth` y résout
 * `next/server` par un chemin que seul son empaqueteur sait suivre. Le gestionnaire du
 * paquet est donc une sentinelle, et c'est son identité que le GET épingle.
 */
const paquet = vi.hoisted(() => ({
  GET: () => new Response("gestionnaire du paquet"),
  POST: () => new Response("gestionnaire du paquet"),
}));

vi.mock("@/lib/auth", () => ({ handlers: paquet }));

const requireDuDepot = createRequire(import.meta.url);
const entreeNextAuth = requireDuDepot.resolve("next-auth");
const entreeAuthCore = createRequire(entreeNextAuth).resolve("@auth/core");

/**
 * Un fichier du paquet qui change de place fait échouer ce test sur une phrase plutôt
 * que sur un code d'erreur du système de fichiers : c'est le bon moment pour revérifier
 * à la main que la connexion par lien ne poste toujours rien.
 */
function lireSource(entree: string, fichier: string): string {
  try {
    return readFileSync(join(dirname(entree), fichier), "utf8");
  } catch {
    throw new Error(`le paquet d'authentification n'expose plus ${fichier}`);
  }
}

/**
 * Une demande de lien telle qu'elle arrive sans passer par l'écran de connexion : le
 * jeton anti-rejeu se prend sur `/api/auth/csrf`, et le cookie inventé suffit à franchir
 * la barrière, qui constate une session sans la valider.
 */
function demandeDeLien(adresse: string): Request {
  return new Request("https://exemple.test/api/auth/signin/nodemailer", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: "authjs.session-token=cookie-invente",
    },
    body: new URLSearchParams({ email: adresse, csrfToken: "jeton-pris-sur-csrf" }).toString(),
  });
}

async function empreinte(reponse: Response): Promise<string> {
  const entetes = [...reponse.headers].map(([nom, valeur]) => `${nom}: ${valeur}`).sort();
  return [reponse.status, reponse.statusText, ...entetes, await reponse.text()].join("\n");
}

describe("la demande de lien postée droit sur la route du paquet", () => {
  it("répond la même chose à l'adresse qui ouvre un accès et à celle qui n'en ouvre aucun", async () => {
    // Given trois saisies dont les destinations différaient : celle qui ouvre un accès
    // partait sur `verify-request`, celle qui n'ouvre rien sur `error?error=AccessDenied`,
    // et la malformée sur une troisième, `sendToken` levant avant même son contrôle.
    const ouvre = demandeDeLien("porteuse@exemple.test");
    const nOuvrePas = demandeDeLien("inconnue@exemple.test");
    const malformee = demandeDeLien("pas-une-adresse");

    // When elles sont postées sur la route. Le refus est attendu, sans quoi un oracle
    // rendu par une fonction asynchrone échapperait à la comparaison qui suit.
    const refuserAvecUneAdresse: (requete: Request) => Response | Promise<Response> = POST;
    const empreintes = await Promise.all(
      [ouvre, nOuvrePas, malformee].map(async (requete) =>
        empreinte(await refuserAvecUneAdresse(requete)),
      ),
    );

    // Then les trois réponses sont la même, jusqu'aux en-têtes et au corps.
    expect(new Set(empreintes).size).toBe(1);

    // Then c'est un refus de méthode, sans destination ni cookie : une redirection, même
    // constante, redonnerait une destination à comparer, et un `Set-Cookie` un état.
    const refus = POST();
    expect(refus.status).toBe(405);
    expect(refus.headers.get("allow")).toBe("GET");
    expect(refus.headers.get("location")).toBeNull();
    expect(refus.headers.get("set-cookie")).toBeNull();
    expect(await refus.text()).toBe("");

    // Then le refus ne reçoit pas la requête, et ne peut donc pas varier avec elle : ce
    // n'est pas une réponse constante par relecture, c'en est une par signature.
    expect(POST.length).toBe(0);
  });

  it("laisse le retour du lien et la page d'erreur au paquet, qui sont les seuls à en avoir besoin", () => {
    // Then le GET reste exactement le gestionnaire du paquet : le retour du lien magique
    // et sa page d'échec en sont, et les détourner tuerait la connexion par courriel.
    expect(GET).toBe(paquet.GET);
    expect(POST).not.toBe(paquet.POST);

    // Then la prémisse qui rend ce refus gratuit est vérifiée et non supposée. Les points
    // d'entrée serveur fabriquent une requête et appellent `Auth()` en processus : aucun
    // ne passe par le gestionnaire HTTP, donc aucun ne perd son chemin. Le jour où le
    // paquet passera par le réseau, c'est ici qu'il faut rouvrir, et pas au premier
    // opérateur qui ne se connecte plus.
    const actionsServeur = lireSource(entreeNextAuth, "lib/actions.js");
    const sessionServeur = lireSource(entreeNextAuth, "lib/index.js");
    expect(actionsServeur).toContain("await Auth(req, { ...config, raw, skipCSRFCheck })");
    expect(sessionServeur).toContain("return Auth(request, {");
    expect(actionsServeur).not.toContain("fetch(");
    expect(sessionServeur).not.toContain("fetch(");

    // Then la seconde prémisse aussi : le courriel porte un lien ordinaire, que le
    // destinataire suit en GET. Un gabarit qui poserait un formulaire ferait du retour de
    // lien un POST, et ce refus fermerait alors la connexion entière.
    const gabaritDuCourriel = lireSource(entreeAuthCore, "lib/utils/email.js");
    expect(gabaritDuCourriel).toMatch(/<a href="\$\{url\}"/);
    expect(gabaritDuCourriel).not.toContain("<form");
  });
});
