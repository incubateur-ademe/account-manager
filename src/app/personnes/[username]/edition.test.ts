import { beforeEach, describe, expect, it, vi } from "vitest";

import { RAISON_NON_EDITABLE } from "@/core/fiche-manuelle";

import { type EtatEdition, modifierFiche } from "./edition";

/**
 * Ce qu'une fiche réécrite ailleurs répond à une correction.
 *
 * Les deux motifs de refus sont écrits pour le bandeau de la fiche, qui annonce lui-même
 * que l'édition est fermée. Rendus tels quels par l'action, ils décrivent ce qui arriverait
 * à une saisie sans dire ce qu'est devenue celle-ci, et leur conditionnel se lit alors
 * comme une prédiction sur un enregistrement qui aurait eu lieu.
 */

const base = vi.hoisted(() => ({
  ecrites: [] as { id: string; fullname: string }[],
}));

const DECLAREE_DANS_LA_POLITIQUE = "robin.exemple";

const FICHES = [
  {
    id: "fiche-collectee",
    username: "alex.exemple",
    source: "BETA",
    usernameFabricated: false,
    fullname: "Alex Exemple",
    githubLogin: null,
    primaryEmail: null,
    communicationEmail: null,
    missionEnd: null,
  },
  {
    id: "fiche-declaree",
    username: DECLAREE_DANS_LA_POLITIQUE,
    source: "LOCAL",
    usernameFabricated: true,
    fullname: "Robin Exemple",
    githubLogin: null,
    primaryEmail: null,
    communicationEmail: null,
    missionEnd: null,
  },
  {
    id: "fiche-locale",
    username: "camille.exemple",
    source: "LOCAL",
    usernameFabricated: true,
    fullname: "Camille Exemple",
    githubLogin: null,
    primaryEmail: null,
    communicationEmail: null,
    missionEnd: null,
  },
];

vi.mock("@/lib/env", () => ({ webEnv: { OPERATORS: [], BREAK_GLASS_USERNAMES: [] } }));

vi.mock("@/lib/policy", () => ({
  policy: () => ({ scope: { local: [{ username: "robin.exemple" }] } }),
}));

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

vi.mock("@/lib/audit", () => ({ audit: () => undefined }));

vi.mock("@/lib/actions", async () => {
  const { operatrice } = await import("@/test/doubles/session");
  return {
    actionTracee: async (params: {
      ecrire: (utilisateur: unknown) => Promise<unknown>;
    }): Promise<void> => {
      await params.ecrire(operatrice());
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: ({ where }: { where: { username: string } }) =>
        Promise.resolve(FICHES.find((fiche) => fiche.username === where.username) ?? null),
      update: ({ where, data }: { where: { id: string }; data: { fullname: string } }) => {
        base.ecrites.push({ id: where.id, fullname: data.fullname });
        return Promise.resolve(undefined);
      },
    },
  },
}));

const NOM_CORRIGE = "Nom corrigé";

function correction(username: string): FormData {
  const formulaire = new FormData();
  formulaire.set("username", username);
  formulaire.set("fullname", NOM_CORRIGE);
  formulaire.set("githubLogin", "");
  formulaire.set("primaryEmail", "");
  formulaire.set("communicationEmail", "");
  return formulaire;
}

function refus(etat: EtatEdition): string {
  if (etat === null || !("erreur" in etat)) {
    throw new Error(`Cette correction n'a pas été refusée : ${JSON.stringify(etat)}`);
  }
  return etat.erreur;
}

describe("la correction d'une fiche qu'un autre système réécrit", () => {
  beforeEach(() => {
    base.ecrites = [];
  });

  it("n'écrit rien et le dit avant d'en donner la raison", async () => {
    const collectee = refus(await modifierFiche(null, correction("alex.exemple")));
    const declaree = refus(await modifierFiche(null, correction(DECLAREE_DANS_LA_POLITIQUE)));

    expect(base.ecrites).toEqual([]);

    for (const message of [collectee, declaree]) {
      expect(message).toMatch(/^Rien n'a été enregistré\. \p{Lu}/u);
    }
    expect(collectee).toContain(RAISON_NON_EDITABLE.COLLECTEE);
    expect(declaree).toContain(RAISON_NON_EDITABLE.DECLAREE);
  });

  it("laisse passer la correction d'une fiche que personne ne réécrit", async () => {
    const etat = await modifierFiche(null, correction("camille.exemple"));

    expect(etat).toEqual({ modifie: true });
    expect(base.ecrites).toEqual([{ id: "fiche-locale", fullname: NOM_CORRIGE }]);
  });
});
