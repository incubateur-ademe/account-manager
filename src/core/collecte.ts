/**
 * Une collecte qui rapporte beaucoup moins que la précédente n'est pas distinguable
 * d'un départ collectif : les deux se ressemblent trait pour trait, seule l'ampleur
 * les sépare. Dans le doute, on refuse d'en tirer des disparitions, car dater une
 * disparition finit par couper un accès.
 *
 * Sans point de comparaison, il n'y a rien à soupçonner : une première collecte n'est
 * pas une chute.
 */
export function chuteExcessive(reference: number, observe: number, partMax: number): boolean {
  if (reference <= 0) {
    return false;
  }
  return observe < Math.floor(reference * (1 - partMax));
}

export interface Fraicheur {
  /** Vrai quand ce qui est affiché ne peut plus être tenu pour l'état du jour. */
  perimee: boolean;
  /** Âge de la dernière collecte complète, nul quand il n'y en a jamais eu. */
  heures: number | null;
}

const HEURE = 60 * 60 * 1000;

/**
 * Une collecte qui a cessé de tourner ne se voit pas : les personnes gardent leur
 * échéance, les statuts restent au vert, et l'écran affiche un périmètre gelé avec
 * la même assurance qu'un périmètre frais. C'est la panne la plus discrète de ce
 * système, et la seule qui fasse mentir tous ses écrans à la fois.
 *
 * Le silence est donc traité comme un signal : passé le délai, on le dit.
 */
export function fraicheurDe(
  derniereCollecte: Date | null,
  maintenant: Date,
  seuilHeures: number,
): Fraicheur {
  if (derniereCollecte === null) {
    return { perimee: true, heures: null };
  }

  const heures = Math.max(
    0,
    Math.floor((maintenant.getTime() - derniereCollecte.getTime()) / HEURE),
  );
  return { perimee: heures >= seuilHeures, heures };
}
