import type { Attachment } from "@/core/appartenance";
import {
  ageDuReleve,
  autrePassageCompletDepuis,
  chuteExcessive,
  type FamilleDeChute,
  FOURNISSEUR_PERIMETRE,
  fichesSansReponse,
  REFUS_D_ECHEANCE,
  REFUS_DE_DISPARITION,
  REFUS_DE_LECTURE,
  REFUS_DE_RETOUR,
  RELEVE_NON_RENOUVELE,
  type RefusDeDatation,
  releveFige,
} from "@/core/collecte";
import {
  emailDeContact,
  type MembreDetaille,
  rattachementDe,
  rattachementDeclare,
} from "@/core/membre";
import { canalDuDroit, participationVivante } from "@/core/participation";
import { declaresManquants } from "@/core/perimetre";
import { jourUTC } from "@/core/statut";
import type { PersonSource } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  fetchIncubatorMembers,
  fetchIncubatorStartups,
  fetchMemberDetail,
  type IncubatorStartup,
  mapLimit,
} from "@/lib/espace-membre";
import { policy } from "@/lib/policy";
import {
  autorisationEnAttente,
  consommerAutorisation,
  messageDeChute,
  perimerAutorisation,
} from "@/lib/sync/gardefou";

const CONCURRENCE = 8;

export interface PerimetreSyncResult {
  /** La trace de ce passage, pour qui a quelque chose à y ajouter après coup. */
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  seen: number;
  created: number;
  updated: number;
  vanished: number;
  missingDeclared: string[];
  introuvables: string[];
  /** Celles qu'il a refusé de faire disparaître sur un aveu d'ignorance trop frais. */
  retenues: string[];
  /** Celles qu'il retient sans borne, la lecture de leur fiche n'ayant pas répondu. */
  retenuesSansReponse: string[];
  /** Ce qu'ont dit les lectures de fiche qui n'ont pas répondu, personne par personne. */
  lecturesManquees: LectureManquee[];
  /** Celles dont il a effacé la disparition sans dater le retour, faute de confirmation. */
  retoursNonDates: RetourNonDate[];
  /** Celles dont il n'a pas écrit l'échéance, faute d'avoir obtenu la fiche qui la porte. */
  echeancesNonEcrites: string[];
  /**
   * Ce que le plancher de chute a refusé, dit assez précisément pour que le passage
   * suivant reconnaisse le même refus.
   *
   * Le seul garde-fou de ce module qui entretienne sa propre référence, et c'est pour
   * cela qu'il a besoin d'être reconnu : il compare l'effectif du jour à celui du
   * dernier passage complet, et son refus dégrade le passage qui le prononce, si bien
   * que la référence contre laquelle il refusera demain est celle d'avant la chute.
   * Une chute réelle qui dure ne se dénoue donc jamais d'elle-même.
   */
  chuteRefusee: RefusDeDatation | null;
  /**
   * Ce que le plancher a dit quand une autorisation nominative l'a levé pour ce
   * passage. Hors des `errors`, et c'est tout le point : levé, il n'a rien dégradé.
   */
  chuteLevee: string | null;
  errors: string[];
  startups: IncubatorStartup[];
}

/**
 * Une fiche complète dont la lecture n'a pas répondu, et ce qu'elle a dit en échouant.
 *
 * Le message est repris ici parce qu'il n'a plus d'autre sortie : cette lecture ne
 * dégrade plus le passage, donc elle ne rejoint plus `errors`, et sans lui la trace
 * dirait qu'une fiche n'a pas répondu sans jamais dire ce que la source a répondu. Or
 * c'est la seule chose qui distingue une panne d'une nuit d'un enregistrement amont
 * durablement mal formé, et la sortie de la seconde est en amont.
 */
export interface LectureManquee {
  username: string;
  message: string;
}

/**
 * Une fiche revue dont le retour n'a pas été daté, et la disparition qu'elle portait.
 *
 * La disparition n'existe plus nulle part une fois ce passage écrit : elle est
 * reprise ici parce que c'est la seule chose qui dise combien de temps l'absence
 * avait duré, et donc si ce refus est le battement d'une nuit qu'on voulait taire ou
 * le retour réel qu'on a accepté de perdre.
 */
export interface RetourNonDate {
  username: string;
  disparueLe: Date;
}

/**
 * Ce qu'un passage sait d'une personne, et ce qu'il ne sait pas.
 *
 * Un champ qui admet `undefined` le dit au sens fort : ce passage n'a pas su lire la
 * source qui le porte, il n'a donc rien à en écrire, et la collecte cesse d'affirmer
 * par défaut ce qu'elle n'a pas constaté. `missionEnd` est le seul dans ce cas, la
 * fiche complète étant la seule à le porter pour qui relève d'une équipe. Le jour où
 * un deuxième champ passera par elle, il hérite du silence en élargissant son propre
 * type : rien plus bas ne regarde les champs un par un.
 */
export interface PersonneResolue {
  username: string;
  betaUuid: string | null;
  fullname: string;
  githubLogin: string | null;
  primaryEmail: string | null;
  communicationEmail: string | null;
  missionEnd: string | null | undefined;
  attachment: Attachment;
  startups: string[];
  source: PersonSource;
}

