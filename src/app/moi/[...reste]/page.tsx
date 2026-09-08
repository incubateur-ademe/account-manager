import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUtilisateur } from "@/lib/session";

export const metadata: Metadata = { title: "Page non trouvée" };

/**
 * Toute adresse de l'espace qui ne mène nulle part, ramenée sur le refus le plus proche.
 *
 * Sans elle, une adresse tronquée ou mal recopiée sous `/moi` ne rencontre aucune route,
 * donc aucune frontière : Next rend alors le 404 de la racine, qui n'offre que l'accueil
 * et les personnes suivies, deux écrans interdits à qui n'est pas de l'équipe. « Sans
 * l'identifiant » est le raccourci naturel de quelqu'un qui s'est trompé de dossier, et
 * il n'existe aucune route à cette adresse-là.
 *
 * Les routes réelles passent devant : un segment fixe l'emporte sur un segment dynamique,
 * et un dynamique sur un attrape-tout. Cette page ne prend donc que ce que personne ne
 * réclame.
 */
export default async function ResteDeLEspacePage(): Promise<never> {
  // La garde d'abord, comme sur toutes les entrées de cet espace : sans elle, une
  // adresse d'ici répondrait « 404 » à qui n'est pas connecté là où ses voisines
  // renvoient vers la connexion, et le balayage des gardes ne la verrait pas.
  await requireUtilisateur();
  notFound();
}
