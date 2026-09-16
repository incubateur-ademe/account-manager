/**
 * La saisie d'un compte de service, lue une fois pour les deux écrans qui l'offrent.
 *
 * Elle est déclarée depuis l'écran des comptes de service, et depuis la file des comptes
 * isolés où un compte constaté fait découvrir la machine qui le détient. Deux lectures
 * finiraient par diverger, et la divergence qui coûte n'est pas la clé vide mais la
 * périodicité : un écran qui accepterait zéro poserait une revue due chaque jour, que
 * personne ne pourrait plus éteindre.
 */

export interface Declaration {
  key: string;
  label: string;
  purpose: string;
  ownerUsername: string;
  reviewEveryDays: number;
  provider: string;
}

export type LectureDeclaration = { erreur: string } | { declaration: Declaration };

export const REVUE_PAR_DEFAUT = 180;

export function lireDeclaration(
  brut: {
    key: string;
    label: string;
    purpose: string;
    ownerUsername: string;
    reviewEveryDays: number;
    provider: string;
  },
  systemesConnus: readonly string[],
): LectureDeclaration {
  const declaration: Declaration = {
    key: brut.key.trim(),
    label: brut.label.trim(),
    purpose: brut.purpose.trim(),
    ownerUsername: brut.ownerUsername.trim(),
    reviewEveryDays: brut.reviewEveryDays,
    provider: brut.provider.trim(),
  };

  if (!declaration.key || !declaration.label || !declaration.purpose) {
    return { erreur: "La clé, le libellé et l'usage sont tous exigés." };
  }
  // Refusé plutôt que rangé sous une clé inconnue : la fiche d'un système liste ses
  // comptes machine, et un système que rien ne sert n'a aucune fiche où les montrer.
  if (!systemesConnus.includes(declaration.provider)) {
    return {
      erreur: declaration.provider
        ? `Aucun système ne porte la clé « ${declaration.provider} ».`
        : "Indiquez le système auquel ce compte appartient.",
    };
  }
  if (!declaration.ownerUsername) {
    return {
      erreur:
        "Indiquez qui répond de ce compte : un compte machine sans propriétaire ne se revoit jamais.",
    };
  }
  if (!Number.isInteger(declaration.reviewEveryDays) || declaration.reviewEveryDays < 1) {
    return { erreur: "La revue se compte en jours entiers, au moins un." };
  }

  return { declaration };
}

/**
 * Le fragment identifiant d'une adresse : ce qui la distingue, sans ce qui se répète.
 *
 * Le domaine perd son extension, qui ne distingue rien entre deux comptes du même
 * incubateur, et la rendrait seulement plus longue à lire dans une liste.
 */
export function fragmentDAdresse(adresse: string): string {
  const [local = "", domaine = ""] = adresse.split("@");
  const segments = domaine.split(".");
  // Un domaine d'un seul segment n'a pas d'extension à retirer : `bot@localhost` la
  // perdrait tout entier, et le fragment cesserait de distinguer quoi que ce soit.
  const sansExtension = segments.length > 1 ? segments.slice(0, -1) : segments;
  return enKebab([local, ...sansExtension].join("-"));
}

/** Tout ce qui n'est ni lettre ni chiffre devient un tiret, accents dépliés. */
export function enKebab(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * La clé pré-remplie d'un compte machine découvert par un compte constaté.
 *
 * Le préfixe est posé ici et non par le connecteur, qui ne rend que son fragment : un
 * connecteur qui le poserait lui-même finirait par l'oublier ou le doubler, et la clé
 * cesserait de dire son système, ce qui compte d'autant plus qu'une colonne le porte
 * désormais à côté.
 */
export function cleProposee(systeme: string, fragment: string): string {
  const propre = enKebab(fragment);
  return propre ? `${enKebab(systeme)}-${propre}` : enKebab(systeme);
}

/**
 * Le libellé pré-rempli. Le nom du système puis le compte tel qu'il se lit chez lui,
 * parce que c'est la colonne qu'on parcourt : une clé remise en mots y perdrait
 * l'adresse réelle, seule chose qui permette de reconnaître le compte sans l'ouvrir.
 */
export function libellePropose(libelleDuSysteme: string, handle: string): string {
  return `${libelleDuSysteme} · ${handle}`;
}

export interface PropositionDeMachine {
  provider: string;
  systemeLibelle: string;
  key: string;
  label: string;
  ownerUsername: string;
  reviewEveryDays: number;
}

/**
 * Ce qu'un compte constaté permet de remplir tout seul, quand on déclare depuis lui la
 * machine qui le détient.
 *
 * Ici et non dans l'écran, pour que la composition soit épinglée sans monter de page : un
 * écran qui cesserait de préfixer la clé, ou qui prendrait le propriétaire ailleurs,
 * produirait des clés qui ne disent plus leur système sans qu'aucun test ne bronche.
 *
 * L'usage n'en fait pas partie, et c'est le seul champ dans ce cas. Il existe pour dire ce
 * que ce compte fait, en une phrase lisible dans deux ans : le pré-remplir le tuerait,
 * personne ne remplaçant un champ déjà rempli, et la colonne répéterait le système qu'on
 * lit juste à côté.
 */
export function propositionDeMachine(
  systeme: { key: string; label: string; accountSlug: (compte: Compte) => string },
  compte: Compte,
  proprietaire: string,
): PropositionDeMachine {
  return {
    provider: systeme.key,
    systemeLibelle: systeme.label,
    key: cleProposee(systeme.key, systeme.accountSlug(compte)),
    label: libellePropose(systeme.label, compte.handle),
    // Qui déclare en répond, jusqu'à ce qu'il désigne quelqu'un d'autre. Un champ vide
    // ferait porter le compte par personne, ce que la saisie refuse de toute façon.
    ownerUsername: proprietaire,
    reviewEveryDays: REVUE_PAR_DEFAUT,
  };
}

export interface Compte {
  handle: string;
  externalId: string;
}