function toDate(iso: string | null | undefined): Date | null | undefined {
  if (iso === undefined) {
    return undefined;
  }
  return iso === null ? null : new Date(`${iso}T00:00:00Z`);
}

/**
 * Tout ce que la collecte réécrit sur une fiche, et rien d'autre.
 *
 * Extrait pour être lisible d'un coup d'œil et vérifiable par un test : c'est la
 * liste qui dit ce qu'un opérateur ne peut pas saisir durablement sur une fiche
 * collectée. Le jour où quelqu'un ajoute un champ à `Person`, c'est ici qu'on voit
 * si la collecte s'est mise à écraser une décision.
 */
export function champsCollectes(personne: PersonneResolue, now: Date, retour: boolean) {
  return {
    // Le jour où une source amont connaît cet identifiant, il cesse d'être une
    // construction locale et redevient un pivot que rien n'a le droit de renommer.
    // Sans cette ligne, une fiche fabriquée puis adoptée resterait renommable.
    usernameFabricated: false,
    betaUuid: personne.betaUuid,
    fullname: personne.fullname,
    githubLogin: personne.githubLogin,
    primaryEmail: personne.primaryEmail,
    communicationEmail: personne.communicationEmail,
    // `undefined` ne touche à rien, comme pour le retour plus bas : une échéance que ce
    // passage n'a pas su lire garde celle du dernier passage qui l'a lue. L'effacer
    // ferait passer une lecture manquée pour une absence de fin de mission, et une
    // personne sans échéance ne remonte plus jamais, par aucun statut.
    missionEnd: toDate(personne.missionEnd),
    attachment: personne.attachment,
    startups: personne.startups,
    source: personne.source,
    lastSeenAt: now,
    vanishedAt: null,
    // Une fiche revue après une disparition confirmée est un retour, et c'est la
    // seule chose qui en tienne lieu : `firstSeenAt` ne bougera plus. La disparition
    // étant effacée sur la ligne du dessus, ce passage est le dernier instant où le
    // retour peut se dater, d'où le verdict en paramètre : la règle est chez
    // l'appelant, seul à savoir ce que les passages précédents ont constaté.
    // `undefined` ne touche à rien : une fiche revue sans retour établi garde la date
    // de son retour précédent, et une fiche créée ici n'en a aucune, n'étant revenue
    // de nulle part.
    returnedAt: retour ? now : undefined,
  };
}

/**
 * Un droit que l'adoption de sa fiche vient de priver de son canal.
 *
 * La collecte réécrit les adresses d'une fiche fabriquée et cesse de la dire
 * modifiable : un droit dont le canal venait de la fiche perd son entrée au milieu
 * d'un dossier, sans qu'aucun geste humain n'ait eu lieu et sans que personne ne le
 * sache. La ligne le dit, et la liste des droits marque le même canal mort ; les deux
 * sorties sont de ré-octroyer en déclarant une adresse, ou d'entrer par l'identifiant
 * beta.gouv. Un droit octroyé avec un canal explicite traverse la bascule intact et
 * n'appelle donc aucun geste : le signal se lève par droit et non par fiche, sur le
 * verdict de `canalDuDroit`, celui-là même que l'écran affiche.
 *
 * Le sujet est le droit et se nomme comme chez ses voisins, dossier et détenteur :
 * l'octroi, la révocation et l'abandon désignent tous le couple, et une seconde forme
 * sous le même `targetType` ferait deux vocabulaires dans un même registre.
 *
 * Écrite après l'écriture et non avant, contrairement à ce que fait toute action d'un
 * humain : elle ne consigne aucune intention, elle constate un fait dont la bascule est
 * la cause. L'annoncer avant la ferait affirmer sur un passage qui échouerait ensuite.
 *
 * Elle ne lit rien, et c'est son appelant qui juge du droit, sur ce que la requête
 * ouvrant `upsert` a relevé avec la ligne. Une lecture posée ici pour elle seule
 * pourrait échouer après un `update` réussi, pousser la personne dans les erreurs de la
 * boucle et faire tomber tout le passage en `PARTIAL`, lequel interdit alors de dater
 * la moindre disparition : une décision de journalisation retirerait ainsi à la
 * collecte sa capacité à constater un départ.
 */
function signalerBascule(dossierId: string, username: string, now: Date): void {
  audit({
    actorKind: "SYSTEM",
    action: "participation.canal-bascule",
    targetType: "participation",
    targetId: `${dossierId}:${username}`,
    after: { fiche: username, adopteeLe: now },
    result: "SUCCESS",
  });
}

