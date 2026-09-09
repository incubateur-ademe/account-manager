import { createRequire } from "node:module";
import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COOKIES_DE_DESTINATION } from "@/lib/connexion";
import { loginAction } from "./actions";

interface Appel {
  provider: string;
  options: Record<string, unknown>;
}

interface Bocal {
  set: (nom: string, valeur: string, options?: Record<string, unknown>) => void;
  delete: (nom: string) => void;
}

/**
 * Le vrai bocal de Next, et pas une doublure : c'est lui qui sérialisera la réponse, et
 * c'est de sa façon d'écraser une pose par un effacement du même nom que dépend
 * l'égalité des deux branches. Une doublure maison prouverait l'intention et pas l'effet.
 */
const requireDuDepot = createRequire(import.meta.url);
const { ResponseCookies } = requireDuDepot("next/dist/compiled/@edge-runtime/cookies") as {
  ResponseCookies: new (entetes: Headers) => Bocal;
};

const base = vi.hoisted(() => ({
  appels: [] as Appel[],
  refuse: false,
  entetes: new Headers(),
  /** Le nom que le paquet poserait sur cette origine, tel qu'un test le relève de lui. */
  cookiePose: "__Secure-authjs.callback-url",
  bocalCasse: false,
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("next/headers", () => ({
  cookies: () => {
    if (base.bocalCasse) {
      return Promise.reject(new Error("le bocal de la réponse n'est plus modifiable"));
    }
    return Promise.resolve(new ResponseCookies(base.entetes));
  },
}));

/**
 * La doublure imite le paquet jusque dans l'ordre où il touche au bocal : l'acceptation
 * pose le cookie de destination, le refus lève avant, parce que le paquet relance son
 * `AccessDenied` en mode brut et sort donc avant que `signIn` n'applique quoi que ce
 * soit. C'est cet ordre, et lui seul, qui faisait de `Set-Cookie` un oracle d'adresse.
 */
vi.mock("@/lib/auth", () => ({
  signIn: (provider: string, options: Record<string, unknown>) => {
    base.appels.push({ provider, options });
    if (base.refuse) {
      const erreur = new Error("AccessDenied");
      erreur.name = "AccessDenied";
      throw erreur;
    }
    new ResponseCookies(base.entetes).set(base.cookiePose, "https://exemple.test/", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    });
    return Promise.resolve("/api/auth/verify-request?provider=nodemailer&type=email");
  },
}));

const MESSAGE =
  "Si cette saisie ouvre un accès, un lien de connexion vient de partir. Vérifiez votre boîte : il est valable peu de temps.";

const OUVRE_UN_ACCES = "porteuse@exemple.test";

/**
 * Ce que le paquet rend en mode brut : sa réponse avant qu'elle ne devienne une réponse
 * HTTP, cookies compris. Décrit ici parce que `@auth/core` n'est pas une dépendance de ce
 * dépôt, seulement celle de `next-auth`, et que ses types ne se résolvent donc pas.
 */
interface BrutDuPaquet {
  leve?: boolean;
  redirect?: string;
  cookies?: { name: string }[];
}

/**
 * Un adaptateur qui ne connaît personne et ne garde rien : le paquet vérifie la présence
 * de ses méthodes avant de router quoi que ce soit, et la connexion par lien se juge
 * entièrement dans le rappel, pas dans la base.
 */
function adaptateurMuet(): Record<string, unknown> {
  const rien = (): Promise<null> => Promise.resolve(null);
  const tel = <T>(valeur: T): Promise<T> => Promise.resolve(valeur);
  return {
    createUser: tel,
    getUser: rien,
    getUserByEmail: rien,
    getUserByAccount: rien,
    updateUser: tel,
    linkAccount: tel,
    createSession: tel,
    getSessionAndUser: rien,
    updateSession: tel,
    deleteSession: rien,
    createVerificationToken: tel,
    useVerificationToken: rien,
  };
}

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

/** Le plancher de temporisation vaut mille cinq cents millisecondes ; on le franchit. */
async function soumettre(valeurs: Record<string, string>): Promise<string | null> {
  const promesse = loginAction(null, champs(valeurs));
  await vi.advanceTimersByTimeAsync(3000);
  return promesse;
}

/** Ce que la réponse à cette soumission poserait dans le navigateur, à l'octet près. */
async function cookiesDe(valeurs: Record<string, string>): Promise<string[]> {
  base.entetes = new Headers();
  await soumettre(valeurs);
  return base.entetes.getSetCookie();
}

beforeEach(() => {
  base.appels = [];
  base.refuse = false;
  base.entetes = new Headers();
  base.cookiePose = "__Secure-authjs.callback-url";
  base.bocalCasse = false;
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("l'écran de connexion, qui route sur l'arobase et ne dit jamais rien d'autre", () => {
  it("envoie la saisie à la bonne porte sans jamais quitter cet écran", async () => {
    // Given un identifiant sans arobase.
    // When il est soumis.
    await expect(
      soumettre({ username: "  Camille.Exemple  ", suite: "/dossiers/dos_1" }),
    ).resolves.toBe(MESSAGE);

    // Then il part vers l'espace-membre, la destination demandée voyage avec le lien, et
    // `redirect: false` garde la réponse sur cet écran : tant que l'acceptation part sur
    // la page de confirmation d'envoi et que le refus reste ici, la barre d'adresse dit
    // ce que la phrase unique refuse de dire.
    expect(base.appels).toEqual([
      {
        provider: ESPACE_MEMBRE_PROVIDER_ID,
        options: {
          email: "Camille.Exemple",
          redirectTo: "/dossiers/dos_1",
          redirect: false,
        },
      },
    ]);

    // When la saisie porte une arobase.
    base.appels = [];
    await expect(soumettre({ username: "camille@exemple.org" })).resolves.toBe(MESSAGE);

    // Then elle part vers le second fournisseur, et la destination retombe sur l'accueil.
    expect(base.appels).toEqual([
      {
        provider: "nodemailer",
        options: { email: "camille@exemple.org", redirectTo: "/", redirect: false },
      },
    ]);

    // Then une destination qui n'est pas un chemin de cette application est écartée :
    // `//ailleurs` est une adresse absolue déguisée.
    base.appels = [];
    await soumettre({ username: "camille.exemple", suite: "//ailleurs.example/piege" });
    expect(base.appels[0]?.options["redirectTo"]).toBe("/");
  });

  it("rend la même phrase à l'accueilli, à l'éconduit et au maladroit, le même temps et les mêmes cookies", async () => {
    // Given une saisie que le contrôle de connexion refuse.
    base.refuse = true;

    // Then le refus rend exactement la phrase de l'envoi, et ne remonte aucune erreur :
    // distinguer les deux ferait de cet outil un oracle d'appartenance à l'annuaire
    // beta.gouv entier, interrogeable sans être connecté.
    await expect(soumettre({ username: "passante.exemple" })).resolves.toBe(MESSAGE);

    // Given les saisies que le normalisateur du paquet refuse en levant, et la saisie
    // vide. Then aucune ne sort du processus, et toutes rendent la même phrase : une
    // exception remontée du paquet vaudrait un message distinct.
    base.refuse = false;
    for (const saisie of ["", "   ", 'ca"mille@exemple.org', "a@b@exemple.org", "camille@,org"]) {
      base.appels = [];
      await expect(soumettre({ username: saisie })).resolves.toBe(MESSAGE);
      expect(base.appels).toEqual([]);
    }

    // Given la branche refusée, qui ne fait aucune poignée de main avec le serveur de
    // courrier là où la branche acceptée en fait une complète.
    base.refuse = true;
    let rendu = false;
    const promesse = loginAction(null, champs({ username: "passante.exemple" })).then((valeur) => {
      rendu = true;
      return valeur;
    });

    // Then elle attend elle aussi le plancher : sans lui, le temps de réponse dirait ce
    // que le message tait, et le retirer rouvre le canal sans changer une ligne de texte.
    await vi.advanceTimersByTimeAsync(1000);
    expect(rendu).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rendu).toBe(true);
    await expect(promesse).resolves.toBe(MESSAGE);

    // Given les trois issues rejouées pour ce qu'elles posent dans le navigateur, la
    // branche acceptée recevant du paquet un cookie de destination que la branche
    // refusée ne reçoit pas : ce `Set-Cookie` était le cinquième canal, plus net que le
    // temps et sous le seul contrôle de qui poste sans cookie.
    base.refuse = false;
    const accueilli = await cookiesDe({ username: "camille.exemple" });
    base.refuse = true;
    const econduit = await cookiesDe({ username: "passante.exemple" });
    const maladroit = await cookiesDe({ username: "a@b@exemple.org" });

    // Then les trois réponses posent exactement les mêmes cookies, à l'octet près, et
    // aucun ne porte de valeur : le cookie du paquet est écrasé par son effacement, qui
    // part de toute façon.
    expect(new Set([accueilli, econduit, maladroit].map((liste) => liste.join("\n"))).size).toBe(1);
    expect(accueilli).toHaveLength(COOKIES_DE_DESTINATION.length);
    expect(accueilli.join("\n")).not.toContain("exemple.test");

    // Then c'est bien l'effacement qui les égalise, et non l'absence de pose : sans lui,
    // la seule branche acceptée porterait un cookie.
    expect(accueilli.every((entete) => entete.includes("Expires=Thu, 01 Jan 1970"))).toBe(true);

    // Then l'ordre des en-têtes en fait partie, et c'est le passage qui réserve les rangs
    // avant l'appel qui le tient : sans lui, le nom que seule la branche acceptée fait
    // connaître au bocal prend le premier rang, et l'ordre redit ce que le contenu ne dit
    // plus.
    expect(accueilli.map((entete) => entete.split("=")[0])).toEqual([...COOKIES_DE_DESTINATION]);

    // Then le préfixe que l'origine décide ne change rien : le paquet pose l'un ou
    // l'autre nom selon le protocole, les deux sont effacés.
    base.refuse = false;
    base.cookiePose = "authjs.callback-url";
    expect((await cookiesDe({ username: "camille.exemple" })).join("\n")).toBe(
      accueilli.join("\n"),
    );

    // Given un bocal de réponse qui refuse d'être touché
    base.bocalCasse = true;

    // Then la soumission casse au lieu de rendre la phrase, et casse quelle que soit la
    // saisie : avaler cette panne rendrait la phrase à tout le monde en laissant la
    // seule branche acceptée porter son cookie, c'est-à-dire rouvrirait l'oracle
    // exactement là où on vient de le fermer. Elle casse dès la réservation, donc avant
    // l'appel, et aucune des deux branches n'atteint la phrase.
    base.refuse = false;
    await expect(loginAction(null, champs({ username: "camille.exemple" }))).rejects.toThrow(
      "bocal",
    );
    base.refuse = true;
    await expect(loginAction(null, champs({ username: "passante.exemple" }))).rejects.toThrow(
      "bocal",
    );
  });

  it("efface sous les deux noms que le paquet peut poser, relevés sur le paquet lui-même", async () => {
    // Given le paquet d'authentification joué exactement comme `signIn` le joue : en
    // processus, en mode brut, sans jeton anti-rejeu. C'est le protocole de l'origine qui
    // décide du préfixe `__Secure-`, et rien n'expose le nom qui en sort.
    const requireDuPaquet = createRequire(requireDuDepot.resolve("next-auth"));
    const { Auth, raw, skipCSRFCheck } = (await import(requireDuPaquet.resolve("@auth/core"))) as {
      Auth: (requete: Request, config: Record<string, unknown>) => Promise<BrutDuPaquet>;
      raw: unknown;
      skipCSRFCheck: unknown;
    };
    const { default: Nodemailer } = (await import(
      requireDuPaquet.resolve("@auth/core/providers/nodemailer")
    )) as { default: (options: Record<string, unknown>) => unknown };

    const liens: string[] = [];
    const config: Record<string, unknown> = {
      secret: "un-secret-de-test-assez-long-pour-etre-accepte",
      basePath: "/api/auth",
      trustHost: true,
      adapter: adaptateurMuet(),
      session: { strategy: "jwt" },
      pages: { signIn: "/login" },
      providers: [
        Nodemailer({
          server: "smtp://exemple.test:25",
          from: "robot@exemple.test",
          sendVerificationRequest: ({ url }: { url: string }) => {
            liens.push(url);
            return Promise.resolve();
          },
        }),
      ],
      callbacks: {
        signIn: ({ user }: { user: { email?: string | null } }) => user.email === OUVRE_UN_ACCES,
      },
    };

    async function demander(origine: string, adresse: string): Promise<BrutDuPaquet> {
      const requete = new Request(`${origine}/api/auth/signin/nodemailer`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: adresse, callbackUrl: "/dossiers/dos_1" }).toString(),
      });
      try {
        return { ...(await Auth(requete, { ...config, raw, skipCSRFCheck })), leve: false };
      } catch {
        return { leve: true };
      }
    }

    // When l'adresse qui ouvre un accès est postée sur une origine sûre, puis sur une
    // origine en clair.
    const surTLS = await demander("https://exemple.test", OUVRE_UN_ACCES);
    const enClair = await demander("http://localhost:3000", OUVRE_UN_ACCES);

    // Then le lien est parti les deux fois, et chacun des noms que le paquet pose figure
    // dans la liste que l'écran de connexion efface. Un renommage amont, ou un cookie de
    // plus à cette phase, casse ici plutôt que de rouvrir l'oracle en silence.
    expect(liens).toHaveLength(2);
    const poses = [...(surTLS.cookies ?? []), ...(enClair.cookies ?? [])].map(({ name }) => name);
    expect(poses).toEqual(
      expect.arrayContaining(["__Secure-authjs.callback-url", "authjs.callback-url"]),
    );
    const efface: readonly string[] = COOKIES_DE_DESTINATION;
    expect(poses.every((nom) => efface.includes(nom))).toBe(true);

    // Then la branche refusée lève avant de rendre le moindre cookie, et n'envoie rien :
    // c'est cet écart-là que l'effacement recompose, et non une différence de valeur.
    const refuse = await demander("https://exemple.test", "inconnue@exemple.test");
    expect(refuse.leve).toBe(true);
    expect(refuse.cookies).toBeUndefined();
    expect(liens).toHaveLength(2);

    // Then l'effacement ne coûte rien au parcours : la destination voyage dans l'adresse
    // du lien, que le retour relit là, et le cookie n'en était qu'un doublon.
    expect(surTLS.redirect).toContain("/verify-request");
    expect(liens[0]).toContain("callbackUrl=");
  });
});
