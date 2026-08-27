import type { PersonSource, RiskLevel } from "@/generated/prisma/enums";

import { type Attachment, toutesLesStartupsSontTerminees } from "./appartenance";
import type { SensDossier } from "./dossier";
import {
  echeanceEffective,
  enCours,
  type RattachementManuel,
  startupsEffectives,
} from "./rattachement-startup";
import { jourUTC } from "./statut";

export type ConstatKind =
  | "SCOPE_EXIT"
  | "SCOPE_ENTRY"
  | "INACTIVE_STARTUP"
  | "ORPHAN"
  | "UNREGISTERED"
  | "OVERDUE_MANUAL_ACTION";

export interface Constat {
  kind: ConstatKind;
  dedupKey: string;
  severity: RiskLevel;
  detail: string;
  /** Renseigné quand le constat porte sur quelqu'un du périmètre. */
  username?: string;
  /** Renseigné quand il porte sur un compte observé sur un système cible. */
  identiteId?: string;
}

export interface PersonneConstatable {
  username: string;
  fullname: string;
  attachment: Attachment;
  /** Les startups que la collecte constate, et elles seules : l'union se fait ici. */
  startups: readonly string[];
  rattachementsManuels: readonly RattachementManuel[];
  missionEnd: Date | null;
  vanishedAt: Date | null;
  /** Posée à la création de la fiche, jamais réécrite, retour compris. */
  firstSeenAt: Date;
  /** Datée par la collecte le jour où elle revoit une fiche qu'elle avait vue partir. */
  returnedAt: Date | null;
  source: PersonSource;
  /**
   * Date du dernier plan d'arrivée exécuté, et de celui-là seulement : un plan à
   * moitié exécuté laisse la personne sans une partie de ses accès, un plan annulé,
   * périmé ou en brouillon ne dit rien de plus qu'un dossier ouvert.
   */
  arriveeTraiteeLe: Date | null;
}

/**
 * Une personne peut quitter le référentiel amont sans que ses accès aient été
 * coupés : le cron de beta.gouv retire des équipes ceux dont la mission est finie.
 * C'est le constat le plus important du système, parce qu'il porte sur quelqu'un
 * que plus aucune source ne réclame et que rien d'autre ne signalerait.
 */
function sortieDuPerimetre(personne: PersonneConstatable): Constat | null {
  if (personne.vanishedAt === null) {
    return null;
  }
  return {
    kind: "SCOPE_EXIT",
    username: personne.username,
    dedupKey: `SCOPE_EXIT:${personne.username}`,
    severity: "HIGH",
    detail: `${personne.fullname} a quitté le référentiel de l'incubateur`,
  };
}

/**
 * Le jour où la détection des arrivées est entrée en service. Le produit a été
 * déployé une semaine plus tôt sans rien savoir des arrivées : sans cette borne, sa
 * mise en service constaterait d'un coup tout le périmètre déjà en poste, et une
 * file de quatre-vingt-quinze constats ne se lit pas, elle se ferme.
 *
 * C'est un fait sur l'histoire du code et non un réglage d'exploitation : la reculer
 * ferait réapparaître d'un coup des constats sur des gens en poste depuis des mois.
 * Elle ne se retouche donc jamais après coup. Une arrivée manquée se rattrape par
 * une ouverture manuelle de dossier, une file noyée décrédibilise l'outil.
 */
export const MISE_EN_SERVICE_DES_ARRIVEES = new Date("2026-08-25T00:00:00Z");

/**
 * Ce qu'il faut savoir du périmètre, et non de la personne, pour juger d'une
 * arrivée. Tout le reste de l'éligibilité est une propriété de la personne, d'où un
 * seul champ.
 *
 * Son absence là où elle est attendue est un état à part entière : la collecte n'a
 * pas conclu sur les arrivées, et rien ne doit alors en être déduit, ni levé, ni
 * fermé, ni déverrouillé.
 */
export interface RegleArrivee {
  /** Date au-delà de laquelle une entrée dans le périmètre est une vraie arrivée. */
  amorcage: Date;
}

/**
 * La borne à partir de laquelle on s'autorise à constater une arrivée.
 *
 * Nulle tant qu'aucune collecte n'a vu personne : sans périmètre connu, une première
 * vue ne dit pas que quelqu'un vient d'arriver, elle dit que l'outil vient d'ouvrir
 * les yeux. Sur une instance neuve, c'est la première collecte qui fait la borne et
 * la constante ne protège rien ; sur celle-ci, c'est l'inverse.
 */
