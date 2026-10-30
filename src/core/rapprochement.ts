export type MethodeRapprochement =
  | "DECLARED"
  | "GITHUB_LOGIN"
  | "EMAIL_EXACT"
  | "HEURISTIC"
  | "NONE";

/**
 * Les seules méthodes qui autorisent une coupure.
 *
 * `HEURISTIC` dit que cela ressemble à cette personne, ce qui suffit à alimenter une
 * file de rattachement à trancher à la main, jamais à couper un accès : couper sur
 * une ressemblance de nom, c'est couper l'accès d'un homonyme. `NONE` désigne un
 * compte que personne ne réclame.
 *
 * Cette liste vit ici et nulle part ailleurs : elle était recopiée dans le calcul des
 * constats et absente de celui des plans, où son oubli ne se voyait pas.
 *
 * La fonction prend une chaîne pour recevoir sans détour ce que rend la base, et
 * refuse tout ce qu'elle ne reconnaît pas : face à une valeur inattendue, le défaut
 * sûr est de ne pas couper.
 */
export const METHODES_REVOCABLES: readonly MethodeRapprochement[] = [
  "DECLARED",
  "GITHUB_LOGIN",
  "EMAIL_EXACT",
];

export function autoriseUneRevocation(methode: string): boolean {
  return (METHODES_REVOCABLES as readonly string[]).includes(methode);
}

export interface IdentiteObservee {
  provider: string;
  externalId: string;
  handle: string;
  emails?: readonly string[];
}

export interface PersonneConnue {
  id: string;
  username: string;
  githubLogin: string | null;
  primaryEmail: string | null;
  communicationEmail: string | null;
  source: "BETA" | "LOCAL" | "SERVICE";
}

export interface CompteDeServiceConnu {
  id: string;
  key: string;
  /** Identités déclarées dans la politique, qui font foi sur son appartenance. */
  identites: readonly { provider: string; externalId: string }[];
}

export interface Rapprochement {
  personId: string | null;
  serviceAccountId: string | null;
  methode: MethodeRapprochement;
}

const ISOLE: Rapprochement = { personId: null, serviceAccountId: null, methode: "NONE" };

/**
 * Un login GitHub s'écrit indifféremment `Jean-Dupont` ou `jean-dupont`, et le champ
 * de l'espace-membre est saisi à la main : on y trouve aussi bien l'adresse complète
 * du profil qu'une arobase de trop. Comparer sans réduire d'abord reviendrait à
 * déclarer isolé un compte que l'on connaît parfaitement.
 */
export function normaliserLogin(valeur: string | null | undefined): string | null {
  if (!valeur) {
    return null;
  }
  const reduit = valeur
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");

  return reduit.length > 0 ? reduit : null;
}

export function normaliserEmail(valeur: string | null | undefined): string | null {
  const reduit = valeur?.trim().toLowerCase();
  return reduit?.includes("@") ? reduit : null;
}

/**
 * Les adresses qui prouvent qu'un compte appartient à une personne.
 *
 * La principale toujours : l'espace-membre l'attribue, ou un opérateur la saisit. L'adresse
 * de contact seulement sur une fiche locale, où seul un opérateur l'écrit, la création
 * depuis un compte isolé y recopiant la principale. Sur une fiche collectée, elle vient de
 * la secondaire que le membre déclare lui-même, sans qu'aucune source n'en prouve la
 * détention. Y lire une identité laisserait un membre
 * revendiquer le compte de quelqu'un d'autre, et son départ couper cet accès.
 */
export function adressesDIdentite(
  personne: Pick<PersonneConnue, "primaryEmail" | "communicationEmail" | "source">,
): string[] {
  return [personne.primaryEmail, personne.source === "LOCAL" ? personne.communicationEmail : null]
    .map((email) => normaliserEmail(email))
    .filter((email): email is string => email !== null);
}

/**
 * L'adresse à viser quand un système agit sur un compte par son adresse : inviter à une
 * arrivée, retirer à un départ. Une adresse déclarée par le membre ferait inviter, ou
 * retirer, la boîte de quelqu'un d'autre.
 */
