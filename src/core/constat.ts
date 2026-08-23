import type { RiskLevel } from "@/generated/prisma/enums";

import { type Attachment, toutesLesStartupsSontTerminees } from "./appartenance";
import {
  echeanceEffective,
  enCours,
  type RattachementManuel,
  startupsEffectives,
} from "./rattachement-startup";
import { jourUTC } from "./statut";

export type ConstatKind =
  | "SCOPE_EXIT"
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
): Constat[] {
  const constats: Constat[] = [];

  for (const personne of personnes) {
    const sortie = sortieDuPerimetre(personne);
    if (sortie) {
      constats.push(sortie);
      // Une personne déjà sortie n'a pas besoin d'un second constat sur ses
      // startups : le premier couvre le cas et appelle la même action.
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
  declareeLe: Date;
  /** Vrai quand le compte visé est toujours observé sur ce système. */
  compteToujoursLa: boolean;
  /** Dernière lecture complète du système, ou null s'il n'a pas été relu depuis. */
  relueLe: Date | null;
}

/**
 * L'outil n'exécute rien : il enregistre ce qu'un opérateur déclare avoir fait. Sans
 * contrepartie, une case cochée vaudrait donc preuve, alors qu'elle ne vaut que
 * parole, et un accès resté ouvert par oubli passerait pour un accès coupé.
 *
 * C'est la collecte qui tranche, et elle seule. On n'attend pas un délai : on attend
 * d'avoir regardé. Tant que le système n'a pas été relu depuis la déclaration, il n'y
 * a rien à dire ; une fois relu, un compte toujours là contredit ce qui a été affirmé.
 */
export function constatsDActionsDeclarees(actions: readonly ActionDeclaree[]): Constat[] {
  const constats: Constat[] = [];

  for (const action of actions) {
    if (!action.compteToujoursLa) {
      continue;
    }
    if (action.relueLe === null || action.relueLe.getTime() <= action.declareeLe.getTime()) {
      continue;
    }

    constats.push({
      kind: "OVERDUE_MANUAL_ACTION",
      dedupKey: `OVERDUE_MANUAL_ACTION:${action.systemKey}:${action.username}`,
      severity: "HIGH",
      detail: `« ${action.label} » a été déclarée faite, mais le compte est toujours présent sur ${action.systemKey} à la lecture suivante`,
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
