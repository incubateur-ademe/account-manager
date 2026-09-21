import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ISSUE_DOSSIER } from "@/core/execution";
import { prisma } from "@/lib/db";
import { calculerPlan, enregistrerPlan, ouvrirDossier } from "@/lib/dossier";
import { executerPlan } from "@/lib/execution";
import { chargerLesSurcharges } from "@/lib/surcharges";
import { politiqueJetable } from "@/test/politique-jetable";

/**
 * Le gel des tolérances par l'instant de confirmation, contre une vraie base.
 *
 * Ce que ce fichier tient et qu'aucun double ne saurait tenir, c'est un couplage entre
 * deux actions : la confirmation écrit `confirmedAt` avec le « maintenant » qu'elle a
 * passé au calcul, et l'exécution le relit pour rejouer les tolérances de cet instant-là.
 * Rien dans les types ne relie les deux. Un refactor qui poserait `confirmedAt` ailleurs,
 * ou qui daterait la confirmation autrement, reconstituerait un autre ensemble de
 * tolérances et ferait refuser des plans confirmés sans qu'aucun test de type ne bronche.
 *
 * Sans ce gel, une tolérance posée entre la confirmation et l'exécution déplace
 * l'empreinte recalculée au démarrage, et le plan devient inexécutable sans issue : le
 * recalcul n'est ouvert qu'à un brouillon.
 *
 * Le second scénario tient la limite de ce gel, qui est une décision et non un oubli. Une
 * permanente n'a pas de date, donc l'instant de la confirmation ne la rejoue pas, et la
 * politique en vigueur l'emporte sur le plan approuvé. Ce qui se tient ici est que le
 * refus nomme le geste qui reste, faute de quoi le dossier n'aurait aucune sortie.
 */

const DOSSIER_POLITIQUE = politiqueJetable("gel-integration");
const FICHIER_POLITIQUE = join(DOSSIER_POLITIQUE, "config.yaml");
/** Le modèle en déclare déjà une, qui ne vise aucun compte de ce scénario. */
const POLITIQUE_INITIALE = readFileSync(FICHIER_POLITIQUE, "utf8");
const SANS_PERMANENTE = POLITIQUE_INITIALE.replace(/^permanentDerogations:\n(?:[ -].*\n)*/m, "");

/**
 * Déclare des permanentes comme un déploiement le ferait, le fichier puis le rechargement.
 *
 * Le cache de politique s'invalide à chaque appel de `chargerLesSurcharges`, que la
 * disposition racine passe une fois par requête : un fichier livré vaut donc dès l'écran
 * suivant, et c'est cette fenêtre-là que le scénario exerce.
 */
async function declarerDesPermanentes(externalIds: readonly string[]): Promise<void> {
  const entrees = externalIds
    .map(
      (externalId) =>
        `  - targetType: identite\n    targetId: github:${externalId}\n    reason: comptes repris par l'équipe pour de bon\n    owner: ${OPERATRICE.username}\n`,
    )
    .join("");

  writeFileSync(FICHIER_POLITIQUE, `${SANS_PERMANENTE}permanentDerogations:\n${entrees}`, "utf8");
  await chargerLesSurcharges();
}

async function rendreLaPolitique(): Promise<void> {
  writeFileSync(FICHIER_POLITIQUE, POLITIQUE_INITIALE, "utf8");
  await chargerLesSurcharges();
}

const USERNAME = "nour.exemple";
const CONFIRMATION = new Date("2026-09-10T09:00:00Z");
const APRES = new Date("2026-09-12T09:00:00Z");

const OPERATRICE = { username: "operatrice.exemple", voie: "ESPACE_MEMBRE" as const };

async function semer(): Promise<string> {
  const personne = await prisma.person.create({
    data: { username: USERNAME, fullname: "Nour Exemple", source: "BETA" },
  });
  // Deux comptes sur le même système : l'étape de révocation les coupe d'un seul geste,
  // donc il faut les tolérer tous les deux pour qu'elle quitte le plan.
  for (const externalId of ["cpt-1", "cpt-2"]) {
    await prisma.externalIdentity.create({
      data: {
        provider: "github",
        externalId,
        handle: externalId,
        matchMethod: "GITHUB_LOGIN",
        personId: personne.id,
      },
    });
  }
  return personne.id;
}

const tolerer = (externalId: string, posee: Date) =>
  prisma.derogation.create({
    data: {
      targetType: "identite",
      targetId: `github:${externalId}`,
      reason: "comptes repris par l'équipe, le temps de la passation",
      createdBy: OPERATRICE.username,
      createdAt: posee,
      expiresAt: new Date("2026-12-31T00:00:00Z"),
    },
  });