export function amorcageDesArrivees(
  premiereCollecte: Date | null,
  miseEnService: Date,
): Date | null {
  if (premiereCollecte === null) {
    return null;
  }
  return premiereCollecte.getTime() > miseEnService.getTime() ? premiereCollecte : miseEnService;
}

/**
 * L'instant depuis lequel la présence de cette personne demande un onboarding.
 *
 * `firstSeenAt` ne bouge pas au retour de quelqu'un. Jugée sur elle seule, une
 * personne revenue resterait inéligible pour toujours, par sa date de première vue,
 * alors que son retour est précisément une arrivée à traiter, avec des accès à
 * rouvrir. Sa réapparition dans le référentiel reprend donc la main : une première
 * arrivée se juge sur la première vue, un retour sur le jour où on l'a revue.
 *
 * Et sur rien d'autre, surtout pas sur la clôture de son dernier départ. Une mission
 * qui s'achève ne fait pas sortir du référentiel amont, dont la liste des membres rend
 * aussi les missions terminées : clore un départ pendant que la fiche est encore là
 * est le chemin normal du produit. Cette clôture lue ici levait donc une arrivée sur
 * chaque personne correctement offboardée, dès le premier départ soldé.
 */
function dateDeReference(personne: PersonneConstatable): Date {
  const retour = personne.returnedAt;
  if (retour !== null && retour.getTime() > personne.firstSeenAt.getTime()) {
    return retour;
  }
  return personne.firstSeenAt;
}

/**
 * Le pendant exact de la sortie du périmètre : quelqu'un est là que personne n'a
 * accueilli. Ses accès ont donc été posés ailleurs, ou pas posés du tout, et dans
 * les deux cas l'outil ignore ce qu'il aura à retirer le jour du départ.
 */
function arriveeSansOnboarding(personne: PersonneConstatable, regle: RegleArrivee): Constat | null {
  // Un compte machine n'arrive pas.
  if (personne.source === "SERVICE") {
    return null;
  }

  const reference = dateDeReference(personne);
  if (reference.getTime() <= regle.amorcage.getTime()) {
    return null;
  }

  // Un onboarding antérieur à la date de référence appartient au séjour d'avant :
  // il n'accueille pas celui-ci.
  const traitee = personne.arriveeTraiteeLe;
  if (traitee !== null && traitee.getTime() > reference.getTime()) {
    return null;
  }

  return {
    kind: "SCOPE_ENTRY",
    username: personne.username,
    dedupKey: `SCOPE_ENTRY:${personne.username}`,
    severity: "MEDIUM",
    detail: `aucun plan d'arrivée n'a été exécuté pour ${personne.fullname} depuis son entrée dans le périmètre`,
  };
}

/**
 * Une startup abandonnée ou transférée ne justifie plus aucun accès. Quelqu'un dont
 * toutes les startups sont dans cet état n'a plus de raison d'en avoir, même si sa
 * mission beta.gouv court encore : il travaille désormais ailleurs.
 */
function startupsToutesTerminees(
  personne: PersonneConstatable,
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
  today: Date,
): Constat | null {
  // Une personne rattachée par équipe garde un titre d'appartenance qui ne dépend
  // d'aucune startup : lui lever ce constat serait un contresens. Les autres sont
  // concernées, y compris celles dont les seules startups viennent d'un
  // rattachement posé à la main.
  if (personne.attachment === "DECLARED" || personne.attachment === "BOTH") {
    return null;
  }

  const effectives = startupsEffectives(personne.startups, personne.rattachementsManuels, today);
  if (effectives.length === 0) {
    return null;
  }

  // Sur une mission déjà terminée, l'échéance dit la même chose et le dit mieux.
  // Lever le constat quand même noierait le seul cas qui compte, celui d'une
  // personne toujours en mission dont plus aucune startup ne vit. L'échéance lue
  // est l'effective : prolonger un accès remet la personne en poste, et c'est
  // exactement la situation que ce constat doit rendre visible.
  const echeance = echeanceEffective(personne.missionEnd, personne.rattachementsManuels, today);
  if (echeance !== null && jourUTC(echeance) < jourUTC(today)) {
    return null;
  }

  // Prédicat partagé avec la dérivation de l'appartenance, garde-fou de phase
  // inconnue compris : décidé deux fois, l'écran et la file finiraient par se
  // contredire sur le même sujet.
  if (!toutesLesStartupsSontTerminees(effectives, phaseParStartup, phasesTerminales)) {
    return null;
  }

  // D'où vient le rattachement change le geste à poser : retirer une décision
  // humaine n'est pas la même chose qu'ouvrir un départ.
  const manuelles = personne.rattachementsManuels
    .filter((rattachement) => enCours(rattachement, today))
    .map((rattachement) => rattachement.startupGhid);

  return {
    kind: "INACTIVE_STARTUP",
    username: personne.username,
    dedupKey: `INACTIVE_STARTUP:${personne.username}`,
    severity: "MEDIUM",
    detail:
      `${personne.fullname} n'est rattaché qu'à des startups terminées : ${effectives.join(", ")}` +
      (manuelles.length > 0 ? ` (dont ${manuelles.join(", ")} par rattachement manuel)` : ""),
  };
}

