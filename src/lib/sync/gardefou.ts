/**
 * Ce qu'un garde-fou de chute dit de son refus, et la sortie qu'un opérateur peut lui
 * ouvrir.
 *
 * Partagé entre la collecte des systèmes cibles et celle du périmètre parce qu'ils ont
 * le même verrou : les deux comparent ce qu'ils viennent de lire à ce qu'ils tenaient
 * pour acquis, les deux refusent de conclure quand l'écart est trop grand, et les deux
 * entretiennent alors ce qu'ils refusent. Deux sorties séparées finiraient par ne plus
 * se ressembler, alors que c'est la même décision, prise au même endroit, par la même
 * personne, et journalisée sous son nom.
 */

import {
  chuteInstallee,
  type FamilleDeChute,
  type RefusDeDatation,
  refusDeLaTrace,
  refusRepete,
} from "@/core/collecte";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

/** Combien de passages en arrière on regarde pour dire qu'un refus s'est installé. */
export const PASSAGES_RELUS = 8;

/**
 * Ce qu'une chute a fait perdre, dans les termes de sa famille.
 *
 * Une table plutôt qu'une suite de conditions, et c'est le seul point de cette
 * mécanique qui se tromperait sans bruit : une famille de plus qu'on oublierait ici ne
 * tomberait pas sous la phrase d'une voisine en annonçant les mauvais nombres, elle ne
 * compilerait pas.
 */
const QUOI: Record<FamilleDeChute, (chute: RefusDeDatation) => string> = {
  identites: (chute) =>
    `chute de la collecte : ${chute.observe} éléments contre ${chute.reference} tenus pour vivants`,
  ressources: (chute) =>
    `chute des ressources : ${chute.observe} contre ${chute.reference} connues`,
  perimetre: (chute) =>
    `chute du périmètre : ${chute.observe} personnes contre ${chute.reference} au dernier relevé complet`,
};

/** Les traces des derniers passages de ce fournisseur, du plus récent au plus ancien. */
function passagesRelus(provider: string, runCourant: string): Promise<{ error: unknown }[]> {
  return prisma.syncRun.findMany({
    where: { provider, capability: "list", id: { not: runCourant } },
    orderBy: { startedAt: "desc" },
    take: PASSAGES_RELUS,
    select: { error: true },
  });
}

/**
 * Le dernier refus que ce fournisseur ait enregistré pour cette famille dans la fenêtre
 * relue, c'est-à-dire celui que l'écran montrait à qui a décidé, ou rien si la fenêtre
 * n'en porte aucun.
 *
 * Rien en base ne dit sur quelle chute une autorisation a été posée, et c'est cette
 * lecture qui en tient lieu. Elle ne le fait qu'à moitié, et mieux vaut le savoir que le
 * déduire : elle retrouve ce qu'un passage a enregistré, pas ce qu'un écran a affiché. Le
 * formulaire ne poste aucun nombre et la page ne se rafraîchit pas, si bien qu'une
 * décision prise depuis un onglet de la veille porte sur une chute que le passage du soir
 * a pu creuser depuis.
 *
 * Ce qu'elle couvre est l'intervalle entre la pose et la dépense, où seuls des passages
 * dégradés peuvent s'intercaler sans rien résoudre : au-delà de la fenêtre, ils emportent
 * le refus montré hors de portée, et l'absence de mesure écarte la décision au lieu de la
 * laisser lever. Un passage peut aussi consulter le garde-fou et ne rien résoudre, en
 * levant sur une écriture plus loin ; il n'atteint alors pas sa clôture, sa trace reste
 * vide, et il ne peut donc pas substituer un autre refus à celui qu'on a montré.
 */
async function refusMontre(
  provider: string,
  famille: FamilleDeChute,
  runCourant: string,
): Promise<RefusDeDatation | null> {
  for (const passage of await passagesRelus(provider, runCourant)) {
    const refus = refusDeLaTrace(passage.error, famille);
    if (refus !== null) {
      return refus;
    }
  }

  return null;
}

/**
 * Le message dit ce qui a été refusé, et depuis combien de passages il l'est à
 * l'identique. La différence n'est pas cosmétique : un avertissement qui retombe
 * chaque nuit avec les mêmes nombres cesse d'être lu, alors qu'il annonce que plus
 * aucune disparition ne sera jamais datée pour ce système.
 */
