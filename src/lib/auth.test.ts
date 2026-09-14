import { createRequire } from "node:module";
import { EspaceMembreProvider } from "@incubateur-ademe/next-auth-espace-membre-provider";
import Nodemailer from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";

import { PROVIDER_ADRESSE } from "@/lib/connexion";
import { webEnv } from "@/lib/env";

/**
 * Ce que le paquet rend en mode brut, décrit ici plutôt qu'importé : `@auth/core` n'est
 * pas une dépendance de ce dépôt, seulement celle de `next-auth`, et ses types ne se
 * résolvent donc pas.
 */
interface BrutDuPaquet {
  redirect?: string;
}

const requireDuDepot = createRequire(import.meta.url);
const requireDuPaquet = createRequire(requireDuDepot.resolve("next-auth"));

/** Ce qu'un transport aurait remis à un serveur, sans qu'aucune socket ne s'ouvre. */
interface Remise {
  enveloppe: { from?: string | false; to?: string[] };
  entetes: string;
}

/**
 * Un transport qui compose pour de vrai et ne poste rien.
 *
 * `jsonTransport` rendrait la même enveloppe, mais son résultat repart vers le
 * fournisseur, qui n'en réexporte rien : on n'aurait aucun moyen de la lire. Celui-ci est
 * un transport comme un autre du point de vue de nodemailer, il reçoit donc le message
 * déjà passé par `mail-composer` et `addressparser`, et c'est cette enveloppe-là,
 * calculée par le paquet et non par le test, que les scénarios inspectent.
 */
function transportQuiCapture(remises: Remise[]): Record<string, unknown> {
  return {
    name: "capture-de-test",
    version: "1.0.0",
    send(
      mail: { message: { getEnvelope: () => Remise["enveloppe"]; messageId: () => string } },
      callback: (erreur: Error | null, info: Record<string, unknown>) => void,
    ) {
      const enveloppe = mail.message.getEnvelope();
      remises.push({ enveloppe, entetes: mail.message.messageId() });
      callback(null, { envelope: enveloppe, messageId: mail.message.messageId(), accepted: [] });
    },
  };
}

