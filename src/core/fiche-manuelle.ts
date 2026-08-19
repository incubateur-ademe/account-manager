import type { PersonSource } from "@/generated/prisma/enums";

import { normaliserLogin } from "./rapprochement";
import { echeanceEffective } from "./rattachement-startup";

/**
 * Un username beta.gouv sert de pivot à tout le système. Une personne qui n'en a
 * pas s'en voit attribuer un, dérivé de son nom : il n'a pas de valeur au-dehors,
 * seulement celle d'identifier la fiche ici.
 *
 * Seul endroit où un identifiant se fabrique, création comme renommage : deux
 * règles de normalisation finiraient par produire deux identifiants pour un même
 * nom, et donc deux fiches.
 */
export function normaliserIdentifiant(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

export interface FicheManuelle {
  username: string;
  source: PersonSource;
  usernameFabricated: boolean;
}

export type RaisonNonEditable = "COLLECTEE" | "DECLAREE";

export type Editabilite = { editable: true } | { editable: false; raison: RaisonNonEditable };

export const RAISON_NON_EDITABLE: Record<RaisonNonEditable, string> = {
  COLLECTEE:
    "Cette fiche vient de l'espace-membre : la collecte réécrit ses champs à chaque passage, ce qui serait saisi ici disparaîtrait à la nuit suivante.",
  DECLAREE:
    "Cette personne est déclarée dans la politique : le fichier fait autorité sur sa fiche, que la collecte reconstruit à chaque passage.",
};

/**
 * L'édition n'est ouverte que sur les fiches qu'aucune collecte ne réécrit.
 *
 * Deux exclusions, et elles n'ont pas la même origine : une fiche issue de
 * l'espace-membre est réécrite par `upsert()` du périmètre, une personne déclarée
 * dans `scope.local` est reconstruite depuis le YAML avec un nom égal à son
 * username et des adresses nulles. Dans les deux cas, saisir ici donnerait
 * l'illusion d'une correction jusqu'à la collecte suivante.
 */
export function ficheEditable(
  fiche: FicheManuelle,
  declaresLocaux: readonly string[],
): Editabilite {
  if (fiche.source !== "LOCAL") {
    return { editable: false, raison: "COLLECTEE" };
  }
  if (declaresLocaux.includes(fiche.username)) {
    return { editable: false, raison: "DECLAREE" };
  }
  return { editable: true };
}

/**
 * Le renommage exige une condition de plus que l'édition : que l'identifiant ait
 * été fabriqué ici.
 *
 * Un vrai username beta.gouv est le pivot d'identité de tout le système et n'est
 * mis à jour par aucun code. Une fiche recopiée depuis l'espace-membre pour
 * quelqu'un hors incubateur en porte un, même quand son `betaUuid` est nul, ce qui
 * rend l'heuristique « LOCAL et sans uuid » impraticable : seul le drapeau posé à
 * la création dit de qui l'identifiant n'engage personne d'autre.
 */
export function renommable(fiche: FicheManuelle, declaresLocaux: readonly string[]): boolean {
  return fiche.usernameFabricated && ficheEditable(fiche, declaresLocaux).editable;
}

export interface SaisieFiche {
  fullname: string;
  githubLogin: string;
  primaryEmail: string;
  communicationEmail: string;
}

export interface ChampsFiche {
  fullname: string;
  githubLogin: string | null;
  primaryEmail: string | null;
  communicationEmail: string | null;
}

export type ValidationChamps = { erreur: string } | { champs: ChampsFiche };

function normaliserAdresse(valeur: string): string | null {
  const reduit = valeur.trim().toLowerCase();
  return reduit.length > 0 ? reduit : null;
}

/**
 * Ce que le rapprochement lira ensuite doit entrer en base sous la forme où il le
 * cherche : `normaliserLogin` est la même fonction des deux côtés, sans quoi une
 * correction saisie avec l'adresse complète du profil ne rebrancherait rien.
 */
export function validerChamps(saisie: SaisieFiche): ValidationChamps {
  const fullname = saisie.fullname.trim();
  if (fullname.length < 3) {
    return { erreur: "Indiquez le nom de la personne." };
  }

  const primaryEmail = normaliserAdresse(saisie.primaryEmail);
  const communicationEmail = normaliserAdresse(saisie.communicationEmail);

  for (const adresse of [primaryEmail, communicationEmail]) {
    if (adresse !== null && !adresse.includes("@")) {
      return { erreur: `« ${adresse} » n'est pas une adresse électronique.` };
    }
  }

  return {
    champs: {
      fullname,
      githubLogin: normaliserLogin(saisie.githubLogin),
      primaryEmail,
      communicationEmail,
    },
  };
}

/**
 * Les trois familles de constats dont la clé nomme la personne. `ORPHAN` et
 * `UNREGISTERED` s'ancrent sur le compte et traversent une fusion sans retouche.
 *
 * Reconnaître la famille plutôt que le suffixe de la clé n'est pas un détail :
 * `ORPHAN:github:jean.dupont` se termine lui aussi par un username le jour où le
 * compte porte le même nom que la fiche.
 */
const ANCRES_SUR_LA_PERSONNE: readonly string[] = [
  "SCOPE_EXIT",
  "INACTIVE_STARTUP",
  "OVERDUE_MANUAL_ACTION",
];

export interface CompteDeFiche {
  id: string;
  provider: string;
  handle: string;
  externalId: string;
  matchMethod: string;
}

export interface ConstatDeFiche {
  id: string;
  kind: string;
  dedupKey: string;
}

export interface DossierDeFiche {
  id: string;
  vivant: boolean;
}

export interface ReferenceDeFiche {
  id: string;
  resourceId: string;
}

/** Un rattachement manuel, augmenté de son identifiant pour pouvoir être déplacé. */
export interface RattachementDeFiche {
  id: string;
  startupGhid: string;
  until: Date;
  /** Non nul pour un rattachement clos, qui suit quand même la personne. */
  endedAt: Date | null;
}

export interface SurchargeDeFiche {
  id: string;
  sens: string;
  par: string;
  raison: string;
}

/**
 * Tout ce qui pend à une fiche, sans exception.
 *
 * Cette liste doit rester le miroir exact des relations que `Person` porte dans le
 * schéma : chacune est en cascade ou en `SetNull`, si bien qu'une relation absente
 * d'ici est emportée par la suppression finale sans erreur, sans ligne dans
 * l'aperçu et sans trace au journal.
 */
export interface FicheAFusionner {
  username: string;
  /** Ce que l'amont dit de sa fin de mission, pour juger d'une prolongation. */
  missionEnd: Date | null;
  comptes: readonly CompteDeFiche[];
  constats: readonly ConstatDeFiche[];
  dossiers: readonly DossierDeFiche[];
  references: readonly ReferenceDeFiche[];
  rattachements: readonly RattachementDeFiche[];
  surcharge: SurchargeDeFiche | null;
}

/**
 * Une étape de la transaction de fusion, dans l'ordre où elle doit s'exécuter.
 *
 * L'ordre est porté ici plutôt que recopié dans l'action parce qu'il n'est pas
 * cosmétique : supprimer la fiche source avant d'avoir tout déplacé fait agir les
 * cascades du schéma à notre place, et elles emportent sans un mot les constats,
 * les dossiers et les références, en laissant les plans du dossier supprimé avec
 * un `departureCaseId` nul, vivants mais introuvables.
 */
export type EtapeFusion =
  | { type: "deplacer-comptes"; ids: readonly string[] }
  | { type: "migrer-constats"; ids: readonly string[] }
  | { type: "reecrire-cles"; cles: readonly { id: string; dedupKey: string }[] }
  | { type: "fermer-constats"; ids: readonly string[]; raison: string }
  | { type: "deplacer-dossiers"; ids: readonly string[] }
  | { type: "deplacer-rattachements"; ids: readonly string[] }
  | { type: "deplacer-surcharge"; id: string }
  | { type: "supprimer-surcharge"; id: string }
  | { type: "deplacer-references"; ids: readonly string[] }
  | { type: "supprimer-references"; ids: readonly string[] }
  | { type: "supprimer-fiche"; username: string };

export interface DoublonDeFournisseur {
  provider: string;
  source: readonly string[];
  cible: readonly string[];
}

export interface PlanFusion {
  source: string;
  cible: string;
  /** Renseigné quand la fusion perdrait quelque chose : rien n'est alors proposé. */
  blocage: string | null;
  comptes: readonly CompteDeFiche[];
  /** Un même système des deux côtés : autorisé, mais assez rare pour être dit. */
  doublons: readonly DoublonDeFournisseur[];
  constatsMigres: readonly ConstatDeFiche[];
  clesReecrites: readonly { id: string; avant: string; apres: string }[];
  constatsFermes: readonly ConstatDeFiche[];
  dossiers: readonly DossierDeFiche[];
  /** Ouverts comme clos : un rattachement fermé explique un constat levé la veille. */
  rattachements: readonly RattachementDeFiche[];
  /** La surcharge de la source, quand la cible n'en porte pas et qu'elle peut suivre. */
  surcharge: SurchargeDeFiche | null;
  /** Celle de la source quand la cible en porte déjà une : elle est perdue, et nommée. */
  surchargeAbandonnee: SurchargeDeFiche | null;
  /**
   * Renseigné quand les rattachements déplacés repoussent l'échéance de la cible.
   *
   * Le refus de prolongation ne se déclenche qu'à la pose, contre la fin de mission
   * de la fiche d'alors. Un rattachement posé sur une fiche sans échéance ne
   * prolongeait donc rien, et devient une prolongation le jour où la fusion le fait
   * atterrir sur quelqu'un qui en a une. Sans cette annonce, une coupure se
   * repousserait sans que le geste l'ait jamais dit.
   */
  prolongation: { avant: Date | null; apres: Date } | null;
  references: readonly ReferenceDeFiche[];
  referencesSupprimees: readonly ReferenceDeFiche[];
  etapes: readonly EtapeFusion[];
}

function reecrireCle(dedupKey: string, ancien: string, nouveau: string): string {
  return dedupKey.endsWith(`:${ancien}`)
    ? `${dedupKey.slice(0, -ancien.length)}${nouveau}`
    : dedupKey;
}

function parFournisseur(comptes: readonly CompteDeFiche[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const compte of comptes) {
    index.set(compte.provider, [...(index.get(compte.provider) ?? []), compte.handle]);
  }
  return index;
}

/**
 * Rend l'inventaire de ce qu'une fusion déplacerait, sans rien écrire.
 *
 * La fusion affirme que ces deux fiches sont la même personne. Elle n'affirme pas
 * que chaque compte est bien à elle : les méthodes de rapprochement sont conservées
 * telles quelles, si bien qu'un compte arrivé par ressemblance reste incapable de
 * produire une révocation et reste dans la file de rattachement.
 */
export function planifierFusion(
  source: FicheAFusionner,
  cible: FicheAFusionner,
  aujourdHui: Date,
): PlanFusion {
  const vivantsSource = source.dossiers.filter((dossier) => dossier.vivant);
  const vivantsCible = cible.dossiers.filter((dossier) => dossier.vivant);

  // `dedupKey` est unique sur toute la table. Une clé réécrite peut donc entrer en
  // collision avec une ligne de la cible, mais aussi avec une ligne de la source :
  // un renommage antérieur laisse derrière lui des constats fermés qui portent
  // encore l'ancien identifiant, et la collecte en ouvre de nouveaux sous le
  // nouveau. Regarder les deux côtés, fermés compris.
  const clesOccupees = new Set([
    ...cible.constats.map((constat) => constat.dedupKey),
    ...source.constats.map((constat) => constat.dedupKey),
  ]);

  const clesReecrites: { id: string; avant: string; apres: string }[] = [];
  const constatsFermes: ConstatDeFiche[] = [];

  for (const constat of source.constats) {
    if (!ANCRES_SUR_LA_PERSONNE.includes(constat.kind)) {
      continue;
    }
    const apres = reecrireCle(constat.dedupKey, source.username, cible.username);
    if (apres === constat.dedupKey) {
      continue;
    }
    // `dedupKey` est unique sur toute la table, constats fermés compris : réécrire
    // sans regarder les fermés ferait échouer la fusion sur une contrainte, ou pire,
    // ferait échouer une collecte ultérieure au moment précis où elle a quelque
    // chose à signaler.
    if (clesOccupees.has(apres)) {
      constatsFermes.push(constat);
      continue;
    }
    clesReecrites.push({ id: constat.id, avant: constat.dedupKey, apres });
  }

  const resourcesDeLaCible = new Set(cible.references.map((reference) => reference.resourceId));
  const references = source.references.filter(
    (reference) => !resourcesDeLaCible.has(reference.resourceId),
  );
  const referencesSupprimees = source.references.filter((reference) =>
    resourcesDeLaCible.has(reference.resourceId),
  );

  const cotesCible = parFournisseur(cible.comptes);
  const doublons = [...parFournisseur(source.comptes)]
    .flatMap(([provider, handles]) => {
      const enFace = cotesCible.get(provider);
      return enFace ? [{ provider, source: handles, cible: enFace }] : [];
    })
    .sort((a, b) => a.provider.localeCompare(b.provider));

  // La cible garde la sienne : une décision nominative ne s'écrase pas parce qu'une
  // autre fiche en portait une. Celle de la source est perdue, mais elle est nommée
  // dans l'aperçu et dans le journal, ce qui est l'invariant réellement en jeu.
  const surchargeSuit = source.surcharge !== null && cible.surcharge === null;

  const avant = echeanceEffective(cible.missionEnd, cible.rattachements, aujourdHui);
  const apres = echeanceEffective(
    cible.missionEnd,
    [...cible.rattachements, ...source.rattachements],
    aujourdHui,
  );
  const prolongation =
    apres !== null && (avant === null || apres.getTime() > avant.getTime())
      ? { avant, apres }
      : null;

  const inventaire = {
    source: source.username,
    cible: cible.username,
    prolongation,
    comptes: source.comptes,
    doublons,
    constatsMigres: source.constats,
    clesReecrites,
    constatsFermes,
    dossiers: source.dossiers,
    rattachements: source.rattachements,
    surcharge: surchargeSuit ? source.surcharge : null,
    surchargeAbandonnee: surchargeSuit ? null : source.surcharge,
    references,
    referencesSupprimees,
  };

  // Un seul dossier vivant par personne est une règle du socle : en faire migrer un
  // second produirait deux plans concurrents et deux façons de croire l'affaire
  // réglée. Le message dit lequel fermer d'abord plutôt que de choisir à la place
  // de l'opérateur.
  if (vivantsSource.length > 0 && vivantsCible.length > 0) {
    return {
      ...inventaire,
      blocage: `« ${source.username} » et « ${cible.username} » ont chacune un dossier de départ en cours. Clôturez ou annulez l'un des deux avant de fusionner.`,
      etapes: [],
    };
  }

  const etapes: EtapeFusion[] = [];
  if (source.comptes.length > 0) {
    etapes.push({ type: "deplacer-comptes", ids: source.comptes.map((compte) => compte.id) });
  }
  if (source.constats.length > 0) {
    etapes.push({ type: "migrer-constats", ids: source.constats.map((constat) => constat.id) });
  }
  if (clesReecrites.length > 0) {
    etapes.push({
      type: "reecrire-cles",
      cles: clesReecrites.map(({ id, apres }) => ({ id, dedupKey: apres })),
    });
  }
  if (constatsFermes.length > 0) {
    etapes.push({
      type: "fermer-constats",
      ids: constatsFermes.map((constat) => constat.id),
      raison: `fusionnée dans ${cible.username}`,
    });
  }
  if (source.dossiers.length > 0) {
    etapes.push({ type: "deplacer-dossiers", ids: source.dossiers.map((dossier) => dossier.id) });
  }
  if (source.rattachements.length > 0) {
    etapes.push({
      type: "deplacer-rattachements",
      ids: source.rattachements.map((rattachement) => rattachement.id),
    });
  }
  if (source.surcharge !== null) {
    etapes.push(
      surchargeSuit
        ? { type: "deplacer-surcharge", id: source.surcharge.id }
        : { type: "supprimer-surcharge", id: source.surcharge.id },
    );
  }
  if (references.length > 0) {
    etapes.push({
      type: "deplacer-references",
      ids: references.map((reference) => reference.id),
    });
  }
  if (referencesSupprimees.length > 0) {
    etapes.push({
      type: "supprimer-references",
      ids: referencesSupprimees.map((reference) => reference.id),
    });
  }
  etapes.push({ type: "supprimer-fiche", username: source.username });

  return { ...inventaire, blocage: null, etapes };
}
