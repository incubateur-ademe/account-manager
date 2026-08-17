import { revueDe } from "@/core/revue";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";

export interface ComptesServiceResult {
  status: "OK" | "PARTIAL" | "FAILED";
  declares: number;
  created: number;
  updated: number;
  enRetard: number;
  /** Comptes présents en base que la politique ne déclare plus. */
  horsPolitique: string[];
  errors: string[];
}

/**
 * Un compte de service est déclaré, il ne se découvre pas : la politique fait foi
 * et cette synchronisation ne fait que la reporter en base.
 *
 * `lastReviewedAt` n'est jamais écrit ici. La périodicité est déclarée, la revue
 * elle-même est un fait constaté : la réécrire depuis le YAML remettrait le
 * compteur à zéro à chaque exécution et rendrait le retard indétectable.
 */
export async function syncComptesDeService(
  now: Date,
  correlationId: string,
): Promise<ComptesServiceResult> {
  const declares = policy().serviceAccounts;
  const errors: string[] = [];
  let created = 0;
  let updated = 0;

  for (const compte of declares) {
    try {
      const data = {
        label: compte.label,
        purpose: compte.purpose,
        ownerUsername: compte.ownerUsername,
        reviewEveryDays: compte.reviewEveryDays,
      };
      const existant = await prisma.serviceAccount.findUnique({
        where: { key: compte.key },
        select: { id: true },
      });

      if (existant) {
        await prisma.serviceAccount.update({ where: { id: existant.id }, data });
        updated += 1;
      } else {
        await prisma.serviceAccount.create({ data: { ...data, key: compte.key } });
        created += 1;
      }
    } catch (error: unknown) {
      errors.push(`${compte.key} : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let enBase: {
    key: string;
    reviewEveryDays: number;
    lastReviewedAt: Date | null;
    createdAt: Date;
  }[];
  try {
    enBase = await prisma.serviceAccount.findMany({
      select: { key: true, reviewEveryDays: true, lastReviewedAt: true, createdAt: true },
    });
  } catch (error: unknown) {
    const echec: ComptesServiceResult = {
      status: "FAILED",
      declares: declares.length,
      created,
      updated,
      enRetard: 0,
      horsPolitique: [],
      errors: [...errors, error instanceof Error ? error.message : String(error)],
    };
    return echec;
  }

  // Un compte retiré de la politique n'est pas supprimé. Ses accès existent
  // toujours sur les systèmes cibles, et effacer la ligne emporterait le nom de
  // son propriétaire ainsi que le rattachement de ses identités, qui remonteraient
  // dès la collecte suivante comme comptes isolés : exactement le bruit que ce
  // modèle existe pour éviter. Le retrait se signale, il ne s'exécute pas seul.
  const declarees = new Set(declares.map((compte) => compte.key));
  const horsPolitique = enBase
    .map((compte) => compte.key)
    .filter((key) => !declarees.has(key))
    .sort();

  const enRetard = enBase.filter((compte) => revueDe(compte, now).etat === "EN_RETARD").length;

  const result: ComptesServiceResult = {
    status: errors.length === 0 ? "OK" : "PARTIAL",
    declares: declares.length,
    created,
    updated,
    enRetard,
    horsPolitique,
    errors,
  };

  audit({
    actorKind: "SYSTEM",
    action: "sync.comptes-service",
    targetType: "service-account",
    correlationId,
    after: result,
    result: result.status === "OK" ? "SUCCESS" : "FAILURE",
  });

  return result;
}
