import { jourUTC } from "@/core/statut";

/**
 * Ce qu'une dérogation vise, et la seule forme sous laquelle elle le vise.
 *
 * Un compte se désigne par son `externalId` et jamais par son handle. Un handle meurt au
 * renommage, ce qui serait visible, mais il fait pire : il se recycle. Un fournisseur qui
 * libère un login abandonné le rend à quelqu'un d'autre, et une tolérance posée dessus
 * couvrirait alors un compte que personne n'a jamais admis, sans que rien ne le dise.
 * L'`externalId` ferme cette panne muette, et c'est la clé que la base tient déjà.
 *
 * Le prix est assumé : cet identifiant ne se devine pas, il se relève à la première
 * collecte, exactement comme celui d'un compte de service dans la politique.
 */
export type Cible =
  | { type: "identite"; provider: string; externalId: string }
  | { type: "personne"; username: string };

/** D'où vient une tolérance, ce qui décide de ce qu'on peut en faire. */
export type Provenance = "base" | "politique";

/**
 * Une tolérance, quelle que soit sa source.
 *
 * `echeance` et `poseeLe` sont nulles pour une permanente : déclarée en git, elle ne
 * s'éteint pas d'elle-même et n'a pas d'instant de naissance à comparer. Les deux dates
 * qui peuvent l'être le sont, parce que juger une tolérance à un instant passé est ce que
 * l'exécution d'un plan confirmé demandera.
 */
export interface Derogation {
  id: string;
  cible: Cible;
  raison: string;
  responsable: string;
  provenance: Provenance;
  poseeLe: Date | null;
  echeance: Date | null;
  leveeLe: Date | null;
}

/**
 * Ce qu'un constat fermé par une tolérance porte comme raison.
 *
 * Distincte de celle d'un constat qui cesse de se vérifier : les deux ferment, mais l'une
 * dit que la situation a changé et l'autre qu'elle dure et qu'on l'admet. Les confondre
 * ferait lire un écart admis comme un écart résolu.
 */
export const RAISON_COUVERT = "toléré par une dérogation en cours";

export function cleDeCible(cible: Cible): string {
  return cible.type === "identite"
    ? `identite:${cible.provider}:${cible.externalId}`
    : `personne:${cible.username}`;
}

/**
 * La cible que porte une clé, ou rien si la clé n'en décrit aucune.
 *
 * Le découpage s'arrête au premier deux-points de chaque segment et jamais au dernier : un
 * `externalId` GitHub peut valoir `email:quelquun@exemple.fr`, si bien qu'une lecture qui
 * découperait partout rendrait un fournisseur et un identifiant faux plutôt qu'un refus.
 *
 * Rendre `null` plutôt que lever est ce qui permet à une entrée de politique illisible
 * d'être écartée et signalée sans arrêter une collecte : une tolérance qu'on ne comprend
 * pas ne couvre rien, elle ne casse rien non plus.
 */
export function lireCible(cle: string): Cible | null {
  const coupe = cle.indexOf(":");
  if (coupe <= 0) {
    return null;
  }
  const type = cle.slice(0, coupe);
  const reste = cle.slice(coupe + 1);
  if (reste.length === 0) {
    return null;
  }
  if (type === "personne") {
    return reste.includes(":") ? null : { type: "personne", username: reste };
  }
  if (type !== "identite") {
    return null;
  }
  const separateur = reste.indexOf(":");
  if (separateur <= 0 || separateur === reste.length - 1) {
    return null;
  }
  return {
    type: "identite",
    provider: reste.slice(0, separateur),
    externalId: reste.slice(separateur + 1),
  };
}

/**
 * Celles qui couvrent à l'instant demandé, les autres étant écartées sans être perdues.
 *
 * L'instant est un paramètre et non `maintenant` lu ici, parce qu'un plan confirmé se
 * rejuge à l'instant de sa confirmation : une tolérance posée ou levée depuis ne doit pas
 * déplacer ce qu'on a approuvé.
 *
 * L'échéance est le dernier jour couvert, en entier. La comparer en instants ferait
 * expirer une tolérance à minuit UTC, donc en pleine journée de travail pour une partie du
 * monde, et personne n'écrit une date en pensant « jusqu'à cette nuit ».
 */
export function derogationsEnCours(
  derogations: readonly Derogation[],
  instant: Date,
): readonly Derogation[] {
  const jour = jourUTC(instant);
  return derogations.filter((derogation) => {
    if (derogation.poseeLe !== null && derogation.poseeLe.getTime() > instant.getTime()) {
      return false;
    }
    if (derogation.leveeLe !== null && derogation.leveeLe.getTime() <= instant.getTime()) {
      return false;
    }
    return derogation.echeance === null || jourUTC(derogation.echeance) >= jour;
  });
}

/** Un constat couvert, et par quoi : la tolérance se cite là où elle agit. */
export interface ConstatCouvert<T> {
  constat: T;
  par: Derogation;
}

/**
 * Le partage d'une liste de constats entre ce qui remonte et ce qui se tait.
 *
 * Un constat sans cible n'est jamais couvert, et ce n'est pas un trou à combler : la
 * contradiction d'une action déclarée porte sur ce qu'un humain a affirmé, pas sur un
 * compte ni sur quelqu'un, et rien ne saurait la viser sans mentir sur ce qu'elle dit.
 *
 * L'appariement se fait sur la clé entière, si bien qu'une tolérance de personne ne tait
 * aucun constat de ses comptes et réciproquement. C'est voulu : couvrir quelqu'un n'est
 * pas couvrir tout ce qu'il détient, et l'inverse le serait encore moins.
 */
export function couvertureDesConstats<T extends { cible: Cible | null }>(
  constats: readonly T[],
  derogations: readonly Derogation[],
): { retenus: readonly T[]; couverts: readonly ConstatCouvert<T>[] } {
  const parCle = new Map<string, Derogation>();
  for (const derogation of derogations) {
    const cle = cleDeCible(derogation.cible);
    if (!parCle.has(cle)) {
      parCle.set(cle, derogation);
    }
  }

  const retenus: T[] = [];
  const couverts: ConstatCouvert<T>[] = [];
  for (const constat of constats) {
    const couvrante = constat.cible === null ? undefined : parCle.get(cleDeCible(constat.cible));
    if (couvrante === undefined) {
      retenus.push(constat);
    } else {
      couverts.push({ constat, par: couvrante });
    }
  }
  return { retenus, couverts };
}
