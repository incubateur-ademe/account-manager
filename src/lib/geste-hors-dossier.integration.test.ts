import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ouvrirGeste } from "@/app/gestes/actions";
import type { PlannedStep } from "@/core/connector";
import { intentionDUnGeste } from "@/core/geste";
import { empreinteDuPlan } from "@/core/plan";
import { prisma } from "@/lib/db";
import { calculerPlan, enregistrerPlan, type PlanCalcule } from "@/lib/dossier";
import { executerPlan } from "@/lib/execution";
import {
  calculerGeste,
  conditionDAncrage,
  engagementsOuverts,
  REFUS_DEPART_OUVERT,
  REFUS_INTENTION_ILLISIBLE,
} from "@/lib/geste";

/**
 * Un geste hors dossier, de sa naissance à son exécution, contre une vraie base.
 *
 * Ce que ce fichier tient et qu'aucun double ne saurait tenir : que les cinq gardes
 * desserrées le sont réellement, chacune sur une écriture que rien dans les types ne
 * relie à la lecture qui l'a précédée. La quatrième en est le cas d'école, son `where`
 * traversant deux relations pour dire « aucun départ n'est ouvert sur le sujet », et
 * rendant zéro sans lever quand il ne s'évalue pas à vrai.
 *
 * Et que la garde d'écart mord sur un geste dont le connecteur tire un paramètre de la
 * base, ce qui est la seule assertion qui prouve que ce recalcul n'est pas une
 * tautologie là où il ne doit pas l'être.
 */

/** Les écrans que le passage tracé a demandé de rafraîchir, dans l'ordre. */
const rafraichis = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => {
    rafraichis.push(chemin);
  },
}));

const REPERTOIRE = mkdtempSync(join(tmpdir(), "geste-integration-"));
copyFileSync(resolve(process.cwd(), "config/config.exemple.yaml"), join(REPERTOIRE, "config.yaml"));
process.env["POLICY_DIR"] = REPERTOIRE;

const USERNAME = "nour.exemple";
const ADRESSE = "nour.exemple@exemple.invalid";
const AUTRE_ADRESSE = "nour.astreinte@exemple.invalid";

const OUVERTURE = new Date("2026-09-10T09:00:00Z");
const APRES = new Date("2026-09-12T09:00:00Z");
/** La veille du geste : l'instant d'un départ qui aurait été confirmé avant lui. */
const AVANT_LE_GESTE = new Date("2026-09-09T09:00:00Z");

const OPERATRICE = { username: "operatrice.exemple", voie: "ESPACE_MEMBRE" as const };

const intention = (justification: string) =>
  intentionDUnGeste.parse({
    systeme: "scalingo",
    scope: {
      nature: "collaboration",
      region: "osc-fr1",
      application: "portail-exemple",
      role: "limited",
    },
    expiresInDays: 30,
    justification,
  });

/** La confirmation telle que l'action l'écrit : la garde lue, puis la condition d'ancrage. */
async function confirmer(planId: string, empreinte: string, accessCaseId: string | null) {
  return prisma.plan.updateMany({
    where: { id: planId, state: "DRAFT", ...conditionDAncrage(accessCaseId) },
    data: {
      state: "EXECUTING",
      confirmedDigest: empreinte,
      confirmedBy: OPERATRICE.username,
      confirmedAt: OUVERTURE,
    },
  });
}

