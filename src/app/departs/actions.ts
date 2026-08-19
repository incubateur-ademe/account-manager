"use server";

import { redirect } from "next/navigation";

import { echeanceEffective } from "@/core/rattachement-startup";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { calculerPlanDeDepart, enregistrerPlan, ouvrirDossierDeDepart } from "@/lib/depart";

export interface EtatDepart {
  erreur?: string;
}

/**
 * Ouvre un dossier de départ et calcule son plan. Rien n'est exécuté et rien n'est
 * confirmé : à ce stade, l'outil dit ce qu'il faudrait faire, et c'est tout.
 */
export async function ouvrirDepart(
  _etat: EtatDepart | null,
  formData: FormData,
): Promise<EtatDepart> {
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
  // sans quoi le dossier contredirait sa fiche.
  const echeance = echeanceEffective(personne.missionEnd, personne.startupAssignments, maintenant);

  const dossierId = await actionTracee({
    action: "depart.ouverture",
    targetType: "personne",
    targetId: personne.username,
    after: { echeance: echeance?.toISOString().slice(0, 10) ?? null },
    revalider: [`/personnes/${personne.username}`, "/departs"],
    ecrire: async (operateur) => {
      const dossier = await ouvrirDossierDeDepart(personne.id, echeance);
      if (dossier.deja) {
        return dossier.id;
      }

      const calcule = await calculerPlanDeDepart(personne.id, personne.username, maintenant);
      await enregistrerPlan(dossier.id, calcule, operateur.username, maintenant);
      return dossier.id;
    },
  });

  // Hors du passage tracé : `redirect` interrompt le flux par une exception que le
  // journal prendrait pour un échec, et l'action serait consignée comme ratée alors
  // qu'elle a abouti.
  redirect(`/departs/${dossierId}`);
}
