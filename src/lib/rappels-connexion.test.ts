import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditInput } from "@/core/audit";
import type { DecisionConnexion } from "@/lib/connexion";

import { rappelsDeConnexion } from "./rappels-connexion";

const base = vi.hoisted(() => ({
  decisions: [] as DecisionConnexion[],
  vues: [] as { voie: string | null; email: string | undefined }[],
  journal: [] as AuditInput[],
}));

vi.mock("@/lib/connexion", async () => {
  const reel = await vi.importActual<typeof import("./connexion")>("./connexion");
  return {
    PROVIDER_ADRESSE: reel.PROVIDER_ADRESSE,
    voieDuProvider: reel.voieDuProvider,
    deciderConnexion: (voie: string | null, user: { email?: string | null }) => {
      base.vues.push({ voie, email: user.email ?? undefined });
      const decision = base.decisions.shift();
      if (decision === undefined) {
        throw new Error("le scénario n'a pas prévu de décision pour cet appel");
      }
      return Promise.resolve(decision);
    },
  };
});

vi.mock("@/lib/audit", () => ({
  audit: (entree: AuditInput) => {
    base.journal.push(entree);
  },
}));

const ESPACE_MEMBRE = "espace-membre-beta-gouv-email";

function ouverte(champs: Partial<Extract<DecisionConnexion, { accepte: true }>> = {}) {
  return {
    accepte: true as const,
    voie: "ADRESSE" as const,
    username: "camille.exemple",
    personId: "per_0000000000000000000000",
    viaBreakGlass: false,
    ...champs,
  };
}

function fermee(champs: Partial<Extract<DecisionConnexion, { accepte: false }>> = {}) {
  return {
    accepte: false as const,
    voie: "ADRESSE" as const,
    username: null,
    refus: "SANS_DROIT" as const,
    ...champs,
  };
}

/** Ce que le paquet passe au retour du lien : ni `email`, ni rien qui le distingue. */
const RETOUR_DU_LIEN = {
  user: { id: "u1", email: "camille@exemple.org" },
  account: { provider: "nodemailer", providerAccountId: "camille@exemple.org", type: "email" },
} as never;

/** Et à l'envoi : le champ `email` porte la marque de la phase. */
const ENVOI_DU_LIEN = {
  user: { id: "u1", email: "camille@exemple.org" },
  account: { provider: "nodemailer", providerAccountId: "camille@exemple.org", type: "email" },
  email: { verificationRequest: true },
} as never;

function signIn(params: never): Promise<boolean | string> {
  const rappel = rappelsDeConnexion.signIn;
  if (rappel === undefined) {
    throw new Error("le contrôle de connexion n'est plus câblé");
  }
  return Promise.resolve(rappel(params));
}

function jwt(params: never) {
  const rappel = rappelsDeConnexion.jwt;
  if (rappel === undefined) {
    throw new Error("la construction du jeton n'est plus câblée");
  }
  return Promise.resolve(rappel(params));
}

async function sessionDepuis(params: never): Promise<{ user: Record<string, unknown> }> {
  const rappel = rappelsDeConnexion.session;
  if (rappel === undefined) {
    throw new Error("la lecture du jeton n'est plus câblée");
  }
  return (await rappel(params)) as { user: Record<string, unknown> };
}

beforeEach(() => {
  base.decisions = [];
  base.vues = [];
  base.journal = [];
});

