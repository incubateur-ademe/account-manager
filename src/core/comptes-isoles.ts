import type { MethodeRapprochement } from "@/core/rapprochement";

/**
 * Ce qu'il faut savoir d'une identité pour dire si elle attend un geste, et rien de
 * plus.
 */
export interface IdentiteACategoriser {
  vanishedAt: Date | null;
  personId: string | null;
  serviceAccountId: string | null;
  matchMethod: MethodeRapprochement;
}

/**
 * Pourquoi une identité ne peut fonder aucune révocation.
 *
 * `sans-detenteur` : personne ne s'en réclame, il faut lui trouver un propriétaire ou
 * la couper. `ressemblance` : la collecte a supposé un détenteur sur une ressemblance
 * que nul n'a confirmée, et couper là-dessus, c'est couper l'accès d'un homonyme.
 */
export type CategorieDIsolement = "sans-detenteur" | "ressemblance";

/**
 * Miroir pur de la clause de `src/lib/comptes-isoles.ts`, qui existe pour être
 * éprouvé sans base. Les deux se lisent ensemble et se modifient ensemble : les
 * laisser diverger ferait diverger deux écrans qui affichent le même total.
 *
 * Les deux catégories sont disjointes par construction, sans quoi une identité à la
 * fois sans détenteur et rapprochée par ressemblance serait comptée deux fois et la
 * somme dépasserait le total.
 */
export function categorieDIsolement(identite: IdentiteACategoriser): CategorieDIsolement | null {
  if (identite.vanishedAt !== null) {
    return null;
  }

  if (identite.personId === null && identite.serviceAccountId === null) {
    return "sans-detenteur";
  }

  return identite.matchMethod === "HEURISTIC" ? "ressemblance" : null;
}
