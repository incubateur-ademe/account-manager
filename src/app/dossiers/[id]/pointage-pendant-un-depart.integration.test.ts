import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedStep } from "@/core/connector";
import { intentionDUnGeste } from "@/core/geste";
import { empreinteDuPlan } from "@/core/plan";
import { prisma } from "@/lib/db";
import { enregistrerPlan, type PlanCalcule } from "@/lib/dossier";

/**
 * La fenêtre entre la garde lue et l'écriture, sur les deux gestes qui font naître un
 * engagement hors dossier : le pointage et le verdict.
 *
 * Contre une vraie base, parce que la condition en jeu traverse deux relations pour dire
 * « aucun départ n'est ouvert sur le sujet de ce plan », et qu'un double ne l'honorerait
 * pas sans réécrire un moteur. Ce que le scénario tient : qu'un départ ouvert *après* la
 * garde ne laisse plus rien s'écrire. Sans cela, l'engagement né de ce pointage sort du
 * plan de départ, borné à l'instant de sa confirmation, donc l'accès ouvert ici n'est
 * repris par personne.
 *
 * `departOuvertSur` est doublée à faux, et c'est la seule liberté du montage : c'est
 * exactement ce que la vraie fonction aurait répondu en s'exécutant avant que le départ
 * s'ouvre. Tout le reste est le produit.
 */

const { departOuvert } = vi.hoisted(() => ({ departOuvert: { repond: false } }));

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/geste", async (original) => ({
  ...(await original<typeof import("@/lib/geste")>()),
  departOuvertSur: () => Promise.resolve(departOuvert.repond),
}));

const { pointerEtape, validerEtape } = await import("./actions");

const REPERTOIRE = mkdtempSync(join(tmpdir(), "pointage-integration-"));
copyFileSync(resolve(process.cwd(), "config/config.exemple.yaml"), join(REPERTOIRE, "config.yaml"));
process.env["POLICY_DIR"] = REPERTOIRE;

const USERNAME = "nour.exemple";
const OUVERTURE = new Date("2026-09-10T09:00:00Z");

const OPERATRICE = "operatrice.exemple";
const AUTRE = "collegue.exemple";

const intention = intentionDUnGeste.parse({
  systeme: "scalingo",
  scope: {
    nature: "collaboration",
    region: "osc-fr1",
    application: "portail-exemple",
    role: "limited",
  },
  expiresInDays: 30,
  justification: "renfort d'astreinte sur le portail",
});

function gesteManuel(): PlanCalcule {
  const etape: PlannedStep = {
    systemKey: "scalingo",
    capability: "grant",
    tier: "manual",
    action: "emettre-un-jeton-restreint",
    label: "Émettre un jeton restreint pour l'astreinte",
    params: { usage: "astreinte", region: "osc-fr1" },
    riskLevel: "high",
    expectedState: { jeton: true },
    idempotencyKey: `scalingo:osc-fr1:grant-jeton:${USERNAME}`,
    grantExpiresAt: new Date("2026-10-10T09:00:00Z"),
    engagementKey: "scalingo:jeton:astreinte",
    manual: {
      title: "Émettre un jeton restreint",
      runbook: "Passer par le proxy, qui seul sait en générer un.",
      doneWhen: "Le jeton a été remis à son destinataire.",
    },
  };

  return {
    sens: "ONBOARDING",
    etapes: [{ etape, origine: "connecteur", ordre: 0 }],
    ecartees: [],
    empreinte: empreinteDuPlan([etape]),
    systemes: ["scalingo"],
    sansConnecteur: [],
    nonConfirmes: [],
    refus: [],
  };
}

/** Un geste confirmé, prêt à être pointé : l'état qu'un plan porte après confirmation. */
async function gesteConfirme(personId: string): Promise<{ planId: string; etapeId: string }> {
  const calcule = gesteManuel();
  const planId = await enregistrerPlan(
    { kind: "MANUAL_OP", subjectId: personId, intention },
    calcule,
    OPERATRICE,
    OUVERTURE,
  );
  await prisma.plan.update({
    where: { id: planId },
    data: {
      state: "EXECUTING",
      confirmedDigest: calcule.empreinte,
      confirmedBy: OPERATRICE,
      confirmedAt: OUVERTURE,
    },
  });
  const etape = await prisma.planStep.findFirstOrThrow({
    where: { planId },
    select: { id: true },
  });
  return { planId, etapeId: etape.id };
}

function pointage(etapeId: string): FormData {
  const donnees = new FormData();
  donnees.set("etapeId", etapeId);
  donnees.set("pointage", "fait");
  return donnees;
}

function verdict(etapeId: string): FormData {
  const donnees = new FormData();
  donnees.set("etapeId", etapeId);
  donnees.set("verdict", "accepter");
  return donnees;
}

