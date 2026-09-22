import { describe, expect, it } from "vitest";

import { CLE_INCUBATEUR } from "@/core/modele-plan";
import { prisma } from "@/lib/db";

import { departSansSecondRegard } from "./lecture";

/**
 * Ce que l'écran des modèles sait dire du second regard, contre une vraie base.
 *
 * Le compte traverse une relation pour poser ses deux conditions de propriétaire et de
 * moment, ce qu'aucun double ne tient sans rejouer la clause qu'il vérifie. Les trois
 * voisines semées ici existent pour ça : chacune serait comptée par un `where` amputé
 * d'une de ses conditions, et l'avertissement disparaîtrait alors que rien ne relit
 * un départ.
 */

const ETAPE = {
  position: 1,
  title: "Restituer le matériel",
  doneWhen: "Le matériel est revenu et son état est noté.",
} as const;

async function semerModele(
  proprietaire: string,
  moment: "ONBOARDING" | "OFFBOARDING",
  controleur: "OPERATOR" | null,
): Promise<void> {
  await prisma.planTemplate.create({
    data: {
      ownerKey: proprietaire,
      kind: moment,
      steps: {
        create: {
          ...ETAPE,
          key: `${proprietaire}-${moment}`,
          expectedActor: "SUBJECT",
          validationBy: controleur,
        },
      },
    },
  });
}

describe("l'écran des modèles signale un départ que personne ne relit", () => {
  it("ne compte que les étapes de départ de l'incubateur, et seulement celles qu'un contrôleur relit", async () => {
    // Given une base vide, que le passage de mise en place pose avant chaque scénario,
    // Then rien ne relit un départ qui n'a pas encore été déclaré.
    await expect(departSansSecondRegard()).resolves.toBe(true);

    // Given le départ de l'incubateur, déclaré sans contrôleur,
    await semerModele(CLE_INCUBATEUR, "OFFBOARDING", null);

    // Given une arrivée de l'incubateur et un départ de startup, tous deux relus,
    await semerModele(CLE_INCUBATEUR, "ONBOARDING", "OPERATOR");
    await semerModele("produit-exemple", "OFFBOARDING", "OPERATOR");

    // Then l'avertissement tient : ni l'autre moment ni l'autre propriétaire ne relit
    // le départ de l'incubateur, et les compter éteindrait l'avertissement alors que
    // rien n'a changé pour la personne qui part.
    await expect(departSansSecondRegard()).resolves.toBe(true);

    // When un contrôleur est posé sur l'étape de départ de l'incubateur,
    await prisma.planTemplateStep.updateMany({
      where: { template: { ownerKey: CLE_INCUBATEUR, kind: "OFFBOARDING" } },
      data: { validationBy: "OPERATOR" },
    });

    // Then l'avertissement s'éteint.
    await expect(departSansSecondRegard()).resolves.toBe(false);

    // When ce contrôleur est retiré, ce qu'une modification de modèle fait sans rien
    // demander de plus,
    await prisma.planTemplateStep.updateMany({
      where: { template: { ownerKey: CLE_INCUBATEUR, kind: "OFFBOARDING" } },
      data: { validationBy: null },
    });

    // Then il revient. C'est la seule chose qui distingue cet avertissement d'une
    // consigne écrite une fois dans un document de déploiement.
    await expect(departSansSecondRegard()).resolves.toBe(true);
  });
});
