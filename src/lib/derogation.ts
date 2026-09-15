import {
  cleDeCible,
  couvertureParCible,
  type Derogation,
  derogationsEnCours,
  lireCible,
} from "@/core/derogation";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";

/**
 * Ce que les deux sources rendent, et ce qu'elles n'ont pas su rendre.
 *
 * Les illisibles remontent au lieu de se loguer ici : une tolérance qu'on ne comprend pas
 * ne couvre rien, et qui l'apprend décide de ce qu'il en fait. La collecte les imprime
 * dans son compte rendu, là où quelqu'un les lira.
 */
export interface LectureDeDerogations {
  applicables: readonly Derogation[];
  illisibles: readonly string[];
}

/**
 * Les tolérances qui couvrent à l'instant demandé, de la base et de la politique.
 *
 * La table entière est lue, et le tri se fait dans le cœur plutôt que dans le `where` :
 * une seule règle décide de ce qui couvre, et un plan confirmé la rejouera à l'instant de
 * sa confirmation sans qu'une seconde version de cette règle vive en SQL. La table compte
 * quelques dizaines de lignes, ce qui rend la question de coût sans objet.
 *
 * Une entrée de politique dont la cible est illisible est écartée. Lever à sa place
 * arrêterait une collecte entière sur une faute de frappe dans un fichier versionné.
 */
export async function derogationsApplicables(instant: Date): Promise<LectureDeDerogations> {
  const lignes = await prisma.derogation.findMany({
    select: {
      id: true,
      targetType: true,
      targetId: true,
      reason: true,
      createdBy: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  const illisibles: string[] = [];
  const connues: Derogation[] = [];

  for (const entree of policy().permanentDerogations) {
    const cle = `${entree.targetType}:${entree.targetId}`;
    const cible = lireCible(cle);
    if (cible === null) {
      illisibles.push(cle);
      continue;
    }
    connues.push({
      id: `politique:${cle}`,
      cible,
      raison: entree.reason,
      responsable: entree.owner,
      provenance: "politique",
      poseeLe: null,
      echeance: null,
      leveeLe: null,
    });
  }

  for (const ligne of lignes) {
    const cle = `${ligne.targetType}:${ligne.targetId}`;
    const cible = lireCible(cle);
    if (cible === null) {
      illisibles.push(cle);
      continue;
    }
    connues.push({
      id: ligne.id,
      cible,
      raison: ligne.reason,
      responsable: ligne.createdBy,
      provenance: "base",
      poseeLe: ligne.createdAt,
      echeance: ligne.expiresAt,
      leveeLe: ligne.revokedAt,
    });
  }

  return { applicables: derogationsEnCours(connues, instant), illisibles };
}

/**
 * Ce qui couvre chacun des comptes donnés, indexé par la clé de leur cible.
 *
 * Les écrans qui montrent des comptes s'en servent pour dire lesquels sont tolérés, plutôt
 * que de refaire l'appariement chacun de leur côté : une clé composée à la main quelque
 * part finirait par diverger de celle que la réconciliation compare.
 */
export async function toleranceDesComptes(
  comptes: readonly { provider: string; externalId: string }[],
  instant: Date,
): Promise<ReadonlyMap<string, Derogation>> {
  if (comptes.length === 0) {
    return new Map();
  }
  const { applicables } = await derogationsApplicables(instant);
  const parCle = couvertureParCible(applicables);

  const couverts = new Map<string, Derogation>();
  for (const compte of comptes) {
    const cle = cleDeCible({ type: "identite", ...compte });
    const couvrante = parCle.get(cle);
    if (couvrante) {
      couverts.set(cle, couvrante);
    }
  }
  return couverts;
}
