import type { Prisma } from "@/generated/prisma/client";

import { RESULTATS, type Resultat } from "./libelles";

export const TAILLE_PAGE = 100;

/**
 * Sentinelle pour « c'est le système qui a agi ». L'arobase la rend impossible à
 * confondre avec un username beta.gouv, qui n'en contient jamais.
 */
export const ACTEUR_SYSTEME = "@systeme";

export interface Criteres {
  /** Vide, `ACTEUR_SYSTEME`, ou un username. */
  acteur: string;
  action: string;
  resultat: Resultat | "";
  /** `correlationId` d'une exécution. */
  execution: string;
  /** Username dont on veut l'histoire : ce qui le concerne et ce qu'il a fait. */
  personne: string;
  page: number;
}

function estResultat(valeur: string): valeur is Resultat {
  return RESULTATS.some((resultat) => resultat.valeur === valeur);
}

export function lireCriteres(params: Record<string, string | string[] | undefined>): Criteres {
  const premier = (cle: string): string => {
    const valeur = params[cle];
    return (Array.isArray(valeur) ? valeur[0] : valeur)?.trim() ?? "";
  };

  const resultat = premier("resultat");
  const page = Number.parseInt(premier("page"), 10);

  return {
    acteur: premier("acteur"),
    action: premier("action"),
    resultat: estResultat(resultat) ? resultat : "",
    execution: premier("execution"),
    personne: premier("personne"),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/**
 * Un événement de renommage ou de fusion, tel que le journal le porte : l'avant et
 * l'après vivent dans `before` et `after`, en JSON libre.
 */
export interface LienDIdentifiant {
  before: unknown;
  after: unknown;
}

function usernameDe(charge: unknown): string | null {
  if (typeof charge !== "object" || charge === null) {
    return null;
  }
  const brut = (charge as Record<string, unknown>)["username"];
  return typeof brut === "string" && brut.length > 0 ? brut : null;
}

/**
 * Tous les identifiants qu'une même fiche a portés, en remontant et en descendant
 * la chaîne des renommages et des fusions.
 *
 * Sans elle, l'histoire d'un compte se coupe au premier renommage : les événements
 * antérieurs nomment un identifiant que plus rien ne relie à la fiche d'aujourd'hui.
 * La chaîne se parcourt dans les deux sens, et l'ensemble des identifiants déjà vus
 * tient lieu de garde : une boucle fabriquée à la main ne doit pas faire tourner
 * l'écran indéfiniment.
 */
export function identifiantsLies(liens: readonly LienDIdentifiant[], username: string): string[] {
  if (username === "") {
    return [];
  }

  const voisins = new Map<string, Set<string>>();
  const relier = (de: string, vers: string): void => {
    const deja = voisins.get(de) ?? new Set<string>();
    deja.add(vers);
    voisins.set(de, deja);
  };

  for (const lien of liens) {
    const avant = usernameDe(lien.before);
    const apres = usernameDe(lien.after);
    if (avant === null || apres === null || avant === apres) {
      continue;
    }
    relier(avant, apres);
    relier(apres, avant);
  }

  const vus = new Set([username]);
  const aVisiter = [username];

  while (aVisiter.length > 0) {
    const courant = aVisiter.pop() as string;
    for (const voisin of voisins.get(courant) ?? []) {
      if (!vus.has(voisin)) {
        vus.add(voisin);
        aVisiter.push(voisin);
      }
    }
  }

  return [...vus].sort();
}

export function versFiltre(
  criteres: Criteres,
  alias: readonly string[] = [],
): Prisma.AuditEventWhereInput {
  const filtre: Prisma.AuditEventWhereInput = {};

  if (criteres.acteur === ACTEUR_SYSTEME) {
    filtre.actorKind = "SYSTEM";
  } else if (criteres.acteur !== "") {
    filtre.actorUsername = criteres.acteur;
  }
  if (criteres.action !== "") {
    filtre.action = criteres.action;
  }
  if (criteres.resultat !== "") {
    filtre.result = criteres.resultat;
  }
  if (criteres.execution !== "") {
    filtre.correlationId = criteres.execution;
  }
  if (criteres.personne !== "") {
    // Les cibles qui portent sur quelqu'un le nomment en fin d'identifiant, après
    // le type de constat. Chercher le suffixe plutôt qu'un champ dédié évite de
    // dupliquer le username sur chaque événement, au prix de cette convention.
    //
    // La recherche porte sur tous les identifiants que cette fiche a portés : une
    // fusion et un renommage n'ont pas à couper l'histoire d'un compte en deux.
    //
    // Le troisième terme ne se restreint plus aux sessions, et c'est un changement de
    // définition : ce filtre répond désormais « ce qui la concerne ou ce qu'elle a
    // fait », là où il ne rendait de ses propres gestes que ses connexions. Tant que
    // seuls des opérateurs écrivaient, leurs gestes se lisaient sur les fiches qu'ils
    // touchaient ; quelqu'un qui agit sur son propre dossier n'apparaîtrait, sans ce
    // terme, dans aucune histoire, pas même la sienne.
    const identifiants = alias.includes(criteres.personne) ? alias : [criteres.personne, ...alias];
    filtre.OR = identifiants.flatMap((identifiant) => [
      { targetId: identifiant },
      { targetId: { endsWith: `:${identifiant}` } },
      { actorUsername: identifiant },
    ]);
  }

  return filtre;
}

export function nombreDePages(total: number): number {
  return Math.max(1, Math.ceil(total / TAILLE_PAGE));
}

export function auMoinsUnFiltre(criteres: Criteres): boolean {
  const { acteur, action, resultat, execution, personne } = criteres;
  return acteur !== "" || action !== "" || resultat !== "" || execution !== "" || personne !== "";
}

export function lienJournal(criteres: Criteres, remplacements: Partial<Criteres> = {}): string {
  const fusion: Criteres = { ...criteres, ...remplacements };
  const query = new URLSearchParams();

  if (fusion.acteur !== "") {
    query.set("acteur", fusion.acteur);
  }
  if (fusion.action !== "") {
    query.set("action", fusion.action);
  }
  if (fusion.resultat !== "") {
    query.set("resultat", fusion.resultat);
  }
  if (fusion.execution !== "") {
    query.set("execution", fusion.execution);
  }
  if (fusion.personne !== "") {
    query.set("personne", fusion.personne);
  }
  if (fusion.page > 1) {
    query.set("page", String(fusion.page));
  }

  const chaine = query.toString();
  return chaine === "" ? "/journal" : `/journal?${chaine}`;
}
