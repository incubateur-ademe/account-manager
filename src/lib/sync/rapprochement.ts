import {
  adressesDIdentite,
  type CompteDeServiceConnu,
  type MethodeRapprochement,
  normaliserEmail,
  rapprocher,
} from "@/core/rapprochement";
import type { MatchMethod } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export interface ResultatRapprochement {
  examinees: number;
  rattachees: number;
  parMethode: Record<MethodeRapprochement, number>;
}

/**
 * Rend à la file des isolés une preuve par adresse que plus aucune adresse d'identité ne
 * soutient.
 *
 * Seule la collecte pose `EMAIL_EXACT`, un opérateur posant `DECLARED` : aucun arbitrage
 * humain n'est défait ici. Le cas visé est un compte rattaché par la secondaire qu'un
 * membre avait déclarée, du temps où elle valait preuve. Laissé en place, il resterait
 * révocable, et le départ de ce membre couperait l'accès d'un autre.
 */
async function detacherLesPreuvesPerimees(correlationId: string): Promise<void> {
  const prouvees = await prisma.externalIdentity.findMany({
    where: { matchMethod: "EMAIL_EXACT", personId: { not: null } },
    select: {
      id: true,
      handle: true,
      personId: true,
      person: { select: { primaryEmail: true, communicationEmail: true, source: true } },
    },
  });

  for (const identite of prouvees) {
    const adresse = normaliserEmail(identite.handle);
    if (identite.person === null || adresse === null) {
      continue;
    }
    if (adressesDIdentite(identite.person).includes(adresse)) {
      continue;
    }
    audit({
      actorKind: "SYSTEM",
      action: "identite.preuve-perimee",
      targetType: "identite",
      targetId: identite.id,
      correlationId,
      before: { personId: identite.personId, matchMethod: "EMAIL_EXACT" },
      after: { personId: null, matchMethod: "NONE" },
      result: "SUCCESS",
    });
    await prisma.externalIdentity.update({
      where: { id: identite.id },
      data: { personId: null, matchMethod: "NONE" },
    });
  }
}

/**
 * Le rapprochement ne repasse jamais sur ce qui est déjà rattaché. Une identité liée
 * l'a été soit par une collecte antérieure, soit par un opérateur qui a tranché :
 * dans les deux cas, la recalculer chaque nuit finirait par défaire un arbitrage
 * humain sans que personne ne s'en aperçoive. La seule exception est une preuve par
 * adresse que la règle d'identité ne reconnaît plus, rejugée dans ce même passage.
 */
export async function rapprocherIdentites(correlationId: string): Promise<ResultatRapprochement> {
  await detacherLesPreuvesPerimees(correlationId);

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
        source: true,
      },
    }),
    // Les identités déjà rattachées à un compte de service, et elles seules. Un compte
    // machine se reconnaît parce que quelqu'un l'a dit une fois, depuis l'écran : la
    // collecte ne devine pas qu'un compte n'est pas humain, et le deviner reviendrait à
    // décider qu'une personne n'en est pas une.
    prisma.serviceAccount.findMany({
      select: {
        id: true,
        key: true,
        identities: { select: { provider: true, externalId: true } },
      },
    }),
  ]);

  const comptesConnus: CompteDeServiceConnu[] = comptes.map((compte) => ({
    id: compte.id,
    key: compte.key,
    identites: compte.identities,
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
