/**
 * La clé reste une chaîne libre là où les autres tables d'ici portent une union : la
 * phase est une colonne de texte que le référentiel amont remplit à sa main, sans
 * énumération qui nous engage. Une union figerait un vocabulaire qui ne nous
 * appartient pas, et une phase inventée demain s'y lirait sans repli, pour afficher
 * un vide là où la valeur brute dit au moins quelque chose. L'index libre rend
 * `string | undefined` et oblige l'appelant à nommer ce repli.
 */
export const LIBELLE_PHASE: Record<string, string> = {
  investigation: "Investigation",
  construction: "Construction",
  acceleration: "Accélération",
  transfer: "Transfert",
  transfere: "Transférée",
  success: "Pérennisée",
  alumni: "Alumni",
  abandon: "Abandonnée",
  "abandon-investigation": "Abandonnée en investigation",
};
