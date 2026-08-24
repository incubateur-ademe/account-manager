"use server";

import { redirect } from "next/navigation";
import { dossierVivant } from "@/core/dossier";
import {
  type ChampsFiche,
  type FicheAFusionner,
  ficheEditable,
  normaliserIdentifiant,
  type PlanFusion,
  planifierFusion,
  renommable,
  validerChamps,
} from "@/core/fiche-manuelle";
import { enCours } from "@/core/rattachement-startup";
import { Prisma } from "@/generated/prisma/client";
import { actionTracee } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";

export type EtatEdition = { erreur: string } | { modifie: true } | null;

/**
 * Ce que la fusion déplacerait, sous une forme que le formulaire sait afficher.
 * L'action ne l'accompagne d'aucune écriture : la fusion est un geste explicite et
 * confirmé, jamais la conséquence silencieuse d'un renommage.
 */
export interface ApercuFusion {
  source: string;
  cible: string;
  blocage: string | null;
  comptes: readonly { provider: string; handle: string; methode: string }[];
  doublons: readonly { provider: string; source: readonly string[]; cible: readonly string[] }[];
  constatsMigres: number;
  clesReecrites: number;
  constatsFermes: number;
  dossiers: number;
  rattachements: number;
  rattachementsEnCours: number;
  surchargeSuit: boolean;
  /** Décrit la surcharge de la source quand la cible en porte déjà une. */
  surchargeAbandonnee: string | null;
  /** Renseigné quand la fusion repousse l'échéance de la fiche cible. */
  prolongation: { avant: string | null; apres: string } | null;
  references: number;
  referencesSupprimees: number;
}

export type EtatIdentifiant = { erreur: string } | { fusion: ApercuFusion } | null;

// `/startups` en fait partie : une fusion déplace les rattachements manuels d'une
// fiche à l'autre et un renommage change l'identifiant affiché, deux écritures dont
// l'index des startups et la page de chacune tirent directement ce qu'ils montrent.
const CHEMINS_LISTES = ["/personnes", "/comptes-isoles", "/constats", "/startups", "/"] as const;

const SELECTION_FICHE = {
  id: true,
  username: true,
  source: true,
  usernameFabricated: true,
  fullname: true,
  githubLogin: true,
  primaryEmail: true,
  communicationEmail: true,
  missionEnd: true,
} as const;

function declaresLocaux(): string[] {
  return policy().scope.local.map((entree) => entree.username);
}

/**
 * Corrige ce qu'un opérateur a saisi. Ni l'échéance, qui vient d'un rattachement
 * daté, ni l'appartenance, ni les startups, ni la source : ce sont des constats,
 * pas des saisies.
 *
 * Le login GitHub et les adresses alimentent le rapprochement automatique, et
 * c'est voulu : les corriger rebranche les comptes encore isolés et ceux à venir.
 * Ceux déjà rattachés à la mauvaise personne ne bougent pas, le rapprochement ne
 * repassant jamais sur une identité déjà attribuée.
 */
export async function modifierFiche(_etat: EtatEdition, formData: FormData): Promise<EtatEdition> {
  const username = String(formData.get("username") ?? "").trim();

  const personne = await prisma.person.findUnique({
    where: { username },
    select: SELECTION_FICHE,
  });

  if (!personne) {
    return { erreur: "Cette personne n'est plus en base." };
  }
  if (!ficheEditable(personne, declaresLocaux()).editable) {
    return { erreur: "Cette fiche n'est pas modifiable ici : une collecte la réécrit." };
  }

  const validation = validerChamps({
    fullname: String(formData.get("fullname") ?? ""),
    githubLogin: String(formData.get("githubLogin") ?? ""),
    primaryEmail: String(formData.get("primaryEmail") ?? ""),
    communicationEmail: String(formData.get("communicationEmail") ?? ""),
  });

  if ("erreur" in validation) {
    return { erreur: validation.erreur };
  }

  const avant: Partial<ChampsFiche> = {};
  const apres: Partial<ChampsFiche> = {};
  for (const cle of [
    "fullname",
    "githubLogin",
    "primaryEmail",
    "communicationEmail",
  ] as const satisfies readonly (keyof ChampsFiche)[]) {
    if (personne[cle] !== validation.champs[cle]) {
      Object.assign(avant, { [cle]: personne[cle] });
      Object.assign(apres, { [cle]: validation.champs[cle] });
    }
  }

  if (Object.keys(apres).length === 0) {
    return { modifie: true };
  }

  await actionTracee({
    action: "personne.edition",
    targetType: "personne",
    targetId: personne.username,
    before: avant,
    after: apres,
    revalider: [`/personnes/${personne.username}`, "/personnes"],
    ecrire: async () => {
      await prisma.person.update({ where: { id: personne.id }, data: validation.champs });
    },
  });

  return { modifie: true };
}

