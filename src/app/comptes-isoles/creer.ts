"use server";

import { systemesQuiAccueillentUnCompteMachine } from "@/connectors";
import { lireDeclaration, REVUE_PAR_DEFAUT } from "@/core/compte-de-service";
import { identifiantReserve, normaliserIdentifiant } from "@/core/fiche-manuelle";
import { Prisma } from "@/generated/prisma/client";
import { actionTracee } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { webEnv } from "@/lib/env";
import { requireOperateur, type Utilisateur } from "@/lib/session";

export type EtatCreation = { erreur: string } | null;

interface IdentiteIsolee {
  id: string;
  provider: string;
  handle: string;
}

/**
 * L'état dans lequel `identiteATraiter` a laissé passer le compte, redit en clause de
 * mise à jour. Il y est relu au moment d'écrire, et non tenu pour acquis depuis la
 * lecture : deux opérateurs qui traitent la même ligne en même temps liraient tous deux
 * un compte libre, et le second écraserait la décision du premier sans que rien ne le
 * dise. Écrire sous condition fait échouer le second, et l'échec annule sa transaction.
 */
const ENCORE_A_TRANCHER: Prisma.ExternalIdentityWhereInput = {
  serviceAccountId: null,
  OR: [{ personId: null }, { matchMethod: "HEURISTIC" }],
};

/**
 * Le compte traité entre-temps. Rendue plutôt que laissée remonter : la transaction doit
 * échouer, mais une panne et une course ne se racontent pas pareil à qui traite.
 */
class CompteDejaTranche extends Error {}

/** Le refus d'une clé prise nomme le geste qui reste : sans lui, il se lit comme une impasse. */
const cleDejaPrise = (cle: string) =>
  `Un compte de service porte déjà la clé « ${cle} » : rattachez-lui ce compte.`;

/**
 * Les trois refus que partagent les deux gestes de cet écran : le compte a disparu, il
 * est déjà tenu pour une machine, ou quelqu'un l'a déjà rattaché. Un rattachement issu
 * d'une ressemblance ne compte pas : c'est la supposition que cet écran demande de
 * trancher, et la refuser rendrait ces lignes intraitables.
 */
async function identiteATraiter(id: string): Promise<IdentiteIsolee | { erreur: string }> {
  if (!id) {
    return { erreur: "Compte introuvable." };
  }

  const identite = await prisma.externalIdentity.findUnique({
    where: { id },
    select: {
      id: true,
      provider: true,
      handle: true,
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
  if (identite.personId !== null && identite.matchMethod !== "HEURISTIC") {
    return { erreur: "Ce compte est déjà rattaché." };
  }

  return { id: identite.id, provider: identite.provider, handle: identite.handle };
}

/**
 * Le constat disait que ce compte n'avait pas de détenteur connu ; il en a un désormais.
 * Attendre la collecte suivante pour le refermer laisserait afficher un problème déjà
 * résolu, et rien n'use plus vite une file que d'y retrouver ce qu'on vient de traiter.
 *
 * Sans marque de clôture humaine : la situation a cessé, elle n'a pas été jugée.
 */
async function fermerLesConstatsResolus(
  tx: Prisma.TransactionClient,
  identiteId: string,
  raison: string,
  operateur: Utilisateur,
): Promise<void> {
  const resolus = await tx.finding.findMany({
    where: { externalIdentityId: identiteId, kind: "UNREGISTERED", closedAt: null },
    select: { id: true, dedupKey: true },
  });

  if (resolus.length === 0) {
    return;
  }

  await tx.finding.updateMany({
    where: { id: { in: resolus.map((constat) => constat.id) } },
    data: { closedAt: new Date(), closeReason: raison },
  });

  for (const constat of resolus) {
    audit({
      actorKind: "HUMAN",
      actorUsername: operateur.username,
      action: "finding.close",
      targetType: "finding",
      targetId: constat.dedupKey,
      after: { raison, voie: operateur.voie },
      result: "SUCCESS",
    });
  }
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
  await requireOperateur();

  const id = String(formData.get("id") ?? "").trim();
  const nom = String(formData.get("nom") ?? "").trim();

  if (nom.length < 3) {
    return { erreur: "Indiquez le nom de la personne." };
  }

  const username = normaliserIdentifiant(nom);
  if (username.length < 3) {
    return { erreur: "Ce nom ne donne pas d'identifiant exploitable." };
  }

  const reserve = identifiantReserve(username, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES);
  if (reserve !== null) {
    return { erreur: reserve };
  }

  const identite = await identiteATraiter(id);
  if ("erreur" in identite) {
    return identite;
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
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const personne = await tx.person.create({
          data: {
            username,
            usernameFabricated: true,
            fullname: nom,
            attachment: "NONE",
            source: "LOCAL",
            startups: [],
            firstSeenAt: now,
            lastSeenAt: now,
          },
          select: { id: true },
        });

        const rattachees = await tx.externalIdentity.updateMany({
          where: { id: identite.id, ...ENCORE_A_TRANCHER },
          data: { personId: personne.id, matchMethod: "DECLARED" },
        });
        if (rattachees.count !== 1) {
          throw new CompteDejaTranche();
        }

        await fermerLesConstatsResolus(tx, identite.id, `fiche créée pour ${username}`, operateur);
      });
    },
  });

  return null;
}

