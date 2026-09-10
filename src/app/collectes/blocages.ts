import { type BlocageInstalle, blocagesInstalles } from "@/core/collecte";
import { prisma } from "@/lib/db";

/**
 * Combien de passages l'écran des collectes relit, et sur lesquels il dit ce qui
 * bloque. Assez pour que la table des exécutions couvre plusieurs jours de tous les
 * systèmes à la fois, un blocage installé ne se lisant que dans une série.
 */
export const PASSAGES_AFFICHES = 60;

/**
 * Les garde-fous dont le blocage tient, tels que l'écran des collectes les annonce en
 * tête.
 *
 * L'écran les montre et l'action qui les lève les recalcule, par cet appel-ci des deux
 * côtés. C'est ce qui donne son sens au refus de l'action : deux lectures qui se
 * ressembleraient sans être la même laisseraient passer une décision posée sur des
 * nombres qu'aucun écran n'a annoncés, ce que cette garde existe précisément pour
 * empêcher.
 */
export async function blocagesDuMoment(): Promise<BlocageInstalle[]> {
  const runs = await prisma.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: PASSAGES_AFFICHES,
    select: { provider: true, error: true },
  });

  return blocagesInstalles(runs);
}
