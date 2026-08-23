"use server";

import { prolongeLaMission } from "@/core/rattachement-startup";
import { jourUTC } from "@/core/statut";
import { actionTracee } from "@/lib/actions";
import {
  appartenanceDeLaLigne,
  phasesDesStartups,
  SELECTION_APPARTENANCE,
} from "@/lib/appartenance";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";

export type EtatDetachement = { erreur: string } | null;

/**
 * Défaire un rattachement est le pendant nécessaire de le poser : une attribution
 * erronée sans geste pour l'annuler ne se corrigerait qu'en base, hors de portée du
 * journal, et personne ne saurait plus qui a décidé quoi.
 *
 * Le compte redevient alors sans détenteur connu, ce qu'il faut : il reparaît
 * aussitôt parmi les comptes isolés, et la collecte suivante le signalera.
 */
export async function detacherIdentite(
  _etat: EtatDetachement,
  formData: FormData,
): Promise<EtatDetachement> {
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { erreur: "Compte introuvable." };
  }

  const identite = await prisma.externalIdentity.findUnique({
    where: { id },
    select: {
      id: true,
      provider: true,
      handle: true,
      matchMethod: true,
      person: { select: { username: true } },
      serviceAccount: { select: { key: true } },
    },
  });

  if (!identite) {
    return { erreur: "Ce compte n'est plus en base." };
  }

  const detenteur = identite.person?.username ?? identite.serviceAccount?.key ?? null;
  if (detenteur === null) {
    return { erreur: "Ce compte n'est rattaché à personne." };
  }

  await actionTracee({
    action: "identite.detachement",
    targetType: "identite",
    targetId: `${identite.provider}:${identite.handle}`,
    before: { detenteur, methode: identite.matchMethod },
    revalider: ["/comptes-isoles", "/personnes", "/constats", "/"],
    ecrire: async (operateur) => {
      await prisma.externalIdentity.update({
        where: { id: identite.id },
        data: { personId: null, serviceAccountId: null, matchMethod: "NONE" },
      });

      // Les constats qui reposaient sur ce rattachement n'ont plus d'objet : celui
      // d'un compte dont le détenteur est parti n'a de sens que si le compte est
      // bien le sien.
      const caducs = await prisma.finding.findMany({
        where: { externalIdentityId: identite.id, closedAt: null },
        select: { id: true, dedupKey: true },
      });

      if (caducs.length === 0) {
        return;
      }

      await prisma.finding.updateMany({
        where: { id: { in: caducs.map((constat) => constat.id) } },
        data: { closedAt: new Date(), closeReason: `rattachement à ${detenteur} défait` },
      });

      for (const constat of caducs) {
        audit({
          actorKind: "HUMAN",
          actorUsername: operateur.username,
          action: "finding.close",
          targetType: "finding",
          targetId: constat.dedupKey,
          after: { raison: `rattachement à ${detenteur} défait` },
          result: "SUCCESS",
        });
      }
    },
  });

  return null;
}

/** Même discriminant que le rattachement d'un compte, et pour la même raison. */
export type EtatRattachementStartup = { erreur: string; confirmationRequise?: true } | null;

const CHEMINS_RATTACHEMENT = ["/personnes", "/constats", "/startups", "/"] as const;

function jourDepuisIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return null;
  }
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Rattache une personne à une startup pour une durée bornée.
 *
 * L'objet vit en base et non dans `Person.startups`, que la collecte réécrit sans
 * condition à chaque passage, jusqu'à la remettre vide pour les personnes déclarées
 * dans la politique : une valeur écrite là disparaîtrait à la première nuit.
 *
 * Rien ici ne lève ni ne ferme de constat. `INACTIVE_STARTUP` dépend des phases de
 * toutes les startups et d'une date qui passe toute seule : le recalculer ici
 * créerait une seconde vérité, et resterait de toute façon incomplet le jour où un
 * rattachement expire sans que personne n'ait cliqué. C'est la collecte qui tranche.
 */
