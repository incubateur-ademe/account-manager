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

export interface ReleveSysteme {
  provider: string;
  startedAt: Date;
  status: "OK" | "PARTIAL" | "FAILED" | "SKIPPED";
}

export interface SystemeMuet {
  provider: string;
  /** Ce qui cloche : jamais lu, plus lu depuis trop longtemps, ou en échec. */
  raison: "perime" | "echec" | "non-lu";
  heures: number | null;
}

/**
 * La fraîcheur du périmètre ne dit rien des systèmes cibles. Une lecture GitHub qui
 * échoue toutes les nuits depuis un mois laisse pourtant les fiches affirmer que
 * personne n'y a de compte, sur l'écran précis où se décide une coupure : l'absence
 * d'observation s'y lit exactement comme une absence de compte.
 *
 * Cette fonction rend les systèmes dont on ne peut plus dire qu'on les regarde.
 */
export function systemesMuets(
  releves: readonly ReleveSysteme[],
  attendus: readonly string[],
  maintenant: Date,
  seuilHeures: number,
): SystemeMuet[] {
  const muets: SystemeMuet[] = [];

  for (const provider of attendus) {
    const releve = releves.find((candidat) => candidat.provider === provider);

    if (!releve) {
      muets.push({ provider, raison: "non-lu", heures: null });
      continue;
    }

    if (releve.status === "FAILED") {
      muets.push({ provider, raison: "echec", heures: null });
      continue;
    }

    // Un système annoncé comme non lu n'est pas une panne : la trace existe, elle
    // dit ce qu'il manque, et c'est déjà ce qu'on voulait savoir.
    if (releve.status === "SKIPPED") {
      muets.push({ provider, raison: "non-lu", heures: null });
      continue;
    }

    const { perimee, heures } = fraicheurDe(releve.startedAt, maintenant, seuilHeures);
    if (perimee) {
      muets.push({ provider, raison: "perime", heures });
    }
  }

  return muets;
}
