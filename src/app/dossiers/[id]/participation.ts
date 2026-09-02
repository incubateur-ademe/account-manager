"use server";

import { dossierVivant } from "@/core/dossier";
import { estOperateur } from "@/core/identite";
import {
  canalMenace,
  DUREE_MAX_JOURS,
  echeanceDOctroi,
  type RefusAdresse,
  voieDeConnexion,
} from "@/core/participation";
import { actionTracee } from "@/lib/actions";
import { canalRecevable } from "@/lib/connexion";
import { prisma } from "@/lib/db";
import { webEnv } from "@/lib/env";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

export interface EtatParticipation {
  erreur?: string;
  /**
   * Dit à l'octroi et pas seulement dans la liste : c'est au moment du geste qu'un
   * opérateur peut encore choisir une autre adresse.
   */
  avertissement?: string;
}

/**
 * Ce que la connexion opposerait à ce canal, dit à qui peut encore le corriger.
 *
 * Le dictionnaire est complet parce que son type l'exige, non parce que ce geste peut
 * tout produire : il ajoute lui-même un candidat, et un candidat né d'un octroi passe
 * avant celui de la fiche, si bien que ni `INCONNUE` ni `FICHE_FERMEE` ne sortent d'ici.
 */
const REFUS_DE_CANAL: Record<RefusAdresse, string> = {
  INCONNUE: "Cette adresse ne désigne personne.",
  PLURALITE:
    "Cette adresse désigne déjà quelqu'un d'autre : un lien envoyé là n'identifierait personne.",
  FICHE_FERMEE: "Cette adresse est portée par une fiche que la collecte réécrit.",
  ALLOWLIST:
    "Cette adresse porte le nom d'un opérateur de l'outil : elle n'ouvrira jamais un droit par dossier.",
  LIGNE_ETRANGERE:
    "Quelqu'un s'est déjà connecté avec cette adresse par son identifiant beta.gouv : elle ne peut pas servir de canal.",
};

/**
 * Ouvre un dossier à quelqu'un qui n'est pas de l'équipe, pour un temps et pour une
 * raison écrite.
 *
 * Cinq refus, et le compte se dit parce qu'il se vérifie : une durée qui n'en est pas
 * une, un dossier qui n'est plus ouvert, un dossier dont le départ n'est que soupçonné,
 * une fiche qui nomme un opérateur, un canal que la connexion écarterait. Le dossier
 * clos est celui qu'on oublie : la mort du droit s'y déduit, mais rien n'empêcherait
 * d'en octroyer un dessus.
 *
 * Ré-octroyer après une révocation réécrit la même ligne, le couple dossier et personne
 * étant unique. Les cinq champs de l'octroi sont donc reposés et les trois de la
 * révocation effacés : sans quoi la date d'octroi resterait celle du premier, et
 * l'ancien canal survivrait à un geste posé justement parce qu'il ne répondait plus.
 */