async function inventaireDe(
  personId: string,
  username: string,
  missionEnd: Date | null,
): Promise<FicheAFusionner> {
  const [comptes, constats, dossiers, references, rattachements, surcharge] = await Promise.all([
    prisma.externalIdentity.findMany({
      where: { personId },
      select: { id: true, provider: true, handle: true, externalId: true, matchMethod: true },
      orderBy: [{ provider: "asc" }, { handle: "asc" }],
    }),
    prisma.finding.findMany({
      where: { personId },
      select: { id: true, kind: true, dedupKey: true },
    }),
    prisma.accessCase.findMany({ where: { personId }, select: { id: true, state: true } }),
    prisma.reference.findMany({ where: { personId }, select: { id: true, resourceId: true } }),
    // Ouverts comme clos : un rattachement fermé explique un constat levé la veille,
    // et le schéma pose qu'un retrait ferme au lieu de supprimer.
    prisma.startupAssignment.findMany({
      where: { personId },
      select: { id: true, startupGhid: true, until: true, endedAt: true },
    }),
    prisma.scopeOverride.findUnique({
      where: { personId },
      select: { id: true, decision: true, createdBy: true, reason: true },
    }),
  ]);

  return {
    username,
    missionEnd,
    comptes,
    constats,
    dossiers: dossiers.map((dossier) => ({
      id: dossier.id,
      vivant: dossierVivant(dossier.state),
    })),
    references,
    rattachements,
    surcharge:
      surcharge === null
        ? null
        : {
            id: surcharge.id,
            sens: surcharge.decision,
            par: surcharge.createdBy,
            raison: surcharge.reason,
          },
  };
}

function apercuDe(plan: PlanFusion, aujourdHui: Date): ApercuFusion {
  return {
    source: plan.source,
    cible: plan.cible,
    blocage: plan.blocage,
    comptes: plan.comptes.map((compte) => ({
      provider: compte.provider,
      handle: compte.handle,
      methode: compte.matchMethod,
    })),
    doublons: plan.doublons,
    constatsMigres: plan.constatsMigres.length,
    clesReecrites: plan.clesReecrites.length,
    constatsFermes: plan.constatsFermes.length,
    dossiers: plan.dossiers.length,
    rattachements: plan.rattachements.length,
    rattachementsEnCours: plan.rattachements.filter((rattachement) =>
      enCours(rattachement, aujourdHui),
    ).length,
    surchargeSuit: plan.surcharge !== null,
    surchargeAbandonnee:
      plan.surchargeAbandonnee === null
        ? null
        : `${plan.surchargeAbandonnee.sens === "EXCLUDE" ? "hors incubateur" : "dans l'incubateur"}, posée par ${plan.surchargeAbandonnee.par} : « ${plan.surchargeAbandonnee.raison} »`,
    prolongation:
      plan.prolongation === null
        ? null
        : {
            avant: plan.prolongation.avant === null ? null : dateFr.format(plan.prolongation.avant),
            apres: dateFr.format(plan.prolongation.apres),
          },
    references: plan.references.length,
    referencesSupprimees: plan.referencesSupprimees.length,
  };
}

