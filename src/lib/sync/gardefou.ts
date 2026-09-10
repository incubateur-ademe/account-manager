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
export type BorneDAmpleur = "pas plus profonde que la chute annoncée" | "aucune";

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
 * Sous la borne de l'ampleur, elle ne vaut que pour une chute qui n'est pas plus
 * profonde que celle qu'on a montrée à qui a tranché, et ce sont les nombres portés par
 * la ligne qui le disent : sans cette borne, une décision prise sur quatre départs
 * vérifiés un par un daterait en bloc un effondrement d'une tout autre ampleur survenu
 * depuis. Les relire dans la trace du dernier passage ne donnerait pas la même chose,
 * et c'est la raison d'être de ces colonnes : ce qu'un passage a enregistré n'est pas ce
 * qu'un écran a affiché.
 *
 * Deux mesures, parce que deux ampleurs se sont trouvées disjointes. L'observé dit la
 * taille de la liste rendue ; ce que la datation toucherait dit combien de personnes
 * seraient constatées parties, ce qui est le geste lui-même. L'une ne borne pas l'autre :
 * une nuit dégradée fait naître des fiches sans toucher au relevé, si bien qu'une chute
 * identique à celle annoncée peut en dater bien plus qu'on n'en avait examiné.
 *
 * Une ligne qui ne porte aucun nombre ne se mesure pas, et la borne échoue fermé : elle
 * est écartée plutôt que levée sans mesure, comme l'est une chute trop profonde. Vaut
 * pour les deux mesures, et pour la même raison : un soir dont l'ampleur n'a pas pu être
 * comptée ne se compare à rien. Elle n'est donc tenable que chez un appelant qui périme
 * ce qu'elle écarte.
 */
export async function autorisationEnAttente(
  provider: string,
  chute: RefusDeDatation,
  run: { startedAt: Date },
  borne: BorneDAmpleur,
): Promise<AutorisationPosee | null> {
  const autorisation = await prisma.scopeDropOverride.findFirst({
    where: attente(provider, chute.famille, run),
    orderBy: { createdAt: "asc" },
    select: { reason: true, createdBy: true, observe: true, datables: true },
  });

  if (autorisation === null) {
    return null;
  }

  if (borne === "pas plus profonde que la chute annoncée") {
    if (autorisation.observe === null || chute.observe < autorisation.observe) {
      return null;
    }
    if (
      autorisation.datables === null ||
      chute.datables === undefined ||
      chute.datables > autorisation.datables
    ) {
      return null;
    }
  }

  return { reason: autorisation.reason, createdBy: autorisation.createdBy };
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
      datables: chute.datables,
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
