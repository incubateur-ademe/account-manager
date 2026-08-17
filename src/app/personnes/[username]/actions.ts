"use server";

import { actionTracee } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export type EtatDetachement = { erreur: string } | null;

/**
 * Défaire un rattachement est le pendant nécessaire de le poser : une attribution
 * erronée sans geste pour l'annuler ne se corrigerait qu'en base, hors de portée du
 * journal, et personne ne saurait plus qui a décidé quoi.
 *
 * Le compte redevient alors sans détenteur connu, ce qu'il faut : il reparaît
 * aussitôt parmi les comptes isolés, et la collecte suivante le signalera.
 */
export async function detacherIdentite(
  _etat: EtatDetachement,
  formData: FormData,
): Promise<EtatDetachement> {
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { erreur: "Compte introuvable." };
  }

  const identite = await prisma.externalIdentity.findUnique({
    where: { id },
    select: {
      id: true,
      provider: true,
      handle: true,
      matchMethod: true,
      person: { select: { username: true } },
      serviceAccount: { select: { key: true } },
    },
  });

  if (!identite) {
    return { erreur: "Ce compte n'est plus en base." };
  }

  const detenteur = identite.person?.username ?? identite.serviceAccount?.key ?? null;
  if (detenteur === null) {
    return { erreur: "Ce compte n'est rattaché à personne." };
  }

  await actionTracee({
    action: "identite.detachement",
    targetType: "identite",
    targetId: `${identite.provider}:${identite.handle}`,
    before: { detenteur, methode: identite.matchMethod },
    revalider: ["/comptes-isoles", "/personnes", "/constats", "/"],
    ecrire: async (operateur) => {
      await prisma.externalIdentity.update({
        where: { id: identite.id },
        data: { personId: null, serviceAccountId: null, matchMethod: "NONE" },
      });

      // Les constats qui reposaient sur ce rattachement n'ont plus d'objet : celui
      // d'un compte dont le détenteur est parti n'a de sens que si le compte est
      // bien le sien.
      const caducs = await prisma.finding.findMany({
        where: { externalIdentityId: identite.id, closedAt: null },
        select: { id: true, dedupKey: true },
      });

      if (caducs.length === 0) {
        return;
      }

      await prisma.finding.updateMany({
        where: { id: { in: caducs.map((constat) => constat.id) } },
        data: { closedAt: new Date(), closeReason: `rattachement à ${detenteur} défait` },
      });

      for (const constat of caducs) {
        audit({
          actorKind: "HUMAN",
          actorUsername: operateur.username,
          action: "finding.close",
          targetType: "finding",
          targetId: constat.dedupKey,
          after: { raison: `rattachement à ${detenteur} défait` },
          result: "SUCCESS",
        });
      }
    },
  });

  return null;
}
