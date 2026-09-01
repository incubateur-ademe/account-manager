import { redirect } from "next/navigation";

import { estOperateur } from "@/core/identite";
import type { Voie } from "@/core/participation";
import { auth } from "@/lib/auth";
import { webEnv } from "@/lib/env";

export interface Utilisateur {
  username: string;
  email: string | null;
  nom: string | null;
  /** La fiche que la session désigne, quand elle en désigne une. */
  personId: string | null;
  voie: Voie;
  /**
   * Ce qui autorise, quand `username` ne fait que nommer. Les deux ne se confondent
   * pas : un identifiant de fiche se renomme, et rien ne le compare à l'allowlist en
   * le renommant. La qualité d'opérateur ne se calcule donc que sur un identifiant
   * venu de la voie espace-membre, et vaut faux par construction sur l'autre.
   */
  operateur: boolean;
}

/**
 * Le proxy ne fait que constater la présence d'un cookie, il ne le valide pas.
 * Toute page ou action qui lit ou modifie des accès passe donc par une des gardes de
 * ce module : c'est ici, et nulle part ailleurs, que la session est réellement
 * vérifiée.
 *
 * Une action serveur en appelle une en première ligne, avant sa première lecture, et ne
 * s'en remet pas à `actionTracee` qui l'appelle aussi : les refus qu'une action rend
 * avant d'écrire distinguent un identifiant connu d'un identifiant inconnu, si bien
 * que les laisser répondre avant la garde donne une énumération du référentiel, sans
 * écriture et donc sans la moindre trace.
 *
 * Le `generateMetadata` d'une page relève de la même règle et ne s'en remet pas au
 * composant qui le suit : il s'exécute pour son compte, et un titre qui nomme une
 * fiche a déjà dit qu'elle existait.
 *
 * L'appartenance à l'allowlist est revérifiée à chaque passage, et non tenue pour
 * acquise depuis la connexion. La session est un jeton signé qui porte le username
 * pour des semaines : sans cette relecture, retirer quelqu'un d'`OPERATORS` ne lui
 * retirerait rien avant l'expiration de son jeton. Un droit par dossier se relit de
 * la même façon, et pour la même raison.
 */
export async function utilisateurCourant(): Promise<Utilisateur | null> {
  const session = await auth();
  const username = session?.user?.username;
  const voie = session?.user?.voie;

  // La voie est exigée autant que le nom, et son absence vaut absence de session. Un
  // jeton muet sur ce point est un jeton émis avant que la seconde porte existe : lui
  // supposer la première serait juste aujourd'hui et faux au premier défaut qui
  // laisserait l'autre porte oublier de l'écrire. Le prix est une reconnexion.
  if (!username || !voie) {
    return null;
  }

  return {
    username,
    email: session.user.email ?? null,
    nom: session.user.name ?? null,
    personId: session.user.personId ?? null,
    voie,
    // Le nom ne suffit pas à décider, la porte en fait partie. Un identifiant de fiche
    // a la forme d'un username beta.gouv, il se renomme, et rien ne le compare à
    // l'allowlist en le renommant : le comparer ici quelle que soit son origine
    // court-circuiterait tout ce que la connexion vient de vérifier.
    operateur:
      voie === "ESPACE_MEMBRE" &&
      estOperateur(username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES),
  };
}

/** Qui est là, sans rien présumer de ce qu'il a le droit de faire. */
export async function requireUtilisateur(): Promise<Utilisateur> {
  const utilisateur = await utilisateurCourant();

  if (utilisateur === null) {
    redirect("/login");
  }

  return utilisateur;
}

/**
 * Deux refus, et ils ne disent pas la même chose. Sans session, l'écran de connexion
 * est la réponse. Avec une session valide mais hors allowlist, le renvoyer là
 * affirmerait à tort que la connexion a échoué : ce qui manque n'est pas une preuve
 * d'identité, c'est un droit sur cet écran-ci.
 */
export async function requireOperateur(): Promise<Utilisateur> {
  const utilisateur = await utilisateurCourant();

  if (utilisateur === null) {
    redirect("/login");
  }
  if (!utilisateur.operateur) {
    redirect("/moi");
  }

  return utilisateur;
}
