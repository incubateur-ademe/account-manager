import { describe, expect, it } from "vitest";

import { ISSUE_GESTE, refusDEcart } from "@/core/execution";
import { prisma } from "@/lib/db";
import { calculerGeste, REFUS_DEPART_OUVERT } from "@/lib/geste";

import { gestesConfirmes } from "./gestes-confirmes";

/**
 * Ce que la fiche lit des gestes confirmés, contre une vraie base.
 *
 * Le refus d'exécution s'y lit sur les gardes de `executerPlan`, et c'est le recalcul du
 * geste qui les nourrit : un double ne rendrait que l'empreinte qu'on lui a apprise.
 */

const USERNAME = "nour.exemple";
const MAINTENANT = new Date("2026-09-22T09:00:00Z");
const JOUR = 86_400_000;

const INTENTION = {
  systeme: "scalingo",
  scope: {
    nature: "collaboration",
    region: "osc-fr1",
    application: "service-annuaire",
    role: "collaborator",
  },
  justification: "Renfort pendant une astreinte",
};

async function semerPersonne(): Promise<string> {
  const { id } = await prisma.person.create({
    data: { username: USERNAME, fullname: "Nour Exemple", source: "BETA" },
    select: { id: true },
  });
  return id;
}

async function semerGeste(
  personId: string,
  champs: {
    id: string;
    state: "EXECUTING" | "PARTIALLY_EXECUTED" | "EXECUTED";
    confirmedDigest: string;
    confirmeIlYA: number;
    termeDans: number;
    grantExpiresAt?: Date;
  },
): Promise<void> {
  const confirmedAt = new Date(MAINTENANT.getTime() - champs.confirmeIlYA * JOUR);
  await prisma.plan.create({
    data: {
      id: champs.id,
      kind: "MANUAL_OP",
      state: champs.state,
      subjectId: personId,
      intent: INTENTION,
      planDigest: champs.confirmedDigest,
      confirmedDigest: champs.confirmedDigest,
      confirmedAt,
      confirmedBy: "operatrice.exemple",
      createdBy: "operatrice.exemple",
      createdAt: confirmedAt,
      expiresAt: new Date(MAINTENANT.getTime() + champs.termeDans * JOUR),
      steps: {
        create: {
          systemKey: "scalingo",
          tier: "manual",
          capability: "grant",
          action: "collaborer",
          label: "Inviter sur service-annuaire",
          params: {},
          riskLevel: "HIGH",
          expectedState: "ALREADY_PRESENT",
          idempotencyKey: `idem-${champs.id}`,
          ordre: 1,
          state: champs.state === "EXECUTED" ? "SUCCEEDED" : "PENDING",
          grantExpiresAt: champs.grantExpiresAt ?? null,
        },
      },
    },
  });
}

describe("les gestes confirmés que la fiche lit", () => {
  it("sépare les soldés des gestes en cours, et oppose à chacun le refus que l'exécution opposerait", async () => {
    // Given une personne sans geste,
    const personId = await semerPersonne();

    // Then la fiche n'a rien à rendre,
    await expect(gestesConfirmes(personId, USERNAME, MAINTENANT)).resolves.toEqual({
      enCours: [],
      soldes: [],
    });

    // Given l'empreinte que le geste vaut aujourd'hui, telle que l'exécution la recalcule,
    const actuel = await calculerGeste(
      INTENTION as Parameters<typeof calculerGeste>[0],
      personId,
      USERNAME,
      MAINTENANT,
    );

    // Given un geste soldé qui a posé un terme, un geste en cours fidèle à ce qui a été
    // approuvé, et un autre dont l'empreinte a bougé depuis,
    const terme = new Date("2027-03-01T12:00:00Z");
    await semerGeste(personId, {
      id: "pla-solde",
      state: "EXECUTED",
      confirmedDigest: "digest-solde",
      confirmeIlYA: 20,
      termeDans: -13,
      grantExpiresAt: terme,
    });
    await semerGeste(personId, {
      id: "pla-fidele",
      state: "EXECUTING",
      confirmedDigest: actuel.empreinte,
      confirmeIlYA: 1,
      termeDans: 6,
    });
    await semerGeste(personId, {
      id: "pla-deplace",
      state: "PARTIALLY_EXECUTED",
      confirmedDigest: "digest-d-avant-la-collecte",
      confirmeIlYA: 2,
      termeDans: 5,
    });

    const lus = await gestesConfirmes(personId, USERNAME, MAINTENANT);

    // Then le soldé se résume, terme compris, et ne paie aucun recalcul,
    expect(lus.soldes).toEqual([
      expect.objectContaining({
        planId: "pla-solde",
        systeme: "scalingo",
        etapes: 1,
        confirmePar: "operatrice.exemple",
        termes: [terme],
      }),
    ]);

    // Then les gestes en cours viennent du plus récemment confirmé au plus ancien,
    expect(lus.enCours.map(({ planId }) => planId)).toEqual(["pla-fidele", "pla-deplace"]);
    const [fidele, deplace] = lus.enCours;

    // Then le geste fidèle se lance : aucun refus, et sa masse est mesurée sur le recalcul,
    expect(fidele?.refus).toBeNull();
    expect(fidele?.pointable).toBe(true);
    expect(fidele?.masse).toMatchObject({ depasse: false });

    // Then le geste déplacé porte mot pour mot le refus de l'exécution, sans masse, et
    // reste pointable : écarter ses étapes est sa seule sortie,
    expect(deplace?.etat).toBe("PARTIALLY_EXECUTED");
    expect(deplace?.refus).toBe(
      refusDEcart("digest-d-avant-la-collecte", actuel.empreinte, ISSUE_GESTE),
    );
    expect(deplace?.masse).toBeNull();
    expect(deplace?.pointable).toBe(true);

    // Given un départ ouvert sur la personne,
    await prisma.accessCase.create({
      data: { personId, kind: "OFFBOARDING", state: "CONFIRMED" },
    });

    // Then chaque geste en cours oppose le refus du départ, avant tout autre, et plus rien
    // ne s'y pointe, le pointage refusant pour la même raison,
    const pendantLeDepart = await gestesConfirmes(personId, USERNAME, MAINTENANT);
    expect(pendantLeDepart.enCours.map(({ refus }) => refus)).toEqual([
      REFUS_DEPART_OUVERT,
      REFUS_DEPART_OUVERT,
    ]);
    expect(pendantLeDepart.enCours.every(({ pointable }) => !pointable)).toBe(true);

    // Given le départ abandonné, et le terme du geste fidèle passé,
    await prisma.accessCase.updateMany({ where: { personId }, data: { state: "CANCELLED" } });
    await prisma.plan.update({
      where: { id: "pla-fidele" },
      data: { expiresAt: new Date(MAINTENANT.getTime() - 2 * JOUR) },
    });

    // Then c'est la péremption qui refuse le geste fidèle, et il redevient pointable.
    const perime = await gestesConfirmes(personId, USERNAME, MAINTENANT);
    const fideleAPresent = perime.enCours.find(({ planId }) => planId === "pla-fidele");
    expect(fideleAPresent?.refus).toMatch(/^Ce plan valait jusqu'au/u);
    expect(fideleAPresent?.pointable).toBe(true);
    expect(fideleAPresent?.masse).toBeNull();
  });
});
