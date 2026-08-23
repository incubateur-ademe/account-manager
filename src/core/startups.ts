import type { Attachment } from "@/generated/prisma/enums";

import { estPhaseTerminale } from "./appartenance";
import {
  echeanceEffective,
  enCours,
  type RattachementManuel,
  startupsEffectives,
} from "./rattachement-startup";
import { jourUTC, type Statut, type StatutOptions, statutDePersonne } from "./statut";

export type VueStartups = "actives" | "terminales" | "sorties" | "tout";

export const VUES_STARTUPS: readonly { valeur: VueStartups; libelle: string }[] = [
  { valeur: "actives", libelle: "Actives" },
  { valeur: "terminales", libelle: "En phase terminale" },
  { valeur: "sorties", libelle: "Sorties de l'incubateur" },
  { valeur: "tout", libelle: "Tout" },
];

export function estVueStartups(valeur: string | undefined): valeur is VueStartups {
  return VUES_STARTUPS.some((vue) => vue.valeur === valeur);
}

/** Ce qu'une ligne `Startup` porte de constaté, sans rien de dérivé. */
export interface StartupObservee {
  ghid: string;
  name: string;
  currentPhase: string | null;
  phaseStart: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  vanishedAt: Date | null;
}

export interface PersonneRattachable {
  username: string;
  fullname: string;
  missionEnd: Date | null;
  vanishedAt: Date | null;
  attachment: Attachment;
  startups: readonly string[];
  rattachementsManuels: readonly RattachementManuel[];
}

export interface LigneIndexStartup extends StartupObservee {
  terminale: boolean;
  phaseConnue: boolean;
  /**
   * Plus rendue par la liste de l'incubateur, ce qui ne dit pas qu'elle est finie :
   * une co-incubation retirée, un ghid renommé et un abandon donnent le même
   * symptôme, d'où un drapeau distinct de `terminale`.
   */
  sortie: boolean;
  membres: number;
  membresSortis: number;
}

/**
 * Les membres se comptent sur les startups effectives, collecte et rattachements
 * manuels en cours confondus : compter `Person.startups` seul ferait disparaître du
 * compteur quelqu'un qu'un opérateur vient de rattacher à la main.
 *
 * Une personne sortie du référentiel compte comme membre, et se compte une seconde
 * fois dans `membresSortis` : c'est sur elle que des accès survivent, la retirer de
 * l'écran la perdrait de vue au moment où elle compte le plus.
 */
