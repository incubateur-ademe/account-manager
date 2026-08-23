import { randomUUID } from "node:crypto";

import {
  champsConstates,
  chuteExcessive,
  chuteInstallee,
  type RefusDeDatation,
  refusDeLaTrace,
  refusRepete,
} from "@/core/collecte";
import type {
  CollectError,
  CollectResult,
  Connector,
  NonEmptyArray,
  ObservedGrant,
  ObservedIdentity,
  ObservedResource,
  RunContext,
} from "@/core/connector";
import { Prisma } from "@/generated/prisma/client";
import type { SyncStatus } from "@/generated/prisma/enums";
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
  /**
   * Ce qu'un garde-fou a refusé de dater, relu par le passage suivant pour savoir si
   * le même refus retombe. Sans cette trace structurée, reconnaître un blocage
   * installé demanderait de comparer des phrases de journal.
   */
  refus?: RefusDeDatation[];
}

const STATUT: Record<CollectResult["status"], SyncStatus> = {
  ok: "OK",
  partial: "PARTIAL",
  failed: "FAILED",
};

async function enregistrerIdentites(
  provider: string,
  identites: readonly ObservedIdentity[],
  now: Date,
): Promise<{ creees: number; revues: number }> {
  let creees = 0;
  let revues = 0;

  for (const identite of identites) {
    const { details, ...constates } = champsConstates(identite, now);

    // `DbNull` et non `null` : le type d'entrée d'une colonne Json ne l'accepte pas, et
    // omettre la clé conserverait l'ancienne valeur, ce qui ferait survivre une
    // métadonnée que le connecteur ne remonte plus.
    const commun = {
      ...constates,
      details:
        details === null
          ? Prisma.DbNull
          : details.map((detail) => ({ label: detail.label, value: detail.value })),
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

/**
 * Le contrat autorise un acces sans ressource : « membre de l'organisation » vise le
 * systeme entier et rien de plus precis. La base, elle, exige une ressource, et la
 * contrainte d'unicite d'un acces la reclame aussi. Le systeme devient donc une
 * ressource comme une autre, sous une cle reservee : les identifiants des systemes
 * cibles (depots, espaces, domaines) n'ont pas le droit de commencer par une
 * parenthese, la collision est impossible.
 *
 * Sans cela, un tel acces etait rejete comme incoherent, ce qui le perdait et faisait
 * passer tout le run en PARTIAL, donc interdisait de dater la moindre disparition.
 */
const RESSOURCE_SYSTEME = "(systeme)";

async function ressourceDuSysteme(provider: string): Promise<string> {
  const enregistree = await prisma.resource.upsert({
    where: { provider_externalId: { provider, externalId: RESSOURCE_SYSTEME } },
    update: {},
    create: {
      provider,
      externalId: RESSOURCE_SYSTEME,
      label: `${provider} (le système lui-même)`,
    },
    select: { id: true },
  });
  return enregistree.id;
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

    let resourceId: string | undefined;
    if (grant.resourceExternalId === undefined) {
      resourceId = await ressourceDuSysteme(provider);
    } else {
      resourceId = ressources.get(grant.resourceExternalId);

      // Une ressource nommee mais absente de la collecte est une contradiction du
      // connecteur, contrairement a l'absence de ressource, qui est prevue.
      if (resourceId === undefined) {
        erreurs.push(
          `accès sur une ressource absente de la collecte : ${grant.identityExternalId}`,
        );
        continue;
      }
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

/**
 * Ce que l'outil tient pour vrai en ce moment, et non ce qu'un run passe a vu.
 *
 * La reference etait le dernier run OK, si bien qu'en l'absence d'un tel run elle
 * valait zero et desarmait le garde-fou. Des identites creees par des runs partiels
 * survivaient alors a un premier run OK qui n'aurait rien rapporte : la clause
 * d'exclusion portait sur une liste vide, qui n'exclut personne, et le systeme entier
 * disparaissait d'un coup.
 *
 * L'etat de la base ne connait pas ce trou : il est vide quand il n'y a rien a perdre.
 */
async function identitesTenuesPourVivantes(provider: string): Promise<number> {
  return prisma.externalIdentity.count({ where: { provider, vanishedAt: null } });
}

/**
 * Le même point de comparaison, pour les ressources.
 *
 * Un accès porte sur une ressource, et une ressource qui cesse d'être lue emporte
 * tous les accès qu'elle portait : une liste d'équipes rendue vide par un incident du
 * fournisseur date tout le monde disparu sur un run par ailleurs vert. Le décompte
 * des identités ne voit pas ce trou, les comptes étant lus ailleurs et intacts.
 *
 * Comptées par les accès qu'elles portent encore, et non par leur seule existence :
 * `Resource` n'a pas de date de disparition, ses lignes ne s'effacent jamais, et les
 * compter toutes ferait grossir la référence à chaque équipe supprimée ou renommée
 * jusqu'à ce que le garde-fou se déclenche sur une collecte parfaitement saine.
 */
async function ressourcesTenuesPourVivantes(provider: string): Promise<number> {
  return prisma.resource.count({
    where: { provider, grants: { some: { vanishedAt: null } } },
  });
}

/**
 * Ce que tout connecteur partage : ouvrir une trace, lire, écrire ce qui a été vu,
 * dater ce qui a disparu, refermer la trace. Écrit une fois ici, ce socle garantit
 * que la discipline du constaté ne dépend pas de la vigilance de chaque connecteur,
 * et notamment qu'une collecte incomplète ne fasse jamais disparaître personne.
 */
/**
 * Rend les écarts constatés par le diagnostic du connecteur, ou `undefined` quand il
 * n'en porte pas ou que tout est conforme.
 *
 * Un diagnostic qui échoue de lui-même compte comme un écart : ne pas savoir dire si
 * la forme a changé n'autorise pas à supposer qu'elle n'a pas changé.
 */
async function ausculter(
  connector: Connector,
  ctx: RunContext,
): Promise<NonEmptyArray<CollectError> | undefined> {
  if (!connector.diagnose) {
    return undefined;
  }

  let constats: readonly CollectError[];
  try {
    constats = (await connector.diagnose(ctx)).findings;
  } catch (error: unknown) {
    constats = [
      {
        scope: "diagnostic",
        message: `diagnostic impraticable : ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  const [premier, ...suivants] = constats;
  return premier ? [premier, ...suivants] : undefined;
}

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

  // Un système entièrement manuel ne se lit pas. Ce n'est pas un échec, et lui
  // inventer un relevé laisserait croire qu'on l'a observé : la trace dit donc qu'il
  // n'a pas été lu, ce qui n'est pas la même chose que de n'en laisser aucune.
  if (!connector.list) {
    return noterSystemeNonLu(provider, "système sans capacité de lecture", now, correlationId);
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

  // Le diagnostic, quand le connecteur en porte un, décide si la lecture a lieu. Un
  // système dont la forme a changé se lit peut-être encore, mais ce qu'on en tirerait
  // n'aurait plus le sens qu'on lui prête : ne rien écrire vaut mieux qu'écrire ce
  // qu'on ne sait plus interpréter.
  const ecarts = await ausculter(connector, ctx);

  let lu: CollectResult;
  if (ecarts) {
    lu = { status: "failed", errors: ecarts };
  } else {
    try {
      lu = await connector.list(ctx);
    } catch (error: unknown) {
      lu = {
        status: "failed",
        errors: [
          { scope: "list", message: error instanceof Error ? error.message : String(error) },
        ],
      };
    }
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
  const refus: RefusDeDatation[] = [];

  if (status === "OK") {
    const reference = await identitesTenuesPourVivantes(provider);
    const referenceRessources = await ressourcesTenuesPourVivantes(provider);
    const seuil = policy().thresholds.maxScopeDrop;

    const chuteIdentites = chuteExcessive(reference, lu.itemsSeen, seuil)
      ? ({ famille: "identites", observe: lu.itemsSeen, reference } as const)
      : null;
    const chuteRessources = chuteExcessive(referenceRessources, lu.resources.length, seuil)
      ? ({
          famille: "ressources",
          observe: lu.resources.length,
          reference: referenceRessources,
        } as const)
      : null;

    // Deux verrous distincts, et c'est le point. Une chute des identités interdit de
    // conclure sur qui a disparu, donc aussi sur les accès qui en dépendent. Une chute
    // des ressources n'interdit que les accès : qu'un connecteur cesse d'émettre une
    // famille de ressources ne dit rien de la personne dont la fiche vient de
    // s'éteindre, et les coupler laissait la seconde geler la première.
    const leveIdentites = chuteIdentites
      ? await consommerAutorisation(provider, chuteIdentites, run)
      : false;
    const daterIdentites = chuteIdentites === null || leveIdentites;

    // Le sort des identités d'abord, et seulement ensuite celui des ressources : une
    // autorisation consommée pendant qu'un verrou en amont tient encore serait perdue
    // sans rien dater, ferait écrire au journal qu'on a autorisé ce qui n'a pas eu
    // lieu, et retirerait ce refus de la trace du run, si bien que le passage suivant
    // repartirait de zéro et cesserait d'annoncer un blocage qui dure.
    const leveRessources =
      daterIdentites && chuteRessources
        ? await consommerAutorisation(provider, chuteRessources, run)
        : false;
    const daterAcces = daterIdentites && (chuteRessources === null || leveRessources);

    for (const [chute, leve] of [
      [chuteIdentites, leveIdentites],
      [chuteRessources, leveRessources],
    ] as const) {
      if (chute === null) {
        continue;
      }
      erreurs.push(await messageDeChute(provider, run.id, chute, Boolean(leve)));
      if (!leve) {
        status = "PARTIAL";
        // Seuls les refus qui tiennent se transmettent : un garde-fou levé n'a rien
        // bloqué, et le compter comme une répétition ferait passer pour installée une
        // situation qu'un opérateur vient précisément de dénouer.
        refus.push(chute);
      }
    }

    if (daterIdentites) {
      const vus = lu.identities.map((identite) => identite.externalId);
      const parties = await prisma.externalIdentity.updateMany({
        where: { provider, externalId: { notIn: vus }, vanishedAt: null },
        data: { vanishedAt: now },
      });
      disparues = parties.count;
    }

    if (daterAcces) {
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
    refus,
  };

  await cloreRun(run.id, now, resultat);
  tracer(provider, correlationId, resultat);
  return resultat;
}

/** Combien de passages en arrière on regarde pour dire qu'un refus s'est installé. */
const PASSAGES_RELUS = 8;

/**
 * Le message dit ce qui a été refusé, et depuis combien de passages il l'est à
 * l'identique. La différence n'est pas cosmétique : un avertissement qui retombe
 * chaque nuit avec les mêmes nombres cesse d'être lu, alors qu'il annonce que plus
 * aucune disparition ne sera jamais datée pour ce système.
 */
async function messageDeChute(
  provider: string,
  runCourant: string,
  chute: RefusDeDatation,
  leve: boolean,
): Promise<string> {
  const quoi =
    chute.famille === "identites"
      ? `chute de la collecte : ${chute.observe} éléments contre ${chute.reference} tenus pour vivants`
      : `chute des ressources : ${chute.observe} contre ${chute.reference} connues`;

  if (leve) {
    return `${quoi}, datation autorisée à la main pour ce passage`;
  }

  const precedents = await prisma.syncRun.findMany({
    where: { provider, capability: "list", id: { not: runCourant } },
    orderBy: { startedAt: "desc" },
    take: PASSAGES_RELUS,
    select: { error: true },
  });

  const repetitions = refusRepete(
    chute,
    precedents.map((run) => refusDeLaTrace(run.error, chute.famille)),
  );

  if (!chuteInstallee(repetitions)) {
    return `${quoi}, aucune disparition datée`;
  }

  return `${quoi}, aucune disparition datée : ce refus retombe à l'identique depuis ${repetitions} passages, il ne se dénouera pas seul`;
}

/**
 * Cherche une autorisation posée à la main pour ce fournisseur et cette famille, et la
 * consomme.
 *
 * Consommée, donc valable une fois : une autorisation qui durerait éteindrait le
 * garde-fou au lieu de le lever pour un passage. La trace suit l'écriture plutôt que
 * de la précéder, comme le reste de la collecte : la décision, elle, a déjà été
 * journalisée nominativement au moment où un opérateur l'a posée.
 */
async function consommerAutorisation(
  provider: string,
  chute: RefusDeDatation,
  run: { id: string; startedAt: Date },
): Promise<boolean> {
  // Posée avant que ce passage ne commence, sinon elle vaut pour le suivant : l'écran
  // promet d'autoriser la prochaine collecte, et un opérateur qui clique pendant qu'une
  // collecte tourne décide sur un état que cette collecte a déjà cessé de lire.
  const attendues = {
    provider,
    famille: chute.famille,
    consumedAt: null,
    createdAt: { lt: run.startedAt },
  };

  const autorisation = await prisma.scopeDropOverride.findFirst({
    where: attendues,
    orderBy: { createdAt: "asc" },
    select: { reason: true, createdBy: true },
  });

  if (!autorisation) {
    return false;
  }

  // Toutes celles qui attendent, et pas seulement la première : rien en base n'empêche
  // deux créations concurrentes pour le même couple, et en laisser une derrière
  // lèverait le garde-fou une seconde fois au passage d'après. Conditionné sur
  // `consumedAt` encore nul pour que deux collectes concurrentes ne se les partagent
  // pas.
  const pris = await prisma.scopeDropOverride.updateMany({
    where: attendues,
    data: { consumedAt: new Date(), consumedRunId: run.id },
  });

  if (pris.count === 0) {
    return false;
  }

  audit({
    actorKind: "SYSTEM",
    action: "sync.gardefou.leve",
    targetType: "system",
    targetId: provider,
    after: {
      famille: chute.famille,
      observe: chute.observe,
      reference: chute.reference,
      raison: autorisation.reason,
      autorisePar: autorisation.createdBy,
    },
    result: "SUCCESS",
  });

  return true;
}

function tracer(provider: string, correlationId: string, resultat: ResultatCollecte): void {
  audit({
    actorKind: "SYSTEM",
    action: `sync.${provider}`,
    targetType: "system",
    targetId: provider,
    correlationId,
    after: resultat,
    result:
      resultat.status === "OK" ? "SUCCESS" : resultat.status === "SKIPPED" ? "SKIPPED" : "FAILURE",
  });
}

/**
 * Un systeme qu'on n'a pas lu laisse une trace disant qu'on ne l'a pas lu.
 *
 * Sans elle, il sort simplement des executions, et rien ne distingue plus un systeme
 * sans ecart d'un systeme que personne ne regarde depuis des semaines. C'est
 * exactement la question a laquelle cet outil doit repondre.
 */
export async function noterSystemeNonLu(
  provider: string,
  raison: string,
  now: Date,
  correlationId: string,
): Promise<ResultatCollecte> {
  const resultat: ResultatCollecte = {
    provider,
    status: "SKIPPED",
    itemsSeen: 0,
    identites: { creees: 0, revues: 0, disparues: 0 },
    ressources: 0,
    acces: { crees: 0, revus: 0, disparus: 0 },
    erreurs: [raison],
  };

  await prisma.syncRun.create({
    data: {
      provider,
      capability: "list",
      status: "SKIPPED",
      startedAt: now,
      finishedAt: now,
      // Le champ s'appelle error, il porte ici la raison de n'avoir rien lu : ce
      // n'est pas une panne, mais ca se lit au meme endroit.
      error: { messages: [raison] },
    },
  });

  tracer(provider, correlationId, resultat);
  return resultat;
}

async function cloreRun(id: string, now: Date, resultat: ResultatCollecte): Promise<void> {
  await prisma.syncRun.update({
    where: { id },
    data: {
      finishedAt: now,
      status: resultat.status,
      itemsSeen: resultat.itemsSeen,
      error:
        resultat.erreurs.length > 0
          ? {
              messages: resultat.erreurs,
              refus: (resultat.refus ?? []).map((refus) => ({
                famille: refus.famille,
                observe: refus.observe,
                reference: refus.reference,
              })),
            }
          : undefined,
    },
  });
}

/** Identifiant de corrélation d'une exécution, pour relier ses traces entre elles. */
export function nouvelleExecution(): string {
  return randomUUID();
}
