"use server";

import { randomUUID } from "node:crypto";

import { echeanceEffective } from "@/core/rattachement-startup";
import { type ResultatParPersonne, type ResumeDeLot, resumeDuLot } from "@/core/startups";
import { actionTracee } from "@/lib/actions";
import {
  appartenanceDeLaLigne,
  phasesDesStartups,
  SELECTION_APPARTENANCE,
} from "@/lib/appartenance";
import { prisma } from "@/lib/db";
import { calculerPlanDeDepart, enregistrerPlan, ouvrirDossierDeDepart } from "@/lib/depart";
import { policy } from "@/lib/policy";

export type EtatLot = { erreur: string } | { resume: ResumeDeLot } | null;

/**
 * Trois gestes, trois actions, et jamais un discriminant : le ticket dit que déclarer
 * quelqu'un hors incubateur et ouvrir son dossier de départ ne se remplacent pas, et
 * un seul formulaire à trois boutons ferait croire à un choix exclusif.
 *
 * Chacune boucle côté serveur plutôt que de laisser le client enchaîner N appels : il
 * ne saurait pas préserver l'ordre, la raison commune et la moitié des erreurs, et
 * chaque appel repaierait la barrière de session et une revalidation complète.
 *
 * Dans la boucle, un `actionTracee` PAR PERSONNE. Jamais un seul pour le lot : un
 * événement qui dirait « quinze personnes sorties » ne se réexamine pas. Ils portent
 * tous le même `correlationId`, ce qui rend le lot entier au filtre d'exécution du
 * journal, et chacun recopie la raison commune pour rester lisible seul.
 */

const CHEMINS_LOT = ["/personnes", "/constats", "/startups", "/"] as const;

function cheminsDe(ghid: string, username: string): string[] {
  return [`/personnes/${username}`, `/startups/${ghid}`, ...CHEMINS_LOT];
}

interface Entree {
  usernames: string[];
  raison: string;
  ghid: string;
}

function lireEntree(formData: FormData, raisonRequise: boolean): Entree | { erreur: string } {
  const usernames = formData
    .getAll("username")
    .map((valeur) => String(valeur).trim())
    .filter((valeur) => valeur.length > 0);
  const raison = String(formData.get("raison") ?? "").trim();
  const ghid = String(formData.get("startup") ?? "").trim();

  if (!ghid) {
    return { erreur: "Startup introuvable." };
  }
  if (usernames.length === 0) {
    return { erreur: "Sélectionnez au moins une personne." };
  }
  if (raisonRequise && raison.length < 3) {
    return {
      erreur:
        "Indiquez la raison de ce traitement : elle sera recopiée sur la trace de chaque personne.",
    };
  }

  return { usernames, raison, ghid };
}

/**
 * Une personne dont l'écriture échoue laisse DEUX traces au journal, l'intention puis
 * l'échec, et c'est voulu. Le récapitulatif compte donc des personnes et jamais des
 * événements, et l'échec reste borné à sa ligne : une transaction unique sur quinze
 * personnes ferait annuler les quatorze autres par celle qui a disparu de la base
 * entre l'affichage et la soumission.
 */
async function traiterChacune(
  usernames: readonly string[],
  traiter: (username: string) => Promise<ResultatParPersonne>,
): Promise<ResumeDeLot> {
  const resultats: ResultatParPersonne[] = [];

  for (const username of usernames) {
    try {
      resultats.push(await traiter(username));
    } catch (error: unknown) {
      resultats.push({
        username,
        fullname: username,
        issue: "ECHEC",
        detail: error instanceof Error ? error.message : "Échec inattendu.",
      });
    }
  }

  return resumeDuLot(resultats);
}

export async function declarerHorsIncubateurEnLot(
  _etat: EtatLot,
  formData: FormData,
): Promise<EtatLot> {
  const entree = lireEntree(formData, true);
  if ("erreur" in entree) {
    return entree;
  }

  const lot = randomUUID();
  const phases = await phasesDesStartups();
  const terminales = policy().startups.terminalPhases;
  const maintenant = new Date();

  const resume = await traiterChacune(entree.usernames, async (username) => {
    const personne = await prisma.person.findUnique({
      where: { username },
      select: { id: true, username: true, fullname: true, ...SELECTION_APPARTENANCE },
    });

    if (!personne) {
      return {
        username,
        fullname: username,
        issue: "ECHEC",
        detail: "Cette personne n'est plus en base.",
      };
    }

    const avant = appartenanceDeLaLigne(personne, phases, terminales, maintenant);

    await actionTracee({
      action: "personne.appartenance.forcee",
      targetType: "personne",
      targetId: personne.username,
      correlationId: lot,
      before: { motif: avant.motif, dans: avant.dans },
      after: { sens: "EXCLUDE", raison: entree.raison, startup: entree.ghid, lot },
      revalider: cheminsDe(entree.ghid, personne.username),
      ecrire: async (operateur) => {
        await prisma.scopeOverride.upsert({
          where: { personId: personne.id },
          update: {
            decision: "EXCLUDE",
            reason: entree.raison,
            createdBy: operateur.username,
            createdAt: new Date(),
          },
          create: {
            personId: personne.id,
            decision: "EXCLUDE",
            reason: entree.raison,
            createdBy: operateur.username,
          },
        });
      },
    });

    return { username, fullname: personne.fullname, issue: "TRAITEE", detail: null };
  });

  return { resume };
}

