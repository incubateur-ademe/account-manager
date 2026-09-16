/**
 * La saisie d'un compte de service, lue une fois pour les deux écrans qui l'offrent.
 *
 * Elle est déclarée depuis l'écran des comptes de service, et depuis la file des comptes
 * isolés où un compte constaté fait découvrir la machine qui le détient. Deux lectures
 * finiraient par diverger, et la divergence qui coûte n'est pas la clé vide mais la
 * périodicité : un écran qui accepterait zéro poserait une revue due chaque jour, que
 * personne ne pourrait plus éteindre.
 */

export interface Declaration {
  key: string;
  label: string;
  purpose: string;
  ownerUsername: string;
  reviewEveryDays: number;
}

export type LectureDeclaration = { erreur: string } | { declaration: Declaration };

export const REVUE_PAR_DEFAUT = 180;

export function lireDeclaration(brut: {
  key: string;
  label: string;
  purpose: string;
  ownerUsername: string;
  reviewEveryDays: number;
}): LectureDeclaration {
  const declaration: Declaration = {
    key: brut.key.trim(),
    label: brut.label.trim(),
    purpose: brut.purpose.trim(),
    ownerUsername: brut.ownerUsername.trim(),
    reviewEveryDays: brut.reviewEveryDays,
  };

  if (!declaration.key || !declaration.label || !declaration.purpose) {
    return { erreur: "La clé, le libellé et l'usage sont tous exigés." };
  }
  if (!declaration.ownerUsername) {
    return {
      erreur:
        "Indiquez qui répond de ce compte : un compte machine sans propriétaire ne se revoit jamais.",
    };
  }
  if (!Number.isInteger(declaration.reviewEveryDays) || declaration.reviewEveryDays < 1) {
    return { erreur: "La revue se compte en jours entiers, au moins un." };
  }

  return { declaration };
}
