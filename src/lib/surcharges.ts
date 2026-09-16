import { prisma } from "@/lib/db";
import { poserLesSurcharges } from "@/lib/policy";

/**
 * Lit ce que la base porte de la configuration et le pose avant toute lecture de politique.
 *
 * Explicite et non implicite : `policy()` est synchrone et appelée partout, y compris dans
 * du code qui n'a pas de base sous la main. La rendre asynchrone obligerait chaque écran à
 * attendre ce qu'il ne lit pas, et chaque test à doubler une base pour un seuil.
 *
 * Appelée une fois par requête depuis la disposition racine, et une fois par exécution
 * depuis la collecte : le cache de politique s'invalide à chaque appel, si bien qu'un
 * réglage posé dans l'interface vaut dès l'écran suivant.
 */
export async function chargerLesSurcharges(): Promise<void> {
  const lignes = await prisma.configOverride.findMany({ select: { path: true, value: true } });

  poserLesSurcharges(Object.fromEntries(lignes.map((ligne) => [ligne.path, ligne.value])));
}