/**
 * Chaque compte reçoit son propre événement, cible `identite`, avec `externalId`
 * dans la charge utile : le handle peut changer chez le fournisseur, l'`externalId`
 * non, et sans lui la chaîne se casserait au premier renommage côté GitHub.
 *
 * Rendu comme une fonction du résultat parce que la trace précède l'écriture :
 * l'événement affirme le déplacement avant qu'il ait lieu, et si l'écriture casse,
 * il faut le démentir. Sans ce démenti, N lignes du journal affirmeraient
 * durablement qu'un compte a changé de fiche alors que rien n'a bougé.
 */
function tracerComptesDeplaces(
  operateur: string,
  comptes: readonly {
    provider: string;
    handle: string;
    externalId: string;
    matchMethod?: string;
  }[],
  de: string,
  vers: string,
  result: "SUCCESS" | "FAILURE",
): void {
  for (const compte of comptes) {
    audit({
      actorKind: "HUMAN",
      actorUsername: operateur,
      action: "identite.reattribution",
      targetType: "identite",
      targetId: `${compte.provider}:${compte.handle}`,
      before: { personne: de, ...(compte.matchMethod ? { methode: compte.matchMethod } : {}) },
      after: { personne: vers, externalId: compte.externalId },
      result,
    });
  }
}

/**
 * Traduit une violation d'unicité en phrase. Deux clés uniques peuvent sauter ici :
 * `Person.username` sur un renommage concurrent, et `Finding.dedupKey` sur une clé
 * de constat prise entre l'aperçu et la confirmation. Sans traduction, l'écran
 * afficherait une erreur technique là où la bonne réponse tient en une phrase.
 */
function messageDeCollision(error: unknown, identifiant: string): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  return `« ${identifiant} » vient d'être pris, ou l'un de ses constats l'a été. Rien n'a été écrit : refaites la demande pour repartir de l'état courant.`;
}

/**
 * Un geste, deux issues. Identifiant libre : c'est un renommage, tracé
 * nominativement. Identifiant déjà porté : rien n'est écrit, et l'inventaire de ce
 * que la fusion déplacerait est rendu pour confirmation. C'est le cas réel quand la
 * personne est arrivée dans l'espace-membre entre-temps.
 */
