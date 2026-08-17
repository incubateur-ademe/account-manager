import {
  type CompteDeServiceConnu,
  type MethodeRapprochement,
  rapprocher,
} from "@/core/rapprochement";
import type { MatchMethod } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";

export interface ResultatRapprochement {
  examinees: number;
  rattachees: number;
  parMethode: Record<MethodeRapprochement, number>;
}

/**
 * Le rapprochement ne repasse jamais sur ce qui est déjà rattaché. Une identité liée
 * l'a été soit par une collecte antérieure, soit par un opérateur qui a tranché :
 * dans les deux cas, la recalculer chaque nuit finirait par défaire un arbitrage
 * humain sans que personne ne s'en aperçoive.
 */
export async function rapprocherIdentites(correlationId: string): Promise<ResultatRapprochement> {
  const isolees = await prisma.externalIdentity.findMany({
    where: { personId: null, serviceAccountId: null, matchMethod: "NONE", vanishedAt: null },
    select: { id: true, provider: true, externalId: true, handle: true },
  });

  const parMethode: Record<MethodeRapprochement, number> = {
    DECLARED: 0,
    GITHUB_LOGIN: 0,
    EMAIL_EXACT: 0,
    HEURISTIC: 0,
    NONE: 0,
  };

  if (isolees.length === 0) {
    return { examinees: 0, rattachees: 0, parMethode };
  }

  const [personnes, comptes] = await Promise.all([
    prisma.person.findMany({
      where: { vanishedAt: null },
      select: {
        id: true,
        username: true,
        githubLogin: true,
        primaryEmail: true,
        communicationEmail: true,
      },
    }),
    prisma.serviceAccount.findMany({ select: { id: true, key: true } }),
  ]);

  // Les identités d'un compte de service sont déclarées dans la politique, pas
  // constatées : c'est une affirmation de l'incubateur sur ce qu'il possède.
  const declarees = new Map(
    policy().serviceAccounts.map((compte) => [compte.key, compte.identities]),
  );
  const comptesConnus: CompteDeServiceConnu[] = comptes.map((compte) => ({
    id: compte.id,
    key: compte.key,
    identites: declarees.get(compte.key) ?? [],
  }));

  let rattachees = 0;

  for (const identite of isolees) {
    const trouve = rapprocher(identite, personnes, comptesConnus);
    parMethode[trouve.methode] += 1;

    if (trouve.methode === "NONE") {
      continue;
    }

    await prisma.externalIdentity.update({
      where: { id: identite.id },
      data: {
        personId: trouve.personId,
        serviceAccountId: trouve.serviceAccountId,
        matchMethod: trouve.methode as MatchMethod,
      },
    });
    rattachees += 1;
  }

  const resultat = { examinees: isolees.length, rattachees, parMethode };

  audit({
    actorKind: "SYSTEM",
    action: "identite.rapprochement",
    targetType: "identite",
    correlationId,
    after: resultat,
    result: "SUCCESS",
  });

  return resultat;
}
