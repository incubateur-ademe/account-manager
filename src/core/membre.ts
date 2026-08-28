import type { Attachment } from "./appartenance";

/** Voie par laquelle l'espace-membre rattache une personne à un incubateur. */
export type RattachementApi = "startups" | "teams" | "both";

export interface MissionApi {
  end?: string | null;
  startups?: readonly { ghid?: string | null }[] | null;
}

/**
 * Volontairement partiel : on ne déclare que ce qu'on consomme, pour qu'un champ
 * ajouté chez eux ne casse rien ici. Tout le reste du payload est ignoré, dont bio,
 * competences, domaine et legal_status qui n'ont pas à entrer dans ce système.
 */
interface MembreCommun {
  uuid?: string | null;
  username: string;
  fullname?: string | null;
  github?: string | null;
  primary_email?: string | null;
  secondary_email?: string | null;
  communication_email?: string | null;
  missions?: readonly MissionApi[] | null;
}

/**
 * Membre tel que le rend la liste scopée à un incubateur. Ses missions sont déjà
 * restreintes aux startups de cet incubateur, et `attachment` dit par quelle voie il
 * en relève : c'est l'espace-membre qui tranche, plus nous.
 */
export interface MembreIncubateur extends MembreCommun {
  attachment: RattachementApi;
  teams?: readonly string[] | null;
}

/** Fiche complète : ses missions ne sont restreintes à aucun incubateur. */
export type MembreDetaille = MembreCommun;

const PARIS = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Les dates n'ont pas la même origine selon le champ : une fin de mission arrive à
 * minuit UTC, une fin de startup à 23h00 UTC, soit le lendemain à Paris. Tronquer la
 * chaîne décalerait cette seconde d'un jour et couperait un accès la veille du
 * dernier jour travaillé. On repasse donc systématiquement par le fuseau de Paris.
 */
export function jourParis(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : PARIS.format(date);
}

function maxJour(valeurs: readonly (string | null | undefined)[]): string | null {
  let max: string | null = null;
  for (const valeur of valeurs) {
    const jour = jourParis(valeur);
    if (jour === null) {
      return null;
    }
    if (max === null || jour > max) {
      max = jour;
    }
  }
  return max;
}

function finDeMission(missions: readonly MissionApi[] | null | undefined): string | null {
  return maxJour((missions ?? []).map((mission) => mission.end));
}

const ATTACHMENT: Record<RattachementApi, Attachment> = {
  startups: "STARTUPS",
  teams: "DECLARED",
  both: "BOTH",
};

export interface Rattachement {
  attachment: Attachment;
  startups: string[];
  missionEnd: string | null;
}

/**
 * Le même, rendu par une résolution qui a pu ne pas lire la source portant l'échéance.
 *
 * `undefined` dit qu'on n'en sait rien, là où `null` dit qu'il n'y en a pas. Les deux
 * se ressemblent partout ailleurs et n'ont pas le même effet à l'écriture : `null`
 * s'écrit et efface, `undefined` ne s'écrit pas et laisse en base ce qu'y avait mis le
 * dernier passage qui, lui, avait su lire.
 *
 * Deux interfaces plutôt qu'une seule élargie, parce que les deux voies ne sont pas
 * dans le même cas : un rattachement déclaré part d'une fiche qu'on tient déjà en
 * main, et son échéance est toujours connue. Lui prêter une ignorance qu'il ne peut
 * pas avoir la ferait traiter à chacun de ses appelants.
 */
export interface RattachementIncertain extends Omit<Rattachement, "missionEnd"> {
  missionEnd: string | null | undefined;
}

/**
 * L'appartenance à l'incubateur n'est plus déduite ici : elle est résolue par
 * l'espace-membre, qui sait qu'une startup peut relever de plusieurs incubateurs. Ne
 * reste qu'à retenir les startups du périmètre et à dater la fin.
 *
 * `detail` porte les missions non restreintes à l'incubateur. Il est nécessaire dès
 * que le rattachement passe par une équipe : la liste scopée n'associe alors aucune
 * mission à la personne, et c'est sa fin de mission beta.gouv qui fait foi. Son
 * absence sur cette voie n'est donc pas une personne sans mission, c'est une lecture
 * qui a manqué, et l'échéance est alors inconnue plutôt que nulle.
 */
export function rattachementDe(
  membre: MembreIncubateur,
  ghidsIncubateur: ReadonlySet<string>,
  detail?: MembreDetaille | null,
): RattachementIncertain {
  const attachment = ATTACHMENT[membre.attachment];

  const startups = [
    ...new Set(
      (membre.missions ?? []).flatMap((mission) =>
        (mission.startups ?? [])
          .map((startup) => startup.ghid)
          .filter((ghid): ghid is string => typeof ghid === "string" && ghidsIncubateur.has(ghid)),
      ),
    ),
  ].sort();

  // Retomber sur les missions scopées écrirait une date qu'on n'a pas lue : nulle pour
  // qui ne relève que d'une équipe, dont la liste ne porte aucune mission, et celle de
  // la seule voie startup pour qui relève des deux, qui la raccourcit quand la mission
  // beta.gouv va plus loin et en invente une quand la fiche n'en portait aucune. Les
  // deux font proposer un départ trop tôt : ce n'est pas une approximation, c'est une
  // erreur toujours dans le même sens.
  const missionEnd =
    attachment === "STARTUPS"
      ? finDeMission(membre.missions)
      : detail
        ? finDeMission(detail.missions)
        : undefined;

  return { attachment, startups, missionEnd };
}

/**
 * Rattachement d'une personne déclarée transverse dans la politique mais que
 * l'espace-membre ne rattache pas à l'incubateur : la déclaration locale fait
 * autorité sur son appartenance, sa fiche sur son échéance.
 */
export function rattachementDeclare(detail: MembreDetaille): Rattachement {
  return { attachment: "DECLARED", startups: [], missionEnd: finDeMission(detail.missions) };
}

export function emailDeContact(membre: MembreCommun): string | null {
  return membre.communication_email === "secondary"
    ? (membre.secondary_email ?? membre.primary_email ?? null)
    : (membre.primary_email ?? null);
}
