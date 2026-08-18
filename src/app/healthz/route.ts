import { loadPolicy } from "@/lib/policy";

export const dynamic = "force-dynamic";

/**
 * Sonde de vivacite. Le nom est celui que tout le monde cherche (Kubernetes en a
 * fait un standard de fait) : cette route n'est lue par aucun humain, elle est
 * interrogee par un orchestrateur, la ou les ecrans, eux, restent en francais.
 * Elle repond deux questions, et pas une de plus : le serveur
 * ecoute-t-il, et l'image porte-t-elle une politique lisible.
 *
 * La politique en fait partie parce qu'une image construite sans elle ne servira
 * jamais rien : le defaut est permanent, et une sonde verte laisserait ce
 * deploiement remplacer une version qui, elle, fonctionnait.
 *
 * La base n'en fait pas partie, a l'inverse. Une base momentanement injoignable est
 * une panne dont l'application ne peut rien : la declarer morte la ferait sortir du
 * routage et remplacerait une page d'erreur lisible par une absence de reponse.
 */
export function GET(): Response {
  try {
    loadPolicy();
  } catch (error) {
    return Response.json(
      { etat: "degrade", cause: error instanceof Error ? error.message : String(error) },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json({ etat: "ok" }, { headers: { "cache-control": "no-store" } });
}