export function adresseProuvee(
  personne: Pick<PersonneConnue, "primaryEmail" | "communicationEmail" | "source">,
): string | null {
  return adressesDIdentite(personne)[0] ?? null;
}

/**
 * Indexe par clé en écartant les clés portées par plusieurs personnes : deux fiches
 * qui revendiquent le même compte ne se départagent pas ici, et choisir au hasard
 * finirait par couper l'accès de la mauvaise.
 *
 * L'ambiguïté se juge sur la personne, jamais sur le nombre de fois où la clé passe :
 * une même fiche a le droit d'apporter deux fois la même valeur, et c'est le cas
 * courant sur une fiche locale, `primaryEmail` et `communicationEmail` y portant souvent
 * la même adresse. Compter les passages écartait alors
 * la clé de sa propre titulaire, et rendait `EMAIL_EXACT` inatteignable pour elle.
 */
function indexSansAmbiguite(
  entrees: readonly (readonly [string | null, PersonneConnue])[],
): Map<string, PersonneConnue> {
  const index = new Map<string, PersonneConnue>();
  const ambigus = new Set<string>();

  for (const [cle, personne] of entrees) {
    if (cle === null) {
      continue;
    }
    const deja = index.get(cle);
    if (deja !== undefined && deja.id !== personne.id) {
      ambigus.add(cle);
      continue;
    }
    index.set(cle, personne);
  }

  for (const cle of ambigus) {
    index.delete(cle);
  }
  return index;
}

/**
 * Attribue un compte observé à qui le détient, du plus sûr au plus faible.
 *
 * L'ordre n'est pas cosmétique : seules les trois premières méthodes autorisent une
 * révocation. `HEURISTIC` dit « cela ressemble à cette personne », ce qui suffit à
 * alimenter une file de rattachement à trancher à la main, jamais à couper un accès.
 * `NONE` est un résultat du système et non une anomalie : un compte que personne ne
 * réclame est précisément ce que cet outil cherche à mettre au jour.
 */
export function rapprocher(
  identite: IdentiteObservee,
  personnes: readonly PersonneConnue[],
  comptes: readonly CompteDeServiceConnu[],
): Rapprochement {
  const declare = comptes.find((compte) =>
    compte.identites.some(
      (declaree) =>
        declaree.provider === identite.provider && declaree.externalId === identite.externalId,
    ),
  );
  if (declare) {
    return { personId: null, serviceAccountId: declare.id, methode: "DECLARED" };
  }

  if (identite.provider === "github") {
    const parLogin = indexSansAmbiguite(
      personnes.map((personne) => [normaliserLogin(personne.githubLogin), personne] as const),
    );
    const login = normaliserLogin(identite.handle);
    const trouvee = login ? parLogin.get(login) : undefined;
    if (trouvee) {
      return { personId: trouvee.id, serviceAccountId: null, methode: "GITHUB_LOGIN" };
    }
  }

  const parEmail = indexSansAmbiguite(
    personnes.flatMap((personne) =>
      adressesDIdentite(personne).map((email) => [email, personne] as const),
    ),
  );

  const observes = [...(identite.emails ?? []), identite.handle]
    .map((email) => normaliserEmail(email))
    .filter((email): email is string => email !== null);

  for (const email of observes) {
    const trouvee = parEmail.get(email);
    if (trouvee) {
      return { personId: trouvee.id, serviceAccountId: null, methode: "EMAIL_EXACT" };
    }
  }

  // Dernier recours : le compte porte quelque chose qui ressemble à un username
  // beta.gouv. C'est vrai la plupart du temps, et c'est précisément pour cela que
  // ce n'est pas une preuve.
  const parUsername = indexSansAmbiguite(
    personnes.map((personne) => [personne.username.toLowerCase(), personne] as const),
  );
  const pistes = [
    normaliserLogin(identite.handle),
    ...observes.map((email) => email.split("@")[0]),
  ];

  for (const piste of pistes) {
    const trouvee = piste ? parUsername.get(piste) : undefined;
    if (trouvee) {
      return { personId: trouvee.id, serviceAccountId: null, methode: "HEURISTIC" };
    }
  }

  return ISOLE;
}
