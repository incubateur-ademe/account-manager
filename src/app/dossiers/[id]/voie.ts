import { CONNECTEURS } from "@/connectors";
import { type Capability, type ResolvedCapability, resolveCapability } from "@/core/connector";
import { motDuTier } from "@/core/lexique";
import type { PlanCalcule } from "@/lib/dossier";

/** « GITHUB_TOKEN » et « OVH_APP_KEY » se lisent « GITHUB_TOKEN et OVH_APP_KEY ». */
function enumeration(mots: readonly string[]): string {
  return new Intl.ListFormat("fr", { type: "conjunction" }).format(mots);
}

/**
 * Ce que chaque geste du plan vaudrait aujourd'hui, credentials en main.
 *
 * Le plan affiche le tier figé, qui est celui qui a été approuvé, mais ce n'est pas
 * toujours celui qui s'appliquera : la boucle d'exécution recalcule le plan et suit la
 * voie du jour. Taire l'écart afficherait un tier théorique, exactement ce que ce
 * produit s'interdit, et un opérateur lirait « à faire à la main » sur une étape que la
 * machine s'apprête à exécuter.
 *
 * Les sondes ne regardent que l'environnement, sans appel sortant, et ne sont
 * interrogées que pour les systèmes que ce plan touche.
 */
export async function voiesDuJour(
  etapes: readonly { systemKey: string; capability: string }[],
): Promise<ReadonlyMap<string, ResolvedCapability>> {
  // Un geste sur un objet possédé est toujours à la main : sa capacité dit ce que le système
  // sait lire, et la résoudre promettrait une voie automatique qui n'existe pas.
  const attendues = new Set(
    etapes
      .filter(({ capability }) => capability !== "reference")
      .map(({ systemKey, capability }) => `${systemKey}:${capability}`),
  );
  const resolues = new Map<string, ResolvedCapability>();

  for (const connecteur of CONNECTEURS) {
    const { contract } = connecteur;
    const utiles = [...attendues].filter((cle) => cle.startsWith(`${contract.key}:`));
    if (utiles.length === 0) {
      continue;
    }

    const sondes = await connecteur.probe();
    for (const cle of utiles) {
      const capacite = cle.slice(contract.key.length + 1) as Capability;
      resolues.set(
        cle,
        resolveCapability(capacite, contract.capabilities[capacite], sondes, contract.runbook),
      );
    }
  }

  return resolues;
}

/**
 * Le tier que le plan recalculé donne à chaque étape figée, sous la clé qu'elle porte en
 * base.
 *
 * Rapprochées sur la clé d'idempotence, comme la boucle d'exécution le fait :
 * l'enregistrement la suffixe par l'identifiant du plan, ce qui la rend unique en base
 * sans changer ce qu'elle désigne. Une clé qui ne se retrouve pas laisse l'écran muet sur
 * la voie du jour plutôt que de la deviner.
 */
export function tiersDuJour(
  planId: string,
  actuel: Pick<PlanCalcule, "etapes"> | null,
): ReadonlyMap<string, string> {
  return new Map(
    (actuel?.etapes ?? []).map(({ etape }) => [`${etape.idempotencyKey}:${planId}`, etape.tier]),
  );
}

/**
 * Ce qu'il faut dire d'une étape en plus de son tier figé : la voie du jour quand elle
 * diffère, et ce qui manque pour faire mieux quand une meilleure existe sans être
 * praticable.
 *
 * La voie du jour vient du plan recalculé et non de `resolveCapability`, et l'écart
 * n'est pas théorique : la résolution ne parle que de credentials, quand un connecteur
 * dégrade aussi pour une donnée qui manque, tel un identifiant GitHub sûr. Annoncer
 * « automatique » sur la foi du seul jeton ferait promettre un geste que la boucle
 * n'emprunterait pas. `degradedFrom`, lui, garde sa raison d'être : c'est le seul
 * endroit qui nomme le credential absent.
 */
export function voieLisible(
  tierFige: string,
  tierDuJour: string | undefined,
  resolue: ResolvedCapability | undefined,
): string | null {
  const libelleDe = (tier: string) => motDuTier(tier).libelle;
  const manquants = resolue?.degradedFrom?.missing ?? [];
  const manque =
    tierDuJour !== "auto" && resolue?.degradedFrom
      ? `Elle serait ${libelleDe(resolue.degradedFrom.tier)} si ${enumeration(manquants)} ${manquants.length > 1 ? "étaient renseignés" : "était renseigné"}.`
      : "";

  if (tierDuJour === undefined || tierDuJour === tierFige) {
    return manque === "" ? null : manque;
  }

  return `Ce plan a figé « ${libelleDe(tierFige)} » ; aujourd'hui cette étape est ${libelleDe(tierDuJour)}, et c'est ce qui vaudra au lancement. ${manque}`.trim();
}