export function constatsDe(
  personnes: readonly PersonneConstatable[],
  phaseParStartup: ReadonlyMap<string, string | null>,
  phasesTerminales: readonly string[],
  today: Date,
  arrivees: RegleArrivee | null,
): Constat[] {
  const constats: Constat[] = [];

  for (const personne of personnes) {
    const sortie = sortieDuPerimetre(personne);
    if (sortie) {
      constats.push(sortie);
      // Une personne déjà sortie n'a pas besoin d'un second constat sur ses
      // startups : le premier couvre le cas et appelle la même action. Elle n'a pas
      // davantage besoin qu'on lui souhaite la bienvenue.
      continue;
    }

    const arrivee = arrivees === null ? null : arriveeSansOnboarding(personne, arrivees);
    if (arrivee) {
      constats.push(arrivee);
      // Proposer de retirer les accès de quelqu'un dont on n'a même pas acté
      // l'arrivée serait absurde : c'est l'arrivée qu'il faut traiter d'abord.
      continue;
    }

    const terminees = startupsToutesTerminees(personne, phaseParStartup, phasesTerminales, today);
    if (terminees) {
      constats.push(terminees);
    }
  }

  return constats.sort((a, b) => a.dedupKey.localeCompare(b.dedupKey));
}

/**
 * Les types que la collecte sait produire, et donc les seuls qu'elle a le droit de
 * refermer. Un constat d'une autre origine, posé à la main ou par un futur chemin,
 * ne doit pas se faire clore par une réconciliation qui ignore ce qui l'a levé.
 *
 * Une fonction et non une constante, parce que le droit de conclure sur les arrivées
 * se décide à chaque passage. « Ne pas conclure » n'est jamais « produire une liste
 * vide » : un type qui n'est pas calculé doit sortir des trois portes à la fois, la
 * levée, la fermeture des constats ouverts et le réarmement des clôtures manuelles.
 * Oublier l'une des trois ferme un constat à tort ou lève un verrou qu'un opérateur
 * a posé, et les deux pannes sont muettes. La liste est donc lue au même endroit par
 * les trois requêtes, plutôt que tenue par la discipline de qui les relit.
 */
export function typesReconcilies({
  arriveesConcluantes,
}: {
  arriveesConcluantes: boolean;
}): ConstatKind[] {
  const types: ConstatKind[] = [
    "SCOPE_EXIT",
    "INACTIVE_STARTUP",
    "ORPHAN",
    "UNREGISTERED",
    "OVERDUE_MANUAL_ACTION",
  ];

  if (arriveesConcluantes) {
    types.push("SCOPE_ENTRY");
  }

  return types;
}

/**
 * Départage les constats qu'un opérateur a clos, selon que la situation qu'il a
 * jugée dure encore ou non.
 *
 * Ceux dont la situation persiste restent clos : les rouvrir chaque nuit
 * reviendrait à lui resservir un travail qu'il a déjà fait, et c'est ainsi qu'une
 * file cesse d'être lue. Ceux dont la situation a cessé perdent leur verrou, sans
 * quoi un épisode ultérieur ne serait plus jamais signalé, et le silence
 * ressemblerait alors à une absence d'écart.
 */
