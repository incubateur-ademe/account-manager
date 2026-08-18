import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { CONNECTEURS } from "@/connectors";
import { resolveCapability } from "@/core/connector";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { executerCollecte, noterSystemeNonLu } from "@/lib/sync/collecte";
import { syncComptesDeService } from "@/lib/sync/comptes-service";
import { syncConstats, syncStartups } from "@/lib/sync/constats";
import { syncPerimetre } from "@/lib/sync/perimetre";
import { rapprocherIdentites } from "@/lib/sync/rapprochement";

// Charge .env, .env.local et leurs variantes comme le fait Next : sans ça, la
// collecte en ligne de commande ne voit aucune configuration. L'accès à env étant
// différé, l'ordre d'évaluation des imports ne pose pas de problème.
loadEnvConfig(process.cwd(), process.env["NODE_ENV"] !== "production");

async function main(): Promise<number> {
  const correlationId = randomUUID();
  const now = new Date();

  console.log(`[sync] démarrage ${correlationId}`);
  if (!env.ACTIONS_ENABLED) {
    console.log("[sync] ACTIONS_ENABLED est faux : aucune écriture sur un système cible");
  }

  // La politique est lue paresseusement, si bien qu'une politique manquante se
  // manifestait d'abord par un périmètre FAILED à zéro personne, qui ressemble trait
  // pour trait à une panne de l'espace-membre, puis par une pile d'appels quelques
  // étapes plus loin. Autant le dire ici : sans politique, il n'y a pas de collecte.
  try {
    policy();
  } catch (error: unknown) {
    console.error(`[sync] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const perimetre = await syncPerimetre(now, correlationId);

  console.log(
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
      console.log(
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
      console.error(`[sync] startups : ${startups.erreur}`);
    }
  }

  // Reportés avant toute lecture d'un système cible : le rapprochement attribue les
  // comptes machine à partir de ce qui est déclaré ici, et un compte de service
  // absent de la base ferait rendre son compte comme réclamé par personne.
  // Indépendant du périmètre au demeurant : la politique est locale et versionnée,
  // une panne de l'espace-membre n'empêche pas de reporter les comptes déclarés.
  const comptes = await syncComptesDeService(now, correlationId);
  console.log(
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
      console.warn(`[sync] ${cle} non lu : ${manquants}`);
      await noterSystemeNonLu(cle, `non lu : ${manquants}`, now, correlationId);
      nonLus.push(cle);
      continue;
    }

    const collecte = await executerCollecte(connecteur, now, correlationId);
    if (collecte.status === "FAILED") {
      systemesEnEchec.push(cle);
    }
    console.log(
      `[sync] ${cle} ${collecte.status} : ${collecte.itemsSeen} comptes, ` +
        `${collecte.identites.creees} nouveaux, ${collecte.identites.disparues} disparus, ` +
        `${collecte.acces.crees + collecte.acces.revus} accès`,
    );
    for (const message of collecte.erreurs) {
      console.error(`[sync] ${cle} : ${message}`);
    }
  }

  const rapprochement = await rapprocherIdentites(correlationId);
  if (rapprochement.examinees > 0) {
    const { DECLARED, GITHUB_LOGIN, EMAIL_EXACT, HEURISTIC, NONE } = rapprochement.parMethode;
    console.log(
      `[sync] rapprochement : ${rapprochement.rattachees} sur ${rapprochement.examinees} ` +
        `(déclarés ${DECLARED}, login ${GITHUB_LOGIN}, adresse ${EMAIL_EXACT}, ` +
        `ressemblance ${HEURISTIC}, isolés ${NONE})`,
    );
  }

  // Les constats se calculent en dernier, sur l'état complet du jour : les tirer
  // avant la lecture des systèmes cibles reviendrait à juger des accès d'hier, et à
  // ne jamais voir qu'une personne partie détient encore un compte.
  if (perimetre.status !== "FAILED") {
    const [personnes, identites] = await Promise.all([
      prisma.person.findMany({
        select: {
          username: true,
          fullname: true,
          attachment: true,
          startups: true,
          missionEnd: true,
          vanishedAt: true,
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

    const constats = await syncConstats(
      personnes,
      perimetre.startups,
      identites.map((identite) => ({
        id: identite.id,
        provider: identite.provider,
        handle: identite.handle,
        rattachementSur: ["DECLARED", "GITHUB_LOGIN", "EMAIL_EXACT"].includes(identite.matchMethod),
        personneUsername: identite.person?.username ?? null,
        personneSortie: identite.person?.vanishedAt != null,
        compteDeService: identite.serviceAccountId !== null,
      })),
      policy().startups.terminalPhases,
      now,
      correlationId,
    );
    console.log(
      `[sync] constats : ${constats.actifs} actifs, ${constats.ouverts} ouverts, ${constats.fermes} fermés`,
    );
  }

  for (const key of comptes.horsPolitique) {
    console.warn(`[sync] compte de service en base mais retiré de la politique : ${key}`);
  }
  for (const message of comptes.errors) {
    console.error(`[sync] compte de service ${message}`);
  }

  for (const username of perimetre.introuvables) {
    console.warn(`[sync] fiche introuvable dans l'espace-membre : ${username}`);
  }
  for (const username of perimetre.missingDeclared) {
    console.warn(`[sync] déclaré dans la politique mais absent de l'annuaire : ${username}`);
  }
  for (const message of perimetre.errors) {
    console.error(`[sync] ${message}`);
  }

  if (nonLus.length > 0) {
    console.warn(`[sync] systèmes non lus : ${nonLus.join(", ")}`);
  }
  if (systemesEnEchec.length > 0) {
    console.error(`[sync] systèmes en échec : ${systemesEnEchec.join(", ")}`);
  }

  // Sortir en 0 sur un connecteur en echec rendait la tache planifiee verte pendant
  // qu'un systeme n'etait plus lu du tout. Un systeme non lu faute de credential ne
  // compte pas : il est annonce, il est trace, et il n'y a rien a reparer cette nuit.
  const echec =
    perimetre.status === "FAILED" ||
    comptes.status === "FAILED" ||
    startups.erreur !== null ||
    systemesEnEchec.length > 0;

  return echec ? 1 : 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exitCode = code;
  })
  .catch(async (error: unknown) => {
    console.error("[sync] échec non rattrapé", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
