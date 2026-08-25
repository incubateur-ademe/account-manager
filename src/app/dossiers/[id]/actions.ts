"use server";

import type { EtatEtape, SensDossier } from "@/core/dossier";
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
} from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { origineFigeeSchema } from "@/core/modele-plan";
import { peremptionDuPlan } from "@/core/plan";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { calculerPlan, enregistrerPlan } from "@/lib/dossier";
import { requireOperateur } from "@/lib/session";

export interface EtatAction {
  erreur?: string;
}

const POINTAGES: Record<string, EtatEtape> = {
  fait: "SUCCEEDED",
  "deja-absent": "ALREADY_ABSENT",
  "deja-present": "ALREADY_PRESENT",
  ignoree: "SKIPPED",
  echec: "FAILED",
};

/**
 * Le constat qu'un autre est passé avant, et il n'y en a qu'un par sens. Le refus
 * n'est pas cosmétique : consigner « déjà absent » sous une étape d'octroi ferait
 * dire au journal l'inverse de ce qui a été constaté, et l'écran le relirait ainsi
 * dans deux ans.
 */
const CONSTAT_DU_SENS: Record<SensDossier, EtatEtape> = {
  ONBOARDING: "ALREADY_PRESENT",
  OFFBOARDING: "ALREADY_ABSENT",
};

