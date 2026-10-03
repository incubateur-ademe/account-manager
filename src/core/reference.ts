import type { OwnedReference, PlannedStep } from "@/core/connector";
import { autoriseUneRevocation } from "@/core/rapprochement";
import type { OnOffboard } from "@/generated/prisma/enums";

/** Une référence telle que le socle la lit pour un départ, déjà réduite à ce que le plan voit. */
export interface ReferenceLue {
  provider: string;
  resourceExternalId: string;
  resourceLabel: string;
  url: string | null;
  onOffboard: OnOffboard;
  /** Comment le compte propriétaire a été rattaché à la personne. */
  matchMethod: string;
}

const GESTE: Record<Exclude<OnOffboard, "KEEP">, OwnedReference["fate"]> = {
  ARCHIVE: "archive",
  TRANSFER: "transfer",
};

/**
 * Les objets possédés qui appellent un geste au départ, par système.
 *
 * `KEEP` ne produit rien : on ne fabrique pas du travail pour dire qu'il n'y en a pas. Et une
 * ressemblance n'ouvre aucun geste : archiver la page de quelqu'un d'autre au motif qu'un
 * login ressemblait est une bévue visible de tous. La vie de la référence n'est pas jugée
 * ici, le socle ne remet que des lignes déjà retenues.
 */
export function referencesAgissantes(
  lignes: readonly ReferenceLue[],
): ReadonlyMap<string, readonly OwnedReference[]> {
  const parSysteme = new Map<string, OwnedReference[]>();
  for (const ligne of lignes) {
    if (ligne.onOffboard === "KEEP" || !autoriseUneRevocation(ligne.matchMethod)) {
      continue;
    }
    const reference: OwnedReference = {
      resourceExternalId: ligne.resourceExternalId,
      resourceLabel: ligne.resourceLabel,
      ...(ligne.url === null ? {} : { url: ligne.url }),
      fate: GESTE[ligne.onOffboard],
    };
    parSysteme.set(ligne.provider, [...(parSysteme.get(ligne.provider) ?? []), reference]);
  }
  return parSysteme;
}

/** Ce que le connecteur dit d'un objet, dans les mots de son système. */
export interface TexteDeReference {
  /** L'objet, avec son article : « le dépôt incubateur-ademe/annuaire ». */
  designation: string;
  runbook: string;
  /** Le libellé du champ où se saisit le repreneur d'un transfert. */
  repreneur: string;
  /** Le genre de la désignation, pour accorder le critère de fin. */
  feminin: boolean;
}

/**
 * L'étape qu'un objet possédé appelle au départ : archiver ou transférer, jamais supprimer,
 * à la main, avec le repreneur saisi au pointage pour un transfert.
 *
 * Sa clé désigne l'objet et non le compte : deux comptes d'une même personne qui possèdent
 * le même objet n'en font qu'une étape. Ses paramètres ne portent que l'objet, que
 * l'empreinte suit.
 */
export function etapeDeReference(
  systemKey: string,
  reference: OwnedReference,
  texte: TexteDeReference,
): PlannedStep {
  const transfert = reference.fate === "transfer";
  const geste = transfert ? "Transférer" : "Archiver";
  const e = texte.feminin ? "e" : "";

  return {
    systemKey,
    capability: "reference",
    tier: "manual",
    action: transfert ? "transferer" : "archiver",
    label: `${geste} ${texte.designation}`,
    params: { objet: reference.resourceExternalId },
    riskLevel: "high",
    expectedState: transfert ? { transfere: true } : { archive: true },
    idempotencyKey: `${systemKey}:reference:${reference.resourceExternalId}`,
    manual: {
      title: `${geste} ${texte.designation}`,
      runbook: texte.runbook,
      ...(reference.url === undefined ? {} : { deeplink: reference.url }),
      doneWhen: transfert
        ? `${majuscule(texte.designation)} a un nouveau responsable, et n'a pas été supprimé${e}.`
        : `${majuscule(texte.designation)} est archivé${e}, et n'a pas été supprimé${e}.`,
      ...(transfert ? { saisie: { libelle: texte.repreneur, obligatoire: true } } : {}),
    },
  };
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
