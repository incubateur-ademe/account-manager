import { revueDe } from "@/core/revue";
import { prisma } from "@/lib/db";

/**
 * Les comptes de service dont la revue est due.
 *
 * Ils ne se reportent plus depuis un fichier : un compte machine se déclare une fois depuis
 * l'écran, et ce qu'il porte vit en base. Ce que la collecte peut encore en dire est ce
 * qu'aucun écran ne regarde tous les jours, à savoir lesquels attendent d'être revus.
 *
 * Une échéance de revue et non une fin de mission : un compte machine n'en a pas, et c'est
 * précisément pourquoi quelqu'un doit se prononcer périodiquement sur son existence.
 */
export async function comptesEnRetardDeRevue(maintenant: Date): Promise<readonly string[]> {
  const comptes = await prisma.serviceAccount.findMany({
    // Un ordre explicite : sans lui, la même liste s'écrirait différemment d'une nuit à
    // l'autre dans le journal, et ce bruit se lirait comme un changement.
    orderBy: { key: "asc" },
    select: { key: true, reviewEveryDays: true, lastReviewedAt: true, createdAt: true },
  });

  return comptes
    .filter(
      (compte) =>
        revueDe(
          {
            reviewEveryDays: compte.reviewEveryDays,
            lastReviewedAt: compte.lastReviewedAt,
            createdAt: compte.createdAt,
          },
          maintenant,
        ).etat === "EN_RETARD",
    )
    .map((compte) => compte.key);
}
