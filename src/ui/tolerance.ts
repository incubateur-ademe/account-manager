import { cleDeCible, type Derogation } from "@/core/derogation";

import { dateFr } from "./dates";

/**
 * Ce qu'un écran dit d'un compte toléré, ou rien quand il ne l'est pas.
 *
 * La phrase est composée ici et non dans chaque écran : deux endroits qui la rédigent
 * chacun de leur côté finissent par dire deux choses différentes du même état, et c'est
 * précisément là qu'un opérateur cesse de croire ce qu'il lit.
 *
 * L'échéance passe par `dateFr`, en UTC : le dernier jour couvert est une date sans heure,
 * qu'un formateur du fuseau du lecteur reculerait d'un jour la moitié de l'année.
 */
export function tolerance(
  couverts: ReadonlyMap<string, Derogation>,
  compte: { provider: string; externalId: string },
): string | null {
  const couvrante = couverts.get(cleDeCible({ type: "identite", ...compte }));
  if (couvrante === undefined) {
    return null;
  }
  return couvrante.echeance === null
    ? "toléré sans terme"
    : `toléré jusqu'au ${dateFr.format(couvrante.echeance)}`;
}
