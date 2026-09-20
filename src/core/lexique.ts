import type { Tier } from "@/core/connector";
import type { SyncStatus } from "@/generated/prisma/enums";

interface MotDEcran {
  libelle: string;
  severite: "success" | "warning" | "error" | "info";
}

/**
 * Ce qu'une collecte a conclu, dit en français.
 *
 * La table vit ici et non sur l'un des écrans qui la rendent : le tableau de bord et la
 * liste des collectes annoncent la même conclusion, et deux copies finiraient par
 * nommer différemment le même état.
 *
 * `libelle` sert un badge, `explication` une phrase, et les deux se lisent séparément :
 * un badge n'a pas la place de dire ce qu'un état coûte, une phrase n'a pas à répéter
 * le badge qu'elle suit.
 */
export const LIBELLE_ETAT_COLLECTE: Record<
  SyncStatus,
  {
    libelle: string;
    explication: string;
    severite: "success" | "warning" | "error" | "info";
  }
> = {
  OK: {
    libelle: "complète",
    explication: "Les disparitions ont pu être datées.",
    severite: "success",
  },
  PARTIAL: {
    libelle: "incomplète",
    explication: "Tout n'a pas pu être conclu, et des disparitions ont pu rester non datées.",
    severite: "warning",
  },
  FAILED: {
    libelle: "en échec",
    explication: "Le système n'a pas répondu.",
    severite: "error",
  },
  SKIPPED: {
    libelle: "non lu",
    explication: "Système non lu. Ce qui s'y trouve reste inconnu.",
    severite: "info",
  },
};

/**
 * Ce qu'un système sait faire d'une étape, dit en français.
 *
 * Deux écrans le disaient et pas dans les mêmes mots : « manuel » et « indisponible »
 * sur l'inventaire des systèmes, « à faire à la main » et « sans moyen de le faire » sur
 * un dossier. Même valeur, deux noms, donc deux choses aux yeux de qui lit les deux
 * écrans. Ce sont les seconds qui restent : un tier dit ce qu'il faudra faire, pas dans
 * quelle catégorie l'outil range le système.
 */
export const LIBELLE_TIER: Record<Tier, MotDEcran> = {
  auto: { libelle: "automatique", severite: "success" },
  assisted: { libelle: "assisté", severite: "info" },
  manual: { libelle: "à faire à la main", severite: "warning" },
  // Une étape peut sortir sans aucune voie praticable : elle est émise quand même,
  // portant la marche à suivre du contrat, parce qu'une ligne d'arrivée qui manque est
  // le mode de panne que ce produit existe pour éviter.
  none: { libelle: "sans moyen de le faire", severite: "error" },
};

function estTier(valeur: string): valeur is Tier {
  // `Object.hasOwn` et non `in` : sans lui, un tier nommé « constructor » ou
  // « toString » serait tenu pour connu et rendrait un membre du prototype, donc un
  // badge vide là où le repli ci-dessous existe précisément pour afficher la valeur.
  return Object.hasOwn(LIBELLE_TIER, valeur);
}

/**
 * Le même mot, pour un tier figé dans un plan d'hier. La colonne garde la valeur du
 * jour où l'étape a été créée : une valeur retirée du code depuis n'a plus de mot ici,
 * et l'afficher telle quelle vaut mieux que de la taire sur l'écran d'où l'on agit.
 */
export function motDuTier(tier: string): MotDEcran {
  return estTier(tier) ? LIBELLE_TIER[tier] : { libelle: tier, severite: "info" };
}
