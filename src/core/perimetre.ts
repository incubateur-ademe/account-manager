export type Attachment = "STARTUPS" | "DECLARED" | "BOTH" | "LOCAL";

/**
 * Un membre déclaré transverse mais que l'espace-membre ne connaît pas ne doit pas
 * disparaître en silence : c'est soit une faute de frappe dans la politique, soit une
 * fiche à créer.
 */
export function declaresManquants(
  resolus: readonly string[],
  declares: readonly string[],
): string[] {
  const connus = new Set(resolus);
  return declares.filter((username) => !connus.has(username)).sort();
}