describe("un geste hors dossier naît, se confirme, s'exécute, et se refuse", () => {
  let personId = "";

  beforeEach(async () => {
    const personne = await prisma.person.create({
      data: {
        username: USERNAME,
        fullname: "Nour Exemple",
        source: "BETA",
        communicationEmail: ADRESSE,
      },
    });
    personId = personne.id;
  });

  it("porte son ancrage, sa confirmation et son écart, sans aucun dossier", async () => {
    // Given une fiche sans dossier, et une intention que le connecteur accepte
    const calcule = await calculerGeste(
      intention("renfort d'astreinte"),
      personId,
      USERNAME,
      OUVERTURE,
    );
    expect(calcule.refus).toEqual([]);
    expect(calcule.etapes).toHaveLength(1);

    // When on l'enregistre sous l'ancrage d'un geste
    const planId = await enregistrerPlan(
      { kind: "MANUAL_OP", subjectId: personId, intention: intention("renfort d'astreinte") },
      calcule,
      OPERATRICE.username,
      OUVERTURE,
    );

    // Then la ligne porte le genre, l'ancrage et l'intention relisible par son schéma, et
    // son unique étape porte la justification saisie : la `PlannedStep` n'en porte aucune,
    // et c'est l'ancrage qui la pose.
    const ecrit = await prisma.plan.findUniqueOrThrow({
      where: { id: planId },
      select: {
        kind: true,
        accessCaseId: true,
        subjectId: true,
        intent: true,
        steps: { select: { justification: true, systemKey: true, grantExpiresAt: true } },
      },
    });
    expect(ecrit.kind).toBe("MANUAL_OP");
    expect(ecrit.accessCaseId).toBeNull();
    expect(ecrit.subjectId).toBe(personId);
    expect(intentionDUnGeste.parse(ecrit.intent).justification).toBe("renfort d'astreinte");
    expect(ecrit.steps).toHaveLength(1);
    expect(ecrit.steps[0]?.justification).toBe("renfort d'astreinte");
    expect(ecrit.steps[0]?.grantExpiresAt).not.toBeNull();

    // Then un second geste sur la même personne s'écrit sans que l'index unique partiel
    // s'y oppose : il exclut en toutes lettres les plans sans dossier.
    const second = await enregistrerPlan(
      { kind: "MANUAL_OP", subjectId: personId, intention: intention("second renfort") },
      calcule,
      OPERATRICE.username,
      OUVERTURE,
    );
    expect(second).not.toBe(planId);

    // When on confirme le premier, exactement comme l'action l'écrit
    // Then le compte est de un : avant le desserrage, le filtre sur la relation
    // `accessCase` ne s'évaluait jamais à vrai sur un geste, l'action rendait zéro et
    // levait « ce plan ou son ancrage a changé d'état » sans qu'aucun état n'ait changé.
    const confirme = await confirmer(planId, calcule.empreinte, null);
    expect(confirme.count).toBe(1);

    const apresConfirmation = await prisma.plan.findUniqueOrThrow({
      where: { id: planId },
      select: { confirmedAt: true, confirmedDigest: true },
    });
    expect(apresConfirmation.confirmedAt).toEqual(OUVERTURE);
    expect(apresConfirmation.confirmedDigest).toBe(calcule.empreinte);

    // When on exécute, en simulation
    const partie = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: false,
      maintenant: APRES,
    });

    // Then rien n'est refusé : ni la garde du dossier disparu, ni celle du dossier mort,
    // ni celle de l'écart, dont l'empreinte recalculée est celle qui a été confirmée.
    expect(partie.refus).toBeUndefined();
    expect(partie.simulation).toBe(true);

    // When un départ s'ouvre sur la personne
    const depart = await prisma.accessCase.create({
      data: { personId, kind: "OFFBOARDING", state: "CANDIDATE" },
      select: { id: true },
    });

    // Then l'exécution refuse, et le message renvoie vers le dossier sans en écrire
    // l'adresse : ouvrir un accès pendant un départ déplacerait l'empreinte d'un plan que
    // personne ne peut plus recalculer.
    const pendantLeDepart = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: false,
      maintenant: APRES,
    });
    expect(pendantLeDepart.refus).toBe(REFUS_DEPART_OUVERT);

    // Then la même condition ferme la fenêtre du côté de l'écriture : le second geste,
    // resté brouillon, ne se confirme plus tant que ce départ court.
    expect((await confirmer(second, calcule.empreinte, null)).count).toBe(0);

    await prisma.accessCase.update({
      where: { id: depart.id },
      data: { state: "CANCELLED" },
    });

    // When l'adresse de communication change entre la confirmation et l'exécution, ce que
    // `planifierOctroiScalingo` met dans `params.beneficiaire`
    const avant = await prisma.planStep.findFirstOrThrow({
      where: { planId },
      select: { state: true, lastError: true },
    });
    await prisma.person.update({
      where: { id: personId },
      data: { communicationEmail: AUTRE_ADRESSE },
    });

    // Then l'exécution refuse par l'écart, et aucune étape n'a changé d'état : la garde
    // mord parce que ce paramètre-là vient de la base et non de l'intention gelée. Elle
    // serait tautologique sur un geste dont tout vient de l'intention.
    const enEcart = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: false,
      maintenant: APRES,
    });
    expect(enEcart.refus).toBeDefined();
    expect(enEcart.refus).toContain("ne décrit plus ce qui a été approuvé");
    expect(
      await prisma.planStep.findFirstOrThrow({
        where: { planId },
        select: { state: true, lastError: true },
      }),
    ).toEqual(avant);

    // When l'intention gelée cesse de se relire, ce qu'une écriture faite hors de cet
    // outil ou un champ ajouté au schéma produisent : elle est un `strictObject`, et
    // `intent` est l'instantané fait pour survivre au code qui l'a écrit
    await prisma.plan.update({
      where: { id: planId },
      data: { intent: { systeme: "scalingo", scope: {}, champDUneAutreVersion: true } },
    });

    // Then le lancement refuse et le dit, au lieu de lever : `lancerExecution` n'attrape
    // rien, et une levée ici sortait en erreur de serveur. Le refus passe par le même
    // chemin tracé que les autres, donc avant la garde d'écart qui mordait juste avant.
    const intentionIllisible = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: false,
      maintenant: APRES,
    });
    expect(intentionIllisible.refus).toBe(REFUS_INTENTION_ILLISIBLE);
    expect(
      await prisma.planStep.findFirstOrThrow({
        where: { planId },
        select: { state: true, lastError: true },
      }),
    ).toEqual(avant);

    // Then la fiche ne se supprime plus : la relation du sujet est en `Restrict`, et ce
    // plan est la seule trace d'un accès qu'aucune collecte ne rendra. C'est ce refus que
    // la fusion doit devancer en déplaçant les gestes avant la suppression.
    await expect(prisma.person.delete({ where: { id: personId } })).rejects.toThrow();
  });
});