export async function octroyerParticipation(
  _etat: EtatParticipation | null,
  formData: FormData,
): Promise<EtatParticipation> {
  const operateur = await requireOperateur();

  const dossierId = String(formData.get("dossierId") ?? "").trim();
  const identifiant = String(formData.get("identifiant") ?? "")
    .trim()
    .toLowerCase();
  const motif = String(formData.get("motif") ?? "").trim();
  const canalSaisi = String(formData.get("canal") ?? "")
    .trim()
    .toLowerCase();
  const jours = Number(String(formData.get("jours") ?? "").trim());

  if (motif.length < 3) {
    return {
      erreur: "Dites pourquoi ce droit est accordé : sans motif, personne ne saura le retirer.",
    };
  }

  const maintenant = new Date();
  const echeance = echeanceDOctroi(maintenant, jours);
  if (echeance === null) {
    return {
      erreur: `Une durée est un nombre entier de jours, d'au moins un et d'au plus ${DUREE_MAX_JOURS}.`,
    };
  }

  const dossier = await prisma.accessCase.findUnique({
    where: { id: dossierId },
    select: { id: true, state: true },
  });

  if (dossier === null) {
    return { erreur: "Ce dossier n'existe plus." };
  }
  if (!dossierVivant(dossier.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }
  // Distinct de la garde du dessus, et il faut qu'il le reste : le droit se lit sur un
  // dossier veillé, il ne s'y écrit pas. Y octroyer un accès dirait à quelqu'un qu'on
  // soupçonne le départ d'un tiers avant que personne ne l'ait tranché.
  if (dossier.state === "WATCH") {
    return {
      erreur:
        "Ce départ n'est que soupçonné : ouvrir ce dossier à quelqu'un le lui apprendrait avant que personne ne l'ait décidé.",
    };
  }

  const personne = await prisma.person.findUnique({
    where: { username: identifiant },
    select: {
      id: true,
      username: true,
      source: true,
      usernameFabricated: true,
      communicationEmail: true,
    },
  });

  if (personne === null) {
    return { erreur: "Aucune fiche ne porte cet identifiant." };
  }
  if (estOperateur(personne.username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES)) {
    return {
      erreur: `« ${personne.username} » est un opérateur de l'outil : ce dossier lui est déjà ouvert, et un droit par objet n'ajouterait rien.`,
    };
  }

  let canal: string | null = null;
  if (canalSaisi.length > 0) {
    if (voieDeConnexion(canalSaisi) !== "ADRESSE") {
      return { erreur: "Le canal est une adresse de courriel, ou rien du tout." };
    }
    const refus = await canalRecevable(personne, canalSaisi);
    if (refus !== null) {
      return { erreur: REFUS_DE_CANAL[refus] };
    }
    canal = canalSaisi;
  }

  await actionTracee({
    action: "participation.octroi",
    targetType: "participation",
    targetId: `${dossier.id}:${personne.username}`,
    after: {
      dossier: dossier.id,
      personne: personne.username,
      motif,
      jours,
      echeance: echeance.toISOString(),
      canal,
    },
    revalider: [`/dossiers/${dossier.id}`],
    ecrire: async () => {
      await prisma.caseParticipation.upsert({
        where: { accessCaseId_personId: { accessCaseId: dossier.id, personId: personne.id } },
        create: {
          accessCaseId: dossier.id,
          personId: personne.id,
          reason: motif,
          channelEmail: canal,
          grantedBy: operateur.username,
          grantedAt: maintenant,
          expiresAt: echeance,
        },
        update: {
          reason: motif,
          channelEmail: canal,
          grantedBy: operateur.username,
          grantedAt: maintenant,
          expiresAt: echeance,
          revokedAt: null,
          revokedBy: null,
          revokedReason: null,
        },
      });
    },
  });

  return canalMenace(personne, canal, policy().mail.domainsLostOnDeparture)
    ? {
        avertissement:
          "Le lien de connexion partira sur une boîte que ce départ va couper : elle cessera de répondre, et le droit deviendra inutilisable avant son terme. Ré-octroyez en déclarant une autre adresse dès qu'elle est connue.",
      }
    : {};
}

/**
 * Retire le droit, tout de suite. Rien n'est supprimé : la ligne reste, révoquée et
 * datée, parce qu'elle dit ce que quelqu'un avait décidé.
 *
 * L'écriture est conditionnée sur l'absence de révocation, et elle lève quand elle ne
 * touche rien : le perdant d'une double soumission n'écrase pas le nom ni l'heure du
 * gagnant. Sa trace reste au journal, en échec, et c'est voulu plutôt que subi : la
 * trace précède l'action, donc l'intention des deux appels y figure de toute façon.
 */
export async function revoquerParticipation(
  _etat: EtatParticipation | null,
  formData: FormData,
): Promise<EtatParticipation> {
  const operateur = await requireOperateur();

  const participationId = String(formData.get("participationId") ?? "").trim();
  const motif = String(formData.get("motif") ?? "").trim();

  const droit = await prisma.caseParticipation.findUnique({
    where: { id: participationId },
    select: {
      id: true,
      accessCaseId: true,
      revokedAt: true,
      person: { select: { username: true } },
    },
  });

  if (droit === null) {
    return { erreur: "Ce droit n'existe plus." };
  }
  if (droit.revokedAt !== null) {
    return { erreur: "Ce droit est déjà révoqué." };
  }

  const maintenant = new Date();

  await actionTracee({
    action: "participation.revocation",
    targetType: "participation",
    targetId: `${droit.accessCaseId}:${droit.person.username}`,
    after: {
      dossier: droit.accessCaseId,
      personne: droit.person.username,
      ...(motif ? { motif } : {}),
    },
    revalider: [`/dossiers/${droit.accessCaseId}`],
    ecrire: async () => {
      const { count } = await prisma.caseParticipation.updateMany({
        where: { id: droit.id, revokedAt: null },
        data: {
          revokedAt: maintenant,
          revokedBy: operateur.username,
          revokedReason: motif.length > 0 ? motif : null,
        },
      });

      if (count === 0) {
        throw new Error("Ce droit a été révoqué pendant que vous le retiriez.");
      }
    },
  });

  return {};
}