async function upsert(
  personne: PersonneResolue,
  now: Date,
  dernierPassageComplet: Date | null,
): Promise<{ issue: "created" | "updated"; retourNonDate: Date | null }> {
  const existing = await prisma.person.findUnique({
    where: { username: personne.username },
    select: {
      id: true,
      vanishedAt: true,
      source: true,
      participations: {
        select: {
          accessCaseId: true,
          channelEmail: true,
          expiresAt: true,
          revokedAt: true,
          accessCase: { select: { state: true } },
        },
      },
    },
  });

  if (existing) {
    // Relevée avant l'écriture, qui l'efface sans condition : ce passage est le dernier
    // à savoir qu'il y avait une disparition, et sans retour daté, rien après lui ne
    // pourra dire qu'elle a existé.
    const disparueLe = existing.vanishedAt;
    const retour = autrePassageCompletDepuis(disparueLe, dernierPassageComplet);
    const champs = champsCollectes(personne, now, retour);
    const bascule = existing.source === "LOCAL" && personne.source !== "LOCAL";
    // Jugés sur la fiche telle que l'écriture qui suit va la laisser, et par le verdict
    // de l'écran : ce qui se signale est un canal qui meurt, pas une fiche qui bascule.
    const ficheAdoptee = { ...champs, username: personne.username };
    const declaresLocaux = policy().scope.local.map((entree) => entree.username);
    const orphelins = bascule
      ? existing.participations.filter(
          (droit) =>
            participationVivante(droit, droit.accessCase.state, now) &&
            !canalDuDroit(ficheAdoptee, droit.channelEmail, declaresLocaux).vivant,
        )
      : [];
    await prisma.person.update({ where: { id: existing.id }, data: champs });
    for (const droit of orphelins) {
      signalerBascule(droit.accessCaseId, personne.username, now);
    }
    return { issue: "updated", retourNonDate: retour ? null : disparueLe };
  }

  await prisma.person.create({
    data: {
      ...champsCollectes(personne, now, false),
      username: personne.username,
      firstSeenAt: now,
    },
  });
  return { issue: "created", retourNonDate: null };
}

/**
 * Le périmètre vient en entier de l'espace-membre, qui sait qui relève d'un
 * incubateur, y compris quand une startup en compte plusieurs. Le miroir public n'est
 * plus interrogé : ses vingt-quatre heures de latence n'ont pas leur place là où on
 * décide de couper des accès, et lui seul ignorait la co-incubation.
 */
