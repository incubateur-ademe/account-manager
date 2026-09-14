import { describe, expect, it } from "vitest";

import { barriereDeBase, doublerBase } from "./db";

/**
 * Ce module est doublé par six harnais, et sa subtilité est exactement celle qui rend un
 * double complaisant : ce qu'il laisse passer sans le dire.
 */
describe("le double de la base refuse ce qu'il ne double pas", () => {
  it("laisse passer les modèles déclarés, et rien d'autre qu'un accès du moteur", () => {
    // Given un harnais qui double un seul modèle,
    const { prisma } = doublerBase({
      person: { findUnique: () => Promise.resolve({ username: "camille.exemple" }) },
    });
    const base = prisma as Record<string, unknown>;

    // Then le modèle déclaré répond,
    expect(base["person"]).toBeDefined();

    // Then un modèle que le harnais ne double pas lève en se nommant, ce qui est toute la
    // différence avec un objet littéral : celui-ci rendrait `undefined`, et la lecture
    // casserait plus loin sur un message qui ne dit ni qui a demandé ni pourquoi,
    expect(() => base["accessCase"]).toThrow("ce harnais ne double pas prisma.accessCase");
    expect(() => base["finding"]).toThrow("ce harnais ne double pas prisma.finding");

    // Then une propriété héritée d'`Object` ne passe pas pour un modèle doublé : la
    // déclaration se juge sur les propriétés propres, là où `in` suivrait la chaîne de
    // prototypes et ouvrirait la barrière sans qu'aucun modèle ne soit déclaré,
    expect(() => base["toString"]).toThrow("ce harnais ne double pas prisma.toString");
    expect(() => base["constructor"]).toThrow("ce harnais ne double pas prisma.constructor");
    expect(() => base["hasOwnProperty"]).toThrow("ce harnais ne double pas prisma.hasOwnProperty");

    // Then ce que le moteur interroge de lui-même passe sans être jugé, parce que ce
    // n'est pas un code qui lit la base : les symboles, et `then`, que toute valeur
    // attendue se voit demander.
    expect(() => Promise.resolve(prisma)).not.toThrow();
    expect(() => String(Object.prototype.toString.call(prisma))).not.toThrow();
  });

  it("refuse tout, symboles compris, quand le harnais ne doit rien lire du tout", async () => {
    // Given la barrière d'un harnais qui prouve qu'une garde passe avant toute lecture,
    const releves: string[] = [];
    const { prisma, deconnecter } = barriereDeBase({
      raison: "accès en base interdit sans session",
      relever: (acces) => releves.push(acces),
    });
    const base = prisma as Record<string, unknown>;

    // Then chaque accès lève en portant la raison du refus et le modèle atteint,
    expect(() => base["person"]).toThrow("accès en base interdit sans session : prisma.person");

    // Then et il est relevé, parce qu'une assertion sur le message rendu ne dirait rien
    // de ce qui a été lu pour le rendre,
    expect(() => base["plan"]).toThrow();
    expect(releves).toEqual(["prisma.person", "prisma.plan"]);

    // Then la fermeture de connexion, elle, répond : une commande qui rattrape une erreur
    // la ferme dans sa branche de sortie, et lever là masquerait ce qu'elle rapportait.
    await expect(deconnecter()).resolves.toBeUndefined();
  });
});
