"use server";

import { actionTracee } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export type EtatCreation = { erreur: string } | null;

/**
 * Un username beta.gouv sert de pivot à tout le système. Une personne qui n'en a
 * pas s'en voit attribuer un, dérivé de son nom : il n'a pas de valeur au-dehors,
 * seulement celle d'identifier la fiche ici.
 */
function identifiantDepuis(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Crée la fiche d'une personne que l'espace-membre ne connaît pas, et lui rattache
 * le compte qui l'a fait découvrir.
 *
 * Elle n'a pas d'échéance, et c'est voulu : elle n'existe que par ce compte, et vit
 * donc tant qu'il est observé. Lui inventer une date de fin reviendrait à prétendre
 * savoir quelque chose qu'aucune source ne dit.
 */
export async function creerFichePourCompte(
  _etat: EtatCreation,
  formData: FormData,
): Promise<EtatCreation> {
  const id = String(formData.get("id") ?? "").trim();
  const nom = String(formData.get("nom") ?? "").trim();

  if (!id) {
    return { erreur: "Compte introuvable." };
  }
  if (nom.length < 3) {
    return { erreur: "Indiquez le nom de la personne." };
  }

  const username = identifiantDepuis(nom);
  if (username.length < 3) {
    return { erreur: "Ce nom ne donne pas d'identifiant exploitable." };
  }

  const identite = await prisma.externalIdentity.findUnique({
    where: { id },
    select: { id: true, provider: true, handle: true, personId: true, serviceAccountId: true },
  });

  if (!identite) {
    return { erreur: "Ce compte n'est plus en base." };
  }
  if (identite.personId !== null || identite.serviceAccountId !== null) {
    return { erreur: "Ce compte est déjà rattaché." };
  }

  const existante = await prisma.person.findUnique({
    where: { username },
    select: { username: true },
  });
  if (existante) {
    return { erreur: `« ${username} » existe déjà : rattachez le compte à cette fiche.` };
  }

  await actionTracee({
    action: "personne.creation",
    targetType: "personne",
    targetId: username,
    after: { nom, compte: `${identite.provider}:${identite.handle}` },
    revalider: ["/comptes-isoles", "/personnes", "/constats", "/"],
    ecrire: async (operateur) => {
      const now = new Date();
      const personne = await prisma.person.create({
        data: {
          username,
          fullname: nom,
          attachment: "LOCAL",
          source: "LOCAL",
          startups: [],
          firstSeenAt: now,
          lastSeenAt: now,
        },
        select: { id: true },
      });

      await prisma.externalIdentity.update({
        where: { id: identite.id },
        data: { personId: personne.id, matchMethod: "DECLARED" },
      });

      const resolus = await prisma.finding.findMany({
        where: { externalIdentityId: identite.id, kind: "UNREGISTERED", closedAt: null },
        select: { id: true, dedupKey: true },
      });

      if (resolus.length === 0) {
        return;
      }

      await prisma.finding.updateMany({
        where: { id: { in: resolus.map((constat) => constat.id) } },
        data: { closedAt: new Date(), closeReason: `fiche créée pour ${username}` },
      });

      for (const constat of resolus) {
        audit({
          actorKind: "HUMAN",
          actorUsername: operateur.username,
          action: "finding.close",
          targetType: "finding",
          targetId: constat.dedupKey,
          after: { raison: `fiche créée pour ${username}` },
          result: "SUCCESS",
        });
      }
    },
  });

  return null;
}
