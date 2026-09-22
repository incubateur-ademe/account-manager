import { CONNECTEURS } from "@/connectors";
import { FOURNISSEUR_PERIMETRE, type Fraicheur, fraicheurDe, systemesMuets } from "@/core/collecte";
import type { MatchMethod } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import type { Utilisateur } from "@/lib/session";

export interface CompteConnu {
  id: string;
  systeme: string;
  handle: string;
  matchMethod: MatchMethod;
  lastSeenAt: Date;
  vanishedAt: Date | null;
}

export interface SystemeMuetVu {
  cle: string;
  systeme: string;
  raison: "perime" | "echec" | "non-lu";
  heures: number | null;
}

/**
 * Ce qui qualifie une liste de comptes, et sans quoi elle ment. Un système qu'on ne lit
 * plus rend « aucun compte » impossible à distinguer de « aucun accès ».
 */
export interface Observation {
  perimetre: Fraicheur;
  observes: readonly string[];
  muets: readonly SystemeMuetVu[];
}

export type MesComptes =
  | { fiche: "absente"; observation: Observation }
  | { fiche: "connue"; comptes: readonly CompteConnu[]; observation: Observation };

const COLONNES_DU_COMPTE = {
  id: true,
  provider: true,
  handle: true,
  matchMethod: true,
  lastSeenAt: true,
  vanishedAt: true,
} as const;

/**
 * La fiche que la session désigne, et rien qui y ressemble.
 *
 * Deux clés, jamais une recherche. `personId` quand la connexion en a résolu une, et
 * c'est le cas de toute session posée par un droit sur un dossier. L'identifiant sinon,
 * et seulement sur la voie espace-membre, qui est la seule à l'avoir prouvé : sur
 * l'autre, il ne fait que nommer, et une fiche fabriquée se renomme. Un repli par
 * adresse, lui, refait le rapprochement heuristique sur l'écran où il montrerait les
 * comptes de quelqu'un d'autre.
 */
function clefDeLaFiche(utilisateur: Utilisateur): { id: string } | { username: string } | null {
  if (utilisateur.personId !== null) {
    return { id: utilisateur.personId };
  }
  if (utilisateur.voie === "ESPACE_MEMBRE") {
    return { username: utilisateur.username };
  }
  return null;
}

/** Les comptes qu'on connaît à quelqu'un, avec de quoi savoir ce que leur absence vaut. */
export async function chargerMesComptes(
  utilisateur: Utilisateur,
  maintenant: Date,
): Promise<MesComptes> {
  const { thresholds } = policy();
  const attendus = CONNECTEURS.map(({ contract }) => contract.key);
  const nomDuSysteme = new Map(
    CONNECTEURS.map(({ contract }) => [contract.key, contract.label] as const),
  );

  const clef = clefDeLaFiche(utilisateur);

  const [fiche, dernierePasse, releves] = await Promise.all([
    clef === null
      ? null
      : prisma.person.findUnique({
          where: clef,
          select: {
            identities: {
              orderBy: [{ provider: "asc" }, { handle: "asc" }],
              select: COLONNES_DU_COMPTE,
            },
          },
        }),
    prisma.syncRun.findFirst({
      where: { provider: FOURNISSEUR_PERIMETRE },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    prisma.syncRun.findMany({
      where: { capability: "list", provider: { not: FOURNISSEUR_PERIMETRE } },
      distinct: ["provider"],
      orderBy: { startedAt: "desc" },
      select: { provider: true, startedAt: true, status: true },
    }),
  ]);

  const muets = systemesMuets(releves, attendus, maintenant, thresholds.collectStaleHours);
  const nomme = (cle: string) => nomDuSysteme.get(cle) ?? cle;

  const observation: Observation = {
    perimetre: fraicheurDe(
      dernierePasse?.startedAt ?? null,
      maintenant,
      thresholds.collectStaleHours,
    ),
    observes: attendus
      .filter((cle) => !muets.some((muet) => muet.provider === cle))
      .map(nomme)
      .sort((a, b) => a.localeCompare(b, "fr")),
    muets: muets.map((muet) => ({
      cle: muet.provider,
      systeme: nomme(muet.provider),
      raison: muet.raison,
      heures: muet.heures,
    })),
  };

  if (fiche === null) {
    return { fiche: "absente", observation };
  }

  return {
    fiche: "connue",
    comptes: fiche.identities.map((identite) => ({
      id: identite.id,
      systeme: nomme(identite.provider),
      handle: identite.handle,
      matchMethod: identite.matchMethod,
      lastSeenAt: identite.lastSeenAt,
      vanishedAt: identite.vanishedAt,
    })),
    observation,
  };
}
