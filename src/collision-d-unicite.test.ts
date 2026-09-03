import { beforeEach, describe, expect, it, vi } from "vitest";

import { rattacherIdentite } from "@/app/comptes-isoles/actions";
import { modifierFiche } from "@/app/personnes/[username]/edition";
import { Prisma } from "@/generated/prisma/client";

/**
 * L'index unique de `Person.communicationEmail` est posé à la main dans la migration,
 * Prisma ne sachant pas déclarer un index partiel. Deux actions écrivent cette colonne
 * sur une fiche locale, et sans traduction leur violation d'unicité sort de l'action
 * serveur : l'opérateur perd sa saisie et voit l'écran générique de Next là où toutes
 * les autres branches de la même action lui rendent une phrase.
 *
 * À la racine de `src/` comme les autres invariants qui traversent deux répertoires :
 * ce qui se vérifie ici est que les deux écritures répondent de la même façon, pas ce
 * que chacune fait de son côté.
 */
const base = vi.hoisted(() => ({
  levee: null as unknown,
  ecrites: [] as string[],
}));

function collision(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

vi.mock("@/lib/policy", () => ({ policy: () => ({ scope: { local: [] } }) }));

vi.mock("@/lib/env", () => ({ webEnv: { OPERATORS: [], BREAK_GLASS_USERNAMES: [] } }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () =>
    Promise.resolve({
      username: "operatrice.exemple",
      email: null,
      nom: null,
      personId: null,
      voie: "ESPACE_MEMBRE",
      operateur: true,
    }),
}));

vi.mock("@/lib/audit", () => ({ audit: () => undefined }));

// Le vrai passage tracé rejoue l'erreur après avoir démenti sa trace : le double le
// reproduit, sans quoi le test prouverait que le `catch` attrape ce que rien ne lève.
vi.mock("@/lib/actions", () => ({
  actionTracee: async (params: {
    ecrire: (utilisateur: unknown) => Promise<unknown>;
  }): Promise<void> => {
    await params.ecrire({ username: "operatrice.exemple", operateur: true });
  },
}));

vi.mock("@/lib/espace-membre", () => ({
  fetchMemberDetail: () =>
    Promise.resolve({
      uuid: "uuid-de-la-passante",
      username: "passante.exemple",
      fullname: "Passante Exemple",
      primary_email: "lead@exemple.org",
      communication_email: "primary",
      missions: [],
    }),
}));

const FICHE = {
  id: "per_0000000000000000000000",
  username: "camille.exemple",
  source: "LOCAL",
  usernameFabricated: true,
  fullname: "Camille Exemple",
  githubLogin: null,
  primaryEmail: null,
  communicationEmail: null,
  missionEnd: null,
};

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: ({ where }: { where: { username: string } }) =>
        Promise.resolve(where.username === FICHE.username ? FICHE : null),
      update: () => {
        base.ecrites.push("person.update");
        return Promise.reject(base.levee);
      },
      create: () => {
        base.ecrites.push("person.create");
        return Promise.reject(base.levee);
      },
    },
    serviceAccount: {
      findUnique: () => Promise.resolve(null),
    },
    externalIdentity: {
      findUnique: () =>
        Promise.resolve({
          id: "idt_0000000000000000000000",
          handle: "cexemple",
          provider: "github",
          personId: null,
          serviceAccountId: null,
          matchMethod: null,
        }),
      update: () => Promise.resolve(undefined),
    },
    finding: {
      findMany: () => Promise.resolve([]),
    },
  },
}));

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

beforeEach(() => {
  base.levee = collision();
  base.ecrites = [];
});

describe("une adresse déjà prise se dit à l'écran, elle ne fait pas sortir l'action", () => {
  it("rend une phrase sur les deux écritures qui posent une adresse, et relaie tout le reste", async () => {
    // Given une fiche locale que l'opératrice édite, et une adresse que la base tient
    // déjà pour prise ailleurs
    // When elle enregistre
    const edition = await modifierFiche(
      null,
      champs({
        username: "camille.exemple",
        fullname: "Camille Exemple",
        githubLogin: "",
        primaryEmail: "",
        communicationEmail: "lead@exemple.org",
      }),
    );

    // Then l'écriture a bien eu lieu et a été refusée, et l'action rend la phrase qui
    // nomme l'adresse en cause plutôt que de laisser l'exception sortir
    expect(base.ecrites).toEqual(["person.update"]);
    expect(edition).toEqual({
      erreur:
        "« lead@exemple.org » est déjà l'adresse de communication d'une autre fiche locale. Rien n'a été écrit : corrigez-la, ou reprenez l'autre fiche.",
    });

    // Given le même refus sur l'autre geste qui pose une adresse : la fiche créée pour
    // quelqu'un que l'incubateur ne compte pas parmi les siens
    base.ecrites = [];

    // When une opératrice rattache un compte isolé à cette personne
    const rattachement = await rattacherIdentite(
      null,
      champs({ id: "idt_0000000000000000000000", cible: "passante.exemple" }),
    );

    // Then la même discipline : l'action répond, et sa phrase n'affirme pas laquelle
    // des trois colonnes uniques a sauté, l'erreur ne le disant pas de façon portable
    expect(base.ecrites).toEqual(["person.create"]);
    expect(rattachement).toEqual({
      erreur:
        "Aucune fiche n'a été créée pour « passante.exemple » : une autre porte déjà son identifiant, son identifiant beta.gouv ou son adresse de communication. Rien n'a été écrit.",
    });

    // Given une panne qui n'est pas une collision
    base.levee = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "test",
    });

    // Then elle remonte telle quelle, sur les deux gestes : traduire toute erreur en
    // message d'écran ferait passer une panne pour une saisie à corriger, et l'opérateur
    // referait indéfiniment le même geste.
    await expect(
      modifierFiche(
        null,
        champs({
          username: "camille.exemple",
          fullname: "Camille Exemple",
          githubLogin: "",
          primaryEmail: "",
          communicationEmail: "lead@exemple.org",
        }),
      ),
    ).rejects.toThrow("Foreign key constraint failed");

    await expect(
      rattacherIdentite(
        null,
        champs({ id: "idt_0000000000000000000000", cible: "passante.exemple" }),
      ),
    ).rejects.toThrow("Foreign key constraint failed");
  });
});