export function verrousDeCloture<T extends { dedupKey: string }>(
  closParUnHumain: readonly T[],
  constatesMaintenant: ReadonlySet<string>,
): { verrouilles: Set<string>; aRearmer: T[] } {
  const verrouilles = new Set<string>();
  const aRearmer: T[] = [];

  for (const constat of closParUnHumain) {
    if (constatesMaintenant.has(constat.dedupKey)) {
      verrouilles.add(constat.dedupKey);
    } else {
      aRearmer.push(constat);
    }
  }

  return { verrouilles, aRearmer };
}

export interface IdentiteConstatable {
  id: string;
  provider: string;
  handle: string;
  /** Vrai quand le rattachement repose sur une preuve, non sur une ressemblance. */
  rattachementSur: boolean;
  personneUsername: string | null;
  /** La personne rattachée a quitté le référentiel de l'incubateur. */
  personneSortie: boolean;
  /** Rattachée à un compte de service déclaré dans la politique. */
  compteDeService: boolean;
}

/**
 * Les deux constats que la lecture d'un système cible peut lever appellent des
 * gestes opposés, et les confondre coûterait cher dans les deux sens.
 *
 * `ORPHAN` porte sur un compte dont le détenteur a quitté le référentiel : celui-là
 * se coupe. `UNREGISTERED` porte sur un compte que personne ne réclame, et le plus
 * souvent il manque une fiche plutôt qu'il ne faut retirer un accès : le traiter
 * comme un départ reviendrait à couper quelqu'un en poste, précisément parce qu'on
 * ne le connaît pas.
 */
export interface ActionDeclaree {
  /** Ce qui a été déclaré fait, tel que le plan le nommait. */
  label: string;
  systemKey: string;
  username: string;
  /** Le sens du dossier dont l'étape vient : il décide de ce qui contredit la parole. */
  sens: SensDossier;
  declareeLe: Date;
  /**
   * Vrai tant que le dossier dont l'étape vient n'est ni clos ni annulé. Un index
   * unique partiel garantit qu'il n'y en a qu'un vivant par personne et par sens :
   * vivant vaut donc exactement « c'est encore le dossier en cours de ce sens ».
   */
  dossierEncoreVivant: boolean;
  /**
   * Quand la collecte a revu la personne après l'avoir vue disparaître, la même notion
   * que pour son arrivée et la seule qui dise qu'un séjour a recommencé. Nulle pour qui
   * n'a jamais quitté le référentiel.
   */
  retourLe: Date | null;
  /**
   * Quand un mouvement de sens opposé a été exécuté pour cette personne, et donc quand
   * ce que l'étape avait produit a été défait à bon droit. Nul quand il n'y en a aucun.
   */
  inverseeLe: Date | null;
  /** Vrai quand le compte visé est toujours observé sur ce système. */
  compteToujoursLa: boolean;
  /** Dernière lecture complète du système, ou null s'il n'a pas été relu depuis. */
  relueLe: Date | null;
}

/**
 * Ce qu'on devrait observer une fois l'étape faite, et donc ce qui la dément. Un
 * départ se vérifie sur une absence, une arrivée sur une présence : reprendre la
 * règle du départ pour les deux ferait signaler comme un manquement chaque accès
 * effectivement donné.
 */
const DEMENTIE: Record<SensDossier, (compteToujoursLa: boolean) => boolean> = {
  ONBOARDING: (compteToujoursLa) => !compteToujoursLa,
  OFFBOARDING: (compteToujoursLa) => compteToujoursLa,
};

const DETAIL: Record<SensDossier, (label: string, systemKey: string) => string> = {
  ONBOARDING: (label, systemKey) =>
    `« ${label} » a été déclarée faite, mais aucun compte n'est observé sur ${systemKey} à la lecture suivante`,
  OFFBOARDING: (label, systemKey) =>
    `« ${label} » a été déclarée faite, mais le compte est toujours présent sur ${systemKey} à la lecture suivante`,
};

