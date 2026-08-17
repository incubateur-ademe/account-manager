import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { CONNECTEURS } from "@/connectors";
import { resolveCapability } from "@/core/connector";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { executerCollecte } from "@/lib/sync/collecte";
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

  const perimetre = await syncPerimetre(now, correlationId);

  console.log(
    `[sync] périmètre ${perimetre.status} : ${perimetre.seen} personnes, ` +
      `${perimetre.created} créées, ${perimetre.updated} mises à jour, ${perimetre.vanished} sorties`,
  );

  if (perimetre.status !== "FAILED") {
    await syncStartups(perimetre.startups, policy().scope.incubator, now);
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
      continue;
    }

    const collecte = await executerCollecte(connecteur, now, correlationId);
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

  return perimetre.status === "FAILED" || comptes.status === "FAILED" ? 1 : 0;
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