describe("le chemin d'envoi du lien de connexion", () => {
  it("comprend l'URL du serveur de courrier telle qu'elle est écrite", () => {
    // Given l'URL que la configuration pose, celle-là même que `src/lib/auth.ts` passe
    // aux deux fournisseurs.
    // When le paquet la lit.
    const transport = createTransport(webEnv.SMTP_URL) as unknown as {
      options: { host?: string; port?: number; secure?: boolean };
    };

    // Then l'hôte et le port sont ceux qu'elle nomme. `createTransport` n'ouvre rien, la
    // connexion n'a lieu qu'à l'envoi : cette lecture se tient donc à l'étage qui
    // s'interdit le réseau, et l'adresse morte de la mise en place suffit.
    expect(transport.options.host).toBe("127.0.0.1");
    expect(transport.options.port).toBe(1);
    expect(transport.options.secure).toBe(false);

    // Then une URL de production est comprise de la même façon, chiffrement et
    // identifiants compris, et le mot de passe traverse son encodage sans y laisser de
    // plumes. C'est la seule chose que ce dépôt donne à nodemailer, et il la lui donne
    // sous forme de chaîne : une montée de version qui changerait sa façon de la lire
    // enverrait le lien à côté sans que rien ne le dise, l'écran de connexion rendant la
    // même phrase quoi qu'il arrive.
    const production = createTransport(
      "smtps://robot%40exemple.fr:mot%40de%3Apasse@relais.exemple.fr:465",
    ) as unknown as {
      options: {
        host?: string;
        port?: number;
        secure?: boolean;
        auth?: { user?: string; pass?: string };
      };
    };

    expect(production.options.host).toBe("relais.exemple.fr");
    expect(production.options.port).toBe(465);
    expect(production.options.secure).toBe(true);
    expect(production.options.auth?.user).toBe("robot@exemple.fr");
    expect(production.options.auth?.pass).toBe("mot@de:passe");
  });

  it("remet un message par chacune des deux portes, avec le bon destinataire dans l'enveloppe", async () => {
    // Given le paquet joué exactement comme `signIn` le joue, en processus, en mode brut
    // et sans jeton anti-rejeu, avec les deux fournisseurs que `src/lib/auth.ts` déclare :
    // le nu, qui envoie à l'adresse saisie, et celui que le wrapper de l'espace-membre
    // enveloppe, qui envoie à l'adresse que l'annuaire porte sur la fiche.
    //
    // Le fournisseur est construit ici et non importé de `auth.ts` : ce dernier appelle
    // `NextAuth()` au chargement et n'expose rien de sa configuration. Ce que ce scénario
    // tient est donc le comportement du paquet sous cette forme d'appel, pas le fait que
    // `auth.ts` l'appelle ainsi.
    const { Auth, raw, skipCSRFCheck } = (await import(requireDuPaquet.resolve("@auth/core"))) as {
      Auth: (requete: Request, config: Record<string, unknown>) => Promise<BrutDuPaquet>;
      raw: unknown;
      skipCSRFCheck: unknown;
    };

    const remises: Remise[] = [];
    const serveur = transportQuiCapture(remises);

    const ADRESSE_DE_LA_FICHE = "camille.durand@beta.gouv.invalid";

    // L'annuaire est doublé au seul endroit qui sort : le `fetch` que le fournisseur
    // reçoit. Le reste du client reste le vrai, si bien que la forme de fiche qu'il
    // attend est celle qu'il lira en production.
    const espaceMembre = EspaceMembreProvider({
      fetch: (() =>
        Promise.resolve(
          Response.json({
            username: "camille.durand",
            communication_email: "primary",
            primary_email: ADRESSE_DE_LA_FICHE,
            secondary_email: null,
          }),
        )) as unknown as typeof fetch,
      espaceMembreApiKey: "aucune-cle-en-test",
    });

    const config: Record<string, unknown> = {
      secret: "un-secret-de-test-assez-long-pour-etre-accepte",
      basePath: "/api/auth",
      trustHost: true,
      adapter: adaptateurMuet(),
      session: { strategy: "jwt" },
      providers: [
        espaceMembre.ProviderWrapper(Nodemailer({ server: serveur, from: webEnv.SMTP_EMAIL_FROM })),
        Nodemailer({ server: serveur, from: webEnv.SMTP_EMAIL_FROM, maxAge: 30 * 60 }),
      ],
      callbacks: { signIn: () => true },
    };

    async function demander(fournisseur: string, saisie: string): Promise<BrutDuPaquet> {
      const requete = new Request(`https://exemple.test/api/auth/signin/${fournisseur}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: saisie, callbackUrl: "/" }).toString(),
      });
      return Auth(requete, { ...config, raw, skipCSRFCheck });
    }

    // When on pousse la porte qui envoie à une adresse, puis celle qui part d'un
    // identifiant beta.gouv.
    const parAdresse = await demander(PROVIDER_ADRESSE, "Camille.Durand+etiquette@ADEME.fr");
    const parEspaceMembre = await demander("espace-membre-beta-gouv-email", "camille.durand");

    // Then les deux liens sont partis. Que le fournisseur rende la main sans lever est
    // une assertion à part entière : il lit `rejected` et `pending` sur ce que le
    // transport lui remet et jette dès que l'un des deux porte quelque chose, si bien
    // qu'un destinataire refusé se solderait ici par une exception.
    expect(remises).toHaveLength(2);
    expect(parAdresse.redirect).toContain("/verify-request");
    expect(parEspaceMembre.redirect).toContain("/verify-request");

    // Then l'enveloppe de la première porte le destinataire saisi, entièrement réduit en
    // minuscules par le normalisateur du paquet. C'est la même réduction que
    // `candidatsPourAdresse` tient pour acquise en comparant les adresses par égalité
    // exacte : le lien part donc à l'adresse que le contrôle de droit vient de juger, et
    // pas à une variante de casse dont personne n'aurait vérifié l'accès.
    expect(remises[0]?.enveloppe.to).toEqual(["camille.durand+etiquette@ademe.fr"]);
    expect(remises[0]?.enveloppe.from).toBe(webEnv.SMTP_EMAIL_FROM);

    // Then l'enveloppe de la seconde ne porte pas l'identifiant saisi mais l'adresse que
    // l'annuaire déclare sur la fiche : c'est tout l'objet du wrapper, et un identifiant
    // qui arriverait tel quel dans le champ `to` serait un lien envoyé nulle part.
    expect(remises[1]?.enveloppe.to).toEqual([ADRESSE_DE_LA_FICHE]);
  });
});

/**
 * Un adaptateur qui ne connaît personne et ne garde rien : le paquet vérifie la présence
 * de ses méthodes avant de router quoi que ce soit, et rien de ce qui se joue ici ne
 * dépend de la base.
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
