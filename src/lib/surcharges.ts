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
export async function chargerLesSurcharges({ strict = false } = {}): Promise<void> {
  try {
    const lignes = await prisma.configOverride.findMany({ select: { path: true, value: true } });

    poserLesSurcharges(Object.fromEntries(lignes.map((ligne) => [ligne.path, ligne.value])));
  } catch (cause: unknown) {
    // La collecte, elle, s'arrête : elle décide des coupures, et le faire sur une politique
    // qui n'est pas celle enregistrée reviendrait à couper sur des seuils que personne n'a
    // choisis. Un écran qui affiche de travers se répare ; une révocation, non.
    if (strict) {
      throw cause;
    }

    // Une base absente ne doit pas emporter la page de connexion. Cet appel est en tête de
    // la disposition racine, donc devant tous les écrans, y compris ceux qui n'ont besoin
    // de rien : lever ici rendrait l'outil inaccessible au moment précis où quelqu'un
    // cherche à comprendre ce qui ne va pas.
    //
    // Ce qui était déjà chargé le reste, et la politique retombe sinon sur le fichier et
    // l'environnement, qui suffisent à démarrer.
    console.error("[configuration] surcharges non lues :", cause);
  }
}
