import { autoriseUneRevocation } from "@/core/rapprochement";
import type { MatchMethod } from "@/generated/prisma/enums";

/**
 * Le recollage des deux lectures, en mémoire et sans aucune connaissance de Scalingo.
 *
 * Un contenant est une ressource que l'on désigne, et non une ressource qui se déclare :
 * rien ici ne regarde de quel système vient la ligne, seulement qui est parent de qui.
 * Conséquence assumée, et lisible : un projet qui ne contient rien de ce que la collecte
 * a vu n'est le parent de personne, donc il se range parmi les applications sans accès.
 */

export interface RessourceLue {
  id: string;
  label: string;
  url: string | null;
  parentId: string | null;
  grants: readonly { role: string; lastSeenAt: Date; externalIdentityId: string }[];
}

export interface CompteLu {
  id: string;
  handle: string;
  matchMethod: MatchMethod;
  details: unknown;
  lastSeenAt: Date;
  person: { username: string; fullname: string } | null;
  serviceAccount: { key: string; label: string } | null;
}

/** Pourquoi aucun geste ne part d'une ligne. Nul quand il en part un. */
export type RefusDeGeste = "proprietaire" | "machine" | "isole" | "ressemblance";

export interface PersonneAffichee {
  username: string;
  fullname: string;
}

/** Le compte de service qu'une identité déclarée machine désigne. */
export interface MachineAffichee {
  cle: string;
  libelle: string;
}

export interface Detail {
  libelle: string;
  valeur: string;
}

export interface AccesAffiche {
  cle: string;
  compteId: string;
  handle: string;
  role: string;
  vuLe: Date;
  matchMethod: MatchMethod;
  personne: PersonneAffichee | null;
  /** Non nulle quand l'identité est déclarée machine, auquel cas `personne` est nulle. */
  machine: MachineAffichee | null;
  /**
   * L'invitation dort dans les métadonnées de l'identité et non dans le rôle : un écran
   * qui ne lirait que le rôle présenterait une invitation dormante exactement comme une
   * collaboration acceptée.
   */
  enAttente: boolean;
  /** Le reste de ce que le connecteur a écrit, rendu tel quel et jamais interprété. */
  autresDetails: readonly Detail[];
  refus: RefusDeGeste | null;
}

export interface ApplicationAffichee {
  id: string;
  /** Le nom Scalingo seul, tel qu'un périmètre de geste l'attend. */
  nom: string;
  /** La région, vide quand le libellé ne la porte pas. */
  region: string;
  /** Le libellé tel que la collecte l'a écrit. */
  libelle: string;
  url: string | null;
  acces: readonly AccesAffiche[];
}

export interface GroupeAffiche {
  cle: string;
  /** Nul pour le reste : ce n'est ni une anomalie ni un projet, seulement le reste. */
  projet: string | null;
  applications: readonly ApplicationAffichee[];
}

export interface AccesDuCompte {
  libelle: string;
  role: string;
  vuLe: Date;
}

export interface DetenteurAffiche {
  cle: string;
  handle: string;
  matchMethod: MatchMethod;
  personne: PersonneAffichee | null;
  machine: MachineAffichee | null;
  enAttente: boolean;
  parProjet: readonly { cle: string; projet: string | null; acces: readonly AccesDuCompte[] }[];
}

export interface ParcAffiche {
  groupes: readonly GroupeAffiche[];
  detenteurs: readonly DetenteurAffiche[];
  /**
   * Le plus récent constat de tout ce qui s'affiche, accès comme comptes. Nul quand
   * rien de vivant ne s'affiche, et alors seulement : un parc dont aucun accès ne
   * survit garde ses comptes constatés, et les dater par les seuls accès faisait dire
   * à l'écran que rien n'avait jamais été vu au-dessus d'une liste de comptes vus.
   */
  dernierConstat: Date | null;
}

const ROLE_PROPRIETAIRE = "owner";

/** La marque que la collecte pose sur une collaboration jamais acceptée. */
const MARQUE_INVITATION = "invitation en attente";

const SANS_PROJET = "sans-projet";

/**
 * Ce que le connecteur a écrit, relu sans confiance : la colonne est libre, et une forme
 * écrite par une version antérieure ne doit pas faire tomber l'écran. Tout ce qui n'est
 * pas un couple de deux chaînes est écarté sans bruit.
 */
function metadonnees(details: unknown): Detail[] {
  if (!Array.isArray(details)) {
    return [];
  }

  return details.flatMap((detail) =>
    typeof detail === "object" &&
    detail !== null &&
    typeof (detail as { label?: unknown }).label === "string" &&
    typeof (detail as { value?: unknown }).value === "string"
      ? [
          {
            libelle: (detail as { label: string }).label,
            valeur: (detail as { value: string }).value,
          },
        ]
      : [],
  );
}

/**
 * Baisser un rôle retire ce que la personne pouvait lire, donc coupe une partie de son
 * accès : le filtre des méthodes de rapprochement s'applique tel quel, comme le départ
 * l'applique avant de transmettre le moindre accès à un connecteur.
 */
