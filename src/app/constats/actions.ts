"use server";

import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

export type EtatCloture = { erreur: string } | null;

/**
 * Clore un constat, c'est dire « j'ai traité, voici pourquoi ». La raison est
 * obligatoire : une file qu'on vide sans motif redevient une file qu'on ne croit
 * plus. La collecte ne rouvrira pas ce constat tant que la situation dure.
 */
export async function cloreConstat(_etat: EtatCloture, formData: FormData): Promise<EtatCloture> {
  await requireOperateur();

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
    select: { id: true, closedAt: true, person: { select: { username: true } } },
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
    // La fiche de la personne aussi, quand le constat en porte une : c'est de là que
    // le geste peut partir. L'identifiant vient du constat relu, jamais du
    // formulaire, qui se poste sans passer par l'écran qui l'a rendu.
    revalider: [
      "/constats",
      "/",
      ...(constat.person ? [`/personnes/${constat.person.username}`] : []),
    ],
    ecrire: async (operateur) => {
      await prisma.finding.update({
        where: { id: constat.id },
        data: { closedAt: new Date(), closeReason: raison, closedBy: operateur.username },
      });
    },
  });

  return null;
}