export async function rattacherAStartup(
  _etat: EtatRattachementStartup,
  formData: FormData,
): Promise<EtatRattachementStartup> {
  const username = String(formData.get("username") ?? "").trim();
  const ghid = String(formData.get("startup") ?? "").trim();
  const saisie = String(formData.get("jusquAu") ?? "").trim();
  const motif = String(formData.get("motif") ?? "").trim();

  const personne = await prisma.person.findUnique({
    where: { username },
    select: { id: true, username: true, missionEnd: true },
  });

  if (!personne) {
    return { erreur: "Cette personne n'est plus en base." };
  }

  // Un ghid libre produirait une phase inconnue, donc un constat qui ne se lèvera
  // jamais, sans que rien ne le dise.
  const startup = await prisma.startup.findUnique({
    where: { ghid },
    select: { ghid: true, name: true },
  });
  if (!startup) {
    return { erreur: `Aucune startup connue ne porte l'identifiant « ${ghid} ».` };
  }

  const until = jourDepuisIso(saisie);
  if (until === null) {
    return { erreur: "Indiquez une date de fin, au format AAAA-MM-JJ." };
  }

  const maintenant = new Date();
  if (jourUTC(until) < jourUTC(maintenant)) {
    return {
      erreur: "Cette date est déjà passée : le rattachement n'aurait aucun effet.",
    };
  }

  // L'avertissement de l'écran ne protège de rien, un formulaire se poste sans
  // passer par lui. Le refus tant que la confirmation manque est le seul dispositif
  // qui tienne.
  const prolonge = prolongeLaMission(personne.missionEnd, until);
  if (prolonge && String(formData.get("confirme") ?? "") !== "oui") {
    return {
      erreur:
        "Cette date dépasse la fin de mission connue : le rattachement prolongera ses accès d'autant. Confirmez pour continuer.",
      confirmationRequise: true,
    };
  }

  const remplace = await prisma.startupAssignment.findFirst({
    where: { personId: personne.id, startupGhid: startup.ghid, endedAt: null },
    select: { id: true, until: true },
  });

  await actionTracee({
    action: "rattachement.pose",
    targetType: "rattachement",
    // L'ordre compte : le filtre « historique de cette personne » du journal
    // reconnaît une cible qui se termine par le username.
    targetId: `${startup.ghid}:${personne.username}`,
    ...(remplace ? { before: { jusquAu: remplace.until.toISOString().slice(0, 10) } } : {}),
    after: {
      startup: startup.ghid,
      jusquAu: saisie,
      motif: motif === "" ? null : motif,
      prolongeLaMission: prolonge,
    },
    revalider: [
      `/personnes/${personne.username}`,
      `/startups/${startup.ghid}`,
      ...CHEMINS_RATTACHEMENT,
    ],
    ecrire: async (operateur) => {
      // Reposer sur la même startup remplace dans le même geste tracé : prolonger
      // reste un acte unique et lisible, plutôt qu'un retrait suivi d'une pose que
      // rien ne relierait. D'où la transaction : une panne entre les deux écritures
      // laisserait l'ancien fermé sans que le nouveau existe, et la personne
      // perdrait son rattachement sans que personne l'ait demandé.
      await prisma.$transaction(async (tx) => {
        if (remplace) {
          // Conditionné sur `endedAt: null` : une fermeture concurrente ne doit pas
          // se faire réécrire son auteur et sa date par celle-ci.
          await tx.startupAssignment.updateMany({
            where: { id: remplace.id, endedAt: null },
            data: { endedAt: new Date(), endedBy: operateur.username },
          });
        }

        await tx.startupAssignment.create({
          data: {
            personId: personne.id,
            startupGhid: startup.ghid,
            until,
            ...(motif === "" ? {} : { reason: motif }),
            createdBy: operateur.username,
          },
        });
      });
    },
  });

  return null;
}

/**
 * Le geste symétrique. Il ferme, il ne supprime pas : une ligne effacée rendrait
 * illisible un constat levé la veille.
 */
export async function retirerRattachement(
  _etat: EtatRattachementStartup,
  formData: FormData,
): Promise<EtatRattachementStartup> {
  const id = String(formData.get("id") ?? "").trim();

  const rattachement = await prisma.startupAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      startupGhid: true,
      until: true,
      endedAt: true,
      createdBy: true,
      createdAt: true,
      person: { select: { username: true } },
    },
  });

  if (!rattachement) {
    return { erreur: "Ce rattachement n'est plus en base." };
  }
  if (rattachement.endedAt !== null) {
    return { erreur: "Ce rattachement est déjà clos." };
  }

  await actionTracee({
    action: "rattachement.retrait",
    targetType: "rattachement",
    targetId: `${rattachement.startupGhid}:${rattachement.person.username}`,
    before: {
      startup: rattachement.startupGhid,
      jusquAu: rattachement.until.toISOString().slice(0, 10),
      posePar: rattachement.createdBy,
      poseLe: rattachement.createdAt.toISOString().slice(0, 10),
    },
    revalider: [
      `/personnes/${rattachement.person.username}`,
      `/startups/${rattachement.startupGhid}`,
      ...CHEMINS_RATTACHEMENT,
    ],
    ecrire: async (operateur) => {
      // `updateMany` conditionné plutôt qu'un `update` par identifiant : deux
      // retraits concurrents laisseraient sinon le second réécrire l'auteur et la
      // date du premier, sur un geste qui avait déjà eu lieu.
      await prisma.startupAssignment.updateMany({
        where: { id: rattachement.id, endedAt: null },
        data: { endedAt: new Date(), endedBy: operateur.username },
      });
    },
  });

  return null;
}

