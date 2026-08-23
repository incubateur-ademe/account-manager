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

/**
 * Ce qu'un garde-fou de chute a refusé de dater, dit assez précisément pour qu'un
 * passage suivant reconnaisse le même refus.
 *
 * Deux familles, deux verrous distincts. Une chute des identités interdit de conclure
 * sur qui a disparu, et donc aussi sur les accès qui en dépendent. Une chute des
 * ressources n'interdit que les accès : qu'un connecteur cesse d'émettre une famille
 * de ressources ne dit rien de la personne dont la fiche vient de s'éteindre.
 */
export type FamilleDeChute = "identites" | "ressources";

export interface RefusDeDatation {
  famille: FamilleDeChute;
  observe: number;
  reference: number;
}

/**
 * Un garde-fou qui refuse la même chose, avec les mêmes nombres, passage après
 * passage, ne décrit plus un incident : il décrit un état, et un état que son propre
 * refus entretient. Les données périmées déclenchent le garde-fou, qui empêche de les
 * nettoyer, qui les maintient périmées.
 *
 * Compter les répétitions est ce qui permet de le dire. Sans ce compte, la ligne de
 * journal ressemble à un avertissement passager alors qu'elle annonce un blocage
 * définitif, et un opérateur qui lit le même avertissement tous les jours cesse de le
 * lire.
 */
export function refusRepete(
  refus: RefusDeDatation,
  precedents: readonly (RefusDeDatation | null)[],
): number {
  let repetitions = 1;

  for (const precedent of precedents) {
    if (
      precedent === null ||
      precedent.famille !== refus.famille ||
      precedent.observe !== refus.observe ||
      precedent.reference !== refus.reference
    ) {
      return repetitions;
    }
    repetitions += 1;
  }

  return repetitions;
}

/**
 * En deçà, on ne sait pas encore : une collecte peut échouer deux fois de suite pour
 * une raison qui passera. Au-delà, le doute n'est plus raisonnable, et c'est à
 * l'écran de le dire plutôt qu'à l'opérateur de le déduire d'une ligne de journal
 * qu'il relit chaque matin.
 */
export const REPETITIONS_AVANT_BLOCAGE = 3;

export function chuteInstallee(repetitions: number): boolean {
  return repetitions >= REPETITIONS_AVANT_BLOCAGE;
}

/**
 * Le refus qu'une trace de run porte pour une famille donnée, s'il y en a un.
 *
 * La trace est du JSON libre côté base : la lire ici plutôt que chez chaque appelant
 * évite que l'écran et la collecte ne s'accordent plus sur ce qu'ils y cherchent.
 */
export function refusDeLaTrace(error: unknown, famille: FamilleDeChute): RefusDeDatation | null {
  if (!error || typeof error !== "object" || !("refus" in error)) {
    return null;
  }

  const brut = (error as { refus: unknown }).refus;
  if (!Array.isArray(brut)) {
    return null;
  }

  for (const entree of brut) {
    if (
      entree &&
      typeof entree === "object" &&
      (entree as RefusDeDatation).famille === famille &&
      typeof (entree as RefusDeDatation).observe === "number" &&
      typeof (entree as RefusDeDatation).reference === "number"
    ) {
      return entree as RefusDeDatation;
    }
  }

  return null;
}

export interface TraceDeRun {
  provider: string;
  error: unknown;
}

export interface BlocageInstalle extends RefusDeDatation {
  provider: string;
  repetitions: number;
}

const FAMILLES: readonly FamilleDeChute[] = ["identites", "ressources"];

/**
 * Les garde-fous qui refusent la même chose depuis assez de passages pour qu'on cesse
 * de parler d'incident.
 *
 * L'écran en a besoin parce que le journal seul ne suffit pas : la ligne qui annonce
 * un blocage définitif ressemble mot pour mot à celle qui annonce un incident
 * passager, et c'est ainsi qu'un opérateur finit par ne plus la lire.
 *
 * Les runs arrivent du plus récent au plus ancien, toutes capacités de lecture
 * confondues par fournisseur.
 */
export function blocagesInstalles(runs: readonly TraceDeRun[]): BlocageInstalle[] {
  const parProvider = new Map<string, TraceDeRun[]>();
  for (const run of runs) {
    const liste = parProvider.get(run.provider) ?? [];
    liste.push(run);
    parProvider.set(run.provider, liste);
  }

  const blocages: BlocageInstalle[] = [];

  for (const [provider, liste] of parProvider) {
    for (const famille of FAMILLES) {
      const refus = liste.map((run) => refusDeLaTrace(run.error, famille));
      const dernier = refus[0];
      if (!dernier) {
        continue;
      }

      const repetitions = refusRepete(dernier, refus.slice(1));
      if (chuteInstallee(repetitions)) {
        blocages.push({ ...dernier, provider, repetitions });
      }
    }
  }

  return blocages.sort(
    (a, b) => a.provider.localeCompare(b.provider, "fr") || a.famille.localeCompare(b.famille),
  );
}
