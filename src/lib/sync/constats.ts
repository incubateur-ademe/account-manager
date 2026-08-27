import {
  arriveeMassive,
  chuteExcessive,
  FOURNISSEUR_PERIMETRE,
  REFUS_DE_VAGUE,
} from "@/core/collecte";
import {
  type ActionDeclaree,
  amorcageDesArrivees,
  type Constat,
  constatsDActionsDeclarees,
  constatsDe,
  constatsDIdentites,
  type IdentiteConstatable,
  MISE_EN_SERVICE_DES_ARRIVEES,
  type PersonneConstatable,
  type RegleArrivee,
  typesReconcilies,
  verrousDeCloture,
} from "@/core/constat";
import { dossierVivant, type SensDossier, sensOppose } from "@/core/dossier";
import type { FindingKind } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { IncubatorStartup } from "@/lib/espace-membre";

/**
 * Ce que la collecte sait d'une personne avant que la base n'y pose la date dont
 * dépend une arrivée. Elle se lit ici, à côté de la règle qui la compare, plutôt
 * qu'au milieu de la projection du périmètre : c'est une date de dossier, pas un fait
 * observé sur la personne.
 */
export type PersonneAvantArrivee = Omit<PersonneConstatable, "arriveeTraiteeLe">;

/**
 * Ce que le passage a fait des arrivées : un compte, ou une raison de n'avoir rien
 * conclu. Ce n'est pas un confort de compte rendu : le refus de vague ne bascule pas
 * le statut du run, contrairement à la chute du périmètre, si bien que cette phrase
 * est sa seule trace.
 */
export type ArriveesDuPassage =
  | { conclu: true; levees: number }
  | { conclu: false; cause: "perimetre-incomplet" | "amorcage-inconnu" | "vague"; message: string };

export interface ConstatsResult {
  ouverts: number;
  fermes: number;
  actifs: number;
  arrivees: ArriveesDuPassage;
}

export interface StartupsResult {
  revues: number;
  disparues: number;
  /** Vrai quand la chute observée a interdit de conclure à des sorties. */
  chuteRefusee: boolean;
}

/**
 * Le référentiel local des startups, qui sert à juger si une personne travaille
 * encore sur quelque chose de vivant.
 *
 * Une startup retirée de l'incubateur n'était jusqu'ici jamais datée : sa dernière
 * phase connue restait vraie pour toujours, et les constats de phase continuaient de
 * s'appuyer dessus. `vanishedAt` dit maintenant qu'on ne l'observe plus, ce qui n'est
 * pas la même chose que de la déclarer terminée.
 */
export async function syncStartups(
  startups: readonly IncubatorStartup[],
  incubatorGhid: string,
  now: Date,
  options: { daterDisparitions: boolean; maxScopeDrop: number },
): Promise<StartupsResult> {
  for (const startup of startups) {
    const data = {
      name: startup.name,
      incubatorGhid,
      currentPhase: startup.currentPhase,
      phaseStart: startup.phaseStart ? new Date(`${startup.phaseStart}T00:00:00Z`) : null,
      lastSeenAt: now,
      vanishedAt: null,
    };
    await prisma.startup.upsert({
      where: { ghid: startup.ghid },
      update: data,
      create: { ...data, ghid: startup.ghid, firstSeenAt: now },
    });
  }

  if (!options.daterDisparitions) {
    return { revues: startups.length, disparues: 0, chuteRefusee: false };
  }

  // Même garde que sur les identités, et pour la même raison : une clause
  // d'exclusion portant sur une liste vide n'exclut personne, et sortirait d'un coup
  // toutes les startups de l'incubateur.
  const reference = await prisma.startup.count({ where: { incubatorGhid, vanishedAt: null } });
  if (chuteExcessive(reference, startups.length, options.maxScopeDrop)) {
    return { revues: startups.length, disparues: 0, chuteRefusee: true };
  }

  const vues = startups.map((startup) => startup.ghid);
  const parties = await prisma.startup.updateMany({
    where: { incubatorGhid, ghid: { notIn: vues }, vanishedAt: null },
    data: { vanishedAt: now },
  });

  return { revues: startups.length, disparues: parties.count, chuteRefusee: false };
}

/**
 * Les constats sont réconciliés à chaque collecte : ceux qui ne se vérifient plus se
 * ferment tout seuls. Un constat qu'il faut clore à la main pour une situation déjà
 * résolue devient du bruit, et le bruit fait ignorer le reste.
 */
