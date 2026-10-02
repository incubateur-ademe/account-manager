import { describe, expect, it } from "vitest";

import { precisionsDesAccesEchus } from "@/lib/acces-echus";
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

async function relire(provider: string, le: Date): Promise<void> {
  await prisma.syncRun.create({
    data: {
      provider,
      capability: "list",
      status: "OK",
      startedAt: le,
      finishedAt: le,
      itemsSeen: 1,
    },
  });
}

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

const ADMIN_GITHUB = {
  systemKey: "github",
  action: "inviter-dans-l-organisation",
  label: "Inviter hugo.exemple dans incubateur-ademe avec le rôle admin",
  params: { organisation: "incubateur-ademe", role: "admin" },
};

async function octroyer(
  personId: string,
  champs: {
    id: string;
    accordeLe: Date;
    terme: Date | null;
    engagementKey?: string;
    deja?: boolean;
    executeLe?: Date;
    geste?: { systemKey: string; action: string; label: string; params: object };
  },
): Promise<void> {
  const geste = champs.geste ?? ADMIN_GITHUB;
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
      confirmedAt: champs.accordeLe,
      expiresAt: champs.accordeLe,
      steps: {
        create: {
          ...geste,
          tier: "auto",
          capability: "grant",
          riskLevel: "HIGH",
          expectedState: { membre: true },
          idempotencyKey: `idem-${champs.id}`,
          ordre: 1,
          // Un accès déjà là se solde au précheck, sans date d'exécution
          state: champs.deja ? "ALREADY_PRESENT" : "SUCCEEDED",
          executedAt: champs.deja ? null : (champs.executeLe ?? champs.accordeLe),
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
    expect(constat?.dedupKey).toMatch(/^EXPIRED_GRANT:github:[^:]+$/u);
    expect(
      await prisma.finding.count({
        where: { kind: "EXPIRED_GRANT", person: { username: USERNAME } },
      }),
    ).toBe(1);

    // Then l'écran sait dire quel accès est échu, le constat ne portant aucun compte
    const precisions = await precisionsDesAccesEchus([constat?.dedupKey ?? ""]);
    expect(precisions.get(constat?.dedupKey ?? "")).toBe(
      "Il s'agit de « Inviter hugo.exemple dans incubateur-ademe avec le rôle admin », accordé jusqu'au 1 septembre 2026.",
    );

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

  it("se juge application par application, et compte un octroi soldé au précheck", async () => {
    // Given Hugo, collaborateur de deux applications Scalingo : alpha jusqu'à un terme
    // passé, puis beta sans terme, plus tard et au même rôle
    const personne = await prisma.person.create({
      data: { username: USERNAME, fullname: "Hugo Exemple", source: "BETA" },
    });
    const [alpha, beta] = await Promise.all(
      ["alpha", "beta"].map((nom) =>
        prisma.resource.create({
          data: { provider: "scalingo", externalId: `app-${nom}`, label: `${nom}, osc-fr1` },
        }),
      ),
    );
    await prisma.externalIdentity.create({
      data: {
        provider: "scalingo",
        externalId: "us-42",
        handle: "hugo@exemple.fr",
        matchMethod: "EMAIL_EXACT",
        personId: personne.id,
        grants: {
          create: [alpha, beta].map((application) => ({
            role: "collaborator",
            resourceId: application?.id ?? "",
          })),
        },
      },
    });
    // Le propriétaire de chaque application, comme Scalingo le rend toujours : il reste
    // quand Hugo s'en va
    await prisma.externalIdentity.create({
      data: {
        provider: "scalingo",
        externalId: "us-proprietaire",
        handle: "proprietaire@exemple.fr",
        matchMethod: "NONE",
        grants: {
          create: [alpha, beta].map((application) => ({
            role: "owner",
            resourceId: application?.id ?? "",
          })),
        },
      },
    });
    await relire("scalingo", RELU);
    const collaborer = (nom: string) => ({
      systemKey: "scalingo",
      action: "inviter-comme-collaborateur",
      label: `Inviter hugo.exemple dans ${nom} comme collaborator`,
      params: { region: "osc-fr1", application: nom, role: "collaborator" },
    });
    // L'octroi d'alpha trouve l'accès déjà là, et se solde au précheck
    await octroyer(personne.id, {
      id: "pla-alpha",
      accordeLe: new Date("2026-03-05"),
      terme: TERME,
      deja: true,
      geste: collaborer("alpha"),
    });
    await octroyer(personne.id, {
      id: "pla-beta",
      accordeLe: new Date("2026-06-01"),
      terme: null,
      geste: collaborer("beta"),
    });

    // When la collecte des constats passe
    await collecter(MAINTENANT);

    // Then alpha se signale : l'octroi de beta ne reconduit qu'elle-même
    const [constat] = await echus();
    expect(constat).toMatchObject({ closedAt: null });
    expect(
      (await precisionsDesAccesEchus([constat?.dedupKey ?? ""])).get(constat?.dedupKey ?? ""),
    ).toContain("dans alpha");

    // When alpha est renommée côté Scalingo, la collecte réécrivant son libellé, et qu'un
    // projet, qui ne porte aucun accès, garde l'ancien nom
    await prisma.resource.create({
      data: { provider: "scalingo", externalId: "prj-alpha", label: "alpha, osc-fr1" },
    });
    await prisma.resource.update({
      where: { id: alpha?.id ?? "" },
      data: { label: "alpha-v2, osc-fr1" },
    });
    await collecter(new Date("2026-09-10T10:00:00Z"));

    // Then le constat reste ouvert : le système se juge sur le rôle seul plutôt que de
    // refermer sur un accès toujours tenu
    expect((await echus())[0]?.closedAt).toBeNull();
    await prisma.resource.update({
      where: { id: alpha?.id ?? "" },
      data: { label: "alpha, osc-fr1" },
    });

    // When alpha est supprimée côté Scalingo, beta restant tenue : la collecte voit
    // disparaître tous ses accès, propriétaire compris, et la collecte repasse
    await prisma.accessGrant.updateMany({
      where: { resourceId: alpha?.id ?? "" },
      data: { vanishedAt: RELU },
    });
    await collecter(new Date("2026-09-11T09:00:00Z"));

    // Then le constat se referme : l'accès gardé ailleurs n'est pas celui qui était échu, et
    // une application supprimée garde son nom
    expect((await echus())[0]?.closedAt).not.toBeNull();
  });

  it("ne compte jamais un compte rattaché par ressemblance, et compte une invitation en attente", async () => {
    // Given Hugo, dont le seul compte GitHub admin de l'organisation lui ressemble sans plus,
    // et un octroi admin échu
    const personne = await prisma.person.create({
      data: { username: USERNAME, fullname: "Hugo Exemple", source: "BETA" },
    });
    const organisation = await prisma.resource.create({
      data: { provider: "github", externalId: "incubateur-ademe", label: "Organisation" },
    });
    const homonyme = await prisma.externalIdentity.create({
      data: {
        provider: "github",
        externalId: "7777",
        handle: "hugo-exemple-bis",
        matchMethod: "HEURISTIC",
        personId: personne.id,
        grants: { create: { role: "admin", resourceId: organisation.id } },
      },
    });
    await relire("github", RELU);
    await octroyer(personne.id, {
      id: "pla-admin",
      accordeLe: new Date("2026-03-05"),
      terme: TERME,
    });

    // Then rien ne se lève : ce constat demande une coupure, et une ressemblance n'en ouvre
    // aucune
    await collecter(MAINTENANT);
    expect(await echus()).toEqual([]);

    // Given le même octroi tenu par une invitation en attente, que la collecte range sous
    // `invite:admin`, sur un compte rattaché par son login
    await prisma.externalIdentity.update({
      where: { id: homonyme.id },
      data: { vanishedAt: RELU },
    });
    await prisma.externalIdentity.create({
      data: {
        provider: "github",
        externalId: "invite-77",
        handle: "hugo-exemple",
        matchMethod: "GITHUB_LOGIN",
        personId: personne.id,
        grants: { create: { role: "invite:admin", resourceId: organisation.id } },
      },
    });

    // Then l'accès est tenu, et le constat se lève
    await collecter(new Date("2026-09-11T09:00:00Z"));
    expect(await echus()).toEqual([expect.objectContaining({ closedAt: null })]);
  });

  it("désigne le dernier octroi par sa confirmation, qu'il ait été exécuté ou soldé au précheck", async () => {
    // Given un octroi sans terme confirmé le 1er mars et exécuté le 6, puis un octroi à terme
    // confirmé le 5 mars, que son précheck solde plus tard, l'accès étant déjà là
    const { personId } = await semer();
    await octroyer(personId, {
      id: "pla-sans-terme",
      accordeLe: new Date("2026-03-01"),
      executeLe: new Date("2026-03-06"),
      terme: null,
    });
    await octroyer(personId, {
      id: "pla-a-terme",
      accordeLe: new Date("2026-03-05"),
      terme: TERME,
      deja: true,
    });

    // Then le dernier décidé est l'octroi à terme, et son terme passé lève le constat
    await collecter(MAINTENANT);
    expect(await echus()).toEqual([expect.objectContaining({ closedAt: null })]);
  });

  it("compte un membre promu administrateur, et se referme sur une reconduction au rôle tenu", async () => {
    // Given Hugo, membre de l'organisation par un octroi échu, promu administrateur depuis
    // hors de l'outil
    const { personId } = await semer();
    await octroyer(personId, {
      id: "pla-membre",
      accordeLe: new Date("2026-03-05"),
      terme: TERME,
      geste: { ...ADMIN_GITHUB, params: { organisation: "incubateur-ademe", role: "member" } },
    });

    // Then l'administrateur tient l'accès du membre, et le constat se lève
    await collecter(MAINTENANT);
    expect(await echus()).toEqual([expect.objectContaining({ closedAt: null })]);

    // When l'opératrice reconduit l'accès au rôle tenu, administrateur et sans terme, et que
    // le précheck le solde
    await octroyer(personId, {
      id: "pla-reconduit-admin",
      accordeLe: new Date("2026-09-10T10:00:00Z"),
      terme: null,
      deja: true,
    });
    await collecter(new Date("2026-09-11T09:00:00Z"));

    // Then le constat se referme : la dernière décision sur l'organisation n'a pas de terme
    expect((await echus())[0]?.closedAt).not.toBeNull();
  });

  it("ne tient plus rien d'un membre que son système garde après l'avoir retiré", async () => {
    // Given Hugo, membre Notion accordé jusqu'à un terme passé, puis retiré par son départ :
    // Notion le rend inactif, la collecte garde l'identité et date son accès disparu
    const personne = await prisma.person.create({
      data: { username: USERNAME, fullname: "Hugo Exemple", source: "BETA" },
    });
    const workspace = await prisma.resource.create({
      data: { provider: "notion", externalId: "workspace", label: "Workspace" },
    });
    await prisma.externalIdentity.create({
      data: {
        provider: "notion",
        externalId: "scim-hugo",
        handle: "hugo@exemple.fr",
        matchMethod: "EMAIL_EXACT",
        personId: personne.id,
        grants: { create: { role: "member", resourceId: workspace.id, vanishedAt: RELU } },
      },
    });
    await relire("notion", RELU);
    await octroyer(personne.id, {
      id: "pla-notion",
      accordeLe: new Date("2026-03-05"),
      terme: TERME,
      geste: {
        systemKey: "notion",
        action: "inviter-dans-le-workspace",
        label: "Inviter hugo.exemple dans le workspace Notion",
        params: { username: USERNAME },
      },
    });
    // When la collecte des constats passe
    await collecter(MAINTENANT);

    // Then l'accès échu ne se lève pas : le compte ne porte plus aucun accès vivant
    expect(await echus()).toEqual([]);
  });

  it("ne dément pas le retrait d'un membre que son système garde inactif", async () => {
    // Given Léa, retirée du workspace Notion avant même la première collecte : Notion la rend
    // inactive, et la collecte garde son identité sans lui avoir jamais relevé d'accès, quand
    // un autre membre en porte un
    const personne = await prisma.person.create({
      data: { username: "lea.exemple", fullname: "Léa Exemple", source: "BETA" },
    });
    const workspace = await prisma.resource.create({
      data: { provider: "notion", externalId: "workspace", label: "Workspace" },
    });
    await prisma.externalIdentity.create({
      data: {
        provider: "notion",
        externalId: "scim-lea",
        handle: "lea@exemple.fr",
        matchMethod: "EMAIL_EXACT",
        personId: personne.id,
      },
    });
    await prisma.externalIdentity.create({
      data: {
        provider: "notion",
        externalId: "scim-autre",
        handle: "autre@exemple.fr",
        matchMethod: "NONE",
        grants: { create: { role: "member", resourceId: workspace.id } },
      },
    });
    await relire("notion", RELU);
    // Et son retrait, soldé par le connecteur
    await prisma.plan.create({
      data: {
        id: "pla-depart",
        kind: "OFFBOARDING",
        state: "EXECUTED",
        accessCase: {
          create: {
            personId: personne.id,
            kind: "OFFBOARDING",
            state: "DONE",
            closedAt: new Date("2026-09-06"),
          },
        },
        intent: {},
        planDigest: "digest-depart",
        createdBy: "operatrice.exemple",
        createdAt: new Date("2026-09-05"),
        confirmedAt: new Date("2026-09-05"),
        expiresAt: new Date("2026-09-12"),
        steps: {
          create: {
            systemKey: "notion",
            tier: "auto",
            capability: "revoke",
            action: "retirer-du-workspace",
            label: "Retirer lea.exemple du workspace Notion",
            params: { username: "lea.exemple", identifiant: "scim-lea", role: "member" },
            riskLevel: "HIGH",
            expectedState: { membre: false },
            idempotencyKey: "notion:revoke:lea.exemple",
            ordre: 1,
            state: "SUCCEEDED",
            executedAt: new Date("2026-09-05"),
          },
        },
      },
    });

    // When la collecte des constats passe
    await collecter(MAINTENANT);

    // Then le retrait n'est pas démenti : le compte ne porte plus aucun accès vivant
    expect(
      await prisma.finding.count({ where: { kind: "OVERDUE_MANUAL_ACTION", closedAt: null } }),
    ).toBe(0);
  });
});
