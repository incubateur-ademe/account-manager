import type { PlannedStep, Tier } from "@/core/connector";
import { type Acteur, combinaisonValide } from "@/core/dossier";

/**
 * Empreinte d'un plan, calculée sur ce qui engage : quelle action, sur quel système,
 * avec quels paramètres. Ni les libellés ni l'ordre n'en font partie, un plan qui ne
 * diffère que par sa présentation étant le même plan.
 *
 * Elle existe pour une seule question : ce qu'on s'apprête à exécuter est-il encore
 * ce qui a été approuvé. Entre les deux, une collecte a pu passer et changer ce que
 * l'outil sait des accès de la personne.
 */
function clesProfondes(valeur: unknown, cles: Set<string>): void {
  if (Array.isArray(valeur)) {
    for (const element of valeur) {
      clesProfondes(element, cles);
    }
    return;
  }
  if (valeur === null || typeof valeur !== "object") {
    return;
  }

  for (const [cle, sous] of Object.entries(valeur)) {
    cles.add(cle);
    clesProfondes(sous, cles);
  }
}

/**
 * Les paramètres d'une étape, sérialisés à clés triées et à tous les niveaux.
 *
 * Le second argument de `JSON.stringify` n'est pas un ordre, c'est un filtre de clés, et
 * il s'applique à chaque objet rencontré quelle que soit sa profondeur : borné aux clés
 * du premier niveau, il faisait disparaître de l'empreinte tout sous-objet, si bien que
 * deux étapes qui n'en diffèrent que par lui devenaient indiscernables et passaient sous
 * la garde d'écart. Le filtre porte donc les clés de tous les niveaux, ce qui les trie du
 * même coup partout.
 *
 * Sur des paramètres plats, il vaut exactement les clés triées du premier niveau : à
 * caractère près, l'empreinte des plans déjà confirmés ne bouge pas, et c'est un
 * invariant. La faire bouger dirait obsolètes tous les plans en vol.
 */
function parametresCanoniques(params: Record<string, unknown>): string {
  const cles = new Set<string>();
  clesProfondes(params, cles);

  return JSON.stringify(params, [...cles].sort());
}

/** L'acteur d'une étape qui n'en nomme pas : celui à qui tout revenait avant que la question se pose. */
const ACTEUR_PAR_DEFAUT: Acteur = "OPERATOR";