export async function syncConstats(
  personnes: readonly PersonneAvantArrivee[],
  startups: readonly IncubatorStartup[],
  identites: readonly IdentiteConstatable[],
  phasesTerminales: readonly string[],
  now: Date,
  correlationId: string,
  options: { perimetreComplet: boolean; maxNewPersonShare: number },
): Promise<ConstatsResult> {
  const phaseParStartup = new Map(startups.map((s) => [s.ghid, s.currentPhase]));

  // Les deux sens se lisent d'un coup : l'arrivée décide du constat d'arrivée, et
  // chacun borne les déclarations de l'autre, un départ exécuté défaisant à bon droit
  // ce qu'une arrivée avait donné et réciproquement.
  const [arrivees, departs] = await Promise.all([
    plansExecutes("ONBOARDING"),
    plansExecutes("OFFBOARDING"),
  ]);
  const traitees: Record<SensDossier, ReadonlyMap<string, Date>> = {
    ONBOARDING: arrivees,
    OFFBOARDING: departs,
  };
  const observees: PersonneConstatable[] = personnes.map((personne) => ({
    ...personne,
    arriveeTraiteeLe: traitees.ONBOARDING.get(personne.username) ?? null,
  }));

  // Un périmètre tronqué ne conclut rien sur les arrivées : les fiches qui manquent à
  // une réponse amputée sont exactement celles qu'on prendrait pour des arrivées.
  const amorcage = options.perimetreComplet ? await dateDAmorcage() : null;
  const regleCandidate: RegleArrivee | null = amorcage === null ? null : { amorcage };

  // Les arrivées se comptent sur un calcul complet et non sur un décompte écrit ici :
  // la règle qui juge une arrivée vit dans le noyau, et la recopier pour compter la
  // ferait diverger.
  const calcul = constatsDe(observees, phaseParStartup, phasesTerminales, now, regleCandidate);
  const levees = calcul.filter((constat) => constat.kind === "SCOPE_ENTRY").length;

  const perimetreConnu = observees.filter(
    (personne) => personne.vanishedAt === null && personne.source !== "SERVICE",
  ).length;

  // La part se mesure sur le périmètre d'avant, celui que les arrivées viennent élargir,
  // et non sur celui d'après qui les contient déjà : mesurée sur le second, la même vague
  // paraîtrait toujours plus modeste qu'elle ne l'est, et d'autant plus qu'elle est
  // grosse. C'est aussi ce qui rend le garde-fou symétrique de celui des chutes, qui
  // compare lui aussi ce qu'on observe à ce qu'on connaissait avant le passage.
  const vague = arriveeMassive(perimetreConnu - levees, levees, options.maxNewPersonShare);

  // La liste des types réconciliables décide des trois portes de ce passage, et une
  // seule fonction la rend : la levée juste en dessous, la fermeture des constats
  // ouverts, le réarmement des clôtures manuelles. « Ne pas conclure » n'est jamais
  // « produire une liste vide » : une porte qui jugerait à côté refermerait un constat
  // à tort ou lèverait un verrou qu'un opérateur a posé, et les deux pannes sont
  // muettes.
  const reconcilies = typesReconcilies({
    arriveesConcluantes: regleCandidate !== null && !vague,
  });

  // La règle du calcul retenu se lit sur cette liste : ce que la réconciliation ne
  // tient pas pour réconciliable ne se lève pas non plus. Le résultat ne s'élague pas
  // pour autant, la priorité par `continue` ayant substitué l'arrivée à d'autres
  // constats : la retirer demande un second calcul sans règle, sans quoi un
  // `INACTIVE_STARTUP` que l'arrivée masquait disparaîtrait avec elle.
  const regleRetenue = reconcilies.includes("SCOPE_ENTRY") ? regleCandidate : null;

  const constats = [
    ...(regleRetenue === regleCandidate
      ? calcul
      : constatsDe(observees, phaseParStartup, phasesTerminales, now, regleRetenue)),
    ...constatsDIdentites(identites),
    ...constatsDActionsDeclarees(await actionsDeclarees(traitees)),
  ];
  const parCle = new Map<string, Constat>(constats.map((c) => [c.dedupKey, c]));

  const existants = await prisma.finding.findMany({
    where: { closedAt: null, kind: { in: reconcilies } },
    select: { id: true, dedupKey: true },
  });
  const clesExistantes = new Set(existants.map((f) => f.dedupKey));

  // Un opérateur a jugé ces situations traitées. Les rouvrir chaque nuit tant
  // qu'elles durent reviendrait à lui resservir un travail qu'il a déjà fait, et
  // c'est ainsi qu'une file cesse d'être lue.
  const clos = await prisma.finding.findMany({
    where: {
      closedBy: { not: null },
      closedAt: { not: null },
      kind: { in: reconcilies },
    },
    select: { id: true, dedupKey: true },
  });

  const { verrouilles, aRearmer } = verrousDeCloture(clos, new Set(parCle.keys()));

  if (aRearmer.length > 0) {
    await prisma.finding.updateMany({
      where: { id: { in: aRearmer.map((f) => f.id) } },
      data: { closedBy: null },
    });
  }

  let ouverts = 0;
  for (const constat of constats) {
    if (clesExistantes.has(constat.dedupKey) || verrouilles.has(constat.dedupKey)) {
      continue;
    }
    const personne = constat.username
      ? await prisma.person.findUnique({
          where: { username: constat.username },
          select: { id: true },
        })
      : null;
    // Une situation qui s'était résolue peut se reproduire : quelqu'un revient dans
    // le périmètre puis en ressort, une startup quitte une phase terminale puis y
    // retombe. La clé de déduplication reste la même, et elle est unique sur toute la
    // table, pas seulement sur les constats ouverts. Créer sans plus de précaution
    // ferait échouer la collecte entière au moment précis où elle a quelque chose à
    // signaler. Le constat est donc rouvert, sa date d'ouverture disant depuis quand
    // dure l'épisode en cours ; les précédents restent dans le journal.
    await prisma.finding.upsert({
      where: { dedupKey: constat.dedupKey },
      update: {
        kind: constat.kind as FindingKind,
        severity: constat.severity,
        personId: personne?.id ?? null,
        externalIdentityId: constat.identiteId ?? null,
        openedAt: now,
        closedAt: null,
        closeReason: null,
      },
      create: {
        kind: constat.kind as FindingKind,
        dedupKey: constat.dedupKey,
        severity: constat.severity,
        personId: personne?.id ?? null,
        externalIdentityId: constat.identiteId ?? null,
        openedAt: now,
      },
    });
    ouverts += 1;
    audit({
      actorKind: "SYSTEM",
      action: "finding.open",
      targetType: "finding",
      targetId: constat.dedupKey,
      correlationId,
      after: { detail: constat.detail },
      result: "SUCCESS",
    });
  }

  const aFermer = existants.filter((f) => !parCle.has(f.dedupKey));
  for (const finding of aFermer) {
    await prisma.finding.update({
      where: { id: finding.id },
      data: { closedAt: now, closeReason: "ne se vérifie plus à la collecte" },
    });
    audit({
      actorKind: "SYSTEM",
      action: "finding.close",
      targetType: "finding",
      targetId: finding.dedupKey,
      correlationId,
      result: "SUCCESS",
    });
  }

  return {
    ouverts,
    fermes: aFermer.length,
    actifs: constats.length,
    arrivees: compteRenduDesArrivees({
      perimetreComplet: options.perimetreComplet,
      amorcage,
      vague,
      levees,
      perimetreConnu,
    }),
  };
}