/**
 * Les primitives de `src/lib/depart.ts` sont rappelées ici plutôt que l'action
 * unitaire : celle-ci se termine par un `redirect`, qui lève une exception et
 * interromprait la boucle au premier tour. Aucun `redirect` non plus au bout de ce
 * geste : il ne sait viser qu'un dossier, et en choisir un arbitrairement ferait
 * perdre les quatorze autres.
 */
export async function ouvrirDepartsEnLot(_etat: EtatLot, formData: FormData): Promise<EtatLot> {
  const entree = lireEntree(formData, true);
  if ("erreur" in entree) {
    return entree;
  }

  const lot = randomUUID();
  const maintenant = new Date();

  const resume = await traiterChacune(entree.usernames, async (username) => {
    const personne = await prisma.person.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        fullname: true,
        missionEnd: true,
        startupAssignments: {
          where: { endedAt: null },
          select: { startupGhid: true, until: true, endedAt: true },
        },
      },
    });

    if (!personne) {
      return {
        username,
        fullname: username,
        issue: "ECHEC",
        detail: "Cette personne n'est plus en base.",
      };
    }

    // La date de départ de quelqu'un dont l'accès est prolongé est la date prolongée,
    // sans quoi le dossier contredirait sa fiche.
    const echeance = echeanceEffective(
      personne.missionEnd,
      personne.startupAssignments,
      maintenant,
    );

    let dejaOuvert = false;
    const dossierId = await actionTracee({
      action: "depart.ouverture",
      targetType: "personne",
      targetId: personne.username,
      correlationId: lot,
      after: {
        echeance: echeance?.toISOString().slice(0, 10) ?? null,
        raison: entree.raison,
        startup: entree.ghid,
        lot,
      },
      revalider: [...cheminsDe(entree.ghid, personne.username), "/departs"],
      ecrire: async (operateur) => {
        const dossier = await ouvrirDossierDeDepart(personne.id, echeance);
        if (dossier.deja) {
          dejaOuvert = true;
          return dossier.id;
        }

        const calcule = await calculerPlanDeDepart(personne.id, personne.username, maintenant);
        await enregistrerPlan(dossier.id, calcule, operateur.username, maintenant);
        return dossier.id;
      },
    });

    // Un dossier qui attendait déjà n'est ni un succès ni un échec : le confondre avec
    // un succès ferait croire à quinze dossiers neufs.
    return {
      username,
      fullname: personne.fullname,
      issue: dejaOuvert ? "DEJA" : "TRAITEE",
      detail: dossierId,
    };
  });

  return { resume };
}

/**
 * Déclarer quelqu'un hors incubateur n'éteint aucun constat : le moteur ne lit pas la
 * surcharge d'appartenance, et la collecte de la nuit reconstate. Sans ce geste, la
 * file resterait pleine derrière un traitement que l'opérateur croirait terminé.
 *
 * Il reste séparé, et ce n'est pas une commodité : une clôture qui suivrait
 * automatiquement une exclusion ferait de la sortie forcée le moyen le plus rapide de
 * faire disparaître un écart gênant, ce que la docstring de `forcerAppartenance`
 * interdit en toutes lettres. Fermer un écart doit rester un acte signé.
 */
export async function cloreConstatsEnLot(_etat: EtatLot, formData: FormData): Promise<EtatLot> {
  const entree = lireEntree(formData, true);
  if ("erreur" in entree) {
    return entree;
  }

  const lot = randomUUID();

  // Les clés viennent de la base et jamais du formulaire, qui se poste sans passer par
  // l'écran qui l'a rendu.
  const constats = await prisma.finding.findMany({
    where: {
      closedAt: null,
      kind: "INACTIVE_STARTUP",
      person: { username: { in: entree.usernames } },
    },
    select: {
      id: true,
      dedupKey: true,
      person: { select: { username: true, fullname: true } },
    },
  });

  if (constats.length === 0) {
    return { erreur: "Aucun constat de startups terminées n'est ouvert sur ces personnes." };
  }

  const resume = await traiterChacune(
    constats.map((constat) => constat.dedupKey),
    async (dedupKey) => {
      const constat = constats.find((candidat) => candidat.dedupKey === dedupKey);
      const username = constat?.person?.username ?? dedupKey;
      const fullname = constat?.person?.fullname ?? dedupKey;

      if (!constat) {
        return { username, fullname, issue: "ECHEC", detail: "Ce constat n'existe plus." };
      }

      // Relu au moment d'écrire : une fermeture concurrente ne doit pas faire échouer
      // le reste du lot.
      const encore = await prisma.finding.findUnique({
        where: { id: constat.id },
        select: { closedAt: true },
      });
      if (!encore) {
        return { username, fullname, issue: "ECHEC", detail: "Ce constat n'existe plus." };
      }
      if (encore.closedAt !== null) {
        return { username, fullname, issue: "DEJA", detail: "Déjà clos." };
      }

      await actionTracee({
        action: "finding.close",
        targetType: "finding",
        targetId: constat.dedupKey,
        correlationId: lot,
        after: { raison: entree.raison, startup: entree.ghid, lot },
        revalider: cheminsDe(entree.ghid, username),
        ecrire: async (operateur) => {
          await prisma.finding.update({
            where: { id: constat.id },
            data: {
              closedAt: new Date(),
              closeReason: entree.raison,
              closedBy: operateur.username,
            },
          });
        },
      });

      return { username, fullname, issue: "TRAITEE", detail: null };
    },
  );

  return { resume };
}
