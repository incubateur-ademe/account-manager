import type { Utilisateur } from "@/lib/session";

/**
 * Les doubles de `@/lib/session`, en un seul endroit.
 *
 * Deux choses les justifient, et elles ne se valent pas.
 *
 * La première est le coût : douze harnais recopiaient la forme d'`Utilisateur`, si bien
 * qu'un champ ajouté sur ce type faisait grossir des fichiers qui n'avaient aucune raison
 * métier de bouger. C'est arrivé. Une fabrique à défauts le referme.
 *
 * La seconde compte davantage. Un double écrit à la main peut recoder la règle qu'il est
 * censé servir, et il l'a fait : un harnais rejetait sur une phrase de son cru, qu'une
 * assertion du même fichier relisait, si bien que le scénario vérifiait le double contre
 * lui-même et non le produit. `doublerSession` transcrit `src/lib/session.ts` ligne à
 * ligne, la seule liberté prise étant de rejeter là où le vrai module appelle `redirect`.
 * Une porte qui perdrait sa garde échoue alors chez tout le monde d'un coup.
 */

/** Les deux portes, nommées comme le module qu'elles doublent. */
export type Porte = "requireUtilisateur" | "requireOperateur";

/** La surface complète de `@/lib/session`, telle qu'un `vi.mock` doit la rendre. */
export interface DoubleDeSession {
  utilisateurCourant: () => Promise<Utilisateur | null>;
  requireUtilisateur: () => Promise<Utilisateur>;
  requireOperateur: () => Promise<Utilisateur>;
}

/**
 * Le refus, sous la forme exacte que Next donne à une redirection.
 *
 * Fabriqué à la main plutôt qu'emprunté à `next/navigation` : trois harnais doublent déjà
 * ce module pour leur compte, et un refus qui passerait par lui prendrait leur version au
 * lieu de la vraie. Le digest se lit ailleurs qu'ici, `unstable_rethrow` le relaie dans
 * deux chemins de production que les scénarios traversent : il doit donc rester parsable,
 * et pas seulement ressembler à une erreur.
 */
export function redirection(chemin: string): Error {
  const digest = `NEXT_REDIRECT;replace;${chemin};307;`;
  return Object.assign(new Error(digest), { digest });
}

const PAR_DEFAUT: Utilisateur = {
  username: "operatrice.exemple",
  email: null,
  nom: null,
  personId: null,
  // Le défaut n'est pas neutre et ne peut pas l'être : trois scénarios relisent la voie
  // dans le journal que le passage tracé compose à partir de la session. La changer les
  // ferait tous tomber, ce qui est la preuve qu'elle est observée.
  voie: "ESPACE_MEMBRE",
  operateur: true,
};

/** Quelqu'un de l'équipe transverse, entré par l'espace-membre. */
export function operatrice(surcharge: Partial<Utilisateur> = {}): Utilisateur {
  return { ...PAR_DEFAUT, ...surcharge };
}

/**
 * Quelqu'un qui détient un droit sur un dossier, et rien de plus.
 *
 * La qualité d'opérateur vaut faux par construction sur la voie de l'adresse, et ce
 * couple-là n'est pas un réglage : le vrai module ne l'accorde qu'à un identifiant venu
 * de l'espace-membre. Une fabrique qui laisserait poser `operateur: true` sur cette voie
 * fabriquerait une session que la production ne peut pas produire.
 */
export function participant(surcharge: Partial<Utilisateur> = {}): Utilisateur {
  return {
    ...PAR_DEFAUT,
    username: "participante.exemple",
    voie: "ADRESSE",
    operateur: false,
    ...surcharge,
  };
}

/**
 * Les trois portes, sur une session que l'appelant décide au moment où elles sont
 * franchies.
 *
 * `lire` est rappelée à chaque passage et non lue une fois : un scénario qui change de
 * session en cours de route est le cas ordinaire, et une valeur figée à la construction
 * le lui interdirait. `relever` reçoit le nom de la porte **avant** la décision, parce
 * que c'est le franchissement qui s'observe et non son issue : une garde qui refuse a
 * bien été appelée.
 */
export function doublerSession(options: {
  lire: () => Utilisateur | null;
  relever?: (porte: Porte) => void;
}): DoubleDeSession {
  const { lire, relever } = options;

  return {
    utilisateurCourant: () => Promise.resolve(lire()),

    requireUtilisateur: () => {
      relever?.("requireUtilisateur");
      const utilisateur = lire();
      return utilisateur === null
        ? Promise.reject(redirection("/login"))
        : Promise.resolve(utilisateur);
    },

    requireOperateur: () => {
      relever?.("requireOperateur");
      const utilisateur = lire();
      if (utilisateur === null) {
        return Promise.reject(redirection("/login"));
      }
      // Les deux refus ne disent pas la même chose, et le double garde la distinction :
      // sans session c'est la connexion qui répond, avec une session hors allowlist c'est
      // un droit qui manque sur cet écran-ci.
      return utilisateur.operateur
        ? Promise.resolve(utilisateur)
        : Promise.reject(redirection("/moi"));
    },
  };
}

/** Une session posée une fois pour toutes, pour un harnais que la session n'intéresse pas. */
export function sessionDe(surcharge: Partial<Utilisateur> = {}): DoubleDeSession {
  const utilisateur = operatrice(surcharge);
  return doublerSession({ lire: () => utilisateur });
}
