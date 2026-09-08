import type { EtatDossier, SensDossier } from "@/core/dossier";
import { participationVivante } from "@/core/participation";
import { prisma } from "@/lib/db";

/**
 * Le droit de participer à un dossier, relu en base au moment où on s'en sert.
 *
 * Jamais porté par le jeton : celui-ci dit qui est là pour des semaines, et un droit
 * qu'il porterait serait un droit que la révocation ne saurait plus retirer avant son
 * expiration. Le prix est une lecture par geste, et c'est le prix de l'effet immédiat.
 *
 * Une session sans fiche n'ouvre rien : c'est le cas de toute session posée par la
 * voie espace-membre au nom d'un opérateur, dont l'identité est un username et non une
 * `Person`.
 */
export async function droitDeParticiper(
  personId: string | null,
  dossierId: string,
): Promise<boolean> {
  if (personId === null) {
    return false;
  }

  const droit = await prisma.caseParticipation.findUnique({
    where: { accessCaseId_personId: { accessCaseId: dossierId, personId } },
    select: { expiresAt: true, revokedAt: true, accessCase: { select: { state: true } } },
  });

  return droit !== null && participationVivante(droit, droit.accessCase.state, new Date());
}

/**
 * Cette fiche détient-elle encore un droit, sur n'importe quel dossier ?
 *
 * C'est ce qui ouvre une porte de connexion, là où `droitDeParticiper` ouvre un geste.
 * Les deux se lisent en base à l'instant où on s'en sert, et la seconde question ne se
 * déduit pas de la première : un lien émis hier ne vaut que par ce que la base dit
 * aujourd'hui.
 */
export async function aUnDroitVivant(personId: string): Promise<boolean> {
  const maintenant = new Date();

  const droits = await prisma.caseParticipation.findMany({
    where: { personId },
    select: { expiresAt: true, revokedAt: true, accessCase: { select: { state: true } } },
  });

  return droits.some((droit) => participationVivante(droit, droit.accessCase.state, maintenant));
}

export interface DossierParticipe {
  id: string;
  sens: SensDossier;
  etat: EtatDossier;
  porteur: string;
  expiresAt: Date;
}

/** Les dossiers qu'un droit vivant couvre, pour l'écran de qui n'est pas opérateur. */
export async function dossiersOuvertsPour(personId: string | null): Promise<DossierParticipe[]> {
  if (personId === null) {
    return [];
  }

  const maintenant = new Date();

  const droits = await prisma.caseParticipation.findMany({
    where: { personId },
    orderBy: { expiresAt: "asc" },
    select: {
      expiresAt: true,
      revokedAt: true,
      accessCase: {
        select: { id: true, kind: true, state: true, person: { select: { fullname: true } } },
      },
    },
  });

  return droits
    .filter((droit) => participationVivante(droit, droit.accessCase.state, maintenant))
    .map((droit) => ({
      id: droit.accessCase.id,
      sens: droit.accessCase.kind,
      etat: droit.accessCase.state,
      porteur: droit.accessCase.person.fullname,
      expiresAt: droit.expiresAt,
    }));
}
