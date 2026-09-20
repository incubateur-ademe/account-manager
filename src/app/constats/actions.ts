"use server";

import { SORTE_DE_CIBLE } from "@/core/constat";
import {
  type Cible,
  cleDeCible,
  colonnesDeCible,
  jourSaisi,
  leveeAdmissible,
  poseAdmissible,
  RAISON_COUVERT,
} from "@/core/derogation";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { couvertureEnBase, derogationsApplicables } from "@/lib/derogation";
import { requireOperateur } from "@/lib/session";

/**
 * Une course perdue contre un autre geste, qui est un refus et non une panne.
 *
 * Levée plutôt que retournée, parce qu'elle se constate au milieu d'une transaction et doit
 * la défaire. Rendue au formulaire plutôt que relancée, parce qu'une action serveur qui lève
 * ne remplit pas l'état que l'écran affiche : l'opérateur voyait sa modale se fermer sur un
 * geste qui n'avait rien écrit.
 */
class CoursePerdue extends Error {}

/**
 * Le refus d'une course, rendu tel quel ; tout le reste continue de lever.
 *
 * Attraper largement ferait afficher une base injoignable comme un refus métier, et
 * `actionTracee` a déjà posé sa trace d'échec quand on arrive ici.
 */
async function sansCoursePerdue<T extends { erreur: string }>(
  geste: () => Promise<unknown>,
): Promise<T | null> {
  try {
    await geste();
    return null;
  } catch (error: unknown) {
    if (error instanceof CoursePerdue) {
      return { erreur: error.message } as T;
    }
    throw error;
  }
}

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
    return { erreur: "Aucun constat n'a été choisi. Rechargez la page." };
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
    return { erreur: "Aucun constat n'a été choisi. Rechargez la page." };
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

  const echeance = jourSaisi(jusquAu);
  if (echeance === null) {
    return { erreur: "Cette échéance n'est pas une date." };
  }

  const { applicables } = await derogationsApplicables(maintenant);
  const verdict = poseAdmissible(
    { cible, raison, echeance },
    new Set(applicables.map((derogation) => cleDeCible(derogation.cible))),
    maintenant,
  );
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }
  // Le verdict garantit la cible, que le typage ne sait pas suivre à travers lui.
  if (cible === null) {
    return {
      erreur: "Cet écart ne se tolère pas. Il porte sur ce qui a été déclaré, pas sur un accès.",
    };
  }

  return sansCoursePerdue<{ erreur: string }>(() =>
    actionTracee({
      action: "derogation.pose",
      targetType: "derogation",
      targetId: cleDeCible(cible),
      after: { raison, jusquAu, constat: dedupKey },
      revalider: [
        "/constats",
        "/",
        ...(constat.person ? [`/personnes/${constat.person.username}`] : []),
      ],
      // Les deux écritures ensemble : la nuit suivante réparerait bien l'une sans l'autre,
      // mais entre les deux l'écran mentirait, en montrant un écart dans la file que le
      // registre dit toléré, ou l'inverse.
      ecrire: async (operateur) =>
        prisma.$transaction(async (tx) => {
          // Le verdict a lu la couverture avant d'entrer ici, si bien que deux poses lancées
          // ensemble la trouvent vide toutes les deux. Le verrou les sérialise sur la cible,
          // et il tombe au commit ; la relecture qui suit voit alors la ligne de la première.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cleDeCible(cible)}))`;
          // Jugée à l'instant où l'on écrit, et non à celui de la lecture d'entrée : une ligne
          // posée entre les deux est née après `maintenant`, et la règle de couverture écarte
          // ce qui n'existait pas encore à l'instant qu'on lui donne.
          if ((await couvertureEnBase(tx, cible, new Date())).length > 0) {
            throw new CoursePerdue("Cet écart vient d'être toléré par ailleurs.");
          }
          await tx.derogation.create({
            data: {
              ...colonnesDeCible(cible),
              reason: raison,
              createdBy: operateur.username,
              expiresAt: echeance,
            },
          });
          // Fermé tout de suite plutôt qu'à la collecte suivante : l'écart cesse de faire
          // du bruit au moment où quelqu'un décide de l'admettre, et sans nom, parce que
          // personne n'a jugé la situation traitée.
          const ferme = await tx.finding.updateMany({
            where: { id: constat.id, closedAt: null },
            data: { closedAt: maintenant, closeReason: RAISON_COUVERT, closedBy: null },
          });
          if (ferme.count === 0) {
            throw new CoursePerdue("Ce constat vient d'être clos par ailleurs.");
          }
        }),
    }),
  );
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
    return { erreur: "Aucune tolérance n'a été choisie. Rechargez la page." };
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

  /*
   * Toutes les lignes de base qui couvrent cette cible, et non la seule ligne choisie.
   * Rien n'interdit à deux d'entre elles de courir ensemble, et lever la première laissait
   * la seconde taire l'écart : le registre annonçait la levée faite, la file restait muette,
   * et l'opérateur n'avait aucun moyen de comprendre pourquoi.
   *
   * La politique en est exclue, `leveeAdmissible` la refusant déjà : une permanente se
   * retire de son fichier, et la lever ici la ferait revenir au déploiement suivant.
   */
  const cle = cleDeCible(derogation.cible);
  const couvrantes = applicables
    .filter((candidate) => candidate.provenance === "base" && cleDeCible(candidate.cible) === cle)
    .map((candidate) => candidate.id);

  return sansCoursePerdue<{ erreur: string }>(() =>
    actionTracee({
      action: "derogation.levee",
      targetType: "derogation",
      targetId: cle,
      before: { jusquAu: derogation.echeance?.toISOString() ?? null, couvrantes },
      revalider: ["/constats", "/"],
      // Conditionnée sur l'absence de levée : de deux levées lancées ensemble, la seconde
      // n'écrase ni le nom ni l'heure de la première, et sa trace reste au journal en échec
      // plutôt que de compter pour une décision qui n'a rien décidé.
      ecrire: async (operateur) => {
        const levee = await prisma.derogation.updateMany({
          where: { id: { in: couvrantes }, revokedAt: null },
          data: { revokedAt: maintenant, revokedBy: operateur.username },
        });
        if (levee.count === 0) {
          throw new CoursePerdue("Cette tolérance vient d'être levée par ailleurs.");
        }
      },
    }),
  );
}
