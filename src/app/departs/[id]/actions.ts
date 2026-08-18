"use server";

import type { EtatEtape } from "@/core/depart";
import { dossierSoldable, etatApresPointage, peutConfirmer, peutPointer } from "@/core/depart";
import { peremptionDuPlan } from "@/core/plan";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { calculerPlanDeDepart } from "@/lib/depart";

export interface EtatAction {
  erreur?: string;
}

const POINTAGES: Record<string, EtatEtape> = {
  fait: "SUCCEEDED",
  "deja-absent": "ALREADY_ABSENT",
  ignoree: "SKIPPED",
  echec: "FAILED",
};

async function planDuDossier(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      state: true,
      planDigest: true,
      expiresAt: true,
      departureCaseId: true,
      departureCase: { select: { person: { select: { id: true, username: true } } } },
      steps: { select: { id: true, state: true, label: true, systemKey: true } },
    },
  });
}

/**
 * Fige l'approbation. Le digest confirmé est recopié à ce moment : c'est lui qui
 * dira, plus tard, si ce qui a été exécuté correspond à ce qui avait été approuvé.
 */
export async function confirmerPlan(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const planId = String(formData.get("planId") ?? "").trim();
  const plan = await planDuDossier(planId);

  if (!plan?.departureCase) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const maintenant = new Date();
  const actuel = await calculerPlanDeDepart(
    plan.departureCase.person.id,
    plan.departureCase.person.username,
    maintenant,
  );

  const verdict = peutConfirmer(
    plan.state,
    peremptionDuPlan(plan, actuel.empreinte, maintenant),
    plan.steps.length,
  );

  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "depart.confirmation",
    targetType: "plan",
    targetId: plan.id,
    after: { etapes: plan.steps.length, empreinte: plan.planDigest },
    revalider: [`/departs/${plan.departureCaseId}`],
    ecrire: async (operateur) => {
      await prisma.plan.update({
        where: { id: plan.id },
        data: {
          state: "EXECUTING",
          confirmedDigest: plan.planDigest,
          confirmedBy: operateur.username,
          confirmedAt: maintenant,
        },
      });
    },
  });

  return {};
}

/**
 * Consigne ce qu'un humain déclare avoir fait, ou constaté. Rien n'est exécuté ici :
 * l'outil n'appelle aucun système, il enregistre une parole et la date.
 */
export async function pointerEtape(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const etapeId = String(formData.get("etapeId") ?? "").trim();
  const choix = String(formData.get("pointage") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const nouvelEtat = POINTAGES[choix];
  if (!nouvelEtat) {
    return { erreur: "Pointage inconnu." };
  }

  const etape = await prisma.planStep.findUnique({
    where: { id: etapeId },
    select: {
      id: true,
      label: true,
      systemKey: true,
      state: true,
      plan: {
        select: {
          id: true,
          state: true,
          departureCaseId: true,
          steps: { select: { id: true, state: true } },
        },
      },
    },
  });

  if (!etape) {
    return { erreur: "Cette étape n'existe plus." };
  }

  const verdict = peutPointer(etape.plan.state);
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  if ((nouvelEtat === "SKIPPED" || nouvelEtat === "FAILED") && note.length < 3) {
    return {
      erreur:
        nouvelEtat === "SKIPPED"
          ? "Dites pourquoi cette étape est écartée : sans raison, elle deviendra un accès oublié."
          : "Dites ce qui a échoué, sinon personne ne saura quoi reprendre.",
    };
  }

  const maintenant = new Date();

  await actionTracee({
    action: "depart.pointage",
    targetType: "etape",
    targetId: `${etape.systemKey}:${etape.label}`,
    before: { etat: etape.state },
    after: { etat: nouvelEtat, ...(note ? { note } : {}) },
    revalider: [`/departs/${etape.plan.departureCaseId}`],
    ecrire: async () => {
      await prisma.planStep.update({
        where: { id: etape.id },
        data: {
          state: nouvelEtat,
          executedAt: maintenant,
          attempts: { increment: 1 },
          ...(note ? { lastError: note } : {}),
        },
      });

      // L'état du plan se déduit de ses étapes, il ne se pose jamais à la main.
      const etats = etape.plan.steps.map((autre) =>
        autre.id === etape.id ? nouvelEtat : (autre.state as EtatEtape),
      );

      await prisma.plan.update({
        where: { id: etape.plan.id },
        data: { state: etatApresPointage(etats) },
      });
    },
  });

  return {};
}

/**
 * Clôt le dossier. Réservé à un plan entièrement soldé : un dossier clos sur des
 * accès encore ouverts est pire que pas de dossier du tout, il affirme que
 * l'affaire est réglée.
 */
export async function cloreDossier(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const dossierId = String(formData.get("dossierId") ?? "").trim();

  const dossier = await prisma.departureCase.findUnique({
    where: { id: dossierId },
    select: {
      id: true,
      state: true,
      person: { select: { username: true } },
      plans: { orderBy: { createdAt: "desc" }, take: 1, select: { state: true } },
    },
  });

  if (!dossier) {
    return { erreur: "Ce dossier n'existe plus." };
  }
  if (dossier.state === "DONE") {
    return { erreur: "Ce dossier est déjà clos." };
  }

  const plan = dossier.plans[0];
  if (!plan || !dossierSoldable(plan.state)) {
    return {
      erreur: "Toutes les étapes ne sont pas soldées : des accès restent ouverts.",
    };
  }

  await actionTracee({
    action: "depart.cloture",
    targetType: "personne",
    targetId: dossier.person.username,
    after: { etat: "DONE" },
    revalider: [`/departs/${dossier.id}`, `/personnes/${dossier.person.username}`],
    ecrire: async () => {
      await prisma.departureCase.update({ where: { id: dossier.id }, data: { state: "DONE" } });
    },
  });

  return {};
}
