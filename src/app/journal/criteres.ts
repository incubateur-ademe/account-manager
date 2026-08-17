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
  /** Username dont on veut l'histoire, quel que soit le type de cible. */
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

export function versFiltre(criteres: Criteres): Prisma.AuditEventWhereInput {
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
    filtre.OR = [
      { targetId: criteres.personne },
      { targetId: { endsWith: `:${criteres.personne}` } },
      { actorUsername: criteres.personne, targetType: "session" },
    ];
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
