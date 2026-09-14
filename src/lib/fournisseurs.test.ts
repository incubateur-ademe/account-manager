import { createRequire } from "node:module";
import { createTransport } from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_ADRESSE } from "@/lib/connexion";
import { webEnv } from "@/lib/env";

const ADRESSE_DE_LA_FICHE = "camille.durand@beta.gouv.invalid";

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

/** L'enveloppe qu'un transport aurait remise, sans qu'aucune socket ne s'ouvre. */
type Enveloppe = { from?: string | false; to?: string[] };

/**
 * Un transport qui compose pour de vrai et ne poste rien.
 *
 * `jsonTransport` rendrait la même enveloppe, mais son résultat repart vers le
 * fournisseur, qui n'en réexporte rien : on n'aurait aucun moyen de la lire. Celui-ci est
 * un transport comme un autre du point de vue de nodemailer, il reçoit donc le message
 * déjà passé par `mail-composer` et `addressparser`, et c'est cette enveloppe-là,
 * calculée par le paquet et non par le test, que les scénarios inspectent.
 */
function transportQuiCapture(remises: Enveloppe[]): Record<string, unknown> {
  return {
    name: "capture-de-test",
    version: "1.0.0",
    send(
      mail: { message: { getEnvelope: () => Enveloppe; messageId: () => string } },
      callback: (erreur: Error | null, info: Record<string, unknown>) => void,
    ) {
      const enveloppe = mail.message.getEnvelope();
      remises.push(enveloppe);
      callback(null, { envelope: enveloppe, messageId: mail.message.messageId(), accepted: [] });
    },
  };
}

describe("le chemin d'envoi du lien de connexion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("comprend l'URL du serveur de courrier telle qu'elle est écrite", () => {
    // Given l'URL que la configuration pose, celle-là même que `src/lib/fournisseurs.ts`
    // passe aux deux portes.
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
    // et sans jeton anti-rejeu, avec les fournisseurs que `src/lib/fournisseurs.ts` déclare
    // vraiment : un expéditeur ou une durée de lien qui changerait là-bas change ici, et
    // une porte qu'on retirerait fait tomber ce scénario au lieu de le laisser vert.
    const { Auth, raw, skipCSRFCheck } = (await import(requireDuPaquet.resolve("@auth/core"))) as {
      Auth: (requete: Request, config: Record<string, unknown>) => Promise<BrutDuPaquet>;
      raw: unknown;
      skipCSRFCheck: unknown;
    };

    const remises: Enveloppe[] = [];

    // L'annuaire est doublé au seul endroit qui sort de la machine, le `fetch` global que
    // `fournisseurs.ts` passe au client à son chargement. Il est donc posé avant l'import, et le
    // reste du client demeure le vrai : la forme de fiche qu'il sait lire ici est celle
    // qu'il lira en production.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({
          username: "camille.durand",
          communication_email: "primary",
          primary_email: ADRESSE_DE_LA_FICHE,
          secondary_email: null,
        }),
      ),
    );
    const { fournisseursDuLien } = await import("@/lib/fournisseurs");

    const config: Record<string, unknown> = {
      secret: "un-secret-de-test-assez-long-pour-etre-accepte",
      basePath: "/api/auth",
      trustHost: true,
      adapter: adaptateurMuet(),
      session: { strategy: "jwt" },
      providers: fournisseursDuLien(transportQuiCapture(remises)),
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
    expect(remises[0]?.to).toEqual(["camille.durand+etiquette@ademe.fr"]);
    expect(remises[0]?.from).toBe(webEnv.SMTP_EMAIL_FROM);

    // Then l'enveloppe de la seconde ne porte pas l'identifiant saisi mais l'adresse que
    // l'annuaire déclare sur la fiche : c'est tout l'objet du wrapper, et un identifiant
    // qui arriverait tel quel dans le champ `to` serait un lien envoyé nulle part.
    expect(remises[1]?.to).toEqual([ADRESSE_DE_LA_FICHE]);

    // Then le lien vaut une demi-heure et non la journée que le paquet donne par défaut,
    // et cela pour les deux portes. Épinglé ici parce que rien d'autre ne le tient :
    // c'est une borne de sécurité, un lien étant un porteur, et elle se perdrait en
    // revenant au défaut sans qu'aucun écran ni aucune erreur ne le signale. Les deux
    // valeurs sont demandées et non une seule, parce que c'est précisément par une porte
    // laissée au défaut que l'écart s'était installé.
    // La valeur se lit à deux endroits selon la porte, et ce n'est pas une précaution :
    // le wrapper de l'espace-membre remonte les options à la racine du fournisseur et
    // supprime `options`, là où le fournisseur nu les y laisse. Ne lire qu'un des deux
    // chemins rendait cette assertion vide pour la porte qu'elle vient épingler.
    const portes = fournisseursDuLien() as {
      id?: string;
      maxAge?: number;
      options?: { maxAge?: number };
    }[];
    expect(portes.map((porte) => [porte.id, porte.options?.maxAge ?? porte.maxAge])).toEqual([
      ["espace-membre-beta-gouv-email", 30 * 60],
      [PROVIDER_ADRESSE, 30 * 60],
    ]);
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
