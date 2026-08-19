import { jourUTC } from "./statut";

/**
 * Un rattachement décidé par un opérateur, réduit à ce qui décide.
 *
 * Nommé `rattachement-startup` et non `rattachement` pour ne pas se confondre à la
 * lecture avec le rapprochement, qui attribue des comptes observés à des personnes
 * et n'a rien à voir.
 */
export interface RattachementManuel {
  startupGhid: string;
  until: Date;
  endedAt: Date | null;
}

/**
 * Un rattachement expire par comparaison de dates, jamais par une écriture.
 *
 * Aucune tâche ne vient poser un drapeau à minuit : une expiration qui dépendrait
 * de la collecte deviendrait fausse la nuit où elle ne tourne pas, et c'est
 * précisément la panne la plus discrète du système. Le dernier jour est inclusif,
 * au même titre qu'une fin de mission.
 */
export function enCours(rattachement: RattachementManuel, aujourdHui: Date): boolean {
  return rattachement.endedAt === null && jourUTC(rattachement.until) >= jourUTC(aujourdHui);
}

/**
 * L'union des startups collectées et de celles qu'un rattachement manuel en cours
 * ajoute, dédupliquée et triée : deux appels successifs doivent rendre la même
 * liste, sans quoi l'affichage bougerait d'une collecte à l'autre.
 */
export function startupsEffectives(
  collectees: readonly string[],
  manuels: readonly RattachementManuel[],
  aujourdHui: Date,
): string[] {
  const manuelles = manuels
    .filter((rattachement) => enCours(rattachement, aujourdHui))
    .map((rattachement) => rattachement.startupGhid);

  return [...new Set([...collectees, ...manuelles])].sort();
}

/**
 * La plus lointaine entre la fin de mission et les rattachements manuels en cours.
 *
 * Elle se calcule et ne se stocke pas : `Person.missionEnd` reste ce que l'amont
 * dit, et un rattachement court ne rogne jamais une mission longue.
 */
export function echeanceEffective(
  missionEnd: Date | null,
  manuels: readonly RattachementManuel[],
  aujourdHui: Date,
): Date | null {
  let echeance = missionEnd;

  for (const rattachement of manuels) {
    if (!enCours(rattachement, aujourdHui)) {
      continue;
    }
    if (echeance === null || jourUTC(rattachement.until) > jourUTC(echeance)) {
      echeance = rattachement.until;
    }
  }

  return echeance;
}

/**
 * Vrai quand la date posée repousse une échéance connue, c'est-à-dire quand le
 * geste prolonge un accès. C'est le geste qu'on veut voir passer, d'où
 * l'avertissement à la saisie et le refus tant que la confirmation manque.
 *
 * Une fiche sans échéance ne se prolonge pas : rien ne déclenchait de coupure pour
 * elle, et lui poser une date de fin la borne au lieu de l'étendre.
 */
export function prolongeLaMission(missionEnd: Date | null, until: Date): boolean {
  return missionEnd !== null && jourUTC(until) > jourUTC(missionEnd);
}
