import { randomUUID } from "node:crypto";

import { chuteExcessive } from "@/core/collecte";
import type {
  CollectResult,
  Connector,
  ObservedGrant,
  ObservedIdentity,
  ObservedResource,
  RunContext,
} from "@/core/connector";
import type { IdKind, SyncStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";

export interface ResultatCollecte {
  provider: string;
  status: SyncStatus;
  itemsSeen: number;
  identites: { creees: number; revues: number; disparues: number };
  ressources: number;
  acces: { crees: number; revus: number; disparus: number };
  erreurs: string[];
}

const STATUT: Record<CollectResult["status"], SyncStatus> = {
  ok: "OK",
  partial: "PARTIAL",
  failed: "FAILED",
};

/**
 * Le contrat parle en minuscules, la base en majuscules. La conversion est explicite
 * plutôt que castée : deux vocabulaires qui se ressemblent sont exactement ce qui
 * finit par diverger sans que rien ne le dise.
 */
const KIND: Record<ObservedIdentity["idKind"], IdKind> = {
  opaque: "OPAQUE",
  email: "EMAIL",
  upn: "UPN",
};

async function enregistrerIdentites(
  provider: string,
  identites: readonly ObservedIdentity[],
  now: Date,
): Promise<{ creees: number; revues: number }> {
  let creees = 0;
  let revues = 0;

  for (const identite of identites) {
    const commun = {
      handle: identite.handle,
      idKind: KIND[identite.idKind],
      lastSeenAt: now,
      vanishedAt: null,
    };

    // Le rattachement à une personne n'est jamais touché ici : il relève du
    // rapprochement, et l'écraser à chaque collecte annulerait tout arbitrage humain.
    const existante = await prisma.externalIdentity.findUnique({
      where: { provider_externalId: { provider, externalId: identite.externalId } },
      select: { id: true },
    });

    if (existante) {
      await prisma.externalIdentity.update({ where: { id: existante.id }, data: commun });
      revues += 1;
    } else {
      await prisma.externalIdentity.create({
        data: { ...commun, provider, externalId: identite.externalId, firstSeenAt: now },
      });
      creees += 1;
    }
  }

  return { creees, revues };
}

async function enregistrerRessources(
  provider: string,
  ressources: readonly ObservedResource[],
): Promise<Map<string, string>> {
  const parExternalId = new Map<string, string>();

  for (const ressource of ressources) {
    const enregistree = await prisma.resource.upsert({
      where: { provider_externalId: { provider, externalId: ressource.externalId } },
      update: { label: ressource.label, url: ressource.url ?? null },
      create: {
        provider,
        externalId: ressource.externalId,
        label: ressource.label,
        url: ressource.url ?? null,
      },
      select: { id: true },
    });
    parExternalId.set(ressource.externalId, enregistree.id);
  }

  return parExternalId;
}

async function enregistrerAcces(
  provider: string,
  grants: readonly ObservedGrant[],
  ressources: ReadonlyMap<string, string>,
  now: Date,
): Promise<{ crees: number; revus: number; erreurs: string[] }> {
  let crees = 0;
  let revus = 0;
  const erreurs: string[] = [];

  for (const grant of grants) {
    const identite = await prisma.externalIdentity.findUnique({
      where: { provider_externalId: { provider, externalId: grant.identityExternalId } },
      select: { id: true },
    });

    // Un accès sans identité en face n'est pas rattachable : le signaler vaut mieux
    // que de le perdre, car c'est le connecteur qui s'est contredit.
    if (!identite) {
      erreurs.push(`accès sur une identité absente de la collecte : ${grant.identityExternalId}`);
      continue;
    }

    const resourceId =
      grant.resourceExternalId === undefined ? undefined : ressources.get(grant.resourceExternalId);

    if (resourceId === undefined) {
      erreurs.push(`accès sur une ressource absente de la collecte : ${grant.identityExternalId}`);
      continue;
    }

    const cle = {
      externalIdentityId_resourceId_role: {
        externalIdentityId: identite.id,
        resourceId,
        role: grant.role,
      },
    };

    const existant = await prisma.accessGrant.findUnique({ where: cle, select: { id: true } });
    const commun = {
      lastActivityAt: grant.lastActivityAt ?? null,
      lastSeenAt: now,
      vanishedAt: null,
    };

    if (existant) {
      await prisma.accessGrant.update({ where: { id: existant.id }, data: commun });
      revus += 1;
    } else {
      await prisma.accessGrant.create({
        data: {
          ...commun,
          externalIdentityId: identite.id,
          resourceId,
          role: grant.role,
          firstSeenAt: now,
        },
      });
      crees += 1;
    }
  }

  return { crees, revus, erreurs };
}

async function dernierRelevecomplet(provider: string): Promise<number> {
  const dernier = await prisma.syncRun.findFirst({
    where: { provider, capability: "list", status: "OK" },
    orderBy: { startedAt: "desc" },
    select: { itemsSeen: true },
  });
  return dernier?.itemsSeen ?? 0;
}

/**
 * Ce que tout connecteur partage : ouvrir une trace, lire, écrire ce qui a été vu,
 * dater ce qui a disparu, refermer la trace. Écrit une fois ici, ce socle garantit
 * que la discipline du constaté ne dépend pas de la vigilance de chaque connecteur,
 * et notamment qu'une collecte incomplète ne fasse jamais disparaître personne.
 */
export async function executerCollecte(
  connector: Connector,
  now: Date,
  correlationId: string,
): Promise<ResultatCollecte> {
  const provider = connector.contract.key;
  const vide: ResultatCollecte = {
    provider,
    status: "OK",
    itemsSeen: 0,
    identites: { creees: 0, revues: 0, disparues: 0 },
    ressources: 0,
    acces: { crees: 0, revus: 0, disparus: 0 },
    erreurs: [],
  };

  // Un système entièrement manuel ne se lit pas : son absence de collecte n'est pas
  // un échec, et lui inventer une trace laisserait croire qu'on l'a observé.
  if (!connector.list) {
    return vide;
  }

  const run = await prisma.syncRun.create({
    data: { provider, capability: "list", status: "FAILED", startedAt: now },
  });

  const ctx: RunContext = {
    runId: run.id,
    now,
    // Jamais forcé à false : l'interrupteur général est la seule chose qui autorise
    // une écriture sur un système tiers.
    dryRun: !env.ACTIONS_ENABLED,
    audit,
  };

  let lu: CollectResult;
  try {
    lu = await connector.list(ctx);
  } catch (error: unknown) {
    lu = {
      status: "failed",
      errors: [{ scope: "list", message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const erreurs = (lu.errors ?? []).map((erreur) =>
    erreur.itemRef
      ? `${erreur.scope} (${erreur.itemRef}) : ${erreur.message}`
      : `${erreur.scope} : ${erreur.message}`,
  );

  if (lu.status === "failed") {
    const echec: ResultatCollecte = { ...vide, status: "FAILED", erreurs };
    await cloreRun(run.id, now, echec);
    tracer(provider, correlationId, echec);
    return echec;
  }

  const identites = await enregistrerIdentites(provider, lu.identities, now);
  const ressources = await enregistrerRessources(provider, lu.resources);
  const acces = await enregistrerAcces(provider, lu.grants, ressources, now);
  erreurs.push(...acces.erreurs);

  let status: SyncStatus = STATUT[lu.status];
  if (acces.erreurs.length > 0 && status === "OK") {
    status = "PARTIAL";
  }

  let disparues = 0;
  let disparus = 0;

  if (status === "OK") {
    const reference = await dernierRelevecomplet(provider);

    if (chuteExcessive(reference, lu.itemsSeen, policy().thresholds.maxScopeDrop)) {
      erreurs.push(
        `chute de la collecte : ${lu.itemsSeen} éléments contre ${reference} au dernier relevé complet, aucune disparition datée`,
      );
      status = "PARTIAL";
    } else {
      const vus = lu.identities.map((identite) => identite.externalId);
      const parties = await prisma.externalIdentity.updateMany({
        where: { provider, externalId: { notIn: vus }, vanishedAt: null },
        data: { vanishedAt: now },
      });
      disparues = parties.count;

      const perdus = await prisma.accessGrant.updateMany({
        where: {
          vanishedAt: null,
          externalIdentity: { provider },
          lastSeenAt: { lt: now },
        },
        data: { vanishedAt: now },
      });
      disparus = perdus.count;
    }
  }

  const resultat: ResultatCollecte = {
    provider,
    status,
    itemsSeen: lu.itemsSeen,
    identites: { ...identites, disparues },
    ressources: ressources.size,
    acces: { crees: acces.crees, revus: acces.revus, disparus },
    erreurs,
  };

  await cloreRun(run.id, now, resultat);
  tracer(provider, correlationId, resultat);
  return resultat;
}

function tracer(provider: string, correlationId: string, resultat: ResultatCollecte): void {
  audit({
    actorKind: "SYSTEM",
    action: `sync.${provider}`,
    targetType: "system",
    targetId: provider,
    correlationId,
    after: resultat,
    result: resultat.status === "OK" ? "SUCCESS" : "FAILURE",
  });
}

async function cloreRun(id: string, now: Date, resultat: ResultatCollecte): Promise<void> {
  await prisma.syncRun.update({
    where: { id },
    data: {
      finishedAt: now,
      status: resultat.status,
      itemsSeen: resultat.itemsSeen,
      error: resultat.erreurs.length > 0 ? { messages: resultat.erreurs } : undefined,
    },
  });
}

/** Identifiant de corrélation d'une exécution, pour relier ses traces entre elles. */
export function nouvelleExecution(): string {
  return randomUUID();
}