async function planDuDossier(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      state: true,
      planDigest: true,
      expiresAt: true,
      accessCaseId: true,
      accessCase: {
        select: { kind: true, state: true, person: { select: { id: true, username: true } } },
      },
      steps: { select: { id: true, state: true, ordre: true, label: true, systemKey: true } },
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
  await requireOperateur();

  const planId = String(formData.get("planId") ?? "").trim();
  const plan = await planDuDossier(planId);

  if (!plan?.accessCase) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const sens = plan.accessCase.kind;
  const maintenant = new Date();
  const actuel = await calculerPlan(
    sens,
    plan.accessCase.person.id,
    plan.accessCase.person.username,
    maintenant,
  );

  // L'état du dossier d'abord : sa garde ne portait que sur le plan, si bien qu'un
  // dossier annulé entre deux clics laissait son brouillon confirmable.
  if (!dossierVivant(plan.accessCase.state)) {
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
    action: "dossier.confirmation",
    targetType: "plan",
    targetId: plan.id,
    after: { sens, etapes: plan.steps.length, empreinte: plan.planDigest },
    revalider: [`/dossiers/${plan.accessCaseId}`],
    ecrire: async (operateur) => {
      // Conditionnée sur ce qui a été lu, plan et dossier : la garde seule laisse
      // passer une annulation arrivée entre la lecture et l'écriture, et un plan
      // confirmé sous un dossier annulé n'a plus personne pour le contredire.
      const { count } = await prisma.plan.updateMany({
        where: {
          id: plan.id,
          state: "DRAFT",
          accessCase: { state: { in: [...ETATS_VIVANTS] } },
        },
        data: {
          state: "EXECUTING",
          confirmedDigest: plan.planDigest,
          confirmedBy: operateur.username,
          confirmedAt: maintenant,
        },
      });

      if (count === 0) {
        throw new Error("Ce plan ou son dossier a changé d'état pendant la confirmation.");
      }
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
  await requireOperateur();

  const etapeId = String(formData.get("etapeId") ?? "").trim();
  const choix = String(formData.get("pointage") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const reponse = String(formData.get("reponse") ?? "").trim();

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
      template: true,
      plan: {
        select: {
          id: true,
          state: true,
          accessCaseId: true,
          accessCase: { select: { kind: true, state: true } },
          steps: { select: { id: true, state: true } },
        },
      },
    },
  });

  if (!etape) {
    return { erreur: "Cette étape n'existe plus." };
  }

  // L'état du dossier avant celui du plan, comme la confirmation et le recalcul le
  // font déjà : cette action était la seule des trois à ne regarder que le plan, et
  // consignait donc un geste sur un dossier que quelqu'un venait d'abandonner.
  if (etape.plan.accessCase && !dossierVivant(etape.plan.accessCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  const sens = etape.plan.accessCase?.kind ?? null;
  if (
    sens !== null &&
    (nouvelEtat === "ALREADY_ABSENT" || nouvelEtat === "ALREADY_PRESENT") &&
    nouvelEtat !== CONSTAT_DU_SENS[sens]
  ) {
    return { erreur: "Ce constat ne vaut pas dans le sens de ce dossier." };
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

  // Une origine gelée illisible ne peut venir que d'une écriture faite hors de cet
  // outil. La taire ferait pointer « fait » sur une étape qui réclamait une valeur,
  // et lever ici ôterait toute issue à l'écran : le pointage se refuse, et le dit.
  const origine = origineFigeeSchema.nullish().safeParse(etape.template);
  if (!origine.success) {
    return {
      erreur:
        "L'origine déclarée de cette étape est illisible : reprenez-la depuis son modèle avant de la pointer.",
    };
  }

  const saisie = origine.data?.saisie ?? null;

  // « Déjà présent » et « déjà absent » affirment que le geste a eu lieu, quelqu'un
  // d'autre étant passé avant : ils soldent l'étape au même titre que « fait », donc
  // ils lui réclament la même valeur. « Écartée » et « échec » n'affirment rien, et
  // sont les seuls à s'en dispenser.
  const critereConstate =
    nouvelEtat === "SUCCEEDED" ||
    nouvelEtat === "ALREADY_PRESENT" ||
    nouvelEtat === "ALREADY_ABSENT";

  // Même refus que celui de la note, pour la même raison : sans la valeur qu'elle
  // demandait, l'étape ne dit pas ce qui a été fait.
  if (critereConstate && saisie?.obligatoire === true && reponse.length === 0) {
    return {
      erreur: `Renseignez « ${saisie.libelle} » : sans elle, personne ne saura ce qui a été fait.`,
    };
  }

  // Rattachée au constat du critère et non à la seule présence d'une saisie : corrigée
  // en écart ou en échec, l'étape garderait sinon la valeur du pointage précédent,
  // affichée sous un geste que personne n'a fait.
  const valeur = critereConstate && saisie && reponse ? reponse : null;

  const maintenant = new Date();

  await actionTracee({
    action: "dossier.pointage",
    targetType: "etape",
    targetId: `${etape.systemKey}:${etape.label}`,
    before: { etat: etape.state },
    after: {
      sens,
      etat: nouvelEtat,
      ...(note ? { note } : {}),
      ...(valeur ? { reponse: valeur } : {}),
    },
    revalider: [`/dossiers/${etape.plan.accessCaseId}`],
    ecrire: async () => {
      await prisma.planStep.update({
        where: { id: etape.id },
        data: {
          state: nouvelEtat,
          executedAt: maintenant,
          attempts: { increment: 1 },
          ...(note ? { lastError: note } : {}),
          reponse: valeur,
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
  await requireOperateur();

  const dossierId = String(formData.get("dossierId") ?? "").trim();

  const dossier = await prisma.accessCase.findUnique({
    where: { id: dossierId },
    select: {
      id: true,
      kind: true,
      state: true,
      person: { select: { username: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { state: true, _count: { select: { steps: true } } },
      },
    },
  });

  if (!dossier) {
    return { erreur: "Ce dossier n'existe plus." };
  }

  const dernier = dossier.plans[0] ?? null;
  const verdict = peutClore(
    dossier.kind,
    dossier.state,
    dernier?.state ?? null,
    dernier?._count.steps ?? 0,
  );
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "dossier.cloture",
    targetType: "personne",
    targetId: dossier.person.username,
    after: { sens: dossier.kind, etat: "DONE" },
    revalider: [`/dossiers/${dossier.id}`, `/personnes/${dossier.person.username}`],
    ecrire: async () => {
      await prisma.accessCase.update({ where: { id: dossier.id }, data: { state: "DONE" } });
    },
  });

  return {};
}

/**
 * Annule un dossier, et le brouillon qui l'accompagne.
 *
 * Un dossier qui n'aura pas lieu doit pouvoir se dire, sinon il reste ouvert et
 * bloque : la fusion de deux fiches le refuse, et la fiche continue d'annoncer un
 * mouvement que personne ne prépare plus.
 *
 * Le plan tombe dans la même transaction que le dossier. Séparés, un brouillon
 * survivrait sous un dossier annulé, et sa confirmation resterait offerte.
 */
export async function annulerDossier(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  await requireOperateur();

  const dossierId = String(formData.get("dossierId") ?? "").trim();
  const motif = String(formData.get("motif") ?? "").trim();

  const dossier = await prisma.accessCase.findUnique({
    where: { id: dossierId },
    select: {
      id: true,
      kind: true,
      state: true,
      person: { select: { username: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, state: true },
      },
    },
  });

  if (!dossier) {
    return { erreur: "Ce dossier n'existe plus." };
  }

  // Le motif se contrôle après la lecture, et non avant : sa phrase nomme le sens du
  // dossier, qu'on ne connaît qu'une fois le dossier lu.
  if (motif.length < 3) {
    return { erreur: LIBELLE_DOSSIER[dossier.kind].motifAttendu };
  }

  const plan = dossier.plans[0] ?? null;
  const verdict = peutAnnuler(dossier.state, plan?.state ?? null);
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "dossier.annulation",
    targetType: "personne",
    targetId: dossier.person.username,
    before: { etat: dossier.state, plan: plan?.state ?? null },
    after: {
      sens: dossier.kind,
      etat: "CANCELLED",
      // L'état réel du plan après le geste : « null » pour les deux cas, plan absent
      // et plan laissé intact parce qu'il était déjà remplacé, aurait rendu la trace
      // incapable de les distinguer.
      plan: planAAnnuler(plan?.state ?? null) ? "CANCELLED" : (plan?.state ?? null),
      motif,
    },
    revalider: [`/dossiers/${dossier.id}`, `/personnes/${dossier.person.username}`],
    ecrire: async () => {
      await prisma.$transaction(async (transaction) => {
        // Conditionné sur l'état lu : entre la lecture et l'écriture, quelqu'un a pu
        // clore ou annuler ce dossier, et un `update` par identifiant seul écraserait
        // sa décision sans que rien ne le dise.
        const { count } = await transaction.accessCase.updateMany({
          where: { id: dossier.id, state: { in: [...ETATS_VIVANTS] } },
          data: { state: "CANCELLED", cancelledReason: motif },
        });

        if (count === 0) {
          throw new Error("Ce dossier a changé d'état pendant l'annulation.");
        }

        if (plan && planAAnnuler(plan.state)) {
          const remplace = await transaction.plan.updateMany({
            where: { id: plan.id, state: plan.state },
            data: { state: "CANCELLED" },
          });

          // Le silence ici laissait un plan confirmé sous un dossier annulé, que plus
          // aucun geste n'atteint : ni pointage, le dossier étant mort, ni clôture,
          // ni annulation. La transaction se défait plutôt que de murer le dossier.
          if (remplace.count === 0) {
            throw new Error("Ce plan a changé d'état pendant l'annulation de son dossier.");
          }
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
  await requireOperateur();

  const planId = String(formData.get("planId") ?? "").trim();
  const plan = await planDuDossier(planId);

  if (!plan?.accessCase || !plan.accessCaseId) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const sens = plan.accessCase.kind;
  const dossierId = plan.accessCaseId;
  const maintenant = new Date();
  const actuel = await calculerPlan(
    sens,
    plan.accessCase.person.id,
    plan.accessCase.person.username,
    maintenant,
  );

  if (!dossierVivant(plan.accessCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  const peremption = peremptionDuPlan(plan, actuel.empreinte, maintenant);
  const verdict = peutRecalculer(plan.state, peremption);

  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "dossier.recalcul",
    targetType: "plan",
    targetId: plan.id,
    before: { empreinte: plan.planDigest, etapes: plan.steps.length },
    after: { sens, empreinte: actuel.empreinte, etapes: actuel.etapes.length },
    revalider: [`/dossiers/${dossierId}`],
    ecrire: async (operateur) => {
      // Les deux écritures dans la même transaction : séparées, une panne entre les
      // deux laissait le plan remplacé comme plan le plus récent, et `peutRecalculer`
      // exigeant un brouillon, le dossier n'avait plus que l'annulation pour sortie.
      await prisma.$transaction(async (transaction) => {
        // Le remplacement d'abord, et sous condition : sans elle, un dossier annulé
        // entre la lecture et l'écriture recevrait un brouillon neuf que plus rien
        // n'irait contredire.
        const { count } = await transaction.plan.updateMany({
          where: {
            id: plan.id,
            state: "DRAFT",
            accessCase: { state: { in: [...ETATS_VIVANTS] } },
          },
          data: { state: etatDUnPlanRemplace(peremption) },
        });

        if (count === 0) {
          throw new Error("Ce plan ou son dossier a changé d'état pendant le recalcul.");
        }

        await enregistrerPlan(dossierId, actuel, operateur.username, maintenant, transaction);
      });
    },
  });

  return {};
}