/**
 * Déclare le compte machine qu'un compte isolé vient de faire découvrir, et lui rattache
 * ce compte dans le même geste.
 *
 * Ce chemin existe parce que l'autre était le seul : découvrir un bot dans la file et
 * n'avoir sous la main que « créer une fiche » conduit à lui en fabriquer une, et une
 * fiche fabriquée à tort ne se supprime depuis aucun écran. La question se pose donc
 * avant, quand y répondre ne coûte rien.
 *
 * Le rattachement et la déclaration ne se séparent pas : un compte de service déclaré
 * sans son compte constaté laisse ce dernier dans la file, et c'est précisément de là
 * qu'on vient.
 */
export async function declarerCompteDeServicePourCompte(
  _etat: EtatCreation,
  formData: FormData,
): Promise<EtatCreation> {
  await requireOperateur();

  const id = String(formData.get("id") ?? "").trim();

  const identite = await identiteATraiter(id);
  if ("erreur" in identite) {
    return identite;
  }

  // Le système ne se saisit pas ici, il se constate : ce compte a été relevé sur un
  // système, et l'écran n'offre pas d'en choisir un autre. Lu du compte plutôt que du
  // formulaire, un champ posté à la main ne peut pas le contredire.
  const lecture = lireDeclaration(
    {
      key: String(formData.get("key") ?? ""),
      label: String(formData.get("label") ?? ""),
      purpose: String(formData.get("purpose") ?? ""),
      ownerUsername: String(formData.get("ownerUsername") ?? ""),
      reviewEveryDays: Number(formData.get("reviewEveryDays") ?? REVUE_PAR_DEFAUT),
      provider: identite.provider,
    },
    systemesQuiAccueillentUnCompteMachine().map(({ key }) => key),
  );
  if ("erreur" in lecture) {
    return lecture;
  }
  const { declaration } = lecture;

  const existant = await prisma.serviceAccount.findUnique({
    where: { key: declaration.key },
    select: { key: true },
  });
  if (existant) {
    return { erreur: cleDejaPrise(declaration.key) };
  }

  try {
    await actionTracee({
      action: "compte-de-service.declaration",
      targetType: "compte-de-service",
      targetId: declaration.key,
      after: { ...declaration, compte: `${identite.provider}:${identite.handle}` },
      revalider: ["/comptes-isoles", "/comptes-de-service", "/constats", "/"],
      ecrire: async (operateur) => {
        // Les trois écritures tiennent ensemble ou pas du tout. Séparées, une panne après
        // la première laisserait une machine déclarée que rien ne porte, et son compte
        // dans la file d'où l'on vient : deux moitiés de geste, dont aucune ne dit
        // qu'elle attend l'autre.
        await prisma.$transaction(async (tx) => {
          const compte = await tx.serviceAccount.create({
            data: declaration,
            select: { id: true },
          });

          const rattachees = await tx.externalIdentity.updateMany({
            where: { id: identite.id, ...ENCORE_A_TRANCHER },
            data: { serviceAccountId: compte.id, personId: null, matchMethod: "DECLARED" },
          });
          if (rattachees.count !== 1) {
            throw new CompteDejaTranche();
          }

          await fermerLesConstatsResolus(
            tx,
            identite.id,
            `rattaché à ${declaration.key}`,
            operateur,
          );
        });

        // Hors de la transaction, parce que le journal n'en fait pas partie : il s'écrit
        // sans être attendu, pour qu'une panne du journal ne fasse jamais échouer
        // l'action. L'y laisser aurait suggéré qu'il s'annule avec elle.
        //
        // Le compte de service porte la trace de sa déclaration ; l'identité, elle, n'en
        // aurait aucune, et c'est elle qu'on retrouve en cherchant ce qu'un compte
        // constaté est devenu.
        audit({
          actorKind: "HUMAN",
          actorUsername: operateur.username,
          action: "identite.rattachement",
          targetType: "identite",
          targetId: `${identite.provider}:${identite.handle}`,
          after: { cible: declaration.key, methode: "DECLARED", voie: operateur.voie },
          result: "SUCCESS",
        });
      },
    });
  } catch (cause: unknown) {
    // Deux saisies simultanées lisent la même absence avant que l'une n'écrive. Le refus
    // de la base est alors le bon, et le rendre comme une panne enverrait chercher un
    // incident là où il n'y a qu'une clé déjà prise. Le même message que le contrôle
    // préalable, et pour la même raison : les deux chemins mènent au même état, où le
    // rattachement reste ouvert, et un message qui tairait ce recours se lirait comme
    // une impasse.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      return { erreur: cleDejaPrise(declaration.key) };
    }
    if (cause instanceof CompteDejaTranche) {
      return {
        erreur: "Ce compte vient d'être traité ailleurs : rouvrez la file pour voir où il en est.",
      };
    }
    throw cause;
  }

  return null;
}
