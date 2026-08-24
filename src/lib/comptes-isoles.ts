import type { Prisma } from "@/generated/prisma/client";

/**
 * Un rattachement par ressemblance appelle le même geste qu'un compte sans
 * détenteur : quelqu'un doit trancher. Le laisser hors de cette file le rendrait
 * invisible, alors qu'il ne pourra jamais justifier une révocation.
 *
 * Cette clause est la seule définition de la file : l'écran qui la liste et le
 * compteur du tableau de bord la partagent, sans quoi les deux affichent le même
 * intitulé sur deux populations différentes.
 */
export const OU_NON_REVOCABLE: Prisma.ExternalIdentityWhereInput = {
  vanishedAt: null,
  OR: [{ personId: null, serviceAccountId: null }, { matchMethod: "HEURISTIC" }],
};

export const OU_SANS_DETENTEUR: Prisma.ExternalIdentityWhereInput = {
  vanishedAt: null,
  personId: null,
  serviceAccountId: null,
};

/**
 * Le complément exact de `OU_SANS_DETENTEUR` à l'intérieur de `OU_NON_REVOCABLE` : une
 * identité rapprochée par ressemblance qui n'aurait pas de détenteur est déjà comptée
 * par l'autre clause, et la compter ici aussi ferait dépasser le total.
 */
export const OU_RESSEMBLANCE_A_CONFIRMER: Prisma.ExternalIdentityWhereInput = {
  vanishedAt: null,
  matchMethod: "HEURISTIC",
  NOT: { personId: null, serviceAccountId: null },
};