export async function syncPerimetre(
  now: Date,
  correlationId: string,
): Promise<PerimetreSyncResult> {
  const run = await prisma.syncRun.create({
    data: { provider: FOURNISSEUR_PERIMETRE, capability: "list", status: "FAILED", startedAt: now },
  });

  const errors: string[] = [];
  const introuvables: string[] = [];
  let created = 0;
  let updated = 0;
  let vanished = 0;
  const resolues: PersonneResolue[] = [];
  let precedent: PassageComplet | null = null;
  let retenues: string[] = [];
  let retenuesSansReponse: string[] = [];
  const lecturesManquees: LectureManquee[] = [];
  const retoursNonDates: RetourNonDate[] = [];
  const echeancesNonEcrites: string[] = [];
  let chuteRefusee: RefusDeDatation | null = null;
  let chuteLevee: string | null = null;
  let absents: string[] = [];
  let startups: IncubatorStartup[] = [];

  try {
    const config = policy();
    const [lectureStartups, lectureMembres] = await Promise.all([
      fetchIncubatorStartups(config.scope.incubator),
      fetchIncubatorMembers(config.scope.incubator),
    ]);

    // Ce que l'espace-membre a renvoyé d'illisible ne fait pas échouer la collecte,
    // mais l'empêche de se dire complète : aucune disparition ne sera datée sur la
    // foi d'une réponse qu'on n'a comprise qu'à moitié.
    errors.push(...lectureStartups.erreurs, ...lectureMembres.erreurs);

    startups = lectureStartups.items;
    const membres = lectureMembres.items;

    const ghids = new Set(startups.map((startup) => startup.ghid));
    const rattaches = new Set(membres.map((membre) => membre.username));

    // La liste scopée n'associe aucune mission à qui relève de l'incubateur par une
    // équipe : sa fiche complète est la seule à porter son échéance.
    const aDetailler = [
      ...new Set([
        ...membres.filter((membre) => membre.attachment !== "startups").map((m) => m.username),
        ...config.scope.transverse.filter((username) => !rattaches.has(username)),
      ]),
    ];

    // Ni le 404 ni la panne ne dégradent ce passage, et c'est la même raison pour les
    // deux : ce qui dégrade un passage est ce qu'il ne peut pas nommer. Un élément que
    // la liste rend illisible sort de la réponse sans qu'aucun identifiant ne le
    // désigne, son absence ne se distingue d'un départ par rien, et le refus de
    // conclure est alors le seul filet. Une fiche complète porte un nom : se dégrader
    // pour un nom connu ne protège personne et coûte tous les vrais départs de la
    // nuit, le relevé cessant d'avancer et avec lui tous les garde-fous qui s'y
    // adossent. Les deux façons de ne pas lire se séparent plus bas, où elles n'ont
    // pas la même borne, et pas ici, où elles ne diffèrent pas.
    const details = new Map<string, MembreDetaille>();
    await mapLimit(aDetailler, CONCURRENCE, async (username) => {
      try {
        const detail = await fetchMemberDetail(username);
        if (detail) {
          details.set(username, detail);
        } else {
          introuvables.push(username);
        }
      } catch (error: unknown) {
        lecturesManquees.push({
          username,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    for (const membre of membres) {
      const rattachement = rattachementDe(membre, ghids, details.get(membre.username));
      // Relevé sur le verdict de la résolution et non sur la carte des fiches lues :
      // c'est la même décision qui se dit ici et s'écrit plus bas, et deux façons de
      // la recalculer finiraient par ne plus désigner les mêmes personnes. Pris avant
      // l'écriture, donc sans savoir s'il y avait une valeur précédente : une fiche
      // créée cette nuit y est aussi, sans rien à conserver, et c'est celle qui a le
      // plus besoin d'être nommée, les autres gardant au moins la dernière échéance
      // lue quand elle n'a, elle, aucune.
      if (rattachement.missionEnd === undefined) {
        echeancesNonEcrites.push(membre.username);
      }
      resolues.push({
        username: membre.username,
        betaUuid: membre.uuid ?? null,
        fullname: membre.fullname ?? membre.username,
        githubLogin: membre.github ?? null,
        primaryEmail: membre.primary_email ?? null,
        communicationEmail: emailDeContact(membre),
        missionEnd: rattachement.missionEnd,
        attachment: rattachement.attachment,
        startups: rattachement.startups,
        source: "BETA" as PersonSource,
      });
    }

    // Déclarés transverses que l'espace-membre ne rattache pas encore à une équipe de
    // l'incubateur : la politique fait autorité sur leur appartenance.
    for (const username of config.scope.transverse) {
      if (rattaches.has(username)) {
        continue;
      }
      const detail = details.get(username);
      if (!detail) {
        continue;
      }
      const rattachement = rattachementDeclare(detail);
      resolues.push({
        username,
        betaUuid: detail.uuid ?? null,
        fullname: detail.fullname ?? username,
        githubLogin: detail.github ?? null,
        primaryEmail: detail.primary_email ?? null,
        communicationEmail: emailDeContact(detail),
        missionEnd: rattachement.missionEnd,
        attachment: rattachement.attachment,
        startups: rattachement.startups,
        source: "BETA" as PersonSource,
      });
    }

    // Suivies à la main faute de fiche : on ne les ajoute que si l'espace-membre ne
    // les connaît pas, sa version étant toujours la plus fraîche.
    const connus = new Set(resolues.map((personne) => personne.username));
    for (const entry of config.scope.local) {
      if (connus.has(entry.username)) {
        continue;
      }
      resolues.push({
        username: entry.username,
        betaUuid: null,
        fullname: entry.username,
        githubLogin: null,
        primaryEmail: null,
        communicationEmail: null,
        missionEnd: entry.until,
        attachment: "NONE",
        startups: [],
        source: "LOCAL" as PersonSource,
      });
    }

    absents = declaresManquants(
      resolues.map((personne) => personne.username),
      config.scope.transverse,
    );

    // Le dernier passage complet sert trois fois : son effectif borne la chute, son
    // instant dit si une disparition a duré et si un angle mort a duré. Un seul relevé
    // pour les trois, sinon des garde-fous qui se réclament du même passage finissent
    // par ne plus parler du même. Le passage courant ne s'y voit pas : il s'ouvre en
    // `FAILED` et n'est promu qu'à sa clôture.
    precedent = await dernierPassageComplet();

    for (const personne of resolues) {
      try {
        const { issue, retourNonDate } = await upsert(personne, now, precedent?.startedAt ?? null);
        if (issue === "created") {
          created += 1;
        } else {
          updated += 1;
        }
        if (retourNonDate !== null) {
          retoursNonDates.push({ username: personne.username, disparueLe: retourNonDate });
        }
      } catch (error: unknown) {
        errors.push(
          `${personne.username} : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
    const failed: PerimetreSyncResult = {
      runId: run.id,
      status: "FAILED",
      seen: 0,
      created,
      updated,
      vanished: 0,
      missingDeclared: absents,
      introuvables,
      retenues: [],
      retenuesSansReponse: [],
      lecturesManquees,
      retoursNonDates,
      echeancesNonEcrites,
      chuteRefusee: null,
      chuteLevee: null,
      errors,
      startups,
    };
    await closeRun(run.id, now, failed);
    return failed;
  }

  let status: PerimetreSyncResult["status"] = errors.length === 0 ? "OK" : "PARTIAL";

  // Un run dégradé ne fait disparaître personne : une collecte tronquée conclurait
  // à tort que la moitié de l'incubateur est partie.
  if (status === "OK") {
    // Une fiche créée à la main pour nommer un compte n'existe que par lui : elle
    // n'est réclamée par aucune source amont, et la faire disparaître à la collecte
    // suivante reviendrait à effacer chaque nuit ce qu'un opérateur vient d'écrire.
    // Elle vit donc tant que son compte est observé, ou tant qu'un rattachement
    // qu'on lui a posé court encore : dire qu'une personne est là jusqu'à telle
    // date et la faire disparaître la nuit même serait se contredire.
    //
    // `source: "LOCAL"` reste en tête et hors du `OR` : une personne venue de
    // l'espace-membre qui en sort doit continuer de lever `SCOPE_EXIT`, qui est le
    // constat le plus important du système.
    const adossees = await prisma.person.findMany({
      where: {
        source: "LOCAL",
        OR: [
          { identities: { some: { vanishedAt: null } } },
          {
            startupAssignments: {
              some: { endedAt: null, until: { gte: new Date(jourUTC(now)) } },
            },
          },
        ],
      },
      select: { username: true },
    });

    const known = [
      ...resolues.map((personne) => personne.username),
      ...adossees.map((personne) => personne.username),
    ];

    // Une fiche que ce passage sait n'avoir pas lue rejoint les connues : il l'a
    // demandée, la source ne l'a pas rendue, et ce qu'un passage avoue ne pas savoir
    // ne vaut pas un départ. C'est l'inverse d'une disparition ordinaire, qui se
    // conclut d'un silence.
    //
    // Résolu avant que le plancher ne soit consulté, et non après : ce qu'un passage
    // retient fait partie du périmètre auquel il croit, donc du nombre qu'il compare
    // comme de celui qu'il laisse. Le calculer après ferait de la retenue elle-même
    // une chute, tout en laissant un relevé plus petit que le périmètre pour toute la
    // durée de la retenue.
    const rendues = await fichesRetenues(
      introuvables,
      lecturesManquees.map((lecture) => lecture.username),
      known,
      precedent,
    );
    retenues = rendues.surAveu;
    retenuesSansReponse = rendues.sansReponse;

    const reference = precedent?.itemsSeen ?? 0;
    const effectif = effectifTenu(resolues.length, [...retenues, ...retenuesSansReponse]);
    const chute = chuteExcessive(reference, effectif, policy().thresholds.maxScopeDrop)
      ? ({ famille: "perimetre", observe: effectif, reference } as const)
      : null;

    // L'autorisation ne se cherche qu'ici, sous le statut complet, et c'est ce qui la
    // borne : un passage dégradé n'atteint pas cette ligne, donc aucune décision
    // d'opérateur ne peut faire dater une nuit dont une lecture a manqué, et celle
    // qu'il a posée n'est pas consommée pour rien, elle attend le passage suivant.
    // Elle ne lève que ce garde-fou : les fiches que ce passage sait n'avoir pas lues
    // sont retenues par une règle qu'aucune autorisation ne regarde.
    //
    // Lue sans être dépensée, la dépense venant après la datation : brûlée avant, une
    // panne en base entre les deux la perdrait sans que rien ne soit daté, et il
    // faudrait la reposer sans rien savoir de plus qu'hier.
    const autorisation =
      chute === null
        ? null
        : await autorisationEnAttente(
            FOURNISSEUR_PERIMETRE,
            chute,
            run,
            "pas plus profonde que la chute annoncée",
          );
    const levee = autorisation !== null;

    if (chute !== null) {
      const dit = await messageDeChute(FOURNISSEUR_PERIMETRE, run.id, chute, levee);
      if (levee) {
        chuteLevee = dit;
      } else {
        // Une réponse valide mais amputée ne se distingue d'un départ collectif que par
        // son ampleur : dans le doute, on ne date aucune disparition.
        errors.push(dit);
        chuteRefusee = chute;
        status = "PARTIAL";
      }
    }

    if (chute === null || levee) {
      const gone = await prisma.person.updateMany({
        where: {
          username: { notIn: [...known, ...retenues, ...retenuesSansReponse] },
          vanishedAt: null,
          source: { not: "SERVICE" },
        },
        data: { vanishedAt: now },
      });
      vanished = gone.count;
    }

    // Dernière écriture du passage, et c'est là tout l'objet des deux temps. Un
    // passage qui n'a rien levé périme celle qui attendait : elle a été posée sur des
    // nombres que ce passage vient de constater autres, et la laisser dormir la
    // ferait lever, des semaines plus tard, une chute que personne n'a examinée.
    if (chute !== null && autorisation !== null) {
      await consommerAutorisation(FOURNISSEUR_PERIMETRE, chute, run, autorisation);
    } else {
      await perimerAutorisation(FOURNISSEUR_PERIMETRE, "perimetre", run);
    }
  }
  const result: PerimetreSyncResult = {
    runId: run.id,
    status,
    seen: resolues.length,
    created,
    updated,
    vanished,
    missingDeclared: absents,
    introuvables,
    retenues,
    retenuesSansReponse,
    lecturesManquees,
    retoursNonDates,
    echeancesNonEcrites,
    chuteRefusee,
    chuteLevee,
    errors,
    startups,
  };
  await closeRun(run.id, now, result);
  audit({
    actorKind: "SYSTEM",
    action: "sync.perimetre",
    targetType: "perimetre",
    correlationId,
    after: result,
    result: status === "OK" ? "SUCCESS" : "FAILURE",
  });
  return result;
}

/**
 * L'effectif du périmètre auquel un passage croit : ce qu'il a résolu, plus ce qu'il
 * retient.
 *
 * Une fiche retenue n'est pas une fiche absente, c'est une fiche dont ce passage ne
 * conclut rien, et il le dit en refusant de la dater. La compter ailleurs que dans son
 * effectif reviendrait à la dire partie du même souffle : la chute du soir se
 * creuserait de la retenue elle-même, et le relevé laissé derrière abaisserait le
 * plancher des nuits suivantes pour toute sa durée. C'est le même nombre qui se
 * compare et qui s'écrit, sans quoi les deux cessent de parler du même périmètre.
 *
 * Les deux façons de retenir y sont, et sans distinction. Elles ne diffèrent que par
 * la borne du sursis, c'est-à-dire par le passage où la fiche cessera d'être retenue,
 * et pas du tout par ce que celui-ci en conclut, qui est rien dans les deux cas :
 * compter n'est pas conclure. Les séparer ici ferait osciller le nombre annoncé au gré
 * de la façon dont la source échoue, sans qu'aucun départ ne l'explique, et un refus
 * qui ne retombe jamais deux fois sur les mêmes nombres ne s'annonce jamais installé :
 * le relevé gèlerait sans qu'aucun bandeau ne s'ouvre, c'est-à-dire sans que la sortie
 * nominative soit atteignable. La distinction reste entière là où elle a un sens, dans
 * `fichesRetenues`, qui décide de la borne et donc du passage qui datera.
 */
function effectifTenu(resolues: number, retenues: readonly string[]): number {
  return resolues + retenues.length;
}

/**
 * Les fiches que ce passage sait n'avoir pas lues, et dont il n'a donc rien à conclure
 * ce soir. Deux façons de ne pas lire, deux bornes, et c'est tout l'objet de ce module.
 *
 * Un 404 de la source n'est pas un silence : le passage nomme la fiche qui lui manque,
 * et il conclurait un départ d'un aveu d'ignorance. La borne est celle du retour, lue
 * sur la dernière vue au lieu de la disparition : tant qu'aucun autre passage complet
 * n'est venu depuis, l'angle mort n'a pas duré et la fiche est retenue ; dès qu'un
 * autre est venu sans la rendre lisible, elle reçoit sa disparition. Le sursis dure
 * donc un passage complet et pas un de plus, et c'est ce qui le sépare d'une
 * exemption : une fiche réellement supprimée en amont garde son départ, avec un
 * passage de retard, là où l'épargner sans condition le lui retirerait pour toujours.
 *
 * Encore faut-il que ce passage-là ait lu la fiche. Un passage complet qui l'a lui
 * aussi retenue faute de réponse n'a rien appris d'elle, et lui faire consommer le
 * sursis le ramènerait à zéro pour qui sort d'une panne : le premier 404 daterait
 * alors le soir même, sur le constat qui coupe des accès. Il ne le consomme donc pas,
 * et deux aveux restent nécessaires.
 *
 * Le regard en arrière ne va pas plus loin qu'un passage, mais il se refait à chaque
 * passage, et une source qui alterne panne et aveu rend donc le sursis à chaque aveu :
 * le passage qui précède chacun d'eux a lui-même retenu la fiche faute de réponse, la
 * disparition n'est jamais datée, et cette grâce-là se représente indéfiniment. C'est
 * assumé, et c'est le prix de la règle du dessus : deux aveux valent départ parce
 * qu'ils disent deux fois la même chose, et une source incapable de le dire deux fois
 * de suite ne l'a jamais dit qu'une fois. L'écart qui reste va du côté qui ne coupe
 * aucun accès.
 *
 * Une lecture qui jette n'est pas un aveu : la source n'a pas répondu, elle n'a rien
 * dit de la fiche, et un angle mort qui dure ne dit toujours rien de la personne. Ces
 * fiches sont donc retenues tant que la lecture échoue, sans borne, et cette retenue
 * n'exempte personne : une suppression en amont répond 404, elle nomme la fiche qu'elle
 * a supprimée, et aucun départ réel n'emprunte ce chemin. La borner comme l'aveu
 * daterait un départ après deux nuits de panne, sur le constat qui coupe des accès.
 *
 * Rien n'est retenu de ce que la collecte a résolu par ailleurs, ni de ce qui a déjà
 * disparu, ni d'un compte de service, que l'`updateMany` épargne de toute façon : dans
 * les trois cas il n'y a rien à retenir, et l'annoncer ferait mentir la trace. Ce
 * filtre-là sépare aussi les deux populations qu'une fiche complète concerne, et c'est
 * pourquoi il n'y en a pas d'autre : une personne que la liste scopée rend encore reste
 * du périmètre quand sa fiche manque, quelle que soit la façon dont elle manque, et
 * seul un déclaré transverse n'a que sa fiche pour y entrer.
 */
async function fichesRetenues(
  introuvables: readonly string[],
  sansReponse: readonly string[],
  known: readonly string[],
  precedent: PassageComplet | null,
): Promise<{ surAveu: string[]; sansReponse: string[] }> {
  const deja = new Set(known);
  const surAveu = new Set(introuvables.filter((username) => !deja.has(username)));
  const muettes = new Set(sansReponse.filter((username) => !deja.has(username)));
  if (surAveu.size === 0 && muettes.size === 0) {
    return { surAveu: [], sansReponse: [] };
  }

  // Les fiches que le dernier passage complet a lui-même retenues faute de réponse :
  // il n'a rien appris d'elles, donc il ne consomme pas le sursis qu'elles ont.
  const muettesDuPrecedent = new Set(fichesSansReponse(precedent?.error));

  // Une seule requête pour les deux listes : elles ne se distinguent que par la borne
  // qu'on leur applique, et la condition d'existence est la même.
  const fiches = await prisma.person.findMany({
    where: {
      username: { in: [...surAveu, ...muettes] },
      vanishedAt: null,
      source: { not: "SERVICE" },
    },
    select: { username: true, lastSeenAt: true },
  });

  return {
    surAveu: fiches
      .filter(
        (fiche) =>
          surAveu.has(fiche.username) &&
          (muettesDuPrecedent.has(fiche.username) ||
            !autrePassageCompletDepuis(fiche.lastSeenAt, precedent?.startedAt ?? null)),
      )
      .map((fiche) => fiche.username),
    sansReponse: fiches
      .filter((fiche) => muettes.has(fiche.username))
      .map((fiche) => fiche.username),
  };
}

/** Le dernier passage dont on a le droit de tirer des conclusions. */
export interface PassageComplet {
  itemsSeen: number;
  startedAt: Date;
  /**
   * Ce qu'il a dit, pour qui doit relire au nom de qui il l'a dit. Une fiche retenue
   * faute de réponse ne laisse rien d'autre : en base, elle a la même dernière vue
   * restée en arrière qu'une fiche retenue sur un aveu, et seule la trace sépare celle
   * dont la sortie viendra de celle dont elle ne viendra pas.
   */
  error: unknown;
}

export async function dernierPassageComplet(): Promise<PassageComplet | null> {
  return prisma.syncRun.findFirst({
    where: { provider: FOURNISSEUR_PERIMETRE, capability: "list", status: "OK" },
    orderBy: { startedAt: "desc" },
    select: { itemsSeen: true, startedAt: true, error: true },
  });
}

/** Le jour d'un instant, dans la forme que les messages du dépôt emploient déjà. */
function jour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Ce qu'un passage qui ne s'est pas dit complet doit dire du relevé qu'il laisse
 * derrière lui, et depuis combien de passages il le laisse.
 *
 * Sans cette phrase, une nuit ratée et un mois de nuits ratées se lisent exactement
 * pareil : les mêmes messages retombent dans la même colonne, et rien ne dit que ce
 * qui ressemble à un incident a cessé d'en être un. Or c'est la seule différence qui
 * compte, parce que la seconde situation a suspendu tout ce qui s'adosse au relevé,
 * pour tout le monde, sans qu'aucun de ces garde-fous puisse le signaler lui-même.
 *
 * La fenêtre relue est bornée par le relevé et non par un nombre de passages, à la
 * différence de l'idiome voisin des refus répétés : le nombre annoncé est alors celui
 * qu'on a lu, là où une fenêtre fixe le plafonnerait en le donnant pour exact. Elle ne
 * contient que des passages non complets, le relevé mis à part, puisque c'est le
 * dernier `OK` qui la commence.
 *
 * Rien à dire faute de relevé : sans passage complet connu, aucune règle n'a de
 * référence et aucune ne conclut quoi que ce soit, comme une première collecte n'est
 * pas une chute. Annoncer un gel supposerait un état qu'on n'a jamais eu.
 */
async function ageDuReleveLaisse(
  runCourant: string,
  status: PerimetreSyncResult["status"],
): Promise<{ passages: number; message: string } | null> {
  if (status === "OK") {
    return null;
  }

  const precedent = await dernierPassageComplet();
  if (precedent === null) {
    return null;
  }

  const depuis = await prisma.syncRun.findMany({
    where: {
      provider: FOURNISSEUR_PERIMETRE,
      capability: "list",
      id: { not: runCourant },
      startedAt: { gte: precedent.startedAt },
    },
    orderBy: { startedAt: "desc" },
    select: { status: true },
  });

  const passages = ageDuReleve([status, ...depuis.map((passage) => passage.status)]);
  const dit = `${RELEVE_NON_RENOUVELE} : les règles adossées au périmètre décident toujours contre le relevé du ${jour(precedent.startedAt)}, laissé ${passages === 1 ? "un passage" : `${passages} passages`} en arrière`;

  return {
    passages,
    message: releveFige(passages)
      ? `${dit} : ce n'est plus un incident, et plus rien de ce qui s'y adosse ne décide sur l'état du jour`
      : dit,
  };
}

async function closeRun(id: string, now: Date, result: PerimetreSyncResult): Promise<void> {
  // Ce qu'un passage a dit, et non ce qui l'a dégradé : ni une fiche retenue ni un
  // retour non daté ne sont des lectures ratées, ce sont des conclusions qu'on s'est
  // refusées sur quelqu'un de nommé. Les compter dans `errors` basculerait le run en
  // `PARTIAL` et lui ferait perdre tous les vrais départs de la nuit. Les dire ici les
  // met dans la colonne que l'écran des collectes lit déjà, comme le refus de vague.
  //
  // Le second refus a plus besoin de cette ligne que le premier : une fiche retenue
  // garde sa disparition en attente, alors qu'un retour non daté a effacé la sienne,
  // et sans cette phrase rien ne distinguerait plus une absence de trois semaines
  // d'une fiche qui n'a pas bougé.
  //
  // Les lectures qui n'ont pas répondu sont dites dans la même forme qu'avant, à la
  // seule différence qu'elles ne dégradent plus : ce que la source a répondu en
  // échouant est la seule chose qui sépare la panne d'une nuit de l'enregistrement
  // amont durablement mal formé, et la retirer d'ici ne laisserait ce message qu'au
  // journal de la console, que personne ne relit.
  //
  // Un plancher de chute levé à la main est de la même nature et arrive donc ici, et
  // non dans les `errors` où va le même plancher quand il refuse : levé, il n'a rien
  // dégradé, le passage est complet et il a daté ses disparitions. La phrase reste,
  // parce qu'une nuit où un garde-fou a été levé ne doit pas ressembler à une nuit
  // ordinaire dans la colonne où on relit les passages.
  const dits = [
    ...result.errors,
    ...result.lecturesManquees.map((lecture) => `${lecture.username} : ${lecture.message}`),
  ];
  if (result.chuteLevee !== null) {
    dits.push(result.chuteLevee);
  }
  if (result.retenues.length > 0) {
    // Point-virgule et non virgule : les noms en portent déjà, et la conclusion se
    // lirait comme un nom de plus dès qu'il y en a deux.
    dits.push(`${REFUS_DE_DISPARITION} : ${result.retenues.join(", ")} ; aucune disparition datée`);
  }
  if (result.retenuesSansReponse.length > 0) {
    dits.push(
      `${REFUS_DE_LECTURE} : ${result.retenuesSansReponse.join(", ")} ; aucune disparition datée tant que la lecture échoue`,
    );
  }
  if (result.retoursNonDates.length > 0) {
    const revenues = result.retoursNonDates
      .map((retour) => `${retour.username} (disparue le ${jour(retour.disparueLe)})`)
      .join(", ");
    dits.push(`${REFUS_DE_RETOUR} : ${revenues} ; absence non confirmée`);
  }
  if (result.echeancesNonEcrites.length > 0) {
    dits.push(
      `${REFUS_D_ECHEANCE} : ${result.echeancesNonEcrites.join(", ")} ; fiche complète non lue`,
    );
  }

  // En dernier, et c'est sa place : les lignes du dessus disent ce que ce passage n'a
  // pas conclu, celle-ci dit ce que plus aucun passage ne conclura tant qu'aucun ne
  // sera complet. Elle est la seule à parler du passage entier plutôt que de quelqu'un.
  const releve = await ageDuReleveLaisse(id, result.status);
  if (releve) {
    dits.push(releve.message);
  }

  // La liste des fiches retenues faute de réponse est portée en clair à côté des
  // phrases, et non déduite de l'une d'elles : c'est un passage complet qui la pose,
  // donc rien en base ne distingue plus ces fiches de celles qu'un aveu retient, et
  // l'écran d'une personne doit pouvoir dire nommément laquelle des deux elle est.
  // Relire un identifiant dans une phrase où les noms sont joints par des virgules
  // finirait par en confondre un avec le morceau d'un autre.
  // L'âge suit la même règle, et pour une raison de plus : la fiche d'une personne
  // n'annonce le gel qu'à partir du passage où ce n'est plus un incident, donc elle a
  // besoin du nombre et non de la phrase, et relire un nombre dans une phrase serait
  // s'en remettre à sa rédaction.
  // Le refus du plancher est porté dans une liste alors qu'il n'y en a qu'un, et ce
  // n'est pas une précaution pour plus tard : c'est la forme que tous les fournisseurs
  // écrivent et que l'écran relit sans savoir lequel il lit. En diverger ici rendrait
  // le périmètre invisible au bandeau qui annonce les blocages installés, ce qui est
  // exactement ce que ce lot existe pour finir.
  const trace: {
    messages: string[];
    sansReponse?: string[];
    ageDuReleve?: number;
    refus?: { famille: FamilleDeChute; observe: number; reference: number }[];
  } = { messages: dits };
  if (result.retenuesSansReponse.length > 0) {
    trace.sansReponse = result.retenuesSansReponse;
  }
  if (releve) {
    trace.ageDuReleve = releve.passages;
  }
  if (result.chuteRefusee !== null) {
    trace.refus = [
      {
        famille: result.chuteRefusee.famille,
        observe: result.chuteRefusee.observe,
        reference: result.chuteRefusee.reference,
      },
    ];
  }

  await prisma.syncRun.update({
    where: { id },
    data: {
      finishedAt: now,
      status: result.status,
      itemsSeen: effectifTenu(result.seen, [...result.retenues, ...result.retenuesSansReponse]),
      error: dits.length > 0 ? trace : undefined,
    },
  });
}

/**
 * Ajoute un refus à la trace d'un passage déjà clos, sans toucher à son statut.
 *
 * Les arrivées se jugent après la clôture du run, une fois les systèmes cibles lus, et
 * leur refus n'est pas un échec de lecture : le périmètre a bien été collecté, c'est
 * ce qu'on a le droit d'en conclure qui est en cause. Le statut ne bascule donc pas,
 * et cette ligne est la seule trace du refus. Elle rejoint les messages du run parce
 * que c'est là que l'écran des collectes va les chercher.
 */
export async function noterRefusDArrivees(runId: string, message: string): Promise<void> {
  const run = await prisma.syncRun.findUnique({ where: { id: runId }, select: { error: true } });
  if (!run) {
    return;
  }

  // La trace repart de l'objet relu au lieu d'être réécrite : elle porte aussi les
  // refus de datation, qu'un refus d'arrivées effacerait en la remplaçant, et une
  // trace amputée fait mentir l'écran qui la lit plutôt que de le faire échouer.
  const trace =
    run.error !== null && typeof run.error === "object" && !Array.isArray(run.error)
      ? run.error
      : {};
  const existants = "messages" in trace ? trace["messages"] : null;

  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      error: { ...trace, messages: [...(Array.isArray(existants) ? existants : []), message] },
    },
  });
}