/**
 * Le départ confirmé dont les deux scénarios partent, tel que l'action l'écrit :
 * l'empreinte du calcul et l'instant qui l'a produite, dans la même écriture.
 */
async function confirmerUnDepart(personId: string): Promise<{ planId: string; empreinte: string }> {
  const dossier = await ouvrirDossier(personId, "OFFBOARDING", null);
  const calcule = await calculerPlan("OFFBOARDING", personId, USERNAME, CONFIRMATION);
  expect(calcule.etapes.length).toBeGreaterThan(0);
  const planId = await enregistrerPlan(
    { kind: calcule.sens, accessCaseId: dossier.id },
    calcule,
    OPERATRICE.username,
    CONFIRMATION,
  );

  await prisma.plan.update({
    where: { id: planId },
    data: {
      state: "EXECUTING",
      confirmedAt: CONFIRMATION,
      confirmedBy: OPERATRICE.username,
      confirmedDigest: calcule.empreinte,
    },
  });
  await prisma.accessCase.update({ where: { id: dossier.id }, data: { state: "CONFIRMED" } });

  return { planId, empreinte: calcule.empreinte };
}

describe("un plan confirmé rejoue les tolérances de sa confirmation", () => {
  let personId = "";
  beforeEach(async () => {
    personId = await semer();
  });

  it("reste exécutable après une pose qui aurait écarté une de ses étapes", async () => {
    // Given un départ dont le plan est calculé puis confirmé, sans aucune tolérance,
    const { planId, empreinte: approuvee } = await confirmerUnDepart(personId);

    // When les deux comptes sont tolérés après coup, ce qui retirerait l'étape GitHub
    // d'un plan calculé aujourd'hui,
    await tolerer("cpt-1", APRES);
    await tolerer("cpt-2", APRES);

    const aujourdhui = await calculerPlan("OFFBOARDING", personId, USERNAME, APRES);
    expect(aujourdhui.empreinte).not.toBe(approuvee);

    // Then le même calcul rejoué à l'instant de la confirmation rend l'empreinte
    // approuvée : c'est tout le mécanisme, et il tient parce qu'une tolérance ne couvre
    // pas avant d'avoir été posée,
    const gele = await calculerPlan(
      "OFFBOARDING",
      personId,
      USERNAME,
      APRES,
      undefined,
      CONFIRMATION,
    );
    expect(gele.empreinte).toBe(approuvee);

    // Then et l'exécution part sans refuser, parce qu'elle relit `confirmedAt` en base
    // plutôt que de recalculer au présent. C'est ce couplage entre deux actions que rien
    // dans les types ne tient.
    const resultat = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: true,
      maintenant: APRES,
    });
    expect(resultat.refus).toBeUndefined();
  });
});

describe("une permanente livrée après la confirmation arrête le plan", () => {
  let personId = "";
  beforeEach(async () => {
    personId = await semer();
  });
  afterEach(rendreLaPolitique);

  it("refuse de partir et nomme le geste qui reste", async () => {
    // Given un départ dont le plan est calculé puis confirmé, sans aucune tolérance,
    const { planId, empreinte: approuvee } = await confirmerUnDepart(personId);

    // When les deux comptes sont admis pour de bon dans la politique livrée depuis,
    await declarerDesPermanentes(["cpt-1", "cpt-2"]);

    // Then l'instant de la confirmation ne les rejoue pas : une permanente n'a pas de
    // date, donc rien du gel ne l'atteint et l'étape GitHub quitte le plan,
    const rejoue = await calculerPlan(
      "OFFBOARDING",
      personId,
      USERNAME,
      APRES,
      undefined,
      CONFIRMATION,
    );
    expect(rejoue.empreinte).not.toBe(approuvee);

    // Then l'exécution refuse, et c'est la décision et non un oubli : couper un accès que
    // la politique en vigueur vient d'admettre serait pire que ne pas partir,
    const resultat = await executerPlan(planId, {
      operateur: OPERATRICE,
      masseConfirmee: true,
      maintenant: APRES,
    });
    expect(resultat.refus).toContain("ne décrit plus ce qui a été approuvé");

    // Then le refus nomme la sortie, la même que l'écran offre. Sans elle, le dossier
    // n'en aurait aucune, le recalcul n'étant ouvert qu'à un brouillon,
    expect(resultat.refus).toContain(ISSUE_DOSSIER);

    // Then et rien n'a bougé, ni le compteur du passage ni les étapes en base.
    expect(resultat.executees).toBe(0);
    const etats = await prisma.planStep.findMany({ where: { planId }, select: { state: true } });
    expect(etats.length).toBeGreaterThan(0);
    expect(etats.every(({ state }) => state === "PENDING")).toBe(true);
  });
});
