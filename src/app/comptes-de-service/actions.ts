"use server";

import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

export type EtatRevue = { erreur: string } | null;

/**
 * Un compte machine n'a pas de fin de mission : sans ce geste, sa revue se
 * périme à date fixe et rien ne peut plus l'éteindre. Le badge resterait rouge
 * pour toujours, et un signal qui ne s'éteint jamais finit par ne plus rien
 * signaler.
 */
export async function enregistrerRevue(_etat: EtatRevue, formData: FormData): Promise<EtatRevue> {
  await requireOperateur();

  const key = String(formData.get("key") ?? "").trim();

  if (!key) {
    return { erreur: "Compte introuvable." };
  }

  const compte = await prisma.serviceAccount.findUnique({
    where: { key },
    select: { id: true, lastReviewedAt: true },
  });

  if (!compte) {
    return { erreur: "Ce compte n'existe plus." };
  }

  const now = new Date();

  await actionTracee({
    action: "service-account.review",
    targetType: "service-account",
    targetId: key,
    before: { lastReviewedAt: compte.lastReviewedAt },
    after: { lastReviewedAt: now },
    revalider: ["/comptes-de-service"],
    ecrire: async () => {
      await prisma.serviceAccount.update({
        where: { id: compte.id },
        data: { lastReviewedAt: now },
      });
    },
  });

  return null;
}
