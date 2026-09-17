import { prisma } from "@/lib/db";

import type { CompteLu, RessourceLue } from "./parc";

const PROVIDER = "scalingo";

/**
 * Ce que l'écran a le droit de présenter comme le parc du dernier constat.
 *
 * Sorti de l'écran pour être éprouvé contre une vraie base : la vivacité d'une ligne se
 * décide par une relation, et aucun double écrit à la main ne l'honore sans réécrire un
 * moteur.
 *
 * `Resource` ne porte aucune date de disparition et ses lignes ne s'effacent jamais :
 * sans clause de vivacité, une application supprimée côté Scalingo resterait affichée
 * sous une phrase qui la date de la dernière collecte, alors que la dernière est
 * justement celle qui ne l'a plus vue, et son lien mènerait à une page morte. Le critère
 * est celui du garde-fou de la collecte, et il est exact ici : le connecteur écrit un
 * accès de propriétaire pour chaque application.
 *
 * Un contenant, lui, ne porte aucun accès par construction : un projet Scalingo ne se
 * rejoint pas, le fournisseur laissant la gestion des utilisateurs au niveau de
 * l'application. Le retenir par ses contenues vivantes est donc la seule façon de ne pas
 * faire tomber le regroupement en même temps qu'on écarte les mortes.
 */
export async function lireLeParc(): Promise<{
  ressources: readonly RessourceLue[];
  comptes: readonly CompteLu[];
}> {
  const [ressources, comptes] = await Promise.all([
    prisma.resource.findMany({
      where: {
        provider: PROVIDER,
        OR: [
          { grants: { some: { vanishedAt: null } } },
          { contenus: { some: { grants: { some: { vanishedAt: null } } } } },
        ],
      },
      select: {
        id: true,
        label: true,
        url: true,
        parentId: true,
        // L'identité doit être vivante elle aussi, et pas seulement l'accès : les deux
        // datations sont découplées, et un garde-fou peut refuser de dater les accès d'un
        // système en laissant dater ses identités.
        //
        // Les accès portent `externalIdentityId` et non la relation `externalIdentity` :
        // celle-ci ajouterait un ordre SQL dont la clause reprendrait un paramètre par
        // accès, une personne présente sur dix applications y figurant dix fois.
        grants: {
          where: { vanishedAt: null, externalIdentity: { vanishedAt: null } },
          select: { role: true, lastSeenAt: true, externalIdentityId: true },
        },
      },
      orderBy: { label: "asc" },
    }),
    prisma.externalIdentity.findMany({
      where: { provider: PROVIDER, vanishedAt: null },
      select: {
        id: true,
        handle: true,
        matchMethod: true,
        details: true,
        lastSeenAt: true,
        person: { select: { username: true, fullname: true } },
        serviceAccount: { select: { key: true, label: true } },
      },
      orderBy: { handle: "asc" },
    }),
  ]);

  return { ressources, comptes };
}
