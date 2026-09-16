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

export type EtatDeclaration = { erreur: string } | null;

/**
 * Déclarer un compte de service, c'est affirmer qu'un accès permanent non humain existe,
 * que quelqu'un en répond, et qu'il se revoit tous les N jours. Ces deux dernières choses
 * sont ce qui rend un compte machine gouvernable : sans elles, il ne resterait qu'un nom
 * dans une liste que personne ne relit.
 *
 * Il ne se découvre pas. La collecte ne devine pas qu'un compte n'est pas humain, et le
 * deviner reviendrait à décider qu'une personne n'en est pas une.
 */
export async function declarerUnCompteDeService(
  _etat: EtatDeclaration,
  formData: FormData,
): Promise<EtatDeclaration> {
  await requireOperateur();

  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const ownerUsername = String(formData.get("ownerUsername") ?? "").trim();
  const reviewEveryDays = Number(formData.get("reviewEveryDays") ?? 180);

  if (!key || !label || !purpose || !ownerUsername) {
    return { erreur: "La clé, le libellé, l'usage et le propriétaire sont tous exigés." };
  }
  if (!Number.isInteger(reviewEveryDays) || reviewEveryDays < 1) {
    return { erreur: "La revue se compte en jours entiers, au moins un." };
  }

  const existant = await prisma.serviceAccount.findUnique({ where: { key } });
  if (existant) {
    return { erreur: `Un compte de service porte déjà la clé « ${key} ».` };
  }

  await actionTracee({
    action: "compte-de-service.declaration",
    targetType: "compte-de-service",
    targetId: key,
    after: { label, purpose, ownerUsername, reviewEveryDays },
    revalider: ["/comptes-de-service"],
    ecrire: async () => {
      await prisma.serviceAccount.create({
        data: { key, label, purpose, ownerUsername, reviewEveryDays },
      });
    },
  });

  return null;
}