export async function messageDeChute(
  provider: string,
  runCourant: string,
  chute: RefusDeDatation,
  leve: boolean,
): Promise<string> {
  const quoi = QUOI[chute.famille](chute);

  if (leve) {
    return `${quoi}, datation autorisée à la main pour ce passage`;
  }

  const repetitions = refusRepete(
    chute,
    (await passagesRelus(provider, runCourant)).map((run) =>
      refusDeLaTrace(run.error, chute.famille),
    ),
  );

  if (!chuteInstallee(repetitions)) {
    return `${quoi}, aucune disparition datée`;
  }

  return `${quoi}, aucune disparition datée : ce refus retombe à l'identique depuis ${repetitions} passages, il ne se dénouera pas seul`;
}

/** Une autorisation posée à la main, et ce qu'il faut d'elle pour la journaliser. */
export interface AutorisationPosee {
  reason: string;
  createdBy: string;
}

/**
 * Jusqu'où une décision déjà posée vaut encore, quand l'état a bougé entre le moment
 * où on l'a prise et le passage qui la ramasse.
 *
 * Se dit à chaque appel, sans valeur par défaut, parce que la réponse dépend de ce que
 * l'appelant fait d'une décision qu'il n'a pas levée. Écarter une décision ne rend la
 * main que si elle est périmée dans la foulée : là où rien ne la périme, elle reste en
 * attente, l'écran refuse d'en poser une seconde tant qu'elle attend, et la borne
 * enferme celle qui décide au lieu de la protéger. Un appelant de plus doit donc
 * choisir, et ne peut pas hériter du choix d'un voisin.
 */
export type BorneDAmpleur = "pas plus profonde que le refus montré" | "aucune";

/**
 * Ce qu'une autorisation doit être pour valoir pour ce passage.
 *
 * Posée avant que ce passage ne commence, sinon elle vaut pour le suivant : l'écran
 * promet d'autoriser la prochaine collecte, et un opérateur qui clique pendant qu'une
 * collecte tourne décide sur un état que cette collecte a déjà cessé de lire.
 */
function attente(provider: string, famille: FamilleDeChute, run: { startedAt: Date }) {
  return { provider, famille, consumedAt: null, createdAt: { lt: run.startedAt } };
}

/**
 * L'autorisation qui vaut pour ce passage et pour cette chute, sans encore la dépenser.
 *
 * Lue sans être consommée parce que le dépenser est la dernière écriture d'un passage
 * qui date : consommée avant, une panne en base entre les deux la brûlerait sans rien
 * dater et ferait écrire au journal qu'on a autorisé ce qui n'a pas eu lieu.
 *
 * Sous la borne de l'ampleur montrée, elle ne vaut que pour une chute qui n'est pas
 * plus profonde que celle qui a été affichée. Rien en base ne dit sur quels nombres un
 * opérateur a décidé, et sans cette borne une décision prise sur quatre départs
 * vérifiés un par un daterait en bloc un effondrement d'une tout autre ampleur survenu
 * depuis. La borne échoue donc fermé : quand le refus montré n'est plus dans la fenêtre
 * relue, l'ampleur affichée n'est plus retrouvable nulle part, et une décision qu'on ne
 * peut plus mesurer est écartée plutôt que levée sans mesure. Élargir la fenêtre ne
 * ferait que déplacer la frontière, tout motif de nuits dégradées plus long la défaisant
 * de nouveau. Elle n'est tenable que chez un appelant qui périme ce qu'elle écarte.
 */
export async function autorisationEnAttente(
  provider: string,
  chute: RefusDeDatation,
  run: { id: string; startedAt: Date },
  borne: BorneDAmpleur,
): Promise<AutorisationPosee | null> {
  if (borne === "pas plus profonde que le refus montré") {
    const montre = await refusMontre(provider, chute.famille, run.id);
    if (montre === null || chute.observe < montre.observe) {
      return null;
    }
  }

  return prisma.scopeDropOverride.findFirst({
    where: attente(provider, chute.famille, run),
    orderBy: { createdAt: "asc" },
    select: { reason: true, createdBy: true },
  });
}

/**
 * Dépense l'autorisation qui a permis à ce passage de dater, et le journalise.
 *
 * Consommée, donc valable une fois : une autorisation qui durerait éteindrait le
 * garde-fou au lieu de le lever pour un passage. La trace suit l'écriture plutôt que
 * de la précéder, comme le reste de la collecte : la décision, elle, a déjà été
 * journalisée nominativement au moment où un opérateur l'a posée.
 */
