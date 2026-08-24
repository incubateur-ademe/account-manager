"use server";

import { redirect } from "next/navigation";

import type { SensDossier } from "@/core/dossier";
import { echeanceEffective } from "@/core/rattachement-startup";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { calculerPlan, enregistrerPlan, ouvrirDossier } from "@/lib/dossier";
import { requireOperateur } from "@/lib/session";

export interface EtatDossier {
  erreur?: string;
}

/**
 * Ouvre un dossier et calcule son plan. Rien n'est exécuté et rien n'est confirmé :
 * à ce stade, l'outil dit ce qu'il faudrait faire, et c'est tout.
 */
async function ouvrir(sens: SensDossier, formData: FormData): Promise<EtatDossier> {
  await requireOperateur();

  const username = String(formData.get("username") ?? "").trim();
  if (!username) {
    return { erreur: "Personne introuvable." };
  }

  const personne = await prisma.person.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      missionEnd: true,
      startupAssignments: {
        where: { endedAt: null },
        select: { startupGhid: true, until: true, endedAt: true },
      },
    },
  });

  if (!personne) {
    return { erreur: "Cette personne n'est plus en base." };
  }

  const maintenant = new Date();

  // La date de départ de quelqu'un dont l'accès est prolongé est la date prolongée,
  // sans quoi le dossier contredirait sa fiche. Une arrivée n'a pas d'équivalent :
  // rien en base ne dit quand quelqu'un commence.
  const echeance =
    sens === "OFFBOARDING"
      ? echeanceEffective(personne.missionEnd, personne.startupAssignments, maintenant)
      : null;

  let dejaOuvert = false;
  const dossierId = await actionTracee({
    action: "dossier.ouverture",
    targetType: "personne",
    targetId: personne.username,
    after: { sens, echeance: echeance?.toISOString().slice(0, 10) ?? null },
    revalider: [`/personnes/${personne.username}`],
    ecrire: async (operateur) => {
      const dossier = await ouvrirDossier(personne.id, sens, echeance);
      if (dossier.deja) {
        dejaOuvert = true;

        // Un dossier vivant sans plan est le reste d'une ouverture interrompue entre ses
        // deux écritures. Sans cette reprise il n'a plus que l'annulation pour issue, le
        // recalcul exigeant un brouillon qui n'existe pas.
        if ((await prisma.plan.count({ where: { accessCaseId: dossier.id } })) > 0) {
          return dossier.id;
        }
      }

      const calcule = await calculerPlan(sens, personne.id, personne.username, maintenant);
      await enregistrerPlan(dossier.id, calcule, operateur.username, maintenant);
      return dossier.id;
    },
  });

  // Hors du passage tracé : `redirect` interrompt le flux par une exception que le
  // journal prendrait pour un échec, et l'action serait consignée comme ratée alors
  // qu'elle a abouti. Le drapeau dit au dossier s'il vient d'être ouvert ou s'il
  // attendait déjà : sans lui, un second clic donne l'impression d'en avoir créé un
  // deuxième.
  redirect(`/dossiers/${dossierId}${dejaOuvert ? "?deja=1" : ""}`);
}

export async function ouvrirDepart(
  _etat: EtatDossier | null,
  formData: FormData,
): Promise<EtatDossier> {
  return ouvrir("OFFBOARDING", formData);
}

export async function ouvrirArrivee(
  _etat: EtatDossier | null,
  formData: FormData,
): Promise<EtatDossier> {
  return ouvrir("ONBOARDING", formData);
}