describe("le câblage du contrôle de connexion, et l'invariant qui tient en une ligne absente", () => {
  it("décide au retour du lien exactement comme à son envoi", async () => {
    // Given un droit vivant au moment où le lien part.
    base.decisions = [ouverte()];

    // When le lien est demandé.
    await expect(signIn(ENVOI_DU_LIEN)).resolves.toBe(true);

    // Given ce même droit révoqué pendant que le courriel voyage.
    base.decisions = [fermee({ refus: "SANS_DROIT" })];

    // When le lien est suivi. Le paquet rappelle alors le contrôle **sans** le champ qui
    // marquait la phase d'envoi : c'est la seule différence entre les deux appels.
    // Then le contrôle décide quand même, et refuse. Un `if` sur ce champ ferait ouvrir
    // ici une session que la révocation a retirée il y a vingt minutes.
    await expect(signIn(RETOUR_DU_LIEN)).resolves.toBe(false);
    expect(base.vues).toEqual([
      { voie: "ADRESSE", email: "camille@exemple.org" },
      { voie: "ADRESSE", email: "camille@exemple.org" },
    ]);

    // Then la voie se déduit du fournisseur et de rien d'autre, aux deux appels.
    base.decisions = [ouverte({ voie: "ESPACE_MEMBRE", personId: null })];
    await signIn({ user: { id: "lead.exemple" }, account: { provider: ESPACE_MEMBRE } } as never);
    expect(base.vues.at(-1)).toEqual({ voie: "ESPACE_MEMBRE", email: undefined });
  });

  it("écrit l'événement de connexion avec sa voie, et ne nomme personne sur un refus par adresse", async () => {
    // Given une connexion acceptée par la voie par adresse.
    base.decisions = [ouverte()];
    await signIn(ENVOI_DU_LIEN);

    // Then la trace dit qui, et par quelle porte il l'a prouvé. Sans cette seconde
    // colonne, une fiche nommée comme une opératrice produirait une ligne strictement
    // indiscernable de la connexion réelle de cette opératrice, et le filtre du journal
    // la ferait remonter dans son historique à elle.
    expect(base.journal).toEqual([
      {
        actorKind: "HUMAN",
        actorUsername: "camille.exemple",
        action: "auth.signin",
        targetType: "session",
        after: { voie: "ADRESSE" },
        result: "SUCCESS",
      },
    ]);

    // Then l'accès de secours garde son verbe à lui, c'est ce qui le rend lisible.
    base.journal = [];
    base.decisions = [
      ouverte({ voie: "ESPACE_MEMBRE", username: "secours.exemple", viaBreakGlass: true }),
    ];
    await signIn({
      user: { id: "secours.exemple" },
      account: { provider: ESPACE_MEMBRE },
    } as never);
    expect(base.journal[0]).toMatchObject({
      action: "auth.signin.break_glass",
      after: { voie: "ESPACE_MEMBRE" },
      result: "SUCCESS",
    });

    // Then un refus par adresse dit pourquoi sans dire qui : l'appel n'est pas
    // authentifié, et qui connaît l'adresse de quelqu'un verserait son nom à volonté
    // dans un registre en écriture seule et à rétention indéfinie.
    base.journal = [];
    base.decisions = [fermee({ refus: "LIGNE_ETRANGERE" })];
    await expect(signIn(ENVOI_DU_LIEN)).resolves.toBe(false);
    expect(base.journal).toEqual([
      {
        actorKind: "HUMAN",
        actorUsername: undefined,
        action: "auth.signin",
        targetType: "session",
        after: { voie: "ADRESSE", refus: "LIGNE_ETRANGERE" },
        result: "FAILURE",
      },
    ]);

    // Then un refus par identifiant, lui, nomme : sur cette voie la saisie est un
    // username et non une adresse, et le refus doit se retrouver dans une histoire.
    base.journal = [];
    base.decisions = [
      fermee({ voie: "ESPACE_MEMBRE", username: "passante.exemple", refus: "SANS_FICHE" }),
    ];
    await signIn({
      user: { id: "passante.exemple" },
      account: { provider: ESPACE_MEMBRE },
    } as never);
    expect(base.journal[0]).toMatchObject({
      actorUsername: "passante.exemple",
      after: { voie: "ESPACE_MEMBRE", refus: "SANS_FICHE" },
      result: "FAILURE",
    });
  });

  it("ne met dans le jeton que ce qu'une décision vient de produire", async () => {
    // Given une connexion acceptée par la voie par adresse.
    base.decisions = [ouverte()];

    // When le jeton se construit.
    const jeton = await jwt({
      token: { sub: "u1" },
      user: { id: "u1", email: "camille@exemple.org" },
      account: { provider: "nodemailer" },
    } as never);

    // Then il porte la fiche, le nom et la porte. La fiche est un identifiant que rien
    // n'édite, et c'est sur elle seule qu'un droit par dossier se lira ensuite ; la
    // porte est ce qui interdira au nom de valoir qualité d'opérateur.
    expect(jeton).toMatchObject({
      username: "camille.exemple",
      personId: "per_0000000000000000000000",
      voie: "ADRESSE",
    });

    // When la session se relit depuis ce jeton-là, ce que NextAuth fait à chaque
    // requête, et qui est la seule couture entre ce que le jeton porte et ce que
    // `utilisateurCourant` lit.
    const vue = await sessionDepuis({
      session: { user: { email: "camille@exemple.org" }, expires: "2099-12-31" },
      token: jeton,
    } as never);

    // Then les trois champs la traversent, et la voie en tête : c'est elle qui
    // interdira au nom de valoir qualité d'opérateur, et le nom recopié est celui que
    // la décision a produit, jamais l'identifiant de la ligne d'utilisateur que le
    // paquet a tiré au sort.
    expect(vue.user).toMatchObject({
      username: "camille.exemple",
      personId: "per_0000000000000000000000",
      voie: "ADRESSE",
    });

    // Then un jeton muet sur la porte laisse la session muette elle aussi, plutôt que
    // de lui en supposer une : sans ça, la garde n'aurait plus rien à refuser et un
    // jeton émis avant que la seconde porte existe passerait pour un opérateur.
    const ancienne = await sessionDepuis({
      session: { user: {} },
      token: { sub: "u1", username: "camille.exemple" },
    } as never);
    expect(ancienne.user["voie"]).toBeUndefined();
    expect(ancienne.user["personId"]).toBeNull();

    // When le droit meurt entre le contrôle et la construction du jeton.
    base.decisions = [fermee()];

    // Then aucun jeton n'est produit, ce qui efface le cookie : mieux vaut une session
    // qui n'ouvre pas qu'une session qu'il faudra retirer.
    await expect(
      jwt({
        token: { sub: "u1" },
        user: { id: "u1", email: "camille@exemple.org" },
        account: { provider: "nodemailer" },
      } as never),
    ).resolves.toBeNull();

    // Then les appels suivants, qui relisent un jeton déjà rempli et ne portent aucun
    // compte, le rendent tel quel sans rien redécider : c'est là que passerait une
    // relecture par requête, et il n'y en a pas.
    const deja = { sub: "u1", username: "camille.exemple", personId: "per_x", voie: "ADRESSE" };
    await expect(jwt({ token: deja, user: { id: "u1" } } as never)).resolves.toBe(deja);
    expect(base.vues).toHaveLength(2);
  });
});