export async function consommerAutorisation(
  provider: string,
  chute: RefusDeDatation,
  run: { id: string; startedAt: Date },
  autorisation: AutorisationPosee,
): Promise<boolean> {
  // Toutes celles qui attendent, et pas seulement la première : rien en base n'empêche
  // deux créations concurrentes pour le même couple, et en laisser une derrière
  // lèverait le garde-fou une seconde fois au passage d'après. Conditionné sur
  // `consumedAt` encore nul pour que deux collectes concurrentes ne se les partagent
  // pas.
  const pris = await prisma.scopeDropOverride.updateMany({
    where: attente(provider, chute.famille, run),
    data: { consumedAt: new Date(), consumedRunId: run.id },
  });

  if (pris.count === 0) {
    return false;
  }

  audit({
    actorKind: "SYSTEM",
    action: "sync.gardefou.leve",
    targetType: "system",
    targetId: provider,
    after: {
      famille: chute.famille,
      observe: chute.observe,
      reference: chute.reference,
      raison: autorisation.reason,
      autorisePar: autorisation.createdBy,
    },
    result: "SUCCESS",
  });

  return true;
}

/**
 * Le plancher est-il levé pour ce passage ? Lit la décision et la dépense si elle vaut
 * pour la chute du jour.
 *
 * Pour qui date dans la même foulée, rien de faillible ne s'intercalant alors entre la
 * dépense et la datation. Le périmètre, lui, doit résoudre ce qu'il retient avant de
 * dater : il dépense en deux temps, par `autorisationEnAttente` puis
 * `consommerAutorisation`, avec la datation entre les deux.
 *
 * Ne périme rien, et c'est à l'appelant de le faire : cette fonction sert deux
 * collectes dont une seule a besoin de la péremption aujourd'hui, et l'ajouter ici la
 * poserait pour l'autre sans qu'aucun scénario ne dise ce qu'elle y change. La borne
 * d'ampleur se dit pour la même raison, et c'est la même règle : ne rien périmer et
 * borner l'ampleur sont incompatibles, la décision écartée restant alors en attente
 * pour toujours.
 */
export async function plancherLeve(
  provider: string,
  chute: RefusDeDatation | null,
  run: { id: string; startedAt: Date },
  borne: BorneDAmpleur,
): Promise<boolean> {
  if (chute === null) {
    return false;
  }

  const autorisation = await autorisationEnAttente(provider, chute, run, borne);
  if (autorisation === null) {
    return false;
  }

  return consommerAutorisation(provider, chute, run, autorisation);
}

/**
 * Écarte une autorisation que ce passage n'a pas pu lever, l'état sur lequel elle a été
 * posée n'étant plus celui du jour.
 *
 * Une autorisation sans péremption ne dort pas, elle attend : un passage complet qui ne
 * trouve plus rien à refuser laisse la décision intacte, et le premier effondrement
 * venu, des semaines plus tard et pour de tout autres nombres, la trouve encore en
 * attente et date en bloc des départs que personne n'a examinés. Elle interdit du même
 * coup toute décision ultérieure sur ce garde-fou, l'écran refusant d'en poser une
 * seconde tant que la première attend.
 *
 * À n'appeler que sous un passage qui a consulté le garde-fou : un passage dégradé n'a
 * rien constaté de l'état auquel la décision se rapporte, et la périmer là-dessus
 * ferait perdre une décision que le passage suivant aurait honorée.
 */
export async function perimerAutorisation(
  provider: string,
  famille: FamilleDeChute,
  run: { id: string; startedAt: Date },
): Promise<void> {
  const attendues = attente(provider, famille, run);

  const autorisation = await prisma.scopeDropOverride.findFirst({
    where: attendues,
    orderBy: { createdAt: "asc" },
    select: { reason: true, createdBy: true },
  });

  if (!autorisation) {
    return;
  }

  const perimees = await prisma.scopeDropOverride.updateMany({
    where: attendues,
    data: { consumedAt: new Date(), consumedRunId: run.id },
  });

  if (perimees.count === 0) {
    return;
  }

  audit({
    actorKind: "SYSTEM",
    action: "sync.gardefou.perime",
    targetType: "system",
    targetId: provider,
    after: {
      famille,
      raison: autorisation.reason,
      autorisePar: autorisation.createdBy,
    },
    result: "SUCCESS",
  });
}