export async function renommerFiche(
  _etat: EtatIdentifiant,
  formData: FormData,
): Promise<EtatIdentifiant> {
  // Avant toute lecture, contrairement aux autres refus de ce fichier qui ne rendent
  // qu'un message : l'aperçu de fusion sort de la base les comptes des deux fiches,
  // fournisseur et handle compris. Le proxy constate un cookie, il ne valide ni la
  // session ni l'allowlist, et c'est ici que ça se fait.
  await requireOperateur();

  const username = String(formData.get("username") ?? "").trim();
  const demande = String(formData.get("nouveau") ?? "").trim();
  const confirme = String(formData.get("confirme") ?? "") === "oui";

  const personne = await prisma.person.findUnique({
    where: { username },
    select: SELECTION_FICHE,
  });

  if (!personne) {
    return { erreur: "Cette personne n'est plus en base." };
  }
  if (!renommable(personne, declaresLocaux())) {
    return {
      erreur:
        "Cet identifiant n'a pas été fabriqué ici : c'est un pivot d'identité, et aucun code ne le met à jour.",
    };
  }

  const nouveau = normaliserIdentifiant(demande);
  if (nouveau.length < 3) {
    return { erreur: "Cette saisie ne donne pas d'identifiant exploitable." };
  }
  if (nouveau === personne.username) {
    return { erreur: "C'est déjà son identifiant." };
  }

  const cible = await prisma.person.findUnique({
    where: { username: nouveau },
    select: { id: true, username: true, missionEnd: true },
  });

  if (cible) {
    const maintenant = new Date();
    const [depuis, vers] = await Promise.all([
      inventaireDe(personne.id, personne.username, personne.missionEnd),
      inventaireDe(cible.id, cible.username, cible.missionEnd),
    ]);
    const plan = planifierFusion(depuis, vers, maintenant);

    if (plan.blocage !== null || !confirme) {
      return { fusion: apercuDe(plan, maintenant) };
    }

    try {
      await fusionner(personne.id, cible.id, plan);
    } catch (error: unknown) {
      const message = messageDeCollision(error, nouveau);
      if (message === null) {
        throw error;
      }
      return { erreur: message };
    }
    redirect(`/personnes/${encodeURIComponent(cible.username)}`);
  }

  const comptes = await prisma.externalIdentity.findMany({
    where: { personId: personne.id },
    select: { provider: true, handle: true, externalId: true },
  });

  // Une fiche renommable n'a jamais été collectée, donc aucune startup ne la porte par
  // ce chemin, mais rien n'empêche qu'on l'ait rattachée à la main : ces pages-là
  // nomment son identifiant et le lient, et celui-ci change ici.
  const rattachees = await prisma.startupAssignment.findMany({
    where: { personId: personne.id },
    select: { startupGhid: true },
    distinct: ["startupGhid"],
  });

  try {
    await actionTracee({
      action: "personne.renommage",
      targetType: "personne",
      targetId: personne.username,
      before: { username: personne.username },
      after: { username: nouveau },
      revalider: [
        `/personnes/${personne.username}`,
        `/personnes/${nouveau}`,
        ...rattachees.map(
          (rattachement) => `/startups/${encodeURIComponent(rattachement.startupGhid)}`,
        ),
        ...CHEMINS_LISTES,
      ],
      ecrire: async (operateur) => {
        tracerComptesDeplaces(operateur.username, comptes, personne.username, nouveau, "SUCCESS");

        try {
          await prisma.person.update({
            where: { id: personne.id },
            data: { username: nouveau },
          });
        } catch (error: unknown) {
          tracerComptesDeplaces(operateur.username, comptes, personne.username, nouveau, "FAILURE");
          throw error;
        }
      },
    });
  } catch (error: unknown) {
    const message = messageDeCollision(error, nouveau);
    if (message !== null) {
      return { erreur: message };
    }
    throw error;
  }

  // Hors du passage tracé : `redirect` interrompt le flux par une exception que le
  // journal prendrait pour un échec, et l'action serait consignée comme ratée alors
  // qu'elle a abouti.
  redirect(`/personnes/${encodeURIComponent(nouveau)}`);
}

/**
 * Déplace puis supprime, dans cet ordre, et dans une seule transaction.
 *
 * L'ordre vient du plan et n'est pas recopié ici : supprimer la fiche avant d'avoir
 * tout déplacé laisserait les cascades du schéma emporter sans un mot les constats,
 * les dossiers et les références, et abandonner les plans du dossier supprimé avec
 * un `accessCaseId` nul, vivants mais introuvables dans les écrans.
 */