function refusDuGeste(role: string, compte: CompteLu): RefusDeGeste | null {
  if (role === ROLE_PROPRIETAIRE) {
    return "proprietaire";
  }
  // Avant le compte isolé, et non après : une identité déclarée machine n'a pas de
  // personne non plus, si bien que le refus de l'isolement l'attrapait la première et
  // l'envoyait dans une file dont la clause l'exclut, faute de détenteur nul des deux
  // côtés.
  if (compte.serviceAccount !== null) {
    return "machine";
  }
  if (compte.person === null) {
    return "isole";
  }
  return autoriseUneRevocation(compte.matchMethod) ? null : "ressemblance";
}

function machineAffichee(compte: CompteLu): MachineAffichee | null {
  return compte.serviceAccount === null
    ? null
    : { cle: compte.serviceAccount.key, libelle: compte.serviceAccount.label };
}

export function assemblerLeParc(
  ressources: readonly RessourceLue[],
  comptes: readonly CompteLu[],
): ParcAffiche {
  const contenants = new Set(
    ressources.flatMap((une) => (une.parentId === null ? [] : [une.parentId])),
  );
  const parCompte = new Map(comptes.map((compte) => [compte.id, compte]));
  const parRessource = new Map(ressources.map((une) => [une.id, une]));

  const applications = ressources
    .filter((une) => !contenants.has(une.id))
    .map((une) => {
      const [nom = "", region = ""] = une.label.split(", ");
      return {
        ressource: une,
        affichee: {
          id: une.id,
          nom,
          region,
          libelle: une.label,
          url: une.url,
          acces: une.grants.flatMap((acces): AccesAffiche[] => {
            const compte = parCompte.get(acces.externalIdentityId);
            // Une identité datée disparue est écartée par la lecture elle-même : son
            // accès n'a alors plus de détenteur à nommer.
            if (!compte) {
              return [];
            }
            const details = metadonnees(compte.details);
            return [
              {
                cle: `${une.id}:${compte.id}:${acces.role}`,
                compteId: compte.id,
                handle: compte.handle,
                role: acces.role,
                vuLe: acces.lastSeenAt,
                matchMethod: compte.matchMethod,
                personne: compte.person,
                machine: machineAffichee(compte),
                enAttente: details.some(
                  (detail) => detail.valeur.toLowerCase() === MARQUE_INVITATION,
                ),
                autresDetails: details.filter(
                  (detail) => detail.valeur.toLowerCase() !== MARQUE_INVITATION,
                ),
                refus: refusDuGeste(acces.role, compte),
              },
            ];
          }),
        } satisfies ApplicationAffichee,
      };
    });

  const parGroupe = new Map<
    string,
    { projet: string | null; applications: ApplicationAffichee[] }
  >();
  for (const { ressource, affichee } of applications) {
    const contenant = ressource.parentId === null ? null : parRessource.get(ressource.parentId);
    const cle = contenant ? contenant.id : SANS_PROJET;
    const groupe = parGroupe.get(cle);
    if (groupe) {
      groupe.applications.push(affichee);
    } else {
      parGroupe.set(cle, {
        projet: contenant ? contenant.label : null,
        applications: [affichee],
      });
    }
  }

  // Le reste en dernier : il n'est pas un projet, et l'ouvrir en tête ferait lire une
  // liste d'applications avant le premier mot sur ce qu'un projet regroupe.
  const groupes: GroupeAffiche[] = [...parGroupe.entries()]
    .map(([cle, groupe]) => ({ cle, ...groupe }))
    .sort((a, b) => {
      if (a.projet === null) {
        return b.projet === null ? 0 : 1;
      }
      return b.projet === null ? -1 : a.projet.localeCompare(b.projet);
    });

  const detenteurs = comptes.map((compte): DetenteurAffiche => {
    const details = metadonnees(compte.details);
    const parProjet: { cle: string; projet: string | null; acces: AccesDuCompte[] }[] = [];

    for (const groupe of groupes) {
      const acces = groupe.applications.flatMap((application) =>
        application.acces
          .filter((un) => un.compteId === compte.id)
          .map((un) => ({ libelle: application.libelle, role: un.role, vuLe: un.vuLe })),
      );
      if (acces.length > 0) {
        parProjet.push({ cle: groupe.cle, projet: groupe.projet, acces });
      }
    }

    return {
      cle: compte.id,
      handle: compte.handle,
      matchMethod: compte.matchMethod,
      personne: compte.person,
      machine: machineAffichee(compte),
      enAttente: details.some((detail) => detail.valeur.toLowerCase() === MARQUE_INVITATION),
      parProjet,
    };
  });

  const dates = [
    ...ressources.flatMap((une) => une.grants.map((acces) => acces.lastSeenAt.getTime())),
    ...comptes.map((compte) => compte.lastSeenAt.getTime()),
  ];

  return {
    groupes,
    detenteurs,
    dernierConstat: dates.length === 0 ? null : new Date(Math.max(...dates)),
  };
}