function compteRenduDesArrivees({
  perimetreComplet,
  amorcage,
  vague,
  levees,
  perimetreConnu,
}: {
  perimetreComplet: boolean;
  amorcage: Date | null;
  vague: boolean;
  levees: number;
  perimetreConnu: number;
}): ArriveesDuPassage {
  if (!perimetreComplet) {
    return {
      conclu: false,
      cause: "perimetre-incomplet",
      message: "périmètre incomplet, aucune arrivée conclue",
    };
  }
  if (amorcage === null) {
    return {
      conclu: false,
      cause: "amorcage-inconnu",
      message: "aucune collecte n'a encore vu le périmètre, aucune arrivée conclue",
    };
  }
  if (vague) {
    return {
      conclu: false,
      cause: "vague",
      message:
        `${REFUS_DE_VAGUE} : ${levees} pour un périmètre de ${perimetreConnu}, ` +
        "aucune arrivée conclue",
    };
  }
  return { conclu: true, levees };
}

/**
 * La borne à partir de laquelle une entrée dans le périmètre est une vraie arrivée.
 *
 * `itemsSeen > 0` plutôt qu'un statut : un run qui n'a vu personne n'a ouvert les yeux
 * sur aucun périmètre, et un run partiel qui a vu du monde a bel et bien créé des
 * fiches dont la première vue ne doit pas passer pour une arrivée.
 *
 * Le premier passage ne lève rien de lui-même, et ce n'est pas un hasard : la collecte
 * du périmètre pose le même instant sur la trace du run et sur le `firstSeenAt` des
 * fiches qu'elle crée, or l'égalité est exclue de l'éligibilité. Sur cette instance
 * c'est de toute façon la constante qui fait la borne, la première collecte lui étant
 * antérieure d'une semaine.
 */
export async function dateDAmorcage(): Promise<Date | null> {
  const premiere = await prisma.syncRun.findFirst({
    where: { provider: FOURNISSEUR_PERIMETRE, capability: "list", itemsSeen: { gt: 0 } },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true },
  });

  return amorcageDesArrivees(premiere?.startedAt ?? null, MISE_EN_SERVICE_DES_ARRIVEES);
}

