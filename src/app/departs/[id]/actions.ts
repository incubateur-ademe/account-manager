"use server";

import type { EtatEtape } from "@/core/depart";
import {
  dossierVivant,
  ETATS_VIVANTS,
  etatApresPointage,
  etatDUnPlanRemplace,
  peutAnnuler,
  peutClore,
  peutConfirmer,
  peutPointer,
  peutRecalculer,
  planAAnnuler,
} from "@/core/depart";
import { peremptionDuPlan } from "@/core/plan";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { calculerPlanDeDepart, enregistrerPlan } from "@/lib/depart";

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
      departureCase: {
        select: { state: true, person: { select: { id: true, username: true } } },
      },
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

  // L'état du dossier d'abord : sa garde ne portait que sur le plan, si bien qu'un
  // dossier annulé entre deux clics laissait son brouillon confirmable.
  if (!dossierVivant(plan.departureCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

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

  const verdict = peutClore(dossier.state, dossier.plans[0]?.state ?? null);
  if (!verdict.possible) {
    return { erreur: verdict.raison };
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

/**
 * Annule un dossier, et le brouillon qui l'accompagne.
 *
 * Un départ qui n'aura pas lieu doit pouvoir se dire, sinon son dossier reste ouvert
 * et le bloque : la fusion de deux fiches le refuse, et la fiche continue d'annoncer
 * un départ que personne ne prépare plus.
 *
 * Le plan tombe dans la même transaction que le dossier. Séparés, un brouillon
 * survivrait sous un dossier annulé, et sa confirmation resterait offerte.
 */
export async function annulerDossier(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const dossierId = String(formData.get("dossierId") ?? "").trim();
  const motif = String(formData.get("motif") ?? "").trim();

  if (motif.length < 3) {
    return { erreur: "Dites pourquoi ce départ n'aura pas lieu." };
  }

  const dossier = await prisma.departureCase.findUnique({
    where: { id: dossierId },
    select: {
      id: true,
      state: true,
      person: { select: { username: true } },
      plans: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, state: true } },
    },
  });

  if (!dossier) {
    return { erreur: "Ce dossier n'existe plus." };
  }

  const plan = dossier.plans[0] ?? null;
  const verdict = peutAnnuler(dossier.state, plan?.state ?? null);
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "depart.annulation",
    targetType: "personne",
    targetId: dossier.person.username,
    before: { etat: dossier.state, plan: plan?.state ?? null },
    after: {
      etat: "CANCELLED",
      plan: planAAnnuler(plan?.state ?? null) ? "CANCELLED" : null,
      motif,
    },
    revalider: [`/departs/${dossier.id}`, `/personnes/${dossier.person.username}`],
    ecrire: async () => {
      await prisma.$transaction(async (transaction) => {
        // Conditionné sur l'état lu : entre la lecture et l'écriture, quelqu'un a pu
        // clore ou annuler ce dossier, et un `update` par identifiant seul écraserait
        // sa décision sans que rien ne le dise.
        const { count } = await transaction.departureCase.updateMany({
          where: { id: dossier.id, state: { in: [...ETATS_VIVANTS] } },
          data: { state: "CANCELLED", cancelledReason: motif },
        });

        if (count === 0) {
          throw new Error("Ce dossier a changé d'état pendant l'annulation.");
        }

        if (plan && planAAnnuler(plan.state)) {
          await transaction.plan.updateMany({
            where: { id: plan.id, state: plan.state },
            data: { state: "CANCELLED" },
          });
        }
      });
    },
  });

  return {};
}

/**
 * Remplace un brouillon que le temps ou une collecte a démenti.
 *
 * Sans ce geste, un plan périmé fige son dossier : la confirmation le refuse, et
 * personne ne peut en calculer un autre. Le dossier resterait ouvert sur des accès
 * dont plus rien ne s'occupe, ce qui est la panne la plus discrète de cet écran.
 *
 * Le plan remplacé n'est pas supprimé : il garde ce qu'il proposait et pourquoi il a
 * cessé de valoir, comme tout ce qui a été calculé ici.
 */
export async function recalculerPlan(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const planId = String(formData.get("planId") ?? "").trim();
  const plan = await planDuDossier(planId);

  if (!plan?.departureCase || !plan.departureCaseId) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const dossierId = plan.departureCaseId;
  const maintenant = new Date();
  const actuel = await calculerPlanDeDepart(
    plan.departureCase.person.id,
    plan.departureCase.person.username,
    maintenant,
  );

  if (!dossierVivant(plan.departureCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  const peremption = peremptionDuPlan(plan, actuel.empreinte, maintenant);
  const verdict = peutRecalculer(plan.state, peremption);

  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "depart.recalcul",
    targetType: "plan",
    targetId: plan.id,
    before: { empreinte: plan.planDigest, etapes: plan.steps.length },
    after: { empreinte: actuel.empreinte, etapes: actuel.etapes.length },
    revalider: [`/departs/${dossierId}`],
    ecrire: async (operateur) => {
      await prisma.plan.update({
        where: { id: plan.id },
        data: { state: etatDUnPlanRemplace(peremption) },
      });

      await enregistrerPlan(dossierId, actuel, operateur.username, maintenant);
    },
  });

  return {};
}