describe("ce qu'un départ ouvert après la garde empêche encore d'écrire", () => {
  let personId = "";

  beforeEach(async () => {
    departOuvert.repond = false;
    const personne = await prisma.person.create({
      data: {
        username: USERNAME,
        fullname: "Nour Exemple",
        source: "BETA",
        communicationEmail: "nour.exemple@exemple.invalid",
      },
    });
    personId = personne.id;
  });

  it("refuse le pointage et le verdict d'un geste dont le sujet part, sans toucher l'étape", async () => {
    // Given un geste confirmé sur une personne qu'aucun départ ne concerne
    const { etapeId } = await gesteConfirme(personId);

    // Then il se pointe : c'est le cas nominal, et sans cette assertion le refus qui suit
    // ne prouverait rien, une condition toujours fausse le rendant aussi
    expect(await pointerEtape(null, pointage(etapeId))).toEqual({});
    const pointee = await prisma.planStep.findUniqueOrThrow({
      where: { id: etapeId },
      select: { state: true, executedAt: true, attempts: true, declaredBy: true },
    });
    expect(pointee.state).toBe("SUCCEEDED");
    expect(pointee.executedAt).not.toBeNull();

    // Given un second geste, et un départ qui s'ouvre entre la garde et l'écriture : la
    // garde a répondu « aucun départ » parce qu'elle a couru avant, ce que le double dit
    const second = await gesteConfirme(personId);
    await prisma.accessCase.create({
      data: { personId, kind: "OFFBOARDING", state: "CANDIDATE" },
    });
    const avant = await prisma.planStep.findUniqueOrThrow({
      where: { id: second.etapeId },
      select: { state: true, executedAt: true, attempts: true, declaredBy: true },
    });

    // When on pointe
    // Then l'écriture lève : la condition d'ancrage la refuse, et le compte à zéro dit
    // que l'étape a changé pendant le pointage. Sans elle, cet `executedAt` ferait naître
    // un engagement que le plan du départ, borné à sa confirmation, ne reprendrait pas
    await expect(pointerEtape(null, pointage(second.etapeId))).rejects.toThrow(
      "Cette étape a changé pendant le pointage",
    );

    // Then l'étape n'a pas bougé d'un champ : ni son état, ni sa date, ni son compte de
    // tentatives, ni le nom de qui aurait déclaré
    expect(
      await prisma.planStep.findUniqueOrThrow({
        where: { id: second.etapeId },
        select: { state: true, executedAt: true, attempts: true, declaredBy: true },
      }),
    ).toEqual(avant);

    // Given la même fenêtre sur le verdict, qui est ce qui solde réellement une étape que
    // son plan confie au regard d'un autre : elle est pointée par quelqu'un d'autre et
    // attend un contrôle
    await prisma.planStep.update({
      where: { id: second.etapeId },
      data: {
        state: "SUCCEEDED",
        executedAt: OUVERTURE,
        attempts: 1,
        declaredBy: AUTRE,
        validationBy: "OPERATOR",
        validation: "AWAITING",
      },
    });
    const avantVerdict = await prisma.planStep.findUniqueOrThrow({
      where: { id: second.etapeId },
      select: { validation: true, validatedBy: true, validatedAt: true, state: true },
    });

    // When on accepte
    // Then l'écriture lève de la même façon, et rien n'est signé : un verdict posé
    // pendant ce départ ferait naître son engagement hors de tout plan de reprise
    await expect(validerEtape(null, verdict(second.etapeId))).rejects.toThrow(
      "Cette étape a changé pendant la validation",
    );
    expect(
      await prisma.planStep.findUniqueOrThrow({
        where: { id: second.etapeId },
        select: { validation: true, validatedBy: true, validatedAt: true, state: true },
      }),
    ).toEqual(avantVerdict);
  });

  it("laisse pointer le plan qu'aucun ancrage ne porte plus, dont la condition ne peut rien dire", async () => {
    // Given un plan d'arrivée dont le dossier a été supprimé : la relation est en
    // `SetNull`, si bien que le plan survit sans dossier et sans sujet. Aucune garde en
    // lecture ne s'y oppose, un dossier absent étant aussi un dossier sans porteur devant
    // qui se situer, et l'équipe transverse peut encore le pointer.
    const dossier = await prisma.accessCase.create({
      data: { personId, kind: "ONBOARDING", state: "CONFIRMED", profileKey: "incubateur" },
      select: { id: true },
    });
    const calcule = gesteManuel();
    const planId = await enregistrerPlan(
      { kind: "ONBOARDING", accessCaseId: dossier.id },
      calcule,
      OPERATRICE,
      OUVERTURE,
    );
    await prisma.plan.update({
      where: { id: planId },
      data: {
        state: "EXECUTING",
        confirmedDigest: calcule.empreinte,
        confirmedBy: OPERATRICE,
        confirmedAt: OUVERTURE,
      },
    });
    await prisma.accessCase.delete({ where: { id: dossier.id } });

    const orpheline = await prisma.planStep.findFirstOrThrow({
      where: { planId },
      select: { id: true },
    });
    expect(
      (await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).accessCaseId,
    ).toBeNull();

    // When on pointe
    // Then l'écriture passe : la condition d'ancrage porte alors sur la relation du
    // sujet, qui est nulle elle aussi, donc elle ne s'évaluerait jamais à vrai et ferait
    // lever une écriture que la garde en lecture laisse passer. Elle est donc sautée sur
    // ce plan-là, et sur lui seul.
    expect(await pointerEtape(null, pointage(orpheline.id))).toEqual({});
    expect((await prisma.planStep.findUniqueOrThrow({ where: { id: orpheline.id } })).state).toBe(
      "SUCCEEDED",
    );
  });
});