/**
 * Quand le dernier mouvement de ce sens a été exécuté pour chacun, pour ceux dont il
 * l'a été.
 *
 * Une seule requête pour tout le périmètre : interroger par personne ferait cent
 * allers-retours pour une règle qui tient en une comparaison de dates. `EXECUTED` et
 * lui seul, un plan à moitié exécuté laissant la personne sans une partie de ses
 * accès ; le sens se lit sur le dossier comme ailleurs, et le plan doit porter le même
 * sens que lui, non une réparation de dérive posée sous le même dossier.
 *
 * La date retenue est celle du dernier pointage et non celle de la confirmation :
 * c'est le pointage qui a fait passer le plan en `EXECUTED`, la confirmation ne dit
 * que le moment où il a été approuvé. Un plan sans étape datée retombe sur elle.
 */
async function plansExecutes(sens: SensDossier): Promise<Map<string, Date>> {
  const plans = await prisma.plan.findMany({
    where: { kind: sens, state: "EXECUTED", accessCase: { kind: sens } },
    select: {
      confirmedAt: true,
      steps: { select: { executedAt: true } },
      accessCase: { select: { person: { select: { username: true } } } },
    },
  });

  const traitees = new Map<string, Date>();

  for (const plan of plans) {
    const username = plan.accessCase?.person.username;
    if (!username) {
      continue;
    }

    let executeLe = plan.confirmedAt;
    for (const etape of plan.steps) {
      if (etape.executedAt && (executeLe === null || etape.executedAt > executeLe)) {
        executeLe = etape.executedAt;
      }
    }

    retenirLaPlusRecente(traitees, username, executeLe);
  }

  return traitees;
}

function retenirLaPlusRecente(dates: Map<string, Date>, cle: string, date: Date | null): void {
  if (date === null) {
    return;
  }
  const connue = dates.get(cle);
  if (connue === undefined || connue < date) {
    dates.set(cle, date);
  }
}

/**
 * Ce qu'on a déclaré avoir fait, confronté à ce qu'on observe.
 *
 * Une étape pointée « faite » n'est qu'une parole tant qu'une lecture du système ne
 * l'a pas confirmée. On rapproche donc chaque déclaration de trois choses : le sens
 * du dossier, l'existence du compte de la personne sur ce système, et la date de la
 * dernière relecture.
 */
async function actionsDeclarees(
  traitees: Readonly<Record<SensDossier, ReadonlyMap<string, Date>>>,
): Promise<ActionDeclaree[]> {
  const etapes = await prisma.planStep.findMany({
    // Les deux dimensions, exactement la règle d'`estSoldee` : une étape déclarée
    // faite dont personne n'a encore contrôlé la preuve n'est qu'une parole en
    // suspens, et la confronter à ce qu'on observe fermerait un constat sur elle. Un
    // refus rend d'ailleurs l'étape à `PENDING`, si bien que seul `AWAITING` se
    // rencontre ici : le dire des deux valeurs garde cette lecture alignée sur
    // `estSoldee` le jour où l'une d'elles change de sens.
    where: {
      state: "SUCCEEDED",
      executedAt: { not: null },
      validation: { notIn: ["AWAITING", "REFUSED"] },
    },
    select: {
      label: true,
      systemKey: true,
      executedAt: true,
      plan: {
        select: {
          accessCase: {
            select: {
              kind: true,
              state: true,
              person: {
                select: {
                  username: true,
                  returnedAt: true,
                  identities: { select: { provider: true, vanishedAt: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const relectures = new Map<string, Date>();
  for (const releve of await prisma.syncRun.findMany({
    where: { capability: "list", status: "OK" },
    distinct: ["provider"],
    orderBy: { startedAt: "desc" },
    select: { provider: true, startedAt: true },
  })) {
    relectures.set(releve.provider, releve.startedAt);
  }

  const declarees: ActionDeclaree[] = [];

  for (const etape of etapes) {
    const dossier = etape.plan.accessCase;
    const personne = dossier?.person;
    if (!dossier || !personne || !etape.executedAt) {
      continue;
    }

    declarees.push({
      label: etape.label,
      systemKey: etape.systemKey,
      username: personne.username,
      // Le sens se lit sur le dossier et non sur le plan : `PlanKind` porte aussi des
      // valeurs qui ne sont ni une arrivée ni un départ, et une étape sans dossier
      // n'entre pas ici.
      sens: dossier.kind,
      declareeLe: etape.executedAt,
      dossierEncoreVivant: dossierVivant(dossier.state),
      retourLe: personne.returnedAt,
      inverseeLe: traitees[sensOppose(dossier.kind)].get(personne.username) ?? null,
      compteToujoursLa: personne.identities.some(
        (identite) => identite.provider === etape.systemKey && identite.vanishedAt === null,
      ),
      relueLe: relectures.get(etape.systemKey) ?? null,
    });
  }

  return declarees;
}
