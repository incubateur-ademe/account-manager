import { autoriseUneRevocation } from "@/core/rapprochement";

/** Le compte qui porte un objet possédé, réduit à ce qui décide de sa section. */
export interface CompteDeLObjet {
  matchMethod: string;
  /** Nulle quand le compte n'est rattaché à aucune fiche, compte de service compris. */
  person: { vanishedAt: Date | null } | null;
}

export const SECTIONS_D_OBJETS = ["orphelins", "a-confirmer", "auteur-present"] as const;

export type SectionDObjets = (typeof SECTIONS_D_OBJETS)[number];

/** De la section la mieux placée à la moins bien placée, pour un objet à plusieurs comptes. */
const PREFERENCE: readonly SectionDObjets[] = ["auteur-present", "a-confirmer", "orphelins"];

/**
 * La section d'un seul compte.
 *
 * L'orphelin passe devant la ressemblance. Une ressemblance vers une personne sortie laisse
 * l'objet sans auteur présent. Si la ressemblance est juste, l'auteur est parti. Si elle est
 * fausse, il est inconnu. Confirmer le rattachement n'y changerait rien.
 *
 * Un compte de service n'a pas de fiche. Personne ne part avec lui, si bien que son objet
 * n'a aucun auteur dont le départ le ferait transmettre.
 *
 * La vie du compte n'entre pas en jeu, comme dans le plan de départ : un objet survit à son
 * compte. La sortie d'une fiche se lit comme pour le constat `ORPHAN`, sur `vanishedAt`.
 */
export function sectionDObjet(compte: CompteDeLObjet | null): SectionDObjets {
  if (compte === null || compte.person === null || compte.person.vanishedAt !== null) {
    return "orphelins";
  }
  return autoriseUneRevocation(compte.matchMethod) ? "auteur-present" : "a-confirmer";
}

/**
 * Range des références vivantes par objet, chaque objet dans une seule section, sans en
 * perdre aucun.
 *
 * Un objet porte une référence par compte qui le possède, et va dans la section du mieux
 * placé de ses comptes : un dépôt qu'une personne présente administre encore n'est pas
 * orphelin parce qu'un second administrateur est parti.
 */
export function classerObjetsPossedes<
  T extends { resourceId: string; compte: CompteDeLObjet | null },
>(references: readonly T[]): Record<SectionDObjets, [T, ...T[]][]> {
  const parObjet = new Map<string, [T, ...T[]]>();
  for (const reference of references) {
    const deja = parObjet.get(reference.resourceId);
    parObjet.set(reference.resourceId, deja ? [...deja, reference] : [reference]);
  }

  const sections: Record<SectionDObjets, [T, ...T[]][]> = {
    orphelins: [],
    "a-confirmer": [],
    "auteur-present": [],
  };
  for (const objet of parObjet.values()) {
    const atteintes = new Set(objet.map(({ compte }) => sectionDObjet(compte)));
    const section = PREFERENCE.find((candidate) => atteintes.has(candidate)) ?? "orphelins";
    sections[section].push(objet);
  }
  return sections;
}