export function assemblerIndex(
  startups: readonly StartupObservee[],
  personnes: readonly PersonneRattachable[],
  phasesTerminales: readonly string[],
  aujourdHui: Date,
): { lignes: LigneIndexStartup[]; ghidsInconnus: { ghid: string; membres: number }[] } {
  const terminales = new Set(phasesTerminales);

  const comptes = new Map<string, { membres: number; membresSortis: number }>();
  for (const personne of personnes) {
    const effectives = startupsEffectives(
      personne.startups,
      personne.rattachementsManuels,
      aujourdHui,
    );
    for (const ghid of effectives) {
      const compte = comptes.get(ghid) ?? { membres: 0, membresSortis: 0 };
      compte.membres += 1;
      if (personne.vanishedAt !== null) {
        compte.membresSortis += 1;
      }
      comptes.set(ghid, compte);
    }
  }

  const lignes = startups
    .map((startup) => {
      const compte = comptes.get(startup.ghid);
      return {
        ...startup,
        terminale: estPhaseTerminale(startup.currentPhase, terminales),
        phaseConnue: startup.currentPhase !== null,
        sortie: startup.vanishedAt !== null,
        membres: compte?.membres ?? 0,
        membresSortis: compte?.membresSortis ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr") || a.ghid.localeCompare(b.ghid, "fr"));

  // Un ghid porté par quelqu'un mais absent du référentiel n'a aucune ligne où se
  // dire : sans cette sortie il serait invisible de l'index, donc invisible.
  const observes = new Set(startups.map((startup) => startup.ghid));
  const ghidsInconnus = [...comptes]
    .filter(([ghid]) => !observes.has(ghid))
    .map(([ghid, compte]) => ({ ghid, membres: compte.membres }))
    .sort((a, b) => a.ghid.localeCompare(b.ghid, "fr"));

  return { lignes, ghidsInconnus };
}

/**
 * Les vues `terminales` et `sorties` sont disjointes, et une phase inconnue reste
 * dans `actives` : la ranger dans les terminées faute d'information reviendrait à
 * conclure sur une supposition.
 */
export function filtrerStartups(
  lignes: readonly LigneIndexStartup[],
  vue: VueStartups,
  recherche: string,
): LigneIndexStartup[] {
  const terme = recherche.trim().toLowerCase();

  return lignes.filter((ligne) => {
    if (terme.length > 0) {
      const cible = `${ligne.name} ${ligne.ghid}`.toLowerCase();
      if (!cible.includes(terme)) {
        return false;
      }
    }

    if (vue === "tout") {
      return true;
    }
    if (vue === "sorties") {
      return ligne.sortie;
    }
    if (vue === "terminales") {
      return !ligne.sortie && ligne.terminale;
    }
    return !ligne.sortie && !ligne.terminale;
  });
}

/**
 * Les deux derniers compteurs ne comptent que le peuplé. Une startup terminée sans
 * personne dessus est un fait d'archive et non un travail à faire : la compter
 * gonflerait le compteur jusqu'à le rendre ignorable.
 */
export function compteurs(lignes: readonly LigneIndexStartup[]): {
  actives: number;
  terminalesPeuplees: number;
  sortiesPeuplees: number;
} {
  let actives = 0;
  let terminalesPeuplees = 0;
  let sortiesPeuplees = 0;

  for (const ligne of lignes) {
    if (ligne.sortie) {
      if (ligne.membres > 0) {
        sortiesPeuplees += 1;
      }
      continue;
    }
    if (ligne.terminale) {
      if (ligne.membres > 0) {
        terminalesPeuplees += 1;
      }
      continue;
    }
    actives += 1;
  }

  return { actives, terminalesPeuplees, sortiesPeuplees };
}

export type OrigineRattachement = "collecte" | "manuel" | "les-deux";

export interface MembreDeStartup {
  username: string;
  fullname: string;
  origine: OrigineRattachement;
  manuel: RattachementManuel | null;
  echeance: Date | null;
  /**
   * Rattachée à l'incubateur par une équipe transverse. Ne rien conclure de plus :
   * `BOTH` l'est en même temps que par ses startups, et figure donc bien dans
   * `Person.startups`. Seul `DECLARED` en est absent.
   */
  parEquipe: boolean;
  statut: Statut;
}

export interface RattachementEchu {
  username: string;
  fullname: string;
  rattachement: RattachementManuel;
}

/**
 * Les membres d'une startup en une seule liste, et non deux tableaux : séparer les
 * collectés des rattachés à la main rendrait invisible le cas qui compte, celui de
 * la personne qui est les deux à la fois sur la même startup.
 *
 * L'échéance est l'effective, calculée sur tous les rattachements en cours de la
 * personne et non sur les seuls portés par cette startup : la ligne dirait sinon le
 * contraire de sa fiche.
 */
export function assemblerMembres(
  ghid: string,
  personnes: readonly PersonneRattachable[],
  aujourdHui: Date,
  seuils: StatutOptions,
): { membres: MembreDeStartup[]; echus: RattachementEchu[] } {
  const membres: MembreDeStartup[] = [];
  const echus: RattachementEchu[] = [];

  for (const personne of personnes) {
    const surCetteStartup = personne.rattachementsManuels.filter(
      (rattachement) => rattachement.startupGhid === ghid,
    );

    // Deux rattachements ouverts sur le même couple restent possibles, Prisma ne
    // sachant pas exprimer d'index unique partiel. On retient le plus lointain,
    // celui que retient aussi l'échéance effective.
    let manuel: RattachementManuel | null = null;
    for (const rattachement of surCetteStartup) {
      if (!enCours(rattachement, aujourdHui)) {
        continue;
      }
      if (manuel === null || jourUTC(rattachement.until) > jourUTC(manuel.until)) {
        manuel = rattachement;
      }
    }

    const collectee = personne.startups.includes(ghid);

    // Un rattachement fermé par quelqu'un n'est pas un rattachement que le temps a
    // rattrapé : le premier ne se raconte pas, le second se dit et se date, faute de
    // quoi l'écran laisserait croire à un retrait que personne n'a décidé. Encore
    // faut-il que l'expiration ait bel et bien fait perdre la qualité de membre :
    // tant que la collecte ou un autre rattachement porte la personne sur cette
    // startup, rien n'a cessé, et annoncer une expiration à côté d'une ligne de
    // membre active dirait le contraire. Une seule entrée par personne, la dernière
    // à avoir porté quelque chose.
    if (!collectee && manuel === null) {
      let echu: RattachementManuel | null = null;
      for (const rattachement of surCetteStartup) {
        if (rattachement.endedAt !== null) {
          continue;
        }
        if (echu === null || jourUTC(rattachement.until) > jourUTC(echu.until)) {
          echu = rattachement;
        }
      }
      if (echu !== null) {
        echus.push({
          username: personne.username,
          fullname: personne.fullname,
          rattachement: echu,
        });
      }
      continue;
    }

    const echeance = echeanceEffective(
      personne.missionEnd,
      personne.rattachementsManuels,
      aujourdHui,
    );

    membres.push({
      username: personne.username,
      fullname: personne.fullname,
      origine: collectee ? (manuel === null ? "collecte" : "les-deux") : "manuel",
      manuel,
      echeance,
      parEquipe: personne.attachment === "DECLARED" || personne.attachment === "BOTH",
      statut: statutDePersonne(
        { missionEnd: echeance, vanishedAt: personne.vanishedAt },
        aujourdHui,
        seuils,
      ),
    });
  }

  interface Nomme {
    username: string;
    fullname: string;
  }
  const parNom = (a: Nomme, b: Nomme): number =>
    a.fullname.localeCompare(b.fullname, "fr") || a.username.localeCompare(b.username, "fr");

  membres.sort(parNom);
  echus.sort(parNom);

  return { membres, echus };
}
