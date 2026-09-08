import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";

import type { FicheManuelle } from "@/core/fiche-manuelle";
import { type AuthUserShape, candidateUsernames, resolveOperator } from "@/core/identite";
import {
  adresseRecevable,
  type CandidatAdresse,
  type LigneUser,
  participationVivante,
  type RefusAdresse,
  type Voie,
} from "@/core/participation";
import { prisma } from "@/lib/db";
import { webEnv } from "@/lib/env";
import { aUnDroitVivant } from "@/lib/participation";
import { policy } from "@/lib/policy";

/**
 * L'identifiant du second fournisseur, celui qui envoie un lien à une adresse.
 *
 * C'est celui que `Nodemailer()` se donne quand rien ne l'enveloppe. Le fournisseur
 * espace-membre est le même paquet sous un autre identifiant, posé par son wrapper :
 * les deux coexistent parce que ces identifiants diffèrent, et c'est par eux que la
 * décision ci-dessous sait laquelle des deux portes on pousse.
 */
export const PROVIDER_ADRESSE = "nodemailer";

/**
 * Par quelle porte on entre, ou rien du tout.
 *
 * Rien du tout n'est pas un cas de production, les deux fournisseurs déclarés étant
 * les seuls que ce dépôt configure : c'est un refus fermé plutôt qu'un défaut, parce
 * qu'un défaut ferait entrer un troisième fournisseur par celle des deux voies qui se
 * trouverait écrite en dernier.
 */
export function voieDuProvider(provider: string | undefined): Voie | null {
  if (provider === ESPACE_MEMBRE_PROVIDER_ID) {
    return "ESPACE_MEMBRE";
  }
  if (provider === PROVIDER_ADRESSE) {
    return "ADRESSE";
  }
  return null;
}

export type RefusConnexion = RefusAdresse | "PROVIDER" | "SAISIE" | "SANS_FICHE" | "SANS_DROIT";

/**
 * Ce que l'identification a établi, et rien de plus : elle nomme, elle n'autorise pas.
 *
 * `personId` est la fiche que la session désignera, et c'est le seul ancrage d'un
 * droit par dossier. Il reste nul pour un opérateur, et ce n'est pas une approximation :
 * l'octroi refuse une fiche dont le `username` figure dans une allowlist, si bien
 * qu'un opérateur ne détient jamais de participation et qu'aucune lecture n'aurait
 * quoi que ce soit à en tirer.
 */
export type DecisionConnexion =
  | {
      accepte: true;
      voie: Voie;
      username: string;
      personId: string | null;
      viaBreakGlass: boolean;
    }
  | { accepte: false; voie: Voie | null; username: string | null; refus: RefusConnexion };

function allowlists(): { operateurs: readonly string[]; breakGlass: readonly string[] } {
  return { operateurs: webEnv.OPERATORS, breakGlass: webEnv.BREAK_GLASS_USERNAMES };
}

function declaresLocaux(): string[] {
  return policy().scope.local.map((entree) => entree.username);
}

/**
 * Les fiches et les canaux d'octroi qu'une adresse désigne.
 *
 * Comparaison exacte, sur une adresse déjà réduite en minuscules et sans blancs : c'est
 * la forme sous laquelle le normalisateur du paquet la présente, celle que `validerChamps`
 * écrit sur une fiche, et celle sous laquelle l'index de `channelEmail` sert. **Un canal
 * enregistré sans cette réduction ne serait résolu par personne**, et rien ne le dirait.
 *
 * Les canaux sont filtrés sur le droit vivant ici et pas plus loin : `adresseRecevable`
 * juge une adresse, elle ne sait pas ce qu'est un droit mort.
 */
async function candidatsPourAdresse(adresse: string): Promise<CandidatAdresse[]> {
  const maintenant = new Date();

  const [fiches, canaux] = await Promise.all([
    prisma.person.findMany({
      where: { communicationEmail: adresse },
      select: { id: true, username: true, source: true, usernameFabricated: true },
    }),
    prisma.caseParticipation.findMany({
      where: { channelEmail: adresse },
      select: {
        expiresAt: true,
        revokedAt: true,
        accessCase: { select: { state: true } },
        person: {
          select: { id: true, username: true, source: true, usernameFabricated: true },
        },
      },
    }),
  ]);

  const depuisFiches: CandidatAdresse[] = fiches.map((fiche) => ({
    personId: fiche.id,
    fiche,
    origine: "FICHE",
    adresse,
  }));

  const depuisCanaux: CandidatAdresse[] = canaux
    .filter((canal) => participationVivante(canal, canal.accessCase.state, maintenant))
    .map((canal) => ({
      personId: canal.person.id,
      fiche: canal.person,
      origine: "OCTROI",
      adresse,
    }));

  return [...depuisFiches, ...depuisCanaux];
}

/**
 * La ligne `User` que l'adaptateur trouverait sur cette adresse.
 *
 * Relue ici plutôt que déduite de l'utilisateur que le paquet nous passe : quand il n'en
 * trouve aucune, il en fabrique une de toutes pièces, avec un identifiant tiré au sort,
 * et rien ne distingue à l'œil nu cette ligne inventée d'une ligne réelle.
 *
 * L'adresse rendue est celle qui a servi à la trouver, et pas une colonne relue : la
 * ligne a été trouvée par égalité sur cette valeur, les deux ne peuvent pas différer.
 */
