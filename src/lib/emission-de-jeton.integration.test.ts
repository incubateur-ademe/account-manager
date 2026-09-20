import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditInput } from "@/core/audit";
import { ETATS_VIVANTS } from "@/core/dossier";
import { intentionDUnGeste } from "@/core/geste";
import { prisma } from "@/lib/db";
import { enregistrerPlan } from "@/lib/dossier";
import { type DemandeDeJeton, ErreurFgp } from "@/lib/fgp";
import { calculerGeste, engagementsOuverts } from "@/lib/geste";
import { politiqueJetable } from "@/test/politique-jetable";

/**
 * L'émission d'un jeton restreint, de son intention à la fiche du compte machine, contre une
 * vraie base.
 *
 * Ce que ce fichier tient et qu'aucun double ne saurait tenir : que le chemin automatique est
 * fermé par le contrat et non par une garde enfouie, que le socle, et non le connecteur,
 * écrit le compte machine, et qu'il l'écrit à travers ce que l'étape lui a remis. Aucun
 * fichier de `src/connectors/` n'importe `@/lib/db`, si bien que cette écriture n'a d'autre
 * chemin que le contrat, et qu'une remise perdue en route ne se verrait nulle part ailleurs
 * qu'ici.
 *
 * Et que la clé cliente n'atteint ni la base ni le journal. Elle est cherchée par sa valeur,
 * sur tout ce que les deux portent : une assertion champ par champ passerait à côté du jour
 * où quelqu'un l'ajoute ailleurs.
 *
 * Rien ici n'appelle le proxy : l'émetteur est doublé, et l'adresse posée ne mène nulle part.
 */

/** Ce que l'exécution a fait, dans l'ordre où elle l'a fait. */
const ordre = vi.hoisted(() => [] as string[]);
const demandes = vi.hoisted(() => [] as unknown[]);

/** La moitié qui ne repasse jamais. Cherchée telle quelle dans la base et dans le journal. */
const CLE_CLIENTE = vi.hoisted(() => "cle-cliente-de-test-qui-ne-doit-nulle-part-se-lire");

/** Ce que l'émetteur doublé répond. Le scénario en décide, et rien d'autre. */
const emetteur = vi.hoisted(() => ({
  reponse: { blob: "blob-opaque-de-test", cle: "" } as { blob: string; cle: string } | ErreurFgp,
}));

/**
 * Les écritures sont autorisées ici, et c'est le seul fichier du dépôt dans ce cas : sans
 * elles, la boucle n'appellerait aucun connecteur, et le chemin qu'on veut prouver serait
 * précisément celui qui ne s'emprunte pas. Ce que cette autorisation atteint est doublé de
 * bout en bout, et les adresses restent mortes.
 *
 * Les deux credentials sont posés, et c'est ce qui donne son sens au premier scénario :
 * l'étape reste manuelle alors que rien ne manque, parce que ce n'est pas un credential qui
 * manque.
 */
vi.hoisted(() => {
  process.env["ACTIONS_ENABLED"] = "true";
  process.env["SCALINGO_API_TOKEN"] = "aucun-jeton-en-test";
  process.env["FGP_URL"] = "http://127.0.0.1:1";
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/fgp", async (original) => {
  const reel = await original<typeof import("@/lib/fgp")>();

  return {
    ...reel,
    emettreUnJeton: (demande: DemandeDeJeton) => {
      ordre.push("emission");
      demandes.push(demande);
      return emetteur.reponse instanceof ErreurFgp
        ? Promise.reject(emetteur.reponse)
        : Promise.resolve(emetteur.reponse);
    },
  };
});

/**
 * Le réseau est le seul double du connecteur, et `scalingo.execute` reste le vrai : il route
 * l'action d'émission, refuse un hôte étranger et confronte la cible aux régions que le
 * fournisseur annonce, trois choses qu'un double du connecteur escamoterait. Aucune adresse
 * de cet environnement n'écoute, et le porteur s'échange comme en production.
 */
