import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { syncConstats } from "@/lib/sync/constats";

/**
 * Le constat d'un accès gardé au-delà de son terme, contre une vraie base.
 *
 * Ce qui ne se tient pas plus bas est la lecture : savoir qu'un accès est encore détenu
 * traverse la personne, ses comptes vivants et leurs accès vivants, trois relations qu'un
 * double réécrirait à la main.
 */

const USERNAME = "hugo.exemple";
const TERME = new Date("2026-09-01T12:00:00Z");
const RELU = new Date("2026-09-10T02:00:00Z");
const MAINTENANT = new Date("2026-09-10T09:00:00Z");

async function semer(): Promise<{ personId: string; grantId: string }> {
  const personne = await prisma.person.create({
    data: { username: USERNAME, fullname: "Hugo Exemple", source: "BETA" },
  });
  const organisation = await prisma.resource.create({
    data: { provider: "github", externalId: "incubateur-ademe", label: "Organisation" },
  });
  const compte = await prisma.externalIdentity.create({
    data: {
      provider: "github",
      externalId: "4242",
      handle: "hugo-exemple",
      matchMethod: "GITHUB_LOGIN",
      personId: personne.id,
      grants: { create: { role: "admin", resourceId: organisation.id } },
    },
    select: { grants: { select: { id: true } } },
  });
  await prisma.syncRun.create({
    data: {
      provider: "github",
      capability: "list",
      status: "OK",
      startedAt: RELU,
      finishedAt: RELU,
      itemsSeen: 1,
    },
  });
  return { personId: personne.id, grantId: compte.grants[0]?.id ?? "" };
}

async function octroyer(
  personId: string,
  champs: { id: string; accordeLe: Date; terme: Date | null; engagementKey?: string },
): Promise<void> {
  await prisma.plan.create({
    data: {
      id: champs.id,
      kind: "MANUAL_OP",
      state: "EXECUTED",
      subjectId: personId,
      intent: {},
      planDigest: `digest-${champs.id}`,
      createdBy: "operatrice.exemple",
      createdAt: champs.accordeLe,
      expiresAt: champs.accordeLe,
      steps: {
        create: {
          systemKey: "github",
          tier: "auto",
          capability: "grant",
          action: "inviter-dans-l-organisation",
          label: "Inviter hugo.exemple dans incubateur-ademe avec le rôle admin",
          params: { organisation: "incubateur-ademe", role: "admin" },
          riskLevel: "HIGH",
          expectedState: { membre: true },
          idempotencyKey: `idem-${champs.id}`,
          ordre: 1,
          state: "SUCCEEDED",
          executedAt: champs.accordeLe,
          grantExpiresAt: champs.terme,
          ...(champs.engagementKey === undefined ? {} : { engagementKey: champs.engagementKey }),
        },
      },
    },
  });
}

const collecter = (now: Date) =>
  syncConstats([], [], [], [], now, `collecte-${now.toISOString()}`, {
    perimetreComplet: true,
    maxNewPersonShare: 0.5,
    derogations: [],
  });

const echus = () =>
  prisma.finding.findMany({
    where: { kind: "EXPIRED_GRANT" },
    select: { dedupKey: true, closedAt: true, severity: true },
  });

describe("un accès gardé au-delà de son terme", () => {
  it("se signale tant que le rôle accordé reste constaté, et se referme quand il disparaît", async () => {
    // Given Hugo, administrateur de l'organisation pour une durée dont le terme est passé,
    // le système relu depuis
    const { personId, grantId } = await semer();
    await octroyer(personId, { id: "pla-admin", accordeLe: new Date("2026-03-05"), terme: TERME });

    // When la collecte des constats passe
    await collecter(MAINTENANT);

    // Then le constat se lève, sur la personne et sur cet octroi, avec la gravité de l'étape
    const [constat] = await echus();
    expect(constat).toMatchObject({ closedAt: null, severity: "HIGH" });
    expect(constat?.dedupKey).toMatch(/^EXPIRED_GRANT:github:hugo\.exemple:/u);
    expect(
      await prisma.finding.count({
        where: { kind: "EXPIRED_GRANT", person: { username: USERNAME } },
      }),
    ).toBe(1);

    // When le rôle cesse d'être constaté, et que la collecte repasse
    await prisma.accessGrant.update({ where: { id: grantId }, data: { vanishedAt: RELU } });
    await collecter(new Date("2026-09-11T09:00:00Z"));

    // Then le constat se referme de lui-même
    expect((await echus())[0]?.closedAt).not.toBeNull();
  });

  it("se tait sur un accès reconduit sans terme, et sur un jeton que son terme reprend", async () => {
    // Given le même octroi échu, puis reconduit par un nouveau plan sans terme
    const { personId } = await semer();
    await octroyer(personId, { id: "pla-admin", accordeLe: new Date("2026-03-05"), terme: TERME });
    await octroyer(personId, {
      id: "pla-reconduit",
      accordeLe: new Date("2026-09-02"),
      terme: null,
    });

    // Then rien ne se lève : seul le dernier octroi compte, et il n'a pas de terme
    await collecter(MAINTENANT);
    expect(await echus()).toEqual([]);

    // Given un jeton émis, porteur d'une clé d'engagement, dont le terme est passé
    await prisma.planStep.deleteMany({});
    await prisma.plan.deleteMany({});
    await octroyer(personId, {
      id: "pla-jeton",
      accordeLe: new Date("2026-03-05"),
      terme: TERME,
      engagementKey: "github:jeton:hugo",
    });

    // Then rien ne se lève non plus : un jeton meurt à son terme, et ne se constate dans
    // aucun relevé
    await collecter(MAINTENANT);
    expect(await echus()).toEqual([]);
  });
});