async function fusionner(sourceId: string, cibleId: string, plan: PlanFusion): Promise<void> {
  await actionTracee({
    action: "personne.fusion",
    targetType: "personne",
    targetId: plan.source,
    before: { username: plan.source },
    after: {
      username: plan.cible,
      comptes: plan.comptes.map((compte) => `${compte.provider}:${compte.handle}`),
      constatsMigres: plan.constatsMigres.map((constat) => constat.dedupKey),
      clesReecrites: plan.clesReecrites,
      constatsFermes: plan.constatsFermes.map((constat) => constat.dedupKey),
      dossiers: plan.dossiers.length,
      rattachements: plan.rattachements.map((rattachement) => rattachement.startupGhid),
      surcharge: plan.surcharge === null ? null : plan.surcharge.sens,
      // Nommée et non comptée : c'est une décision nominative qui disparaît, le
      // journal est le seul endroit où elle survit.
      surchargeAbandonnee: plan.surchargeAbandonnee,
      references: plan.references.length,
      referencesSupprimees: plan.referencesSupprimees.length,
    },
    // La page de chaque startup dont un rattachement change de fiche, et pas seulement
    // l'index : elle nomme ses membres et lie leurs identifiants, dont l'un vient de
    // disparaître. Sans elle, revenir en arrière depuis la fiche fusionnée sert une
    // liste où la personne absorbée figure encore, avec un lien vers une fiche qui
    // n'existe plus.
    revalider: [
      `/personnes/${plan.source}`,
      `/personnes/${plan.cible}`,
      ...new Set(
        plan.rattachements.map(
          (rattachement) => `/startups/${encodeURIComponent(rattachement.startupGhid)}`,
        ),
      ),
      ...CHEMINS_LISTES,
    ],
    ecrire: async (operateur) => {
      tracerComptesDeplaces(operateur.username, plan.comptes, plan.source, plan.cible, "SUCCESS");

      const maintenant = new Date();

      try {
        await prisma.$transaction(async (tx) => {
          for (const etape of plan.etapes) {
            switch (etape.type) {
              case "deplacer-comptes":
                // La méthode de rapprochement est conservée : la fusion affirme que
                // ces deux fiches sont la même personne, pas que chaque compte est
                // bien à elle. Promouvoir au passage contournerait sans bruit
                // l'invariant qui interdit de couper sur une ressemblance.
                await tx.externalIdentity.updateMany({
                  where: { id: { in: [...etape.ids] } },
                  data: { personId: cibleId },
                });
                break;
              case "migrer-constats":
                await tx.finding.updateMany({
                  where: { id: { in: [...etape.ids] } },
                  data: { personId: cibleId },
                });
                break;
              case "reecrire-cles":
                for (const cle of etape.cles) {
                  await tx.finding.update({
                    where: { id: cle.id },
                    data: { dedupKey: cle.dedupKey },
                  });
                }
                break;
              case "fermer-constats":
                // Sans `closedBy` : la situation n'a pas été jugée, et la collecte
                // doit pouvoir reprendre la main.
                await tx.finding.updateMany({
                  where: { id: { in: [...etape.ids] } },
                  data: { closedAt: maintenant, closeReason: etape.raison },
                });
                break;
              case "deplacer-dossiers":
                await tx.accessCase.updateMany({
                  where: { id: { in: [...etape.ids] } },
                  data: { personId: cibleId },
                });
                break;
              case "deplacer-rattachements":
                await tx.startupAssignment.updateMany({
                  where: { id: { in: [...etape.ids] } },
                  data: { personId: cibleId },
                });
                break;
              case "deplacer-surcharge":
                await tx.scopeOverride.update({
                  where: { id: etape.id },
                  data: { personId: cibleId },
                });
                break;
              case "supprimer-surcharge":
                await tx.scopeOverride.delete({ where: { id: etape.id } });
                break;
              case "deplacer-references":
                await tx.reference.updateMany({
                  where: { id: { in: [...etape.ids] } },
                  data: { personId: cibleId },
                });
                break;
              case "supprimer-references":
                await tx.reference.deleteMany({ where: { id: { in: [...etape.ids] } } });
                break;
              case "supprimer-fiche":
                await tx.person.delete({ where: { id: sourceId } });
                break;
            }
          }
        });
      } catch (error: unknown) {
        tracerComptesDeplaces(operateur.username, plan.comptes, plan.source, plan.cible, "FAILURE");
        throw error;
      }

      // Après coup, comme le fait le détachement : ces constats n'ont pas été jugés,
      // ils ont perdu leur place. Sans ces lignes, la fermeture ne se lirait que
      // dans la charge utile de l'événement de fusion.
      for (const constat of plan.constatsFermes) {
        audit({
          actorKind: "HUMAN",
          actorUsername: operateur.username,
          action: "finding.close",
          targetType: "finding",
          targetId: constat.dedupKey,
          after: { raison: `fusionnée dans ${plan.cible}` },
          result: "SUCCESS",
        });
      }
    },
  });
}
