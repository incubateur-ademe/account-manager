import type { ReleveSysteme, SystemeMuet } from "@/core/collecte";

/**
 * Le préfixe qu'un connecteur pose sur le rôle d'un accès qui n'attend qu'une
 * acceptation. Une invitation n'est pas un compte, et elle ne périme jamais d'elle
 * même : la compter comme un membre effacerait la seule porte que personne ne referme.
 */
export const PREFIXE_INVITATION = "invite:";

/**
 * Les rôles qui valent droit d'administration. Deux mots et pas davantage : le socle
 * ne peut pas deviner le vocabulaire de chaque système, il peut seulement fixer celui
 * qu'il reconnaît, et laisser aux connecteurs le soin de s'y ramener.
 */
const ADMINISTRATION: ReadonlySet<string> = new Set(["admin", "owner"]);

export interface AccesConstate {
  externalIdentityId: string;
  /** Celui de la ressource, seul rattachement d'un accès à un système. */
  provider: string;
  role: string;
  firstSeenAt: Date;
}

export type QualiteDeCompte = "administrateur" | "membre" | "invitation";

/**
 * Ce qu'un compte est sur un système, d'après tout ce qu'il y détient.
 *
 * Un compte se range dans une seule qualité, sinon les sous-chiffres dépasseraient le
 * total qu'ils sont censés détailler. Sur GitHub, une personne appartenant à trois
 * équipes porte quatre accès `member` : compter les accès, et non les comptes,
 * multiplierait le parc par le nombre d'équipes.
 *
 * L'administration l'emporte sur le reste, puisque c'est le seul de ces chiffres qui
 * mesure un risque. L'invitation ne vient qu'après : un compte qui détient déjà
 * quelque chose est entré, quelle que soit l'invitation qui traîne encore à côté.
 */
export function qualiteDuCompte(roles: readonly string[]): QualiteDeCompte | null {
  if (roles.length === 0) {
    return null;
  }

  const normalises = roles.map((role) => role.toLowerCase());

  if (normalises.some((role) => ADMINISTRATION.has(role))) {
    return "administrateur";
  }

  return normalises.every((role) => role.startsWith(PREFIXE_INVITATION)) ? "invitation" : "membre";
}

/**
 * Depuis quand la plus ancienne invitation est observée sur ce système, et non depuis
 * quand elle a été envoyée.
 *
 * La nuance n'est pas cosmétique : annuler puis renvoyer une invitation lui donne un
 * nouvel identifiant, donc une nouvelle identité, et remet ce compteur à zéro. La
 * vraie date d'envoi n'existe en base que sous forme de texte déjà mis en forme par le
 * connecteur, que le socle a pour règle de ne pas interpréter. L'écran doit donc dire
 * « observée depuis », jamais « ouverte depuis ».
 */
export function plusAncienneInvitation(acces: readonly AccesConstate[]): Date | null {
  let plusAncienne: Date | null = null;

  for (const un of acces) {
    if (!un.role.toLowerCase().startsWith(PREFIXE_INVITATION)) {
      continue;
    }
    if (plusAncienne === null || un.firstSeenAt < plusAncienne) {
      plusAncienne = un.firstSeenAt;
    }
  }

  return plusAncienne;
}

/**
 * Ce que vaut une ligne d'inventaire, qui n'est jamais l'état du jour mais l'état de
 * la dernière lecture.
 *
 * Trois cas et non deux. Un système muet n'a pas de chiffre du tout. Un système lu
 * partiellement en a un, mais incomplet : la collecte a avalé des erreurs unitaires,
 * donc elle n'a posé aucune disparition, et ce qui reste en base peut contenir des
 * comptes déjà partis. Le présenter comme sain serait le mensonge le plus tranquille
 * de cet écran.
 */
export type Observation =
  | { etat: "frais" }
  | { etat: "partiel" }
  | { etat: "muet"; raison: SystemeMuet["raison"]; heures: number | null };

export interface LigneDInventaire {
  provider: string;
  /**
   * Nul quand le système n'est pas observé. Zéro dirait « aucun compte », alors que
   * la seule chose établie est qu'on n'a pas regardé, et un run non `ok` ne pose
   * aucune disparition : ce qui reste en base est le dernier état constaté.
   */
  comptes: number | null;
  administrateurs: number;
  membres: number;
  invitations: number;
  invitationObserveeDepuis: Date | null;
  observation: Observation;
}

/**
 * Une ligne par système attendu, muets compris, dans l'ordre où les systèmes sont
 * attendus.
 *
 * Les systèmes muets sont ceux que la bannière du tableau de bord nomme déjà : la
 * règle n'est pas recalculée ici, elle est reçue, sans quoi l'inventaire et la
 * bannière finiraient par désigner deux populations différentes.
 */
export function inventaireParSysteme(
  attendus: readonly string[],
  comptesParSysteme: readonly { provider: string; comptes: number }[],
  acces: readonly AccesConstate[],
  releves: readonly ReleveSysteme[],
  muets: readonly SystemeMuet[],
): LigneDInventaire[] {
  return attendus.map((provider) => {
    const muet = muets.find((candidat) => candidat.provider === provider);
    if (muet) {
      return {
        provider,
        comptes: null,
        administrateurs: 0,
        membres: 0,
        invitations: 0,
        invitationObserveeDepuis: null,
        observation: { etat: "muet", raison: muet.raison, heures: muet.heures },
      };
    }

    const releve = releves.find((candidat) => candidat.provider === provider);
    if (!releve) {
      // Sans relevé, il n'y a rien à dire de ce système. `systemesMuets` aurait conclu
      // la même chose, mais rien dans cette signature n'oblige l'appelant à passer deux
      // listes cohérentes, et retomber sur « frais » redirait « aucun compte » là où la
      // seule chose établie est qu'on n'a pas regardé.
      return {
        provider,
        comptes: null,
        administrateurs: 0,
        membres: 0,
        invitations: 0,
        invitationObserveeDepuis: null,
        observation: { etat: "muet", raison: "non-lu", heures: null },
      };
    }

    const siens = acces.filter((un) => un.provider === provider);

    const rolesParCompte = new Map<string, string[]>();
    for (const un of siens) {
      const deja = rolesParCompte.get(un.externalIdentityId);
      if (deja) {
        deja.push(un.role);
      } else {
        rolesParCompte.set(un.externalIdentityId, [un.role]);
      }
    }

    let administrateurs = 0;
    let membres = 0;
    let invitations = 0;
    const invites = new Set<string>();
    for (const [identite, roles] of rolesParCompte) {
      const qualite = qualiteDuCompte(roles);
      if (qualite === "administrateur") {
        administrateurs += 1;
      } else if (qualite === "membre") {
        membres += 1;
      } else if (qualite === "invitation") {
        invitations += 1;
        invites.add(identite);
      }
    }

    return {
      provider,
      comptes: comptesParSysteme.find((un) => un.provider === provider)?.comptes ?? 0,
      administrateurs,
      membres,
      invitations,
      // Les seuls comptes comptés comme invitations : sinon la cellule daterait une
      // invitation là où la colonne affiche zéro, un compte détenant à la fois un rôle
      // ordinaire et une invitation étant classé membre.
      invitationObserveeDepuis: plusAncienneInvitation(
        siens.filter((un) => invites.has(un.externalIdentityId)),
      ),
      observation: releve.status === "PARTIAL" ? { etat: "partiel" } : { etat: "frais" },
    };
  });
}
