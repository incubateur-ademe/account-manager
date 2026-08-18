import type { PlannedStep } from "@/core/connector";

/**
 * Empreinte d'un plan, calculée sur ce qui engage : quelle action, sur quel système,
 * avec quels paramètres. Ni les libellés ni l'ordre n'en font partie, un plan qui ne
 * diffère que par sa présentation étant le même plan.
 *
 * Elle existe pour une seule question : ce qu'on s'apprête à exécuter est-il encore
 * ce qui a été approuvé. Entre les deux, une collecte a pu passer et changer ce que
 * l'outil sait des accès de la personne.
 */
export function empreinteDuPlan(etapes: readonly PlannedStep[]): string {
  const empreintes = etapes
    .map((etape) =>
      [
        etape.systemKey,
        etape.capability,
        etape.action,
        etape.idempotencyKey,
        JSON.stringify(etape.params, Object.keys(etape.params).sort()),
      ].join(" "),
    )
    .sort();

  let hash = 0x811c9dc5;
  for (const caractere of empreintes.join("")) {
    hash ^= caractere.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface Peremption {
  perime: boolean;
  /** Vrai quand le plan ne décrit plus la situation observée depuis. */
  obsolete: boolean;
}

/**
 * Un plan a deux façons de cesser d'être valide, et les confondre ferait exécuter
 * pour de bon quelque chose que personne n'a approuvé sous cette forme.
 *
 * Il périme par le temps : au-delà de sa date, ce qui a été constaté est trop vieux
 * pour qu'on agisse dessus sans regarder à nouveau. Il devient obsolète par le
 * contenu : une collecte est passée entre le calcul et la confirmation, et le plan
 * recalculé ne dit plus la même chose.
 */
export function peremptionDuPlan(
  plan: { expiresAt: Date; planDigest: string },
  empreinteActuelle: string,
  maintenant: Date,
): Peremption {
  return {
    perime: plan.expiresAt.getTime() <= maintenant.getTime(),
    obsolete: plan.planDigest !== empreinteActuelle,
  };
}