export function empreinteDuPlan(etapes: readonly PlannedStep[]): string {
  const empreintes = etapes
    .map((etape) =>
      [
        etape.systemKey,
        etape.capability,
        etape.action,
        etape.idempotencyKey,
        // Qui doit agir et qui doit contrôler entrent dans ce qu'on approuve : une
        // étape confiée à la personne concernée n'est pas la même étape que la même
        // confiée à un opérateur. Une étape muette compte comme une étape d'opérateur
        // sans contrôle, la valeur qu'elle prendra en base.
        etape.expectedActor ?? ACTEUR_PAR_DEFAUT,
        etape.validationBy ?? "",
        parametresCanoniques(etape.params),
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
export function plusValableApres(expiresAt: Date, maintenant: Date): boolean {
  return expiresAt.getTime() <= maintenant.getTime();
}

export function peremptionDuPlan(
  plan: { expiresAt: Date; planDigest: string },
  empreinteActuelle: string,
  maintenant: Date,
): Peremption {
  return {
    perime: plusValableApres(plan.expiresAt, maintenant),
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

/**
 * Refuse net un plan dont une étape porte une répartition des rôles qui n'existe pas.
 *
 * Elle lève au lieu de rendre un motif, et c'est voulu : elle tient seule un invariant
 * que la base ne double pas, là où le reste des refus de construction se lit dans une
 * liste que l'appelant regarde. Une étape impossible doit mourir là où elle est
 * écrite, pas à l'affichage, sans quoi elle attendrait pour toujours un validateur qui
 * ne peut pas exister.
 *
 * Le message nomme l'étape et la répartition qu'elle porte : ce qui sort d'ici est un
 * défaut de construction du plan, et le corriger demande de savoir laquelle des trois
 * origines l'a proposée.
 */
export function exigerDesCombinaisonsValides(etapes: readonly PlannedStep[]): void {
  const impossibles = etapes.filter(
    (etape) =>
      !combinaisonValide(etape.expectedActor ?? ACTEUR_PAR_DEFAUT, etape.validationBy ?? null),
  );

  if (impossibles.length === 0) {
    return;
  }

  const lignes = impossibles.map(
    (etape) =>
      `  ${etape.systemKey} / ${etape.action} « ${etape.label} » : ${etape.expectedActor ?? ACTEUR_PAR_DEFAUT} agit, ${etape.validationBy} contrôle`,
  );

  throw new Error(
    `Ce plan porte une répartition des rôles qui n'existe pas :\n${lignes.join("\n")}`,
  );
}

/**
 * Les tiers où la boucle d'exécution appelle le connecteur elle-même, et il n'y en a
 * qu'un.
 *
 * `assisted` n'y figure pas, et c'est une décision plutôt qu'un oubli : aucun connecteur
 * ne le déclare aujourd'hui, et la boucle n'en saurait rien faire d'autre qu'appeler
 * `execute` comme sur un tier automatique, c'est-à-dire tout sauf l'assistance que ce
 * tier promet. Un tier promis mais non tenu comptait dans le plafond de masse des étapes
 * que rien n'exécute, et annonçait à l'écran un geste que personne ne fait. Le jour où un
 * connecteur déclare une voie assistée, l'ajouter ici et lui donner sa conduite dans la
 * boucle est le même geste.
 *
 * Ce que le plafond de masse borne est ce que la machine ferait sans qu'un humain
 * touche chaque ligne : une étape manuelle est déjà bornée par la main qui la coche,
 * une étape sans voie n'est pas exécutée du tout.
 */
const TIERS_EXECUTES: readonly Tier[] = ["auto"];

export function estExecutable(etape: PlannedStep): boolean {
  return TIERS_EXECUTES.includes(etape.tier);
}

export interface Masse {
  /** Nombre d'étapes que la boucle toucherait. */
  executables: number;
  seuil: number;
  depasse: boolean;
}

/**
 * Le plafond de masse, seul garde-fou que ce produit conserve.
 *
 * Il porte sur le nombre d'étapes exécutables d'un plan, et non sur une gravité ou une
 * proportion : un plan anormalement gros est le signe le plus fiable d'un calcul qui a
 * dérapé, un profil recopié de travers ou un catalogue qui a fait entrer tout le parc
 * dans une seule arrivée. La mesure est locale, elle se lit sans rien interroger, et
 * elle ne dépend d'aucun état antérieur.
 *
 * Le seuil arrive par paramètre parce qu'il vit dans la politique et non ici. Il
 * dépend en effet du déploiement : le nombre d'étapes automatiques d'une arrivée
 * nominale suit le nombre de systèmes couverts et la taille des profils, tous deux
 * déclarés hors du code. Une constante de module aurait choisi entre se déclencher sur
 * chaque plan le jour où un quatrième connecteur atterrit, et ne se déclencher jamais.
 * C'est ce qui la distingue de `PLANCHER_ARRIVEES`, qui dit qu'en deçà de cinq une
 * vague n'en est pas une : celle-là est une propriété de la règle, vraie quel que soit
 * le parc, donc elle reste dans le noyau ; celle-ci se règle comme `maxScopeDrop`.
 */
export function masseDuPlan(etapes: readonly PlannedStep[], seuil: number): Masse {
  const executables = etapes.filter(estExecutable).length;
  return { executables, seuil, depasse: executables > seuil };
}

/**
 * Ce qui manque pour partir, ou rien.
 *
 * `confirmee` est un geste humain explicite et rien d'autre : ni case pré-cochée, ni
 * paramètre d'URL, ni valeur par défaut. Le refus nomme ce qu'il refuse et ce qu'il
 * faut faire, comme tous les refus de ce produit.
 */
export function refusDeMasse(masse: Masse, confirmee: boolean): string | null {
  if (!masse.depasse || confirmee) {
    return null;
  }

  return `Ce plan ferait exécuter ${masse.executables} étapes d'un coup, au-delà du plafond de ${masse.seuil}. Un plan de cette taille est le plus souvent le signe d'un calcul qui a dérapé : relisez la liste étape par étape, écartez ce qui n'a rien à y faire, puis confirmez la masse explicitement pour l'exécuter quand même.`;
}