const SERVIES: Readonly<Record<string, unknown>> = {
  "https://auth.scalingo.com/v1/tokens/exchange": { token: "porteur-de-test" },
  "https://auth.scalingo.com/v1/regions": {
    regions: [{ name: "osc-fr1", api: "https://api.osc-fr1.scalingo.com" }],
  },
};

function doublerLeReseau(): void {
  // Le porteur échangé vit dans le module du connecteur et survit d'un scénario au suivant :
  // seules les adresses lues par ce scénario-ci doivent se compter.
  vi.spyOn(globalThis, "fetch")
    .mockClear()
    .mockImplementation((entree) => {
      const adresse = String(entree);
      const corps = SERVIES[adresse];

      return corps === undefined
        ? Promise.reject(new Error(`aucune adresse doublée : ${adresse}`))
        : Promise.resolve(
            new Response(JSON.stringify(corps), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
    });
}

/**
 * Le journal s'écrit sans être attendu, si bien que l'ordre des lignes en base ne dit rien de
 * l'ordre des appels : une panne du journal ne doit jamais faire échouer l'action métier, et
 * la boucle rend la main avant que ses lignes soient posées. C'est donc l'appel qu'on observe,
 * pendant que l'écriture réelle continue de partir.
 */
vi.mock("@/lib/audit", async (original) => {
  const reel = await original<typeof import("@/lib/audit")>();

  return {
    audit: (entree: AuditInput) => {
      ordre.push(`journal:${entree.action}`);
      reel.audit(entree);
    },
  };
});

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

politiqueJetable("emission-integration");

const USERNAME = "nour.exemple";
const ADRESSE = "nour.exemple@exemple.invalid";
const OUVERTURE = new Date("2026-09-10T09:00:00Z");
const OPERATRICE = { username: "operatrice.exemple", voie: "ESPACE_MEMBRE" as const };

const INTENTION = intentionDUnGeste.parse({
  systeme: "scalingo",
  scope: { nature: "jeton", usage: "inventaire-d-une-region", region: "osc-fr1" },
  expiresInDays: 7,
  justification: "inventaire ponctuel du parc pour la revue trimestrielle",
});

async function attendreLesTraces(action: string) {
  for (let essai = 0; essai < 200; essai += 1) {
    const lignes = await prisma.auditEvent.findMany({ where: { action } });
    if (lignes.length > 0) {
      return lignes;
    }
    await new Promise((suite) => setTimeout(suite, 20));
  }
  throw new Error(`aucune trace « ${action} » n'est arrivée au journal`);
}

describe("un jeton restreint s'émet, se range, et ne laisse qu'une moitié derrière lui", () => {
  let personId = "";

  beforeEach(async () => {
    doublerLeReseau();
    ordre.length = 0;
    demandes.length = 0;
    emetteur.reponse = { blob: "blob-opaque-de-test", cle: CLE_CLIENTE };
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

  /** Le geste, calculé, enregistré et confirmé, tel qu'un opérateur le laisse. */
  async function poserUnGesteConfirme(): Promise<{ planId: string; empreinte: string }> {
    const calcule = await calculerGeste(INTENTION, personId, USERNAME, OUVERTURE);
    expect(calcule.refus).toEqual([]);
    expect(calcule.etapes).toHaveLength(1);

    const planId = await enregistrerPlan(
      { kind: "MANUAL_OP", subjectId: personId, intention: INTENTION },
      calcule,
      OPERATRICE.username,
      OUVERTURE,
    );

    await prisma.plan.updateMany({
      where: {
        id: planId,
        state: "DRAFT",
        accessCaseId: null,
        subject: {
          accessCases: { none: { kind: "OFFBOARDING", state: { in: [...ETATS_VIVANTS] } } },
        },
      },
      data: {
        state: "EXECUTING",
        confirmedDigest: calcule.empreinte,
        confirmedBy: OPERATRICE.username,
        confirmedAt: OUVERTURE,
      },
    });

    return { planId, empreinte: calcule.empreinte };
  }

  it("rend encore la clé quand une écriture lève après l'émission", async () => {
    // Given les deux credentials posés, le proxy comme le jeton de compte : c'est ce qui
    // ouvre la voie automatique, et rien d'autre
    expect(process.env["FGP_URL"]).toBeTruthy();
    expect(process.env["SCALINGO_API_TOKEN"]).toBeTruthy();

    const calcule = await calculerGeste(INTENTION, personId, USERNAME, OUVERTURE);
    const etape = calcule.etapes[0]?.etape;
    expect(etape?.tier).toBe("auto");
    // La voie manuelle reste sous elle, avec sa marche à suivre : un credential retiré ne
    // laisse pas un trou
    expect(etape?.manual?.runbook).toContain("proxy à jetons restreints");

    const { planId } = await poserUnGesteConfirme();

    // Given une écriture d'étape qui refuse juste après l'émission. C'est le seul instant
    // où la moitié périssable n'existe nulle part ailleurs que dans la mémoire du passage :
    // ni la base, ni le journal, ni le proxy n'en gardent copie
    const espion = vi
      .spyOn(prisma.planStep, "update")
      .mockRejectedValueOnce(new Error("la base a refusé l'écriture de l'étape"));

    const { executerPlan } = await import("@/lib/execution");
    const passage = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: false,
      maintenant: OUVERTURE,
    });
    espion.mockRestore();

    // Then l'émission a bien eu lieu, et le compte machine est écrit
    expect(demandes).toHaveLength(1);
    const compte = await prisma.serviceAccount.findFirstOrThrow({
      where: { provider: "scalingo" },
    });

    // Then la clé remonte quand même jusqu'à l'appelant, au lieu de disparaître avec
    // l'exception : un jeton vivant que rien ne révoque, dont la clé n'aurait atteint
    // personne, est ce que cette remontée existe pour éviter
    expect(passage.remises).toEqual([
      { key: compte.key, label: compte.label, aRemettre: CLE_CLIENTE },
    ]);

    // Then le passage dit qu'il s'est arrêté en route, et nomme la cause : le compte rendu
    // qui l'accompagne porte des nombres arrêtés au milieu, et l'état du plan n'a pas été
    // reposé
    expect(passage.passageIncomplet).toContain("la base a refusé l'écriture de l'étape");

    // Then le journal porte l'interruption sous le plan, avec le nombre de remises en jeu
    const traces = await attendreLesTraces("plan.execution");
    expect(
      traces.some((ligne) => (ligne.after as Record<string, unknown>)["interrompu"] !== undefined),
    ).toBe(true);
  });

  it("écrit le compte machine depuis le socle, journalise avant d'agir, et ne garde pas la clé", async () => {
    // Given un geste hors dossier qui demande un jeton restreint, borné à sept jours
    const { planId } = await poserUnGesteConfirme();

    // Then la clé d'engagement et le terme ont descendu en base, le socle les transportant
    // sans jamais les interpréter
    const avant = await prisma.planStep.findFirstOrThrow({
      where: { planId },
      select: { engagementKey: true, grantExpiresAt: true, idempotencyKey: true },
    });
    expect(avant.engagementKey).toBe("scalingo:jeton:inventaire-d-une-region:osc-fr1:nour.exemple");
    expect(avant.grantExpiresAt).not.toBeNull();

    // When on exécute le plan, écritures autorisées
    const { executerPlan } = await import("@/lib/execution");
    const passage = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: false,
      maintenant: OUVERTURE,
    });

    // Then la cible a été confrontée aux régions que le fournisseur annonce, et le porteur
    // échangé pour cette seule lecture : c'est `scalingo.execute` qui l'a fait, le vrai
    const lues = vi.mocked(globalThis.fetch).mock.calls.map(([adresse]) => String(adresse));
    expect(lues).toContain("https://auth.scalingo.com/v1/regions");

    // Then l'émission a bien eu lieu, une seule fois, bornée à la région et au terme
    expect(passage.refus).toBeUndefined();
    expect(passage.simulation).toBe(false);
    expect(passage.executees).toBe(1);
    expect(demandes).toHaveLength(1);
    expect(demandes[0]).toMatchObject({
      cible: "https://api.osc-fr1.scalingo.com",
      scopes: ["GET:/v1/apps", "GET:/v1/collaborators"],
      secondes: 7 * 24 * 60 * 60,
    });

    // Then le journal de l'étape a été appelé avant l'émission, et il ne pouvait rien savoir
    // de son issue : c'est l'invariant du produit, une trace nominative écrite avant toute
    // écriture sur un système cible
    const posee = ordre.indexOf("journal:plan.etape.execution");
    expect(posee).toBeGreaterThanOrEqual(0);
    expect(posee).toBeLessThan(ordre.indexOf("emission"));

    const traces = await attendreLesTraces("plan.etape.execution");
    const prealable = traces.find(
      (ligne) => !Object.keys(ligne.after as Record<string, unknown>).includes("motif"),
    );
    expect(prealable).toBeDefined();
    expect(prealable?.actorUsername).toBe(OPERATRICE.username);
    expect(prealable?.after).toMatchObject({ systeme: "scalingo", simulation: false });

    // Then le compte machine existe, écrit par le socle et non par le connecteur, et il
    // porte tout ce qu'une émission décide
    const compte = await prisma.serviceAccount.findFirstOrThrow({
      where: { provider: "scalingo" },
    });
    expect(compte.ownerUsername).toBe(USERNAME);
    expect(compte.issuedBy).toBe(OPERATRICE.username);
    expect(compte.fgpBlob).toBe("blob-opaque-de-test");
    expect(compte.fgpTarget).toBe("https://api.osc-fr1.scalingo.com");
    expect(compte.fgpScopes).toEqual(["GET:/v1/apps", "GET:/v1/collaborators"]);
    expect(compte.expiresAt).toEqual(avant.grantExpiresAt);
    // La périodicité vaut la durée du terme : aucune revue ne tombe avant que le jeton ne
    // meure, et un jeton mort sort de la file au lieu d'y rougir pour toujours
    expect(compte.reviewEveryDays).toBe(7);
    // Dérivée de la clé d'idempotence stockée, qui porte l'identifiant du plan : une
    // réémission écrirait une seconde ligne au lieu d'écraser la première
    expect(compte.key).toContain(planId.toLowerCase());

    // Then la moitié périssable remonte jusqu'à l'appelant, et elle seule : le blob n'y est
    // pas, le rangement ayant réussi
    expect(passage.remises).toEqual([
      { key: compte.key, label: compte.label, aRemettre: CLE_CLIENTE },
    ]);

    // Then la clé cliente n'est nulle part en base. Cherchée par sa valeur sur la fiche
    // entière et sur l'étape : garder les deux moitiés ferait de cette base le coffre des
    // credentials du parc, ce que l'ADR-0001 a refusé en toutes lettres
    expect(JSON.stringify(compte)).not.toContain(CLE_CLIENTE);
    expect(JSON.stringify(await prisma.planStep.findMany({ where: { planId } }))).not.toContain(
      CLE_CLIENTE,
    );

    // Then elle n'est pas davantage au journal, qui est en écriture seule et à rétention
    // indéfinie : une ligne écrite là ne se reprend pas
    await attendreLesTraces("compte-de-service.emission");
    expect(JSON.stringify(await prisma.auditEvent.findMany())).not.toContain(CLE_CLIENTE);

    // Then le journal dit tout de même que ce compte a été émis, sous le nom de qui l'a
    // lancé : sans cette ligne, la fiche apparaîtrait sans que rien ne dise d'où elle vient
    const emission = await attendreLesTraces("compte-de-service.emission");
    expect(emission[0]).toMatchObject({
      actorUsername: OPERATRICE.username,
      targetId: compte.key,
      result: "SUCCESS",
    });
    expect(emission[0]?.after).toMatchObject({
      detenteur: USERNAME,
      cible: "https://api.osc-fr1.scalingo.com",
    });

    // Then l'engagement est ouvert, et c'est par lui seul qu'un départ retrouvera ce jeton :
    // aucune collecte ne le rendra jamais
    const ouverts = await engagementsOuverts(personId, new Date("2026-09-12T09:00:00Z"));
    expect(ouverts.map(({ key }) => key)).toEqual([
      "scalingo:jeton:inventaire-d-une-region:osc-fr1:nour.exemple",
    ]);

    // Then passé le terme, il n'est plus ouvert : attendre l'expiration est la seule reprise
    // qui existe, le proxy n'offrant aucune révocation
    expect(await engagementsOuverts(personId, new Date("2026-09-18T09:00:00Z"))).toEqual([]);
  });

  it("ne rejoue jamais de lui-même une émission dont l'échec est ambigu", async () => {
    // Given un proxy qui expire au lieu de répondre : un blob a pu naître là-bas, rien ne le
    // liste, rien ne le révoque, et aucune route d'introspection n'existe pour lever le doute
    emetteur.reponse = new ErreurFgp(null, false, "The operation was aborted due to timeout");

    const { planId } = await poserUnGesteConfirme();
    const { executerPlan } = await import("@/lib/execution");
    const passer = () =>
      executerPlan(planId, {
        operateur: OPERATRICE,
        masseConfirmee: false,
        maintenant: OUVERTURE,
      });

    // When un premier passage tente l'émission
    const premier = await passer();

    // Then elle échoue, et l'étape porte en base ce que le connecteur a dit de la reprise
    expect(premier.executees).toBe(1);
    expect(premier.echecs).toBe(1);
    const apresLEchec = await prisma.planStep.findFirstOrThrow({ where: { planId } });
    expect(apresLEchec.state).toBe("FAILED");
    expect(apresLEchec.retryable).toBe(false);
    expect(apresLEchec.lastError).toContain("Ne relancez pas à l'aveugle");

    // When un second passage part sur le même plan, sans nouvelle confirmation : c'est un
    // clic, et rien ne le borne du côté de l'écran
    const second = await passer();

    // Then aucune seconde émission n'est partie. Sans cette garde, `FAILED` faisant partie
    // des états que la reprise reprend, le second clic ajoutait un second jeton que rien ne
    // liste et que rien ne révoque, pendant que le message de l'étape demandait précisément
    // de ne pas relancer à l'aveugle
    expect(second.refus).toBeUndefined();
    expect(second.executees).toBe(0);
    expect(demandes).toHaveLength(1);
    expect(await prisma.serviceAccount.count()).toBe(0);

    // Then l'étape n'a été tentée qu'une fois, et elle reste à la main d'un opérateur, qui
    // la pointe ou l'écarte en ayant lu la cause
    const apresLeSecond = await prisma.planStep.findFirstOrThrow({ where: { planId } });
    expect(apresLeSecond.attempts).toBe(1);
    expect(apresLeSecond.state).toBe("FAILED");

    // Then un échec qui exclut qu'un blob soit né, lui, se reprend : le refus du corps
    // précède le chiffrement, et rien n'a pu naître là-bas
    emetteur.reponse = new ErreurFgp(400, true, "400 Bad Request");
    await prisma.planStep.updateMany({ where: { planId }, data: { retryable: null } });
    await passer();
    expect(demandes).toHaveLength(2);
    expect((await prisma.planStep.findFirstOrThrow({ where: { planId } })).retryable).toBe(false);
  });

  it("laisse la saisie à la main porter le terme, et sort du retard de revue ce que le terme éteint", async () => {
    // Given la fiche d'un jeton émis, saisie à la main depuis l'écran des comptes de service,
    // avec le terme que la marche à suivre demande d'y recopier. C'est la seule voie ouverte
    // aujourd'hui, et sans ce champ la fiche naissait sans terme : la branche du terme passé
    // ne pouvait jamais la concerner, et elle réclamait pour toujours une revue que personne
    // ne peut éteindre, faute de révocation chez le proxy qui l'a émise
    const { declarerUnCompteDeService } = await import("@/app/comptes-de-service/actions");

    // Le terme se compte depuis maintenant, et la collecte se joue un jour après lui : la
    // saisie refuse un terme déjà passé, et une date en dur finirait par en devenir un.
    const JOUR_MS = 24 * 60 * 60 * 1000;
    const jourDuTerme = new Date(Date.now() + 180 * JOUR_MS).toISOString().slice(0, 10);
    const terme = new Date(`${jourDuTerme}T00:00:00Z`);

    const saisie = (champs: Record<string, string>): FormData => {
      const formulaire = new FormData();
      for (const [nom, valeur] of Object.entries(champs)) {
        formulaire.set(nom, valeur);
      }
      return formulaire;
    };

    expect(
      await declarerUnCompteDeService(
        null,
        saisie({
          provider: "scalingo",
          key: "scalingo-jeton-inventaire",
          label: "Scalingo · jeton restreint inventaire",
          purpose: "Inventaire ponctuel du parc pour la revue trimestrielle",
          ownerUsername: USERNAME,
          reviewEveryDays: "7",
          expiresAt: jourDuTerme,
        }),
      ),
    ).toBeNull();

    const avecTerme = await prisma.serviceAccount.findUniqueOrThrow({
      where: { key: "scalingo-jeton-inventaire" },
    });
    expect(avecTerme.expiresAt).toEqual(terme);

    // Given la fiche d'un compte machine ordinaire, qui n'a pas de terme et dont la revue
    // finira par être due : c'est le signal que la file existe pour porter
    expect(
      await declarerUnCompteDeService(
        null,
        saisie({
          provider: "scalingo",
          key: "scalingo-bot-de-deploiement",
          label: "Scalingo · bot de déploiement",
          purpose: "Déploie les applications de l'incubateur",
          ownerUsername: USERNAME,
          reviewEveryDays: "7",
        }),
      ),
    ).toBeNull();
    expect(
      (
        await prisma.serviceAccount.findUniqueOrThrow({
          where: { key: "scalingo-bot-de-deploiement" },
        })
      ).expiresAt,
    ).toBeNull();

    // When la collecte relève, bien après les deux échéances, lesquels comptes attendent
    // d'être revus
    const { comptesEnRetardDeRevue } = await import("@/lib/sync/comptes-service");
    const enRetard = await comptesEnRetardDeRevue(new Date(terme.getTime() + JOUR_MS));

    // Then le jeton mort n'y figure pas, et le compte sans terme y figure. Compter le premier
    // rallumerait un signal que plus aucun geste ne peut éteindre, et un signal qui ne
    // s'éteint jamais finit par ne plus rien signaler
    expect(enRetard).toEqual(["scalingo-bot-de-deploiement"]);

    // Then une date illisible est refusée plutôt que repliée sur « aucun terme » : repliée,
    // elle fabriquait exactement la fiche que ce champ existe pour éviter
    expect(
      await declarerUnCompteDeService(
        null,
        saisie({
          provider: "scalingo",
          key: "scalingo-jeton-illisible",
          label: "Scalingo · jeton",
          purpose: "Essai",
          ownerUsername: USERNAME,
          reviewEveryDays: "7",
          expiresAt: "le mois prochain",
        }),
      ),
    ).toEqual({ erreur: "Le terme ne se lit pas comme une date." });
    expect(await prisma.serviceAccount.count()).toBe(2);
  });
});