async function ligneUserDe(adresse: string): Promise<LigneUser | null> {
  const ligne = await prisma.user.findUnique({
    where: { email: adresse },
    select: { username: true },
  });

  return ligne === null ? null : { email: adresse, username: ligne.username };
}

/**
 * Le canal qu'un octroi déclare, jugé aux refus mêmes que la connexion lui opposera.
 *
 * Posé à la saisie, où un opérateur peut encore corriger, et de nouveau au retour du
 * lien, où la base a pu changer entre les deux. Ce n'est pas un doublon : c'est la même
 * règle, là où elle se répare et là où elle protège.
 *
 * Le candidat que l'octroi ferait naître entre dans le jeu, sans quoi la règle jugerait
 * l'adresse telle qu'elle est et non telle que ce geste va la faire être.
 */
export async function canalRecevable(
  personne: FicheManuelle & { id: string },
  adresse: string,
): Promise<RefusAdresse | null> {
  const [existants, ligneUser] = await Promise.all([
    candidatsPourAdresse(adresse),
    ligneUserDe(adresse),
  ]);

  const candidats: CandidatAdresse[] = [
    ...existants,
    { personId: personne.id, fiche: personne, origine: "OCTROI", adresse },
  ];

  const verdict = adresseRecevable(candidats, ligneUser, allowlists(), declaresLocaux());
  return verdict.recevable ? null : verdict.refus;
}

async function parEspaceMembre(user: AuthUserShape): Promise<DecisionConnexion> {
  const match = resolveOperator(user, webEnv.OPERATORS, webEnv.BREAK_GLASS_USERNAMES);
  if (match !== null) {
    return {
      accepte: true,
      voie: "ESPACE_MEMBRE",
      username: match.username,
      personId: null,
      viaBreakGlass: match.viaBreakGlass,
    };
  }

  const candidats = candidateUsernames(user);
  const fiche =
    candidats.length === 0
      ? null
      : await prisma.person.findFirst({
          where: { username: { in: candidats } },
          select: { id: true, username: true },
        });

  if (fiche === null) {
    return {
      accepte: false,
      voie: "ESPACE_MEMBRE",
      username: candidats[0] ?? null,
      refus: "SANS_FICHE",
    };
  }

  if (!(await aUnDroitVivant(fiche.id))) {
    return { accepte: false, voie: "ESPACE_MEMBRE", username: fiche.username, refus: "SANS_DROIT" };
  }

  return {
    accepte: true,
    voie: "ESPACE_MEMBRE",
    username: fiche.username,
    personId: fiche.id,
    viaBreakGlass: false,
  };
}

/**
 * Aucun nom sur un refus par adresse, et c'est délibéré.
 *
 * L'appel n'est pas authentifié : qui connaît l'adresse de quelqu'un écrirait son nom
 * au journal à volonté, sur un registre en écriture seule et à rétention indéfinie. Le
 * code de refus, lui, ne désigne personne et dit ce qu'il faut pour diagnostiquer.
 */
function refuse(refus: RefusConnexion): DecisionConnexion {
  return { accepte: false, voie: "ADRESSE", username: null, refus };
}

async function parAdresse(user: AuthUserShape): Promise<DecisionConnexion> {
  const adresse = (user.email ?? "").trim().toLowerCase();
  if (!adresse.includes("@")) {
    return refuse("SAISIE");
  }

  const [candidats, ligneUser] = await Promise.all([
    candidatsPourAdresse(adresse),
    ligneUserDe(adresse),
  ]);

  const verdict = adresseRecevable(candidats, ligneUser, allowlists(), declaresLocaux());
  if (!verdict.recevable) {
    return refuse(verdict.refus);
  }

  // Posée sur les deux origines et pas seulement sur la fiche, alors qu'un canal ne
  // remonte que d'un droit vivant : c'est la règle « il n'y a pas de compte, il y a un
  // dossier ouvert », et une règle ne se déduit pas d'un filtre écrit ailleurs.
  if (!(await aUnDroitVivant(verdict.candidat.personId))) {
    return refuse("SANS_DROIT");
  }

  return {
    accepte: true,
    voie: "ADRESSE",
    username: verdict.candidat.fiche.username,
    personId: verdict.candidat.personId,
    viaBreakGlass: false,
  };
}

/**
 * Qui entre, par quelle porte, et sous quel nom.
 *
 * Appelée aux **deux** invocations du contrôle de connexion, à l'envoi du lien et à son
 * retour, et elle relit la base les deux fois : posée sur la seule phase d'envoi, elle
 * laisserait un lien émis avant une révocation ouvrir une session vingt minutes après
 * elle. Le droit relu à chaque page ne rattrape pas cela, il ne gouverne que ce qu'une
 * session déjà ouverte peut faire.
 *
 * La qualité d'opérateur ne se cherche que sur la voie espace-membre, et cette
 * séparation est le cœur du dispositif : un identifiant de fiche se renomme, et le
 * renommage ne le compare à aucune allowlist.
 */
export async function deciderConnexion(
  voie: Voie | null,
  user: AuthUserShape,
): Promise<DecisionConnexion> {
  if (voie === null) {
    return { accepte: false, voie: null, username: null, refus: "PROVIDER" };
  }
  return voie === "ESPACE_MEMBRE" ? parEspaceMembre(user) : parAdresse(user);
}
