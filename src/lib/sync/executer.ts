import { CONNECTEURS } from "@/connectors";
import { resolveCapability } from "@/core/connector";
import { autoriseUneRevocation } from "@/core/rapprochement";
import { verifierConfigurations } from "@/lib/configuration-connecteur";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { executerCollecte, noterSystemeNonLu } from "@/lib/sync/collecte";
import { syncComptesDeService } from "@/lib/sync/comptes-service";
import { syncConstats, syncStartups } from "@/lib/sync/constats";
import { noterRefusDArrivees, syncPerimetre } from "@/lib/sync/perimetre";
import { rapprocherIdentites } from "@/lib/sync/rapprochement";

/**
 * Une collecte complète, indépendante de qui la déclenche.
 *
 * Elle vivait dans le `main()` du CLI, ce qui la rendait injoignable depuis
 * l'application : relancer une collecte demandait un accès au serveur, pour un outil
 * dont la promesse est de tout faire depuis un seul endroit.
 *
 * `journal` reçoit ce que la commande imprimait : la ligne de commande y branche la
 * console, l'application ce qu'elle veut en garder.
 */
export interface CompteRenduSync {
  correlationId: string;
  echec: boolean;
}

export async function executerSync(
  now: Date,
  correlationId: string,
  journal: (ligne: string) => void,
): Promise<CompteRenduSync> {
  journal(`[sync] démarrage ${correlationId}`);
  if (!env.ACTIONS_ENABLED) {
    journal("[sync] ACTIONS_ENABLED est faux : aucune écriture sur un système cible");
  }

  // La politique est lue paresseusement, si bien qu'une politique manquante se
  // manifestait d'abord par un périmètre FAILED à zéro personne, qui ressemble trait
  // pour trait à une panne de l'espace-membre, puis par une pile d'appels quelques
  // étapes plus loin. Autant le dire ici : sans politique, il n'y a pas de collecte.
  try {
    policy();
    verifierConfigurations(CONNECTEURS.map((connecteur) => connecteur.contract));
  } catch (error: unknown) {
    journal(`[sync] ${error instanceof Error ? error.message : String(error)}`);
    return { correlationId, echec: true };
  }

  const perimetre = await syncPerimetre(now, correlationId);

  journal(
    `[sync] périmètre ${perimetre.status} : ${perimetre.seen} personnes, ` +
      `${perimetre.created} créées, ${perimetre.updated} mises à jour, ${perimetre.vanished} sorties`,
  );

  // Enveloppe parce que c'etait la seule etape sans filet : une ecriture qui echoue
  // ici faisait remonter l'erreur jusqu'au bout de main() et emportait tout ce qui
  // suit, comptes de service, connecteurs, rapprochement et constats compris. Le
  // referentiel des startups sert aux constats de phase, pas aux revocations : le
  // perdre degrade le tableau, il ne justifie pas d'annuler la nuit.
  let startups = {
    revues: 0,
    disparues: 0,
    chuteRefusee: false,
    erreur: null as string | null,
  };
  if (perimetre.status !== "FAILED") {
    try {
      startups = {
        ...(await syncStartups(perimetre.startups, policy().scope.incubator, now, {
          // Une liste tronquee mais valide ferait sortir des startups qui n'ont
          // jamais quitte l'incubateur : seule une collecte complete peut conclure
          // qu'une startup a disparu.
          daterDisparitions: perimetre.status === "OK",
          maxScopeDrop: policy().thresholds.maxScopeDrop,
        })),
        erreur: null,
      };
      journal(
        `[sync] startups : ${startups.revues} revues, ${startups.disparues} sorties de l'incubateur` +
          (startups.chuteRefusee ? " (chute excessive, aucune sortie datée)" : ""),
      );
    } catch (error: unknown) {
      startups = {
        revues: 0,
        disparues: 0,
        chuteRefusee: false,
        erreur: error instanceof Error ? error.message : String(error),
      };
      journal(`[sync] startups : ${startups.erreur}`);
    }
  }

  // Reportés avant toute lecture d'un système cible : le rapprochement attribue les
  // comptes machine à partir de ce qui est déclaré ici, et un compte de service
  // absent de la base ferait rendre son compte comme réclamé par personne.
  // Indépendant du périmètre au demeurant : la politique est locale et versionnée,
  // une panne de l'espace-membre n'empêche pas de reporter les comptes déclarés.
  const comptes = await syncComptesDeService(now, correlationId);
  journal(
    `[sync] comptes de service ${comptes.status} : ${comptes.declares} déclarés, ` +
      `${comptes.created} créés, ${comptes.updated} mis à jour, ${comptes.enRetard} en retard de revue`,
  );

  const systemesEnEchec: string[] = [];
  const nonLus: string[] = [];

  // Les systèmes cibles se lisent après le périmètre : un compte n'a de sens que
  // rapporté à quelqu'un, et le rapprochement a besoin des personnes du jour.
  for (const connecteur of CONNECTEURS) {
    const cle = connecteur.contract.key;
    const sondes = await connecteur.probe();
    const lecture = resolveCapability(
      "list",
      connecteur.contract.capabilities.list,
      sondes,
      connecteur.contract.runbook,
    );

    if (lecture.tier === "none") {
      const manquants = lecture.degradedFrom?.missing.join(", ") ?? "credential absent";
      journal(`[sync] ${cle} non lu : ${manquants}`);
      await noterSystemeNonLu(cle, `non lu : ${manquants}`, now, correlationId);
      nonLus.push(cle);
      continue;
    }

    const collecte = await executerCollecte(connecteur, now, correlationId);
    if (collecte.status === "FAILED") {
      systemesEnEchec.push(cle);
    }
    journal(
      `[sync] ${cle} ${collecte.status} : ${collecte.itemsSeen} comptes, ` +
        `${collecte.identites.creees} nouveaux, ${collecte.identites.disparues} disparus, ` +
        `${collecte.acces.crees + collecte.acces.revus} accès`,
    );
    for (const message of collecte.erreurs) {
      journal(`[sync] ${cle} : ${message}`);
    }
  }

  const rapprochement = await rapprocherIdentites(correlationId);
  if (rapprochement.examinees > 0) {
    const { DECLARED, GITHUB_LOGIN, EMAIL_EXACT, HEURISTIC, NONE } = rapprochement.parMethode;
    journal(
      `[sync] rapprochement : ${rapprochement.rattachees} sur ${rapprochement.examinees} ` +
        `(déclarés ${DECLARED}, login ${GITHUB_LOGIN}, adresse ${EMAIL_EXACT}, ` +
        `ressemblance ${HEURISTIC}, isolés ${NONE})`,
    );
  }

  // Les constats se calculent en dernier, sur l'état complet du jour : les tirer
  // avant la lecture des systèmes cibles reviendrait à juger des accès d'hier, et à
  // ne jamais voir qu'une personne partie détient encore un compte.
  if (perimetre.status !== "FAILED") {
    const [lignesPersonnes, identites] = await Promise.all([
      prisma.person.findMany({
        select: {
          username: true,
          fullname: true,
          attachment: true,
          startups: true,
          missionEnd: true,
          vanishedAt: true,
          firstSeenAt: true,
          returnedAt: true,
          source: true,
          // Filtre de lecture seulement : aucune écriture n'est ajoutée au chemin
          // de collecte, un rattachement expiré se reconnaît à sa date.
          startupAssignments: {
            where: { endedAt: null },
            select: { startupGhid: true, until: true, endedAt: true },
          },
        },
      }),
      prisma.externalIdentity.findMany({
        where: { vanishedAt: null },
        select: {
          id: true,
          provider: true,
          handle: true,
          matchMethod: true,
          serviceAccountId: true,
          person: { select: { username: true, vanishedAt: true } },
        },
      }),
    ]);

    const personnes = lignesPersonnes.map(({ startupAssignments, ...personne }) => ({
      ...personne,
      rattachementsManuels: startupAssignments,
    }));

    const constats = await syncConstats(
      personnes,
      perimetre.startups,
      identites.map((identite) => ({
        id: identite.id,
        provider: identite.provider,
        handle: identite.handle,
        rattachementSur: autoriseUneRevocation(identite.matchMethod),
        personneUsername: identite.person?.username ?? null,
        personneSortie: identite.person?.vanishedAt != null,
        compteDeService: identite.serviceAccountId !== null,
      })),
      policy().startups.terminalPhases,
      now,
      correlationId,
      {
        // Une collecte tronquée ne conclut rien sur les arrivées, dans aucun sens :
        // ni levée, ni fermeture, ni verrou réarmé.
        perimetreComplet: perimetre.status === "OK",
        maxNewPersonShare: policy().thresholds.maxNewPersonShare,
      },
    );
    journal(
      `[sync] constats : ${constats.actifs} actifs, ${constats.ouverts} ouverts, ${constats.fermes} fermés`,
    );
    journal(
      `[sync] arrivées : ${
        constats.arrivees.conclu
          ? `${constats.arrivees.levees} constatées`
          : constats.arrivees.message
      }`,
    );

    // Le refus de vague ne bascule pas le statut du run : sans cette ligne dans la
    // trace, la seule chose qui dirait qu'un passage s'est tu sur les arrivées serait
    // le journal de la console, que personne ne relit.
    if (!constats.arrivees.conclu && constats.arrivees.cause === "vague") {
      await noterRefusDArrivees(perimetre.runId, constats.arrivees.message);
    }
  }

  for (const key of comptes.horsPolitique) {
    journal(`[sync] compte de service en base mais retiré de la politique : ${key}`);
  }
  for (const message of comptes.errors) {
    journal(`[sync] compte de service ${message}`);
  }

  for (const username of perimetre.introuvables) {
    journal(`[sync] fiche introuvable dans l'espace-membre : ${username}`);
  }
  for (const username of perimetre.missingDeclared) {
    journal(`[sync] déclaré dans la politique mais non résolu ce passage : ${username}`);
  }
  for (const message of perimetre.errors) {
    journal(`[sync] ${message}`);
  }

  if (nonLus.length > 0) {
    journal(`[sync] systèmes non lus : ${nonLus.join(", ")}`);
  }
  if (systemesEnEchec.length > 0) {
    journal(`[sync] systèmes en échec : ${systemesEnEchec.join(", ")}`);
  }

  // Sortir en 0 sur un connecteur en echec rendait la tache planifiee verte pendant
  // qu'un systeme n'etait plus lu du tout. Un systeme non lu faute de credential ne
  // compte pas : il est annonce, il est trace, et il n'y a rien a reparer cette nuit.
  const echec =
    perimetre.status === "FAILED" ||
    comptes.status === "FAILED" ||
    startups.erreur !== null ||
    systemesEnEchec.length > 0;

  return { correlationId, echec };
}

/**
 * Depuis combien de temps une collecte peut rester ouverte avant qu'on la tienne
 * pour morte. Un run s'ouvre en échec et n'est promu qu'à la fin : un conteneur
 * redémarré en cours de route laisse donc une trace ouverte pour toujours, et sans
 * cette péremption elle interdirait toute nouvelle collecte.
 */
const PEREMPTION_MINUTES = 30;

export interface CollecteEnCours {
  provider: string;
  depuis: Date;
}

export async function collecteEnCours(maintenant: Date): Promise<CollecteEnCours | null> {
  const seuil = new Date(maintenant.getTime() - PEREMPTION_MINUTES * 60_000);
  const ouvert = await prisma.syncRun.findFirst({
    where: { finishedAt: null, startedAt: { gte: seuil } },
    orderBy: { startedAt: "desc" },
    select: { provider: true, startedAt: true },
  });

  return ouvert ? { provider: ouvert.provider, depuis: ouvert.startedAt } : null;
}
