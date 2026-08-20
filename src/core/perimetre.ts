/**
 * Un membre déclaré transverse que ce passage n'a pas résolu ne doit pas disparaître
 * en silence : faute de frappe dans la politique, fiche à créer, ou fiche que la
 * lecture n'a pas su charger cette fois-là.
 */
export function declaresManquants(
  resolus: readonly string[],
  declares: readonly string[],
): string[] {
  const connus = new Set(resolus);
  return declares.filter((username) => !connus.has(username)).sort();
}
