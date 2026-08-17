import type { Statut } from "./statut";

export type Vue = "a-suivre" | "a-traiter" | "a-surveiller" | "tout";
export type Colonne = "statut" | "nom" | "echeance";
export type Sens = "asc" | "desc";

export const VUES: { valeur: Vue; libelle: string }[] = [
  { valeur: "a-suivre", libelle: "À suivre" },
  { valeur: "a-traiter", libelle: "À traiter seulement" },
  { valeur: "a-surveiller", libelle: "À surveiller seulement" },
  { valeur: "tout", libelle: "Tout, anciens compris" },
];

const ORDRE_URGENCE: Statut[] = [
  "SORTI",
  "A_TRAITER",
  "EN_SURSIS",
  "BIENTOT",
  "ACTIF",
  "SANS_ECHEANCE",
  "ANCIEN",
];

const DEMANDE_ACTION: Statut[] = ["SORTI", "A_TRAITER", "EN_SURSIS"];

/** Rien à faire aujourd'hui, mais l'échéance approche ou vient de passer. */
const A_SURVEILLER: Statut[] = ["EN_SURSIS", "BIENTOT"];

const COLONNES: Colonne[] = ["statut", "nom", "echeance"];

export interface LignePersonne {
  username: string;
  fullname: string;
  missionEnd: Date | null;
  statut: Statut;
}

export function estVue(valeur: string | undefined): valeur is Vue {
  return VUES.some((vue) => vue.valeur === valeur);
}

export function estColonne(valeur: string | undefined): valeur is Colonne {
  return COLONNES.includes(valeur as Colonne);
}

export function estSens(valeur: string | undefined): valeur is Sens {
  return valeur === "asc" || valeur === "desc";
}

/**
 * La vue par défaut écarte les anciens : ils restent en base et consultables, mais
 * les afficher d'office noierait la poignée de lignes sur lesquelles il y a à agir
 * sous une centaine de départs digérés depuis longtemps.
 */
export function filtrer<T extends LignePersonne>(
  personnes: readonly T[],
  vue: Vue,
  recherche: string,
): T[] {
  const terme = recherche.trim().toLowerCase();

  return personnes.filter((personne) => {
    if (terme.length > 0) {
      const cible = `${personne.fullname} ${personne.username}`.toLowerCase();
      if (!cible.includes(terme)) {
        return false;
      }
    }

    if (vue === "tout") {
      return true;
    }
    if (vue === "a-traiter") {
      return DEMANDE_ACTION.includes(personne.statut);
    }
    if (vue === "a-surveiller") {
      return A_SURVEILLER.includes(personne.statut);
    }
    return personne.statut !== "ANCIEN";
  });
}

export function trier<T extends LignePersonne>(
  personnes: readonly T[],
  colonne: Colonne,
  sens: Sens,
): T[] {
  const parNom = (a: T, b: T) => a.fullname.localeCompare(b.fullname, "fr");

  const comparer = (a: T, b: T): number => {
    if (colonne === "nom") {
      return parNom(a, b);
    }
    if (colonne === "echeance") {
      // Une personne sans échéance n'a pas de date à comparer : elle ferme la
      // marche quel que soit le sens, plutôt que de remonter en tête sur un tri
      // décroissant où elle n'apporterait rien.
      if (a.missionEnd === null || b.missionEnd === null) {
        return 0;
      }
      return a.missionEnd.getTime() - b.missionEnd.getTime() || parNom(a, b);
    }
    return ORDRE_URGENCE.indexOf(a.statut) - ORDRE_URGENCE.indexOf(b.statut) || parNom(a, b);
  };

  const sansDate: T[] = [];
  const avecDate: T[] = [];
  for (const personne of personnes) {
    (colonne === "echeance" && personne.missionEnd === null ? sansDate : avecDate).push(personne);
  }

  avecDate.sort((a, b) => (sens === "desc" ? -comparer(a, b) : comparer(a, b)));
  sansDate.sort(parNom);

  return [...avecDate, ...sansDate];
}