export type EtatAppartenance = { erreur: string } | null;

const CHEMINS_APPARTENANCE = ["/personnes", "/"] as const;

/**
 * Dit que quelqu'un est des nôtres, ou qu'il ne l'est plus, quand les faits ne
 * suffisent pas à trancher : un coach sans produit précis, un prestataire suivi à
 * la main, ou l'inverse, quelqu'un que la collecte rattache encore et dont on veut
 * dire qu'il est parti.
 *
 * Elle dit l'appartenance, elle n'ordonne rien. Aucune date de disparition, aucun
 * constat ouvert ou fermé, aucune identité rendue révocable : la personne reste
 * dans les listes et ses comptes continuent d'être examinés. Sans cette règle, une
 * sortie forcée deviendrait le moyen le plus rapide de faire disparaître un écart
 * gênant. Ce qui coupe des accès reste le dossier de départ.
 */
export async function forcerAppartenance(
  _etat: EtatAppartenance,
  formData: FormData,
): Promise<EtatAppartenance> {
  const username = String(formData.get("username") ?? "").trim();
  const sens = String(formData.get("sens") ?? "");
  const raison = String(formData.get("raison") ?? "").trim();

  if (sens !== "INCLUDE" && sens !== "EXCLUDE") {
    return { erreur: "Sens de la décision non reconnu." };
  }
  if (raison.length < 3) {
    return {
      erreur:
        "Indiquez la raison de cette décision : une appartenance sans motif est une décision qu'on ne saura pas réexaminer.",
    };
  }

  const personne = await prisma.person.findUnique({
    where: { username },
    select: { id: true, username: true, ...SELECTION_APPARTENANCE },
  });

  if (!personne) {
    return { erreur: "Cette personne n'est plus en base." };
  }

  const avant = appartenanceDeLaLigne(
    personne,
    await phasesDesStartups(),
    policy().startups.terminalPhases,
    new Date(),
  );

  await actionTracee({
    action: "personne.appartenance.forcee",
    targetType: "personne",
    targetId: personne.username,
    before: { motif: avant.motif, dans: avant.dans },
    after: { sens, raison },
    revalider: [`/personnes/${personne.username}`, ...CHEMINS_APPARTENANCE],
    ecrire: async (operateur) => {
      // Reposer une surcharge est une nouvelle décision : elle reprend l'auteur et
      // la date du jour, sans quoi l'écran attribuerait le geste au précédent.
      await prisma.scopeOverride.upsert({
        where: { personId: personne.id },
        update: {
          decision: sens,
          reason: raison,
          createdBy: operateur.username,
          createdAt: new Date(),
        },
        create: {
          personId: personne.id,
          decision: sens,
          reason: raison,
          createdBy: operateur.username,
        },
      });
    },
  });

  return null;
}

/**
 * Le geste symétrique. L'appartenance redevient celle des faits, et l'historique de
 * la décision reste au journal : c'est lui qui porte qui a décidé quoi, pas une
 * seconde table.
 */
export async function libererAppartenance(
  _etat: EtatAppartenance,
  formData: FormData,
): Promise<EtatAppartenance> {
  const username = String(formData.get("username") ?? "").trim();

  const personne = await prisma.person.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      scopeOverride: { select: { decision: true, reason: true } },
    },
  });

  if (!personne) {
    return { erreur: "Cette personne n'est plus en base." };
  }
  if (!personne.scopeOverride) {
    return { erreur: "Aucune surcharge d'appartenance n'est posée sur cette personne." };
  }

  await actionTracee({
    action: "personne.appartenance.liberee",
    targetType: "personne",
    targetId: personne.username,
    before: {
      sens: personne.scopeOverride.decision,
      raison: personne.scopeOverride.reason,
    },
    revalider: [`/personnes/${personne.username}`, ...CHEMINS_APPARTENANCE],
    ecrire: async () => {
      await prisma.scopeOverride.delete({ where: { personId: personne.id } });
    },
  });

  return null;
}
