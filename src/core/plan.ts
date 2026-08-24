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

/**
 * D'où vient une étape. `connecteur` pour ce qu'un système sait dire de lui-même,
 * `modele:*` pour ce qu'un humain a déclaré et qu'aucun système ne connaît.
 */
export type OrigineEtape = "connecteur" | "modele:incubateur" | `modele:startup:${string}`;

export interface OrigineDEtapes {
  origine: OrigineEtape;
  etapes: readonly PlannedStep[];
}

export interface EtapeAssemblee {
  etape: PlannedStep;
  origine: OrigineEtape;
  /** Rang de lecture, strictement croissant sur les étapes retenues. */
  ordre: number;
}

export type RaisonDEcart = "doublon" | "non-autorise" | "saisie-illisible";

export interface EtapeEcartee {
  etape: PlannedStep;
  origine: OrigineEtape;
  raison: RaisonDEcart;
}

export interface Assemblage {
  etapes: readonly EtapeAssemblee[];
  /**
   * Ce que l'assemblage n'a pas retenu, et pourquoi. Écarter sans bruit une étape
   * que quelqu'un a pris la peine de déclarer est exactement la panne muette que cet
   * outil existe pour éviter : l'écran affiche cette liste.
   */
  ecartees: readonly EtapeEcartee[];
}

/**
 * Rang d'une origine dans le plan assemblé, et clé de départage à rang égal.
 *
 * L'incubateur prime, puis les startups par `ghid` croissant, puis les connecteurs.
 * Le rang se lit dans l'origine elle-même plutôt que dans l'ordre où l'appelant a
 * fourni ses listes : un ordre qui dépend de l'appelant est un ordre qu'un appelant
 * finira par changer sans le savoir, et l'empreinte suivrait.
 */
function rangDeLOrigine(origine: OrigineEtape): [number, string] {
  if (origine === "modele:incubateur") {
    return [0, ""];
  }
  if (origine === "connecteur") {
    return [2, ""];
  }
  return [1, origine.slice("modele:startup:".length)];
}

/**
 * Réunit les origines d'un plan en une seule liste ordonnée.
 *
 * Le premier arrivé gagne et garde sa place : deux origines qui demandent le même
 * geste le demandent une fois, et c'est la plus prioritaire qui le porte. Le
 * dédoublonnage se fait sur `idempotencyKey`, une seule règle pour les trois
 * origines, parce que c'est la clé qui dit « ce geste-là, sur ce système-là, pour
 * cette personne-là ».
 *
 * Rien n'accède ici à la base ni à l'horloge : l'ordre d'un plan doit se rejouer à
 * l'identique, sans quoi son empreinte changerait d'un calcul à l'autre et un plan
 * confirmé se dirait obsolète tout seul.
 */
export function assembler({ origines }: { origines: readonly OrigineDEtapes[] }): Assemblage {
  const triees = [...origines].sort((a, b) => {
    const [rangA, cleA] = rangDeLOrigine(a.origine);
    const [rangB, cleB] = rangDeLOrigine(b.origine);
    return rangA - rangB || cleA.localeCompare(cleB, "fr");
  });

  const etapes: EtapeAssemblee[] = [];
  const ecartees: EtapeEcartee[] = [];
  const vues = new Set<string>();

  for (const { origine, etapes: proposees } of triees) {
    for (const etape of proposees) {
      if (vues.has(etape.idempotencyKey)) {
        ecartees.push({ etape, origine, raison: "doublon" });
        continue;
      }
      vues.add(etape.idempotencyKey);
      etapes.push({ etape, origine, ordre: etapes.length });
    }
  }

  return { etapes, ecartees };
}
