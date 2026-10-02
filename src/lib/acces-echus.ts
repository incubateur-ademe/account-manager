import { etapeDUnAccesEchu } from "@/core/constat";
import { prisma } from "@/lib/db";
import { dateLocale } from "@/ui/dates";

/**
 * Ce qu'un constat d'accès échu désigne, en une phrase : l'étape d'octroi et son terme. Le
 * constat ne porte aucun compte, et sans elle l'écran ne dirait pas quel accès retirer.
 */
export async function precisionsDesAccesEchus(
  dedupKeys: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const parEtape = new Map(
    dedupKeys.flatMap((cle) => {
      const etapeId = etapeDUnAccesEchu(cle);
      return etapeId === null ? [] : [[etapeId, cle] as const];
    }),
  );
  if (parEtape.size === 0) {
    return new Map();
  }

  const etapes = await prisma.planStep.findMany({
    where: { id: { in: [...parEtape.keys()] } },
    select: { id: true, label: true, grantExpiresAt: true },
  });

  return new Map(
    etapes.flatMap(({ id, label, grantExpiresAt }) => {
      const cle = parEtape.get(id);
      return cle === undefined || grantExpiresAt === null
        ? []
        : [
            [
              cle,
              `Il s'agit de « ${label} », accordé jusqu'au ${dateLocale.format(grantExpiresAt)}.`,
            ],
          ];
    }),
  );
}
