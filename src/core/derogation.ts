import type { Verdict } from "@/core/dossier";
import { jourMetier } from "@/core/statut";

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

/**
 * Les deux colonnes sous lesquelles la base range une cible.
 *
 * Une composée à la main ailleurs finirait par diverger de celle que la lecture compare,
 * et une tolérance rangée sous une clé que personne ne relit ne couvre rien.
 */
export function colonnesDeCible(cible: Cible): { targetType: string; targetId: string } {
  return {
    targetType: cible.type,
    targetId: cible.type === "identite" ? `${cible.provider}:${cible.externalId}` : cible.username,
  };
}

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
  const jour = jourMetier(instant);
  return derogations.filter((derogation) => {
    if (derogation.poseeLe !== null && derogation.poseeLe.getTime() > instant.getTime()) {
      return false;
    }
    if (derogation.leveeLe !== null && derogation.leveeLe.getTime() <= instant.getTime()) {
      return false;
    }
    return derogation.echeance === null || jourMetier(derogation.echeance) >= jour;
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

/**
 * Le temps maximal qu'une tolérance peut couvrir d'un seul geste.
 *
 * Une échéance est ce qui distingue une tolérance d'un oubli, et une échéance trop lointaine
 * ne la distingue plus de rien : personne ne se souvient d'un écart admis pour cinq ans. Il
 * reste possible d'en poser une autre à l'expiration, ce qui demande de redire pourquoi,
 * et c'est exactement le but.
 */
export const TOLERANCE_MAX_JOURS = 180;

const JOUR = 24 * 60 * 60 * 1000;

/**
 * Le jour qu'une saisie désigne, ou rien quand elle n'en désigne aucun.
 *
 * `new Date` ne refuse pas un 31 février : il rend le 3 mars, si bien qu'une requête
 * directe enregistrerait une échéance que personne n'a demandée. La relecture de ce que la
 * date rend est la seule façon d'attraper ça sans réécrire un calendrier.
 */
export function jourSaisi(valeur: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
    return null;
  }
  const jour = new Date(`${valeur}T00:00:00Z`);
  if (Number.isNaN(jour.getTime()) || jour.toISOString().slice(0, 10) !== valeur) {
    return null;
  }
  return jour;
}

/**
 * Ce qu'une pose exige, et les cinq façons de la refuser.
 *
 * Les refus se nomment un par un plutôt que de rendre un booléen : c'est ce que l'écran
 * affiche, et une phrase générique ferait recommencer le geste à l'aveugle.
 */
export function poseAdmissible(
  demande: { cible: Cible | null; raison: string; echeance: Date },
  dejaCouvertes: ReadonlySet<string>,
  maintenant: Date,
): Verdict {
  if (demande.cible === null) {
    return {
      possible: false,
      raison: "Cet écart ne se tolère pas. Il porte sur ce qui a été déclaré, pas sur un accès.",
    };
  }
  if (demande.raison.trim().length < 3) {
    return { possible: false, raison: "Dites pourquoi cet écart est admis." };
  }

  const jour = jourMetier(maintenant);
  const echeance = jourMetier(demande.echeance);
  if (Number.isNaN(echeance)) {
    return { possible: false, raison: "Cette échéance n'est pas une date." };
  }
  if (echeance < jour) {
    return { possible: false, raison: "Cette échéance est déjà passée." };
  }
  if (echeance > jour + TOLERANCE_MAX_JOURS * JOUR) {
    return {
      possible: false,
      raison: `Une tolérance ne couvre pas plus de ${TOLERANCE_MAX_JOURS} jours. Choisissez une échéance plus proche.`,
    };
  }
  if (dejaCouvertes.has(cleDeCible(demande.cible))) {
    return { possible: false, raison: "Cet écart est déjà toléré." };
  }
  return { possible: true };
}

/**
 * Ce qu'une levée exige.
 *
 * Une tolérance éteinte ne se lève pas : le geste n'aurait rien à couper, et il laisserait
 * au journal la trace d'une décision que personne n'a eu à prendre.
 */
export function leveeAdmissible(derogation: Derogation, maintenant: Date): Verdict {
  if (derogation.provenance === "politique") {
    return {
      possible: false,
      raison: "Cette tolérance est déclarée dans la politique. Elle se retire de son fichier.",
    };
  }
  if (derogation.leveeLe !== null) {
    return { possible: false, raison: "Cette tolérance est déjà levée." };
  }
  if (derogationsEnCours([derogation], maintenant).length === 0) {
    return { possible: false, raison: "Cette tolérance est déjà éteinte." };
  }
  return { possible: true };
}

/** Un compte observé, réduit à ce qui décide d'une couverture. */
export interface CompteCouvrable {
  provider: string;
  externalId: string;
  /** Vrai quand son rattachement autorise une révocation. */
  revocable: boolean;
}

/**
 * Les systèmes qu'une tolérance retire entièrement du calcul d'un plan.
 *
 * Tout ou rien, et c'est la seule règle sûre : une étape de révocation coupe la personne
 * sur tout un système d'un seul geste, si bien qu'un seul compte couvert ne retire rien.
 * La retirer épargnerait les comptes que personne n'a admis en même temps que celui qu'on
 * a admis.
 *
 * Les comptes non révocables ne pèsent d'aucun côté. Ils ne produisent aucune étape, donc
 * les couvrir ne retire rien, et ne pas les couvrir ne retient rien : la règle qui interdit
 * de couper sur une ressemblance est tenue ailleurs, et la recopier ici lui donnerait un
 * second exemplaire à maintenir.
 *
 * Une cible de personne ne retire jamais aucune étape, et c'est la comparaison sur la clé
 * entière qui le tient : « personne:untel » ne vaut jamais « identite:github:1042 ». Les
 * écarter d'abord serait un filtre qui a l'air de porter la garantie sans rien porter.
 * Couvrir quelqu'un fait taire ce qu'on signale à son sujet, ça ne décide pas de ce qu'on
 * lui coupe.
 */
/**
 * Ce qui couvre chaque cible, et jusqu'où.
 *
 * Une cible visée par plusieurs tolérances est couverte jusqu'à la plus lointaine des
 * leurs, puisqu'il suffit qu'une seule coure, et une permanente ne s'éteint jamais. Sans
 * ce départage, l'ordre de lecture déciderait : le cas n'a rien d'une course, une
 * permanente déclarée en git sur un compte déjà toléré en base suffit à le produire.
 *
 * Dit une fois et ici, parce que deux endroits qui départagent chacun de leur côté finissent
 * par citer deux échéances différentes du même compte, sur deux écrans voisins.
 */
export function couvertureParCible(
  derogations: readonly Derogation[],
): ReadonlyMap<string, Derogation> {
  const parCible = new Map<string, Derogation>();
  for (const derogation of derogations) {
    const cle = cleDeCible(derogation.cible);
    const deja = parCible.get(cle);
    if (deja === undefined || couvrePlusLoin(derogation, deja)) {
      parCible.set(cle, derogation);
    }
  }
  return parCible;
}

function couvrePlusLoin(candidate: Derogation, tenante: Derogation): boolean {
  if (candidate.echeance === null) {
    return true;
  }
  if (tenante.echeance === null) {
    return false;
  }
  return candidate.echeance.getTime() > tenante.echeance.getTime();
}

export function systemesEntierementToleres(
  comptes: readonly CompteCouvrable[],
  derogations: readonly Derogation[],
): ReadonlyMap<string, Derogation> {
  const parCible = couvertureParCible(derogations);

  const parSysteme = new Map<string, { revocables: number; couvrantes: Derogation[] }>();
  for (const compte of comptes) {
    if (!compte.revocable) {
      continue;
    }
    const etat = parSysteme.get(compte.provider) ?? { revocables: 0, couvrantes: [] };
    etat.revocables += 1;
    const couvrante = parCible.get(
      cleDeCible({ type: "identite", provider: compte.provider, externalId: compte.externalId }),
    );
    if (couvrante) {
      etat.couvrantes.push(couvrante);
    }
    parSysteme.set(compte.provider, etat);
  }

  const retenue = new Map<string, Derogation>();
  for (const [provider, etat] of parSysteme) {
    if (etat.couvrantes.length !== etat.revocables) {
      continue;
    }
    // Celle qui s'éteindra la première, parce que c'est elle qui décidera du retour de
    // l'étape : citer une autre ferait attendre un jour où rien n'arriverait. Une
    // permanente ne s'éteint jamais, et ne l'emporte donc que faute de mieux.
    const premiere = etat.couvrantes.reduce((tot, candidate) => {
      if (tot.echeance === null) {
        return candidate;
      }
      if (candidate.echeance === null) {
        return tot;
      }
      return candidate.echeance.getTime() < tot.echeance.getTime() ? candidate : tot;
    });
    retenue.set(provider, premiere);
  }
  return retenue;
}
