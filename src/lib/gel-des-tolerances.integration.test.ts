import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { calculerPlan, enregistrerPlan, ouvrirDossier } from "@/lib/dossier";
import { executerPlan } from "@/lib/execution";

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
 */

const REPERTOIRE = mkdtempSync(join(tmpdir(), "gel-integration-"));
copyFileSync(resolve(process.cwd(), "config/config.exemple.yaml"), join(REPERTOIRE, "config.yaml"));
process.env["POLICY_DIR"] = REPERTOIRE;

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

describe("un plan confirmé rejoue les tolérances de sa confirmation", () => {
  let personId = "";
  beforeEach(async () => {
    personId = await semer();
  });

  it("reste exécutable après une pose qui aurait écarté une de ses étapes", async () => {
    // Given un départ dont le plan est calculé puis confirmé, sans aucune tolérance,
    const dossier = await ouvrirDossier(personId, "OFFBOARDING", null);
    const calcule = await calculerPlan("OFFBOARDING", personId, USERNAME, CONFIRMATION);
    expect(calcule.etapes.length).toBeGreaterThan(0);
    const planId = await enregistrerPlan(dossier.id, calcule, OPERATRICE.username, CONFIRMATION);

    // La confirmation, telle que l'action l'écrit : l'empreinte du calcul et l'instant
    // qui l'a produite, dans la même écriture.
    await prisma.plan.update({
      where: { id: planId },
      data: {
        state: "EXECUTING",
        confirmedAt: CONFIRMATION,
        confirmedBy: OPERATRICE.username,
        confirmedDigest: calcule.empreinte,
      },
    });
    await prisma.accessCase.update({
      where: { id: dossier.id },
      data: { state: "CONFIRMED" },
    });

    // When les deux comptes sont tolérés après coup, ce qui retirerait l'étape GitHub
    // d'un plan calculé aujourd'hui,
    await tolerer("cpt-1", APRES);
    await tolerer("cpt-2", APRES);

    const aujourdhui = await calculerPlan("OFFBOARDING", personId, USERNAME, APRES);
    expect(aujourdhui.empreinte).not.toBe(calcule.empreinte);

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
    expect(gele.empreinte).toBe(calcule.empreinte);

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
