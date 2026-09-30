import { describe, expect, it } from "vitest";

import { ISSUE_GESTE, REFUS_SANS_CONFIRMATION, refusDEcart } from "@/core/execution";
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
  expiresInDays: 30,
};

function ilYA(jours: number): Date {
  return new Date(MAINTENANT.getTime() - jours * JOUR);
}

async function semerPersonne(): Promise<string> {
  const { id } = await prisma.person.create({
    data: { username: USERNAME, fullname: "Nour Exemple", source: "BETA" },
    select: { id: true },
  });
  return id;
}

interface EtapeSemee {
  idempotencyKey: string;
  tier: string;
  state: "PENDING" | "SUCCEEDED" | "SKIPPED";
  grantExpiresAt?: Date;
}

async function semerGeste(
  personId: string,
  champs: {
    id: string;
    state: "EXECUTING" | "PARTIALLY_EXECUTED" | "EXECUTED";
    confirmedDigest: string;
    creeIlYA: number;
    confirmeIlYA: number | null;
    termeDans: number;
    etapes: readonly EtapeSemee[];
  },
): Promise<void> {
  await prisma.plan.create({
    data: {
      id: champs.id,
      kind: "MANUAL_OP",
      state: champs.state,
      subjectId: personId,
      intent: INTENTION,
      planDigest: champs.confirmedDigest,
      confirmedDigest: champs.confirmedDigest,
      confirmedAt: champs.confirmeIlYA === null ? null : ilYA(champs.confirmeIlYA),
      confirmedBy: champs.confirmeIlYA === null ? null : "operatrice.exemple",
      createdBy: "operatrice.exemple",
      createdAt: ilYA(champs.creeIlYA),
      expiresAt: new Date(MAINTENANT.getTime() + champs.termeDans * JOUR),
      steps: {
        create: champs.etapes.map((etape, rang) => ({
          systemKey: "scalingo",
          tier: etape.tier,
          capability: "grant",
          action: "collaborer",
          label: "Inviter sur service-annuaire",
          params: {},
          riskLevel: "HIGH",
          expectedState: "ALREADY_PRESENT",
          idempotencyKey: etape.idempotencyKey,
          ordre: rang + 1,
          state: etape.state,
          grantExpiresAt: etape.grantExpiresAt ?? null,
        })),
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

    // Given ce que le geste vaut aujourd'hui, tel que l'exécution le recalcule : une étape à
    // faire à la main, faute de credential Scalingo ici,
    const actuel = await calculerGeste(
      INTENTION as Parameters<typeof calculerGeste>[0],
      personId,
      USERNAME,
      MAINTENANT,
    );
    const [recalculee] = actuel.etapes;
    expect(actuel.etapes).toHaveLength(1);
    expect(recalculee?.etape.tier).toBe("manual");

    // Given un geste soldé dont une étape a été écartée, un geste en cours fidèle à ce qui a
    // été approuvé mais figé en automatique, et un autre dont l'empreinte a bougé. Le
    // premier créé n'est pas le premier confirmé, et le dernier confirmé est semé en
    // dernier : seul le tri sur la confirmation les range.
    const terme = new Date("2027-03-01T12:00:00Z");
    await semerGeste(personId, {
      id: "pla-solde",
      state: "EXECUTED",
      confirmedDigest: "digest-solde",
      creeIlYA: 21,
      confirmeIlYA: 20,
      termeDans: -13,
      etapes: [
        {
          idempotencyKey: "idem-solde-1",
          tier: "manual",
          state: "SUCCEEDED",
          grantExpiresAt: terme,
        },
        {
          idempotencyKey: "idem-solde-2",
          tier: "manual",
          state: "SUCCEEDED",
          grantExpiresAt: terme,
        },
        {
          idempotencyKey: "idem-solde-3",
          tier: "manual",
          state: "SKIPPED",
          grantExpiresAt: new Date("2027-06-01T12:00:00Z"),
        },
      ],
    });
    await semerGeste(personId, {
      id: "pla-deplace",
      state: "PARTIALLY_EXECUTED",
      confirmedDigest: "digest-d-avant-la-collecte",
      creeIlYA: 2,
      confirmeIlYA: 2,
      termeDans: 5,
      etapes: [{ idempotencyKey: "idem-deplace", tier: "manual", state: "PENDING" }],
    });
    await semerGeste(personId, {
      id: "pla-fidele",
      state: "EXECUTING",
      confirmedDigest: actuel.empreinte,
      creeIlYA: 3,
      confirmeIlYA: 1,
      termeDans: 6,
      etapes: [
        {
          idempotencyKey: `${recalculee?.etape.idempotencyKey}:pla-fidele`,
          tier: "auto",
          state: "PENDING",
        },
      ],
    });

    const lus = await gestesConfirmes(personId, USERNAME, MAINTENANT);

    // Then le soldé se résume avec les seuls termes des accès ouverts, une fois chacun :
    // l'étape écartée n'a rien ouvert,
    expect(lus.soldes).toEqual([
      expect.objectContaining({
        planId: "pla-solde",
        systeme: "scalingo",
        etapes: 3,
        confirmePar: "operatrice.exemple",
        termes: [terme],
      }),
    ]);

    // Then les gestes en cours viennent du plus récemment confirmé au plus ancien,
    expect(lus.enCours.map(({ planId }) => planId)).toEqual(["pla-fidele", "pla-deplace"]);
    const [fidele, deplace] = lus.enCours;

    // Then le geste fidèle se lance, et sa masse se mesure sur le recalcul comme au
    // lancement : aucune étape que l'outil ferait lui-même, bien que le plan figé en
    // porte une,
    expect(fidele?.refus).toBeNull();
    expect(fidele?.pointable).toBe(true);
    expect(fidele?.masse).toEqual({ executables: 0, seuil: expect.any(Number), depasse: false });

    // Then son étape dit que la voie du jour n'est plus celle qui a été figée,
    expect(fidele?.etapes[0]?.voie).toMatch(/aujourd'hui cette étape est à faire à la main/u);

    // Then le geste déplacé porte mot pour mot le refus de l'exécution, sans masse, et
    // reste pointable : écarter ses étapes est sa seule sortie,
    expect(deplace?.etat).toBe("PARTIALLY_EXECUTED");
    expect(deplace?.refus).toBe(
      refusDEcart("digest-d-avant-la-collecte", actuel.empreinte, ISSUE_GESTE),
    );
    expect(deplace?.masse).toBeNull();
    expect(deplace?.pointable).toBe(true);

    // Given le geste déplacé devenu aussi périmé, puis un départ ouvert sur la personne,
    await prisma.plan.update({
      where: { id: "pla-deplace" },
      data: { expiresAt: ilYA(2) },
    });
    const depart = await prisma.accessCase.create({
      data: { personId, kind: "OFFBOARDING", state: "CONFIRMED" },
    });

    // Then le départ passe avant tout autre refus, péremption comprise, et plus rien ne
    // se pointe, le pointage refusant pour la même raison,
    const pendantLeDepart = await gestesConfirmes(personId, USERNAME, MAINTENANT);
    expect(pendantLeDepart.enCours.map(({ refus }) => refus)).toEqual([
      REFUS_DEPART_OUVERT,
      REFUS_DEPART_OUVERT,
    ]);
    expect(pendantLeDepart.enCours.every(({ pointable }) => !pointable)).toBe(true);

    // Given le départ abandonné,
    await prisma.accessCase.update({ where: { id: depart.id }, data: { state: "CANCELLED" } });

    // Then la péremption passe avant l'écart, comme au lancement, et le geste redevient
    // pointable,
    const apresLeDepart = await gestesConfirmes(personId, USERNAME, MAINTENANT);
    const perime = apresLeDepart.enCours.find(({ planId }) => planId === "pla-deplace");
    expect(perime?.refus).toMatch(/^Ce plan valait jusqu'au/u);
    expect(perime?.pointable).toBe(true);

    // Given un geste en cours sans instant de confirmation, fidèle par ailleurs,
    await semerGeste(personId, {
      id: "pla-sans-instant",
      state: "EXECUTING",
      confirmedDigest: actuel.empreinte,
      creeIlYA: 1,
      confirmeIlYA: null,
      termeDans: 6,
      etapes: [
        {
          idempotencyKey: `${recalculee?.etape.idempotencyKey}:pla-sans-instant`,
          tier: "manual",
          state: "PENDING",
        },
      ],
    });

    // Then il vient en dernier, et oppose le refus que le lancement lui opposerait.
    const sansInstant = (await gestesConfirmes(personId, USERNAME, MAINTENANT)).enCours.at(-1);
    expect(sansInstant?.planId).toBe("pla-sans-instant");
    expect(sansInstant?.refus).toBe(REFUS_SANS_CONFIRMATION);
    expect(sansInstant?.masse).toBeNull();
  });
});
