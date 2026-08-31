"use server";

import type { Acteur } from "@/core/dossier";
import { type SaisieAttendue, saisieAttendueSchema } from "@/core/modele-plan";
import type { RiskLevel, TemplateKind } from "@/generated/prisma/enums";
import {
  ajouterEtape,
  basculerAutorisation,
  type EtapeSaisie,
  modifierEtape,
  type ResultatDEcriture,
  retirerEtape,
} from "@/lib/modele-plan-edition";
import { requireOperateur } from "@/lib/session";

/**
 * Les gestes d'édition d'un modèle. Chacun pose `requireOperateur()` avant sa
 * première lecture en base : les fonctions de `modele-plan-edition` ne la posent pas
 * et s'appuient sur leur appelant, faute de quoi une session hors de l'allowlist
 * apprendrait ce qui existe avant d'être refusée.
 *
 * Aucune règle métier ici : le trim, la clé dérivée du titre, le refus d'un critère
 * vide, celui d'une autorisation fermée et la collision de clé vivent dans la
 * bibliothèque, qui les tient pour toutes les portes d'entrée à venir.
 */

export interface EtatModele {
  erreur?: string;
}

/**
 * Un refus de lecture, distinct d'`EtatModele` dont le champ est facultatif : sur une
 * union, une propriété optionnelle ne discrimine rien, et l'appel partait avec un
 * refus pour valeurs.
 */
type Refus = { erreur: string };

const FAIT: EtatModele = {};

function rendu(resultat: ResultatDEcriture): EtatModele {
  return resultat.ok ? FAIT : { erreur: resultat.erreur };
}

function texte(formData: FormData, champ: string): string {
  return String(formData.get(champ) ?? "").trim();
}

function lireMoment(formData: FormData): TemplateKind | null {
  const valeur = texte(formData, "moment");
  return valeur === "ONBOARDING" || valeur === "OFFBOARDING" ? valeur : null;
}

function lireRisque(formData: FormData): RiskLevel {
  const valeur = texte(formData, "risque");
  return valeur === "HIGH" || valeur === "MEDIUM" ? valeur : "LOW";
}

const ACTEURS: readonly Acteur[] = ["OPERATOR", "SUBJECT", "DELEGATE"];

function estActeur(valeur: string): valeur is Acteur {
  return (ACTEURS as readonly string[]).includes(valeur);
}

/**
 * Les deux rôles d'une étape, et ils refusent une valeur inconnue au lieu de retomber
 * sur un défaut comme `lireRisque`. Retomber en silence sur « aucun contrôleur »
 * retirerait un contrôle qu'un opérateur croit avoir posé, ce qui est le sens
 * dangereux ; retomber sur « à l'opérateur » relèverait de la même faute.
 */
function lireActeur(formData: FormData): Acteur | Refus {
  const valeur = texte(formData, "acteur");
  return estActeur(valeur)
    ? valeur
    : { erreur: "Acteur inconnu : dites qui doit faire cette étape." };
}

function lireControleur(formData: FormData): Acteur | null | Refus {
  const valeur = texte(formData, "controleur");
  if (!valeur) {
    return null;
  }
  return estActeur(valeur)
    ? valeur
    : { erreur: "Contrôleur inconnu : dites qui doit relire cette étape, ou personne." };
}

/**
 * La saisie attendue, telle que le formulaire l'exprime : un libellé vide dit que
 * l'étape ne demande qu'une case cochée. Validée avant d'atteindre la colonne, sans
 * quoi elle se figerait telle quelle dans un plan et ferait lever la relecture d'un
 * dossier des mois plus tard, loin de l'écran qui l'a écrite.
 */
function lireSaisie(formData: FormData): SaisieAttendue | null | Refus {
  const libelle = texte(formData, "saisieLibelle");
  if (!libelle) {
    return null;
  }

  const saisie = saisieAttendueSchema.safeParse({
    libelle,
    obligatoire: formData.get("saisieObligatoire") === "oui",
  });

  return saisie.success
    ? saisie.data
    : { erreur: "La valeur demandée au pointage a besoin d'un libellé lisible." };
}

function lireEtape(formData: FormData): EtapeSaisie | Refus {
  const saisie = lireSaisie(formData);
  if (saisie !== null && "erreur" in saisie) {
    return saisie;
  }

  const acteur = lireActeur(formData);
  if (typeof acteur !== "string") {
    return acteur;
  }

  const controleur = lireControleur(formData);
  if (controleur !== null && typeof controleur !== "string") {
    return controleur;
  }

  return {
    titre: texte(formData, "titre"),
    critere: texte(formData, "critere"),
    marcheASuivre: texte(formData, "marcheASuivre") || null,
    lien: texte(formData, "lien") || null,
    risque: lireRisque(formData),
    acteur,
    controleur,
    saisie,
  };
}

/**
 * Ouvre ou referme le droit des startups de compléter un moment. Refermer ne supprime
 * rien : les étapes restent en base, l'assemblage les écarte avec leur raison, et
 * rouvrir les rend à l'identique.
 */
export async function basculerAutorisationDesStartups(
  _etat: EtatModele | null,
  formData: FormData,
): Promise<EtatModele> {
  await requireOperateur();

  const moment = lireMoment(formData);
  if (moment === null) {
    return { erreur: "Moment inconnu." };
  }

  return rendu(await basculerAutorisation(moment, formData.get("autorise") === "oui"));
}

export async function ajouterEtapeAuModele(
  _etat: EtatModele | null,
  formData: FormData,
): Promise<EtatModele> {
  await requireOperateur();

  const moment = lireMoment(formData);
  const proprietaire = texte(formData, "proprietaire");
  if (moment === null || !proprietaire) {
    return { erreur: "Modèle inconnu." };
  }

  const etape = lireEtape(formData);
  if ("erreur" in etape) {
    return etape;
  }

  return rendu(await ajouterEtape(proprietaire, moment, etape));
}

export async function modifierEtapeDuModele(
  _etat: EtatModele | null,
  formData: FormData,
): Promise<EtatModele> {
  await requireOperateur();

  const etapeId = texte(formData, "etapeId");
  if (!etapeId) {
    return { erreur: "Étape inconnue." };
  }

  const etape = lireEtape(formData);
  if ("erreur" in etape) {
    return etape;
  }

  return rendu(await modifierEtape(etapeId, etape));
}

export async function retirerEtapeDuModele(
  _etat: EtatModele | null,
  formData: FormData,
): Promise<EtatModele> {
  await requireOperateur();

  const etapeId = texte(formData, "etapeId");
  if (!etapeId) {
    return { erreur: "Étape inconnue." };
  }

  return rendu(await retirerEtape(etapeId));
}
