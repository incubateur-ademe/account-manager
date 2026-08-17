"use server";

import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";

export type EtatCloture = { erreur: string } | null;

/**
 * Clore un constat, c'est dire « j'ai traité, voici pourquoi ». La raison est
 * obligatoire : une file qu'on vide sans motif redevient une file qu'on ne croit
 * plus. La collecte ne rouvrira pas ce constat tant que la situation dure.
 */
export async function cloreConstat(_etat: EtatCloture, formData: FormData): Promise<EtatCloture> {
  const dedupKey = String(formData.get("dedupKey") ?? "").trim();
  const raison = String(formData.get("raison") ?? "").trim();

  if (!dedupKey) {
    return { erreur: "Constat introuvable." };
  }
  if (raison.length < 3) {
    return { erreur: "Indiquez ce qui a été fait." };
  }

  const constat = await prisma.finding.findUnique({
    where: { dedupKey },
    select: { id: true, closedAt: true },
  });

  if (!constat) {
    return { erreur: "Ce constat n'existe plus." };
  }
  if (constat.closedAt !== null) {
    return { erreur: "Ce constat est déjà clos." };
  }

  await actionTracee({
    action: "finding.close",
    targetType: "finding",
    targetId: dedupKey,
    after: { raison },
    revalider: ["/constats", "/"],
    ecrire: async (operateur) => {
      await prisma.finding.update({
        where: { id: constat.id },
        data: { closedAt: new Date(), closeReason: raison, closedBy: operateur.username },
      });
    },
  });

  return null;
}