/**
 * Une parole reste opposable tant que ce qu'elle a produit est censé durer, et pas une
 * minute de plus. Un retrait soldé en janvier se fait démentir par le compte que le
 * retour de la personne rouvre en juin, alors qu'il a bien eu lieu : c'est la personne
 * qui est revenue, et sans borne le démenti la suivrait de séjour en séjour.
 *
 * Deux façons de défaire une parole, et une seule de la garder debout.
 *
 * Un mouvement de sens opposé exécuté depuis l'éteint, quoi qu'il arrive par ailleurs :
 * ce qu'elle avait produit a été défait à bon droit, et les deux sens peuvent avoir un
 * dossier vivant en même temps. Sans cette borne, chaque arrivée soldée se ferait
 * démentir par le départ qui la défait, dès le premier départ correctement traité.
 *
 * Le retour de la personne l'éteint aussi, mais seulement quand le dossier dont elle
 * vient est retombé. Un dossier encore vivant est le dernier de son sens, et ce qu'il
 * demande n'a donc pas cessé d'être attendu : c'est là qu'un renouvellement signé en
 * retard, ou une fiche qui saute une collecte et revient, poseraient un retour sans que
 * personne n'ait rien décidé. Éteindre sur cette seule date rendait muet pour toujours
 * le démenti d'un départ toujours en cours, exactement le cas que ce constat existe
 * pour porter.
 *
 * Et le retour, jamais la première vue. `firstSeenAt` ne dit pas qu'un séjour a
 * recommencé, il dit quand la fiche a été créée, et une fiche peut naître après le
 * dossier qu'elle porte : une fusion déplace les dossiers d'une fiche fabriquée vers la
 * vraie, plus jeune qu'eux, et le lire ici faisait taire tout ce que la fiche source
 * avait déclaré.
 */
function encoreOpposable(action: ActionDeclaree): boolean {
  if (action.inverseeLe !== null && action.inverseeLe.getTime() > action.declareeLe.getTime()) {
    return false;
  }
  if (action.dossierEncoreVivant) {
    return true;
  }
  return action.retourLe === null || action.retourLe.getTime() <= action.declareeLe.getTime();
}

/**
 * L'outil n'exécute rien : il enregistre ce qu'un opérateur déclare avoir fait. Sans
 * contrepartie, une case cochée vaudrait donc preuve, alors qu'elle ne vaut que
 * parole, et un accès resté ouvert par oubli passerait pour un accès coupé.
 *
 * C'est la collecte qui tranche, et elle seule. On n'attend pas un délai : on attend
 * d'avoir regardé. Tant que le système n'a pas été relu depuis la déclaration, il n'y
 * a rien à dire ; une fois relu, ce qu'on observe contredit ou non ce qui a été
 * affirmé, dans le sens du dossier.
 */
export function constatsDActionsDeclarees(actions: readonly ActionDeclaree[]): Constat[] {
  const constats: Constat[] = [];

  for (const action of actions) {
    if (!encoreOpposable(action)) {
      continue;
    }
    if (!DEMENTIE[action.sens](action.compteToujoursLa)) {
      continue;
    }
    if (action.relueLe === null || action.relueLe.getTime() <= action.declareeLe.getTime()) {
      continue;
    }

    constats.push({
      kind: "OVERDUE_MANUAL_ACTION",
      dedupKey: `OVERDUE_MANUAL_ACTION:${action.systemKey}:${action.username}`,
      severity: "HIGH",
      detail: DETAIL[action.sens](action.label, action.systemKey),
      username: action.username,
    });
  }

  return constats;
}

export function constatsDIdentites(identites: readonly IdentiteConstatable[]): Constat[] {
  const constats: Constat[] = [];

  for (const identite of identites) {
    // Un compte machine déclaré est à sa place : c'est même à cela que sert la
    // déclaration, ne pas le voir revenir chaque nuit.
    if (identite.compteDeService) {
      continue;
    }

    const ou = `${identite.handle} sur ${identite.provider}`;

    // Une ressemblance ne suffit pas à affirmer qu'une personne partie détient ce
    // compte : ce serait proposer une coupure sur une supposition.
    if (identite.personneUsername !== null) {
      if (identite.personneSortie && identite.rattachementSur) {
        constats.push({
          kind: "ORPHAN",
          dedupKey: `ORPHAN:${identite.provider}:${identite.handle}`,
          severity: "HIGH",
          detail: `${ou} appartient à ${identite.personneUsername}, sortie du référentiel`,
          username: identite.personneUsername,
          identiteId: identite.id,
        });
      }
      continue;
    }

    constats.push({
      kind: "UNREGISTERED",
      dedupKey: `UNREGISTERED:${identite.provider}:${identite.handle}`,
      severity: "MEDIUM",
      detail: `${ou} n'est réclamé par aucune personne suivie ni aucun compte de service`,
      identiteId: identite.id,
    });
  }

  return constats;
}
