"use server";

import { emailDeContact, type MembreDetaille, rattachementDeclare } from "@/core/membre";
import { actionTracee } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { fetchMemberDetail } from "@/lib/espace-membre";
import { requireOperateur } from "@/lib/session";

/**
 * `confirmationRequise` porte le refus qui attend une confirmation, plutôt que de
 * laisser le client reconnaître une phrase dans le message : un libellé se
 * reformule, et le garde-fou disparaîtrait alors sans que rien ne le signale.
 */
export type EtatRattachement = { erreur: string; confirmationRequise?: true } | null;

function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(`${iso}T00:00:00Z`);
}

/**
 * Rattacher à la main est un jugement, pas une observation : la méthode retenue est
 * `DECLARED`, la plus forte, celle qui autorise une révocation. C'est voulu, et c'est
 * pourquoi l'auteur du geste est journalisé avec.
 *
 * La cible peut désigner quelqu'un que l'incubateur ne compte pas parmi les siens :
 * la route qui rend une fiche par username n'est pas restreinte à un incubateur, on
 * va donc la chercher plutôt que de refuser. Sa fiche est alors créée telle que
 * l'espace-membre la décrit, sans rien deviner, et son échéance beta.gouv vient avec :
 * le jour où elle quitte l'administration, ses accès se signalent d'eux-mêmes.
 */
export async function rattacherIdentite(
  _etat: EtatRattachement,
  formData: FormData,
): Promise<EtatRattachement> {
  await requireOperateur();

  const id = String(formData.get("id") ?? "").trim();
  const cible = String(formData.get("cible") ?? "").trim();

  if (!id) {
    return { erreur: "Compte introuvable." };
  }
  if (!cible) {
    return { erreur: "Indiquez un username ou une clé de compte de service." };
  }

  const identite = await prisma.externalIdentity.findUnique({
    where: { id },
    select: {
      id: true,
      handle: true,
      provider: true,
      personId: true,
      serviceAccountId: true,
      matchMethod: true,
    },
  });

  if (!identite) {
    return { erreur: "Ce compte n'est plus en base." };
  }
  if (identite.serviceAccountId !== null) {
    return { erreur: "Ce compte est déclaré comme compte de service." };
  }
  // Un rattachement issu d'une ressemblance n'est pas une décision, c'est la
  // supposition que cet écran demande de trancher. Le refuser ici rendrait ces
  // lignes intraitables, alors qu'elles sont précisément celles qui ne pourront
  // jamais justifier une révocation tant que personne ne les a confirmées.
  if (identite.personId !== null && identite.matchMethod !== "HEURISTIC") {
    return { erreur: "Ce compte est déjà rattaché." };
  }

  const [personne, compte] = await Promise.all([
    prisma.person.findUnique({
      where: { username: cible },
      select: {
        id: true,
        source: true,
        betaUuid: true,
        identities: { where: { vanishedAt: null, id: { not: id } }, take: 2 },
      },
    }),
    prisma.serviceAccount.findUnique({ where: { key: cible }, select: { id: true } }),
  ]);

  let horsPerimetre: MembreDetaille | null = null;

  if (!personne && !compte) {
    try {
      horsPerimetre = await fetchMemberDetail(cible);
    } catch (error: unknown) {
      return {
        erreur: `L'espace-membre n'a pas répondu : ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!horsPerimetre) {
      return {
        erreur: `Ni personne suivie, ni compte de service, ni fiche espace-membre ne porte « ${cible} ».`,
      };
    }
  }

  // Rattacher un premier compte, c'est nommer ce qu'on a observé. En rattacher un
  // second à une fiche qui n'existe que par le premier, c'est affirmer que deux
  // comptes qu'aucune source ne relie sont la même personne : une révocation les
  // coupera tous les deux. Cela se confirme, cela ne se glisse pas.
  //
  // Une personne que beta.gouv connaît a son propre pivot : plusieurs comptes n'y
  // sont pas une construction, et ne méritent pas cette friction.
  const construitUneIdentite =
    personne !== null &&
    personne.source === "LOCAL" &&
    personne.betaUuid === null &&
    personne.identities.length > 0;

  if (construitUneIdentite && String(formData.get("confirme") ?? "") !== "oui") {
    return {
      erreur: `« ${cible} » n'est connue que par un compte déjà rattaché. Lui en ajouter un second affirme qu'il s'agit de la même personne, et une coupure vaudra pour les deux. Confirmez pour continuer.`,
      confirmationRequise: true,
    };
  }

  await actionTracee({
    action: "identite.rattachement",
    targetType: "identite",
    targetId: `${identite.provider}:${identite.handle}`,
    after: {
      cible,
      methode: "DECLARED",
      ...(horsPerimetre ? { ficheCreee: "hors incubateur, depuis l'espace-membre" } : {}),
    },
    revalider: ["/comptes-isoles", "/personnes", "/constats", "/"],
    ecrire: async (operateur) => {
      let personId = personne?.id ?? null;

      if (horsPerimetre) {
        const now = new Date();
        const rattachement = rattachementDeclare(horsPerimetre);
        const creee = await prisma.person.create({
          data: {
            // Le username beta reste le pivot : si cette personne rejoint un jour
            // l'incubateur, la collecte la retrouvera et reprendra sa fiche en main.
            username: horsPerimetre.username,
            fullname: horsPerimetre.fullname ?? horsPerimetre.username,
            betaUuid: horsPerimetre.uuid ?? null,
            githubLogin: horsPerimetre.github ?? null,
            primaryEmail: horsPerimetre.primary_email ?? null,
            communicationEmail: emailDeContact(horsPerimetre),
            missionEnd: toDate(rattachement.missionEnd),
            attachment: "NONE",
            source: "LOCAL",
            startups: [],
            firstSeenAt: now,
            lastSeenAt: now,
          },
          select: { id: true },
        });
        personId = creee.id;
      }

      await prisma.externalIdentity.update({
        where: { id: identite.id },
        data: {
          personId,
          serviceAccountId: personId ? null : (compte?.id ?? null),
          matchMethod: "DECLARED",
        },
      });

      // Le constat disait que ce compte n'avait pas de détenteur connu ; il en a un
      // désormais. Attendre la collecte suivante pour le refermer laisserait afficher
      // un problème déjà résolu, et rien n'use plus vite une file que d'y retrouver
      // ce qu'on vient de traiter.
      const resolus = await prisma.finding.findMany({
        where: { externalIdentityId: identite.id, kind: "UNREGISTERED", closedAt: null },
        select: { id: true, dedupKey: true },
      });

      if (resolus.length === 0) {
        return;
      }

      // Sans marque de clôture humaine : la situation a cessé, elle n'a pas été
      // jugée. Si le rattachement était défait, le constat devrait revenir.
      await prisma.finding.updateMany({
        where: { id: { in: resolus.map((constat) => constat.id) } },
        data: { closedAt: new Date(), closeReason: `rattaché à ${cible}` },
      });

      for (const constat of resolus) {
        audit({
          actorKind: "HUMAN",
          actorUsername: operateur.username,
          action: "finding.close",
          targetType: "finding",
          targetId: constat.dedupKey,
          after: { raison: `rattaché à ${cible}` },
          result: "SUCCESS",
        });
      }
    },
  });

  return null;
}
