"use server";

import { SORTE_DE_CIBLE } from "@/core/constat";
import {
  type Cible,
  cleDeCible,
  leveeAdmissible,
  poseAdmissible,
  RAISON_COUVERT,
} from "@/core/derogation";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { derogationsApplicables } from "@/lib/derogation";
import { requireOperateur } from "@/lib/session";

export type EtatCloture = { erreur: string } | null;

/**
 * Clore un constat, c'est dire « j'ai traité, voici pourquoi ». La raison est
 * obligatoire : une file qu'on vide sans motif redevient une file qu'on ne croit
 * plus. La collecte ne rouvrira pas ce constat tant que la situation dure.
 */
export async function cloreConstat(_etat: EtatCloture, formData: FormData): Promise<EtatCloture> {
  await requireOperateur();

  const dedupKey = String(formData.get("dedupKey") ?? "").trim();
  const raison = String(formData.get("raison") ?? "").trim();

  if (!dedupKey) {
    return { erreur: "Constat introuvable." };
  }
  if (raison.length < 3) {
    return { erreur: "Indiquez ce qui a été fait." };
  }

  const constat = await prisma.finding.findUnique({
    where: { dedupKey },
    select: { id: true, closedAt: true, person: { select: { username: true } } },
  });

  if (!constat) {
    return { erreur: "Ce constat n'existe plus." };
  }
  if (constat.closedAt !== null) {
    return { erreur: "Ce constat est déjà clos." };
  }

  await actionTracee({
    action: "finding.close",
    targetType: "finding",
    targetId: dedupKey,
    after: { raison },
    // La fiche de la personne aussi, quand le constat en porte une : c'est de là que
    // le geste peut partir. L'identifiant vient du constat relu, jamais du
    // formulaire, qui se poste sans passer par l'écran qui l'a rendu.
    revalider: [
      "/constats",
      "/",
      ...(constat.person ? [`/personnes/${constat.person.username}`] : []),
    ],
    ecrire: async (operateur) => {
      await prisma.finding.update({
        where: { id: constat.id },
        data: { closedAt: new Date(), closeReason: raison, closedBy: operateur.username },
      });
    },
  });

  return null;
}

export type EtatTolerance = { erreur: string } | null;

/**
 * Tolérer un écart, c'est dire « je sais, et voici jusqu'à quand ». La différence avec
 * une clôture tient à ces trois mots : une clôture affirme que la situation est traitée
 * et se tait tant qu'elle dure, une tolérance admet qu'elle dure et se rouvre d'elle-même
 * le jour venu.
 *
 * La cible ne se saisit jamais : elle se déduit du constat relu en base. Un formulaire se
 * poste sans passer par l'écran qui l'a rendu, et une cible venue de là ferait taire ce
 * que l'opérateur n'a pas regardé.
 */
export async function tolererConstat(
  _etat: EtatTolerance,
  formData: FormData,
): Promise<EtatTolerance> {
  await requireOperateur();

  const dedupKey = String(formData.get("dedupKey") ?? "").trim();
  const raison = String(formData.get("raison") ?? "").trim();
  const jusquAu = String(formData.get("jusquAu") ?? "").trim();

  if (!dedupKey) {
    return { erreur: "Constat introuvable." };
  }

  const constat = await prisma.finding.findUnique({
    where: { dedupKey },
    select: {
      id: true,
      kind: true,
      closedAt: true,
      person: { select: { username: true } },
      externalIdentity: { select: { provider: true, externalId: true } },
    },
  });

  if (!constat) {
    return { erreur: "Ce constat n'existe plus." };
  }
  if (constat.closedAt !== null) {
    return { erreur: "Ce constat est déjà clos." };
  }

  const maintenant = new Date();
  const sorte = SORTE_DE_CIBLE[constat.kind];
  const cible: Cible | null =
    sorte === "identite" && constat.externalIdentity
      ? { type: "identite", ...constat.externalIdentity }
      : sorte === "personne" && constat.person
        ? { type: "personne", username: constat.person.username }
        : null;

  const { applicables } = await derogationsApplicables(maintenant);
  const verdict = poseAdmissible(
    { cible, raison, echeance: new Date(`${jusquAu}T00:00:00Z`) },
    new Set(applicables.map((derogation) => cleDeCible(derogation.cible))),
    maintenant,
  );
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }
  // Le verdict garantit la cible, que le typage ne sait pas suivre à travers lui.
  if (cible === null) {
    return { erreur: "Cet écart ne se tolère pas." };
  }

  await actionTracee({
    action: "derogation.pose",
    targetType: "derogation",
    targetId: cleDeCible(cible),
    after: { raison, jusquAu, constat: dedupKey },
    revalider: [
      "/constats",
      "/",
      ...(constat.person ? [`/personnes/${constat.person.username}`] : []),
    ],
    ecrire: async (operateur) => {
      await prisma.derogation.create({
        data: {
          targetType: cible.type,
          targetId:
            cible.type === "identite" ? `${cible.provider}:${cible.externalId}` : cible.username,
          reason: raison,
          createdBy: operateur.username,
          expiresAt: new Date(`${jusquAu}T00:00:00Z`),
        },
      });
      // Fermé tout de suite plutôt qu'à la collecte suivante : l'écart cesse de faire du
      // bruit au moment où quelqu'un décide de l'admettre, et sans nom, parce que
      // personne n'a jugé la situation traitée.
      await prisma.finding.update({
        where: { id: constat.id },
        data: { closedAt: maintenant, closeReason: RAISON_COUVERT, closedBy: null },
      });
    },
  });

  return null;
}

/**
 * Lever une tolérance, c'est la couper avant son terme sans effacer qu'elle a existé.
 *
 * Rien n'est supprimé : la ligne reste, datée et signée. Supprimer perdrait qui a décidé
 * d'arrêter de tolérer, et avancer l'échéance rendrait ce geste indiscernable d'un simple
 * écoulement du temps.
 */
export async function leverDerogation(
  _etat: EtatTolerance,
  formData: FormData,
): Promise<EtatTolerance> {
  await requireOperateur();

  const id = String(formData.get("derogationId") ?? "").trim();
  if (!id) {
    return { erreur: "Tolérance introuvable." };
  }

  const maintenant = new Date();
  const { applicables } = await derogationsApplicables(maintenant);
  const derogation = applicables.find((candidate) => candidate.id === id);

  if (!derogation) {
    return { erreur: "Cette tolérance n'est plus en cours." };
  }
  const verdict = leveeAdmissible(derogation, maintenant);
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "derogation.levee",
    targetType: "derogation",
    targetId: cleDeCible(derogation.cible),
    before: { jusquAu: derogation.echeance?.toISOString() ?? null },
    revalider: ["/constats", "/"],
    ecrire: async (operateur) => {
      await prisma.derogation.update({
        where: { id },
        data: { revokedAt: maintenant, revokedBy: operateur.username },
      });
    },
  });

  return null;
}
