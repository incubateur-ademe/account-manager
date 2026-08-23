import type { ObservedDetail, ObservedIdentity } from "@/core/connector";
import type { IdKind } from "@/generated/prisma/enums";

/**
 * Une collecte qui rapporte beaucoup moins que la précédente n'est pas distinguable
 * d'un départ collectif : les deux se ressemblent trait pour trait, seule l'ampleur
 * les sépare. Dans le doute, on refuse d'en tirer des disparitions, car dater une
 * disparition finit par couper un accès.
 *
 * Sans point de comparaison, il n'y a rien à soupçonner : une première collecte n'est
 * pas une chute.
 */
/**
 * Le contrat parle en minuscules, la base en majuscules. La conversion est explicite
 * plutôt que castée : deux vocabulaires qui se ressemblent sont exactement ce qui
 * finit par diverger sans que rien ne le dise.
 */
const KIND: Record<ObservedIdentity["idKind"], IdKind> = {
  opaque: "OPAQUE",
  email: "EMAIL",
  upn: "UPN",
};

/**
 * Ce qu'une identité collectée laisse en base, et rien de plus.
 *
 * La liste est courte et elle est délibérée : ce qui sert de clé, ce qui sert au
 * rapprochement, ce qui déclenche, et ce qui sert à décider à qui un compte
 * appartient. `emails` et `lastActivityAt` sont collectés et ne sont pas persistés :
 * écrire `emails` changerait l'issue du rapprochement sur le parc existant, une
 * ressemblance devenant une correspondance d'adresse, donc une identité révocable.
 * Ce n'est pas un oubli, c'est un autre ticket.
 *
 * `details` suit le dernier état constaté, absence comprise : un connecteur qui
 * cesse de savoir quelque chose d'un compte doit cesser de l'afficher.
 */
export function champsConstates(
  identite: ObservedIdentity,
  now: Date,
): {
  handle: string;
  idKind: IdKind;
  details: readonly ObservedDetail[] | null;
  lastSeenAt: Date;
  vanishedAt: null;
} {
  return {
    handle: identite.handle,
    idKind: KIND[identite.idKind],
    details: identite.details ?? null,
    lastSeenAt: now,
    vanishedAt: null,
  };
}

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

/**
 * L'ingestion du périmètre passe par ce fournisseur : ses runs disent qu'on connaît
 * les personnes, jamais qu'on a lu un système cible. Les compter comme une collecte
 * de comptes ferait passer une absence d'observation pour une absence d'accès.
 */
export const FOURNISSEUR_PERIMETRE = "espace-membre";

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