/**
 * Une étape telle qu'un connecteur la rendra à l'étape suivante du lot, avec la clé que
 * lui seul sait poser : le socle la transporte sans jamais l'interpréter, et c'est
 * exactement ce que ce scénario vérifie.
 */
const CLE = "scalingo:jeton:inventaire-d-une-region:osc-fr1";

function gesteQuiEngage(terme: Date): PlanCalcule {
  const etape: PlannedStep = {
    systemKey: "scalingo",
    capability: "grant",
    tier: "manual",
    action: "emettre-un-jeton-restreint",
    label: "Émettre un jeton restreint pour l'inventaire de la région osc-fr1",
    params: { usage: "inventaire-d-une-region", region: "osc-fr1" },
    riskLevel: "high",
    expectedState: { jeton: true },
    idempotencyKey: `scalingo:osc-fr1:grant-jeton:${USERNAME}`,
    grantExpiresAt: terme,
    engagementKey: CLE,
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

describe("ce qu'un départ retrouve d'un engagement que nulle collecte ne rend", () => {
  let personId = "";

  beforeEach(async () => {
    const personne = await prisma.person.create({
      data: {
        username: USERNAME,
        fullname: "Nour Exemple",
        source: "BETA",
        communicationEmail: ADRESSE,
      },
    });
    personId = personne.id;
  });

  it("interroge le connecteur alors qu'aucun compte n'y est observé", async () => {
    // Given une fiche sans aucune identité externe : elle n'est observée nulle part, et
    // c'est le cas qui tombe dans le trou muet que la clé existe pour boucher
    const sansRien = await calculerPlan("OFFBOARDING", personId, USERNAME, APRES);
    expect(sansRien.systemes).not.toContain("scalingo");

    // Given un geste soldé portant une clé d'engagement dont le terme est à venir
    const terme = new Date("2026-10-10T09:00:00Z");
    const planId = await enregistrerPlan(
      { kind: "MANUAL_OP", subjectId: personId, intention: intention("astreinte de nuit") },
      gesteQuiEngage(terme),
      OPERATRICE.username,
      OUVERTURE,
    );
    await prisma.planStep.updateMany({
      where: { planId },
      data: { state: "SUCCEEDED", executedAt: OUVERTURE },
    });

    // Given, sous la même clé, une étape que rien n'a exécutée : sur un tri décroissant,
    // PostgreSQL range les nuls en premier, si bien qu'elle prendrait la tête du tri qui
    // décide et ferait disparaître l'engagement sans bruit
    const modele = await prisma.planStep.findFirstOrThrow({
      where: { planId },
      select: { id: true, idempotencyKey: true, systemKey: true, capability: true, label: true },
    });
    await prisma.planStep.create({
      data: {
        planId,
        systemKey: modele.systemKey,
        tier: "manual",
        capability: modele.capability,
        action: "emettre-un-jeton-restreint",
        label: modele.label,
        params: {},
        expectedState: {},
        state: "SUCCEEDED",
        engagementKey: CLE,
        idempotencyKey: `${modele.idempotencyKey}:jamais-tentee`,
        executedAt: null,
      },
    });

    // Then la clé a bien descendu en base, le socle la recopiant comme il recopie
    // l'échéance, et la lecture la retrouve avec ce qui l'a ouverte
    const ouverts = await engagementsOuverts(personId, APRES);
    expect(ouverts).toEqual([
      {
        key: CLE,
        systemKey: "scalingo",
        label: "Émettre un jeton restreint pour l'inventaire de la région osc-fr1",
        params: { usage: "inventaire-d-une-region", region: "osc-fr1" },
        openedAt: OUVERTURE,
        expiresAt: terme,
      },
    ]);

    // Then le départ interroge Scalingo, où elle n'a pourtant aucun compte constaté : sans
    // ce changement, le connecteur ne serait pas appelé et l'engagement ne serait nommé
    // nulle part
    const avecEngagement = await calculerPlan("OFFBOARDING", personId, USERNAME, APRES);
    expect(avecEngagement.systemes).toContain("scalingo");

    // Then l'instant reçu borne l'ensemble des lignes et pas seulement leurs termes : un
    // départ confirmé rejoue ses engagements comme il rejoue ses tolérances, et un geste
    // soldé après cette confirmation n'entre pas dans son recalcul. Sans cette borne il en
    // déplacerait l'empreinte, et un départ confirmé n'a plus de recalcul pour la rattraper
    expect(await engagementsOuverts(personId, AVANT_LE_GESTE)).toEqual([]);
    const gele = await calculerPlan(
      "OFFBOARDING",
      personId,
      USERNAME,
      APRES,
      undefined,
      AVANT_LE_GESTE,
    );
    expect(gele.systemes).not.toContain("scalingo");
    expect(gele.empreinte).toBe(sansRien.empreinte);

    // Then un terme passé le fait sortir : c'est la seule reprise qui existe pour un accès
    // qu'aucune API ne referme, et le départ n'a plus rien à en dire
    expect(await engagementsOuverts(personId, new Date("2026-10-11T09:00:00Z"))).toEqual([]);

    // Then une déclaration dont le contrôle est en attente n'a rien ouvert : la compter
    // ferait dire au départ qu'un jeton est vivant avant que quiconque ait relu qu'il l'est
    await prisma.planStep.updateMany({ where: { planId }, data: { validation: "AWAITING" } });
    expect(await engagementsOuverts(personId, APRES)).toEqual([]);
  });

  it("tient pour fermé l'engagement qu'une coupure écartée solde", async () => {
    // Given un jeton émis par un geste soldé, dont l'engagement est ouvert
    const planId = await enregistrerPlan(
      { kind: "MANUAL_OP", subjectId: personId, intention: intention("astreinte de nuit") },
      gesteQuiEngage(new Date("2026-10-10T09:00:00Z")),
      OPERATRICE.username,
      OUVERTURE,
    );
    await prisma.planStep.updateMany({
      where: { planId },
      data: { state: "SUCCEEDED", executedAt: OUVERTURE },
    });
    expect(await engagementsOuverts(personId, APRES)).toHaveLength(1);

    // When un départ porte l'étape qui solde cette clé, et que l'opératrice l'écarte en
    // disant pourquoi : elle décide que cette coupure n'aura pas lieu, ce qui la solde au
    // même titre que « fait », à la raison près qu'elle porte
    const octroi = await prisma.planStep.findFirstOrThrow({
      where: { planId },
      select: { idempotencyKey: true, systemKey: true, label: true },
    });
    await prisma.planStep.create({
      data: {
        planId,
        systemKey: octroi.systemKey,
        tier: "manual",
        capability: "revoke",
        action: "reprendre-un-jeton-restreint",
        label: `Reprendre ${octroi.label}`,
        params: {},
        expectedState: {},
        state: "SKIPPED",
        lastError: "jeton déjà repris à la main pendant l'astreinte",
        engagementKey: CLE,
        idempotencyKey: `${octroi.idempotencyKey}:ecartee`,
        executedAt: APRES,
      },
    });

    // Then l'engagement est fermé : exclure l'écart ferait regagner l'octroi, plus ancien,
    // et tout départ ultérieur ré-émettrait indéfiniment la coupure que quelqu'un vient
    // d'écarter en connaissance de cause
    expect(await engagementsOuverts(personId, APRES)).toEqual([]);

    // Then le départ cesse d'interroger Scalingo, où elle n'a aucun compte : plus rien n'y
    // est ouvert, et le connecteur n'a plus rien à proposer
    const depart = await calculerPlan("OFFBOARDING", personId, USERNAME, APRES);
    expect(depart.systemes).not.toContain("scalingo");
  });
});

/** Le formulaire tel que l'écran le poste, sur l'intention que ce fichier joue partout. */
function champs(surcharge: Record<string, string> = {}): FormData {
  const donnees = new FormData();
  const valeurs: Record<string, string> = {
    username: USERNAME,
    systeme: "scalingo",
    justification: "renfort d'astreinte sur le portail pendant les congés",
    expiresInDays: "30",
    scope: JSON.stringify({
      nature: "collaboration",
      region: "osc-fr1",
      application: "portail-exemple",
      role: "limited",
    }),
    ...surcharge,
  };
  for (const [nom, valeur] of Object.entries(valeurs)) {
    donnees.set(nom, valeur);
  }
  return donnees;
}

/**
 * Le journal s'écrit sans être attendu : `audit` est en fire-and-forget, pour qu'une panne
 * du journal ne fasse jamais échouer l'action qu'il documente. Une assertion qui le lirait
 * une seule fois passerait au repos et tomberait sous charge.
 */
async function attendreLaTrace(action: string) {
  for (let essai = 0; essai < 100; essai += 1) {
    const ligne = await prisma.auditEvent.findFirst({
      where: { action },
      orderBy: { at: "desc" },
    });
    if (ligne) {
      return ligne;
    }
    await new Promise((suite) => setTimeout(suite, 20));
  }
  throw new Error(`aucune trace « ${action} » n'est arrivée au journal`);
}

describe("l'ouverture d'un geste, depuis le formulaire", () => {
  let personId = "";

  beforeEach(async () => {
    rafraichis.length = 0;
    const personne = await prisma.person.create({
      data: {
        username: USERNAME,
        fullname: "Nour Exemple",
        source: "BETA",
        communicationEmail: ADRESSE,
      },
    });
    personId = personne.id;
  });

  it("exige une justification écrite, repose le brouillon précédent, et se refuse pendant un départ", async () => {
    // When la justification tient en deux caractères
    const bafouillee = await ouvrirGeste(null, champs({ justification: "ok" }));

    // Then rien n'est écrit : la justification est ce qui restera quand plus personne ne se
    // souviendra de la demande, et le schéma ne dit que la forme
    expect(bafouillee).toMatchObject({ erreur: expect.stringContaining("Écrivez-la en clair") });
    expect(await prisma.plan.count()).toBe(0);

    // When elle est écrite en clair
    const premier = await ouvrirGeste(null, champs());

    // Then un brouillon naît, ancré sur la personne et sur aucun dossier
    expect(premier.erreur).toBeUndefined();
    const brouillon = await prisma.plan.findUniqueOrThrow({
      where: { id: premier.planId ?? "" },
      select: { state: true, kind: true, accessCaseId: true, subjectId: true },
    });
    expect(brouillon).toMatchObject({
      state: "DRAFT",
      kind: "MANUAL_OP",
      accessCaseId: null,
      subjectId: personId,
    });

    // Then la trace vise la fiche par son identifiant beta.gouv, et non par la clé interne
    // de la ligne : c'est le pivot d'identité du dépôt, le seul que le filtre « personne »
    // du journal rapproche d'une fiche, et le seul que sa colonne « Cible » sache nommer
    expect(await attendreLaTrace("geste.ouverture")).toMatchObject({
      targetType: "personne",
      targetId: USERNAME,
      actorUsername: "operatrice.exemple",
      result: "SUCCESS",
    });
    expect(rafraichis).toEqual([`/personnes/${USERNAME}`]);

    // When on repose le geste sans avoir confirmé le premier
    const second = await ouvrirGeste(
      null,
      champs({ justification: "astreinte prolongée d'une semaine" }),
    );

    // Then le brouillon précédent est réputé périmé, et lui seul : reposer le geste est sa
    // seule sortie, un brouillon de geste n'ayant ni recalcul ni annulation, et deux
    // brouillons vivants sur la même personne laisseraient confirmer celui que personne ne
    // regarde
    expect(second.erreur).toBeUndefined();
    expect(
      await prisma.plan.findMany({ select: { id: true, state: true }, orderBy: { id: "asc" } }),
    ).toHaveLength(2);
    expect(
      (await prisma.plan.findUniqueOrThrow({ where: { id: premier.planId ?? "" } })).state,
    ).toBe("STALE");
    expect(
      (await prisma.plan.findUniqueOrThrow({ where: { id: second.planId ?? "" } })).state,
    ).toBe("DRAFT");

    // When un départ s'ouvre sur la personne
    await prisma.accessCase.create({ data: { personId, kind: "OFFBOARDING", state: "CANDIDATE" } });
    const pendantLeDepart = await ouvrirGeste(null, champs({ justification: "un dernier accès" }));

    // Then le geste se refuse avant d'écrire quoi que ce soit, et le brouillon en cours
    // reste : ouvrir un accès maintenant déplacerait l'empreinte du plan de ce départ
    expect(pendantLeDepart.erreur).toBe(REFUS_DEPART_OUVERT);
    expect(await prisma.plan.count()).toBe(2);
    expect(
      (await prisma.plan.findUniqueOrThrow({ where: { id: second.planId ?? "" } })).state,
    ).toBe("DRAFT");
  });
});
