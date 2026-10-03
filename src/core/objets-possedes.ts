import { autoriseUneRevocation } from "@/core/rapprochement";

/** Le compte qui porte un objet possédé, réduit à ce qui décide de sa section. */
export interface CompteDeLObjet {
  matchMethod: string;
  vanishedAt: Date | null;
  /** Nulle quand le compte n'est rattaché à aucune fiche, compte de service compris. */
  person: { vanishedAt: Date | null } | null;
}

export const SECTIONS_D_OBJETS = ["orphelins", "a-confirmer", "auteur-present"] as const;

export type SectionDObjets = (typeof SECTIONS_D_OBJETS)[number];

/**
 * La première section qui s'applique, dans l'ordre de `SECTIONS_D_OBJETS`.
 *
 * L'orphelin passe devant la ressemblance. Un compte disparu, ou rattaché par ressemblance
 * à une personne sortie, laisse l'objet sans auteur présent. Si la ressemblance est juste,
 * l'auteur est parti. Si elle est fausse, il est inconnu. Confirmer le rattachement n'y
 * changerait rien.
 *
 * Un compte de service n'a pas de fiche. Personne ne part avec lui, si bien que son objet
 * n'a aucun auteur dont le départ le ferait transmettre.
 *
 * La sortie d'une fiche se lit comme pour le constat `ORPHAN`, sur `vanishedAt`.
 */
export function sectionDObjet(compte: CompteDeLObjet | null): SectionDObjets {
  if (
    compte === null ||
    compte.vanishedAt !== null ||
    compte.person === null ||
    compte.person.vanishedAt !== null
  ) {
    return "orphelins";
  }
  return autoriseUneRevocation(compte.matchMethod) ? "auteur-present" : "a-confirmer";
}

/** Range des références vivantes, chacune dans une seule section, sans en perdre aucune. */
export function classerObjetsPossedes<T extends { compte: CompteDeLObjet | null }>(
  objets: readonly T[],
): Record<SectionDObjets, T[]> {
  const sections: Record<SectionDObjets, T[]> = {
    orphelins: [],
    "a-confirmer": [],
    "auteur-present": [],
  };
  for (const objet of objets) {
    sections[sectionDObjet(objet.compte)].push(objet);
  }
  return sections;
}
