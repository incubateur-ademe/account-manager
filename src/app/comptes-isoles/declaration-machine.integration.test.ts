import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

/**
 * Ce que la déclaration d'une machine écrit, contre une vraie base.
 *
 * Ce fichier tient ce qu'aucun double ne saurait tenir : le détenteur d'un compte
 * constaté est une relation, et se tromper de colonne ne se voit qu'en la relisant. Les
 * deux clés étrangères vivent côte à côte sur la même ligne, `personId` et
 * `serviceAccountId`, si bien qu'une déclaration qui poserait la première fabriquerait
 * exactement ce que ce chemin existe pour éviter : une fiche de personne pour un bot,
 * qu'aucun écran ne sait supprimer.
 *
 * Le test de composant voisin prouve que le bon geste part ; lui seul ne dit rien de ce
 * qu'il écrit.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireOperateur: vi.fn(async () => ({ username: "operatrice.exemple", voie: "ESPACE_MEMBRE" })),
}));

const { declarerCompteDeServicePourCompte } = await import("./creer");
const { rattacherIdentite } = await import("./actions");

const SAISIE = {
  key: "bot-de-deploiement",
  label: "Bot de déploiement",
  purpose: "Déploie les applications de l'incubateur",
  ownerUsername: "claire.durand",
  reviewEveryDays: "90",
};

async function semerUnCompteIsole(): Promise<string> {
  const identite = await prisma.externalIdentity.create({
    data: {
      provider: "scalingo",
      externalId: "us-42",
      handle: "bot@exemple.invalid",
      matchMethod: "NONE",
    },
    select: { id: true },
  });
  return identite.id;
}

function saisie(id: string, surcharges: Partial<typeof SAISIE> = {}): FormData {
  const formulaire = new FormData();
  formulaire.set("id", id);
  for (const [nom, valeur] of Object.entries({ ...SAISIE, ...surcharges })) {
    formulaire.set(nom, valeur);
  }
  return formulaire;
}

describe("déclarer une machine depuis la file des comptes isolés", () => {
  it("rattache le compte au compte de service qu'elle crée, sans fabriquer aucune fiche", async () => {
    // Given un compte constaté que personne ne réclame, et un constat ouvert qui le dit.
    const identiteId = await semerUnCompteIsole();
    await prisma.finding.create({
      data: {
        kind: "UNREGISTERED",
        dedupKey: "us-42:UNREGISTERED",
        severity: "MEDIUM",
        externalIdentityId: identiteId,
      },
    });

    // When on déclare que c'est une machine, avec un système posté qui ment. Un formulaire
    // n'en envoie pas, l'écran l'affichant en lecture seule, mais rien n'empêche de le
    // poster à la main, et c'est précisément ce que l'action ne doit pas suivre.
    const formulaire = saisie(identiteId);
    formulaire.set("provider", "notion");
    const refus = await declarerCompteDeServicePourCompte(null, formulaire);

    // Then rien n'est refusé, et le compte de service existe avec la revue saisie et non
    // celle du défaut : une périodicité que personne n'a choisie n'engage personne.
    expect(refus).toBeNull();
    const compte = await prisma.serviceAccount.findUnique({
      where: { key: SAISIE.key },
      select: { id: true, label: true, ownerUsername: true, reviewEveryDays: true, provider: true },
    });
    expect(compte).toMatchObject({
      label: SAISIE.label,
      ownerUsername: SAISIE.ownerUsername,
      reviewEveryDays: 90,
      // Le système vient du compte relevé et jamais du formulaire : un champ posté à la
      // main rangerait cette machine sous un système où elle n'a jamais été vue, et la
      // fiche de ce système l'y afficherait ensuite sans réserve.
      provider: "scalingo",
    });

    // Then le compte constaté pointe vers lui, et vers aucune personne. C'est la seule
    // assertion qui distingue ce chemin de celui qu'il remplace.
    const apres = await prisma.externalIdentity.findUniqueOrThrow({
      where: { id: identiteId },
      select: { personId: true, serviceAccountId: true, matchMethod: true },
    });
    expect(apres.serviceAccountId).toBe(compte?.id);
    expect(apres.personId).toBeNull();
    expect(apres.matchMethod).toBe("DECLARED");

    // Then aucune fiche n'a été fabriquée au passage : c'est le geste qu'on vient
    // d'écarter, et il ne doit pas revenir par une autre porte.
    expect(await prisma.person.count()).toBe(0);

    // Then le constat qui disait ce compte sans détenteur est refermé, sans marque de
    // clôture humaine : la situation a cessé, elle n'a pas été jugée.
    const constat = await prisma.finding.findFirstOrThrow({
      where: { externalIdentityId: identiteId },
      select: { closedAt: true, closedBy: true, closeReason: true },
    });
    expect(constat.closedAt).not.toBeNull();
    expect(constat.closedBy).toBeNull();
    expect(constat.closeReason).toBe(`rattaché à ${SAISIE.key}`);

    // Then le journal porte les deux faits sous le nom de qui les a posés : la
    // déclaration du compte machine, et le rattachement de l'identité. Chercher ce
    // qu'un compte constaté est devenu passe par la seconde, que la première ne dit pas.
    //
    // Attendu plutôt que lu d'un coup, parce que le journal s'écrit sans être attendu :
    // une panne du journal ne doit jamais faire échouer l'action métier, si bien que
    // l'action rend la main avant que ses lignes soient posées. Les lire une seule fois
    // marchait sur une machine au repos et pas sur une machine chargée, ce qui est la
    // définition d'un test qu'on finit par relancer sans le lire.
    await expect
      .poll(
        async () =>
          await prisma.auditEvent.findMany({
            select: { action: true, targetId: true, actorUsername: true },
          }),
        { timeout: 5_000, interval: 25 },
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "compte-de-service.declaration",
            targetId: SAISIE.key,
            actorUsername: "operatrice.exemple",
          }),
          expect.objectContaining({
            action: "identite.rattachement",
            targetId: "scalingo:bot@exemple.invalid",
            actorUsername: "operatrice.exemple",
          }),
        ]),
      );
  });

  it("refuse une clé déjà prise sans toucher au compte, et renvoie vers le rattachement", async () => {
    // Given un compte de service déjà déclaré, et un second compte constaté isolé.
    await prisma.serviceAccount.create({
      data: { ...SAISIE, reviewEveryDays: 180, provider: "scalingo" },
    });
    const identiteId = await semerUnCompteIsole();

    // When on déclare une machine sous la même clé.
    const refus = await declarerCompteDeServicePourCompte(null, saisie(identiteId));

    // Then le refus nomme le geste qui reste ouvert. Sans lui, la clé déjà prise se
    // lirait comme une impasse alors que le rattachement, lui, est encore possible.
    expect(refus?.erreur).toContain("Rattachez-lui ce compte");

    // Then le compte constaté n'a pas bougé : il est toujours dans la file, et le
    // compte de service existant n'a pas été réécrit.
    const apres = await prisma.externalIdentity.findUniqueOrThrow({
      where: { id: identiteId },
      select: { personId: true, serviceAccountId: true },
    });
    expect(apres).toEqual({ personId: null, serviceAccountId: null });
    expect(
      (await prisma.serviceAccount.findUniqueOrThrow({ where: { key: SAISIE.key } }))
        .reviewEveryDays,
    ).toBe(180);
  });

  it("ne déclare pas deux machines pour un même compte, quand le geste part deux fois", async () => {
    // Given un compte déjà déclaré une fois, ce qu'un double clic ou un retour en arrière
    // produit sans intention particulière.
    const identiteId = await semerUnCompteIsole();
    expect(await declarerCompteDeServicePourCompte(null, saisie(identiteId))).toBeNull();

    // When le geste repart, sous une autre clé.
    const refus = await declarerCompteDeServicePourCompte(
      null,
      saisie(identiteId, { key: "un-autre-bot" }),
    );

    // Then c'est refusé avant toute écriture, et surtout aucun second compte de service
    // n'est né : il resterait sans rattachement, puisqu'un compte constaté n'en porte
    // qu'un, et se revoirait pour toujours sans que rien ne dise ce qu'il est.
    expect(refus?.erreur).toBe("Ce compte est déclaré comme compte de service.");
    expect(await prisma.serviceAccount.count()).toBe(1);
    expect(
      (
        await prisma.externalIdentity.findUniqueOrThrow({
          where: { id: identiteId },
          select: { serviceAccount: { select: { key: true } } },
        })
      ).serviceAccount?.key,
    ).toBe(SAISIE.key);
  });

  it("refuse de rattacher un compte à la machine d'un autre système", async () => {
    // Given un compte de service déclaré sur Scalingo, et un compte constaté sur GitHub.
    await prisma.serviceAccount.create({
      data: { ...SAISIE, reviewEveryDays: 180, provider: "scalingo" },
    });
    const identite = await prisma.externalIdentity.create({
      data: {
        provider: "github",
        externalId: "MDQ6VXNlcjEwNDI=",
        handle: "m-marceau",
        matchMethod: "NONE",
      },
      select: { id: true },
    });

    // When on tente de rattacher l'un à l'autre depuis le champ libre de la file.
    const formulaire = new FormData();
    formulaire.set("id", identite.id);
    formulaire.set("cible", SAISIE.key);
    const refus = await rattacherIdentite(null, formulaire);

    // Then c'est refusé, et le message nomme les deux systèmes : sans eux, le refus se
    // lirait comme une clé mal saisie.
    expect(refus?.erreur).toContain("scalingo");
    expect(refus?.erreur).toContain("github");

    // Then rien n'a bougé. La fiche d'un système liste ses comptes machine, et un
    // rattachement croisé y ferait apparaître ce compte sous le mauvais.
    expect(
      await prisma.externalIdentity.findUniqueOrThrow({
        where: { id: identite.id },
        select: { serviceAccountId: true, personId: true },
      }),
    ).toEqual({ serviceAccountId: null, personId: null });
  });

  it("refuse un compte qu'on a déjà tranché, pour ne pas le trancher deux fois", async () => {
    // Given un compte constaté qu'une opératrice a déjà rattaché à une personne.
    const personne = await prisma.person.create({
      data: { username: "nour.exemple", fullname: "Nour Exemple", source: "LOCAL" },
      select: { id: true },
    });
    const identiteId = await semerUnCompteIsole();
    await prisma.externalIdentity.update({
      where: { id: identiteId },
      data: { personId: personne.id, matchMethod: "DECLARED" },
    });

    // When on tente de le déclarer comme machine.
    const refus = await declarerCompteDeServicePourCompte(null, saisie(identiteId));

    // Then c'est refusé, et surtout aucun compte de service n'est né du geste : le créer
    // puis renoncer au rattachement laisserait une machine déclarée que rien ne porte.
    expect(refus?.erreur).toBe("Ce compte est déjà rattaché.");
    expect(await prisma.serviceAccount.count()).toBe(0);
  });
});
