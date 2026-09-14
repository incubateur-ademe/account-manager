import { EspaceMembreProvider } from "@incubateur-ademe/next-auth-espace-membre-provider";
import type { Provider } from "next-auth/providers";
import Nodemailer, { type NodemailerConfig } from "next-auth/providers/nodemailer";

import { webEnv } from "@/lib/env";

/**
 * Les deux portes d'entrée, hors de la configuration qui les monte.
 *
 * Elles vivent ici et non dans `auth.ts` pour une raison mécanique : ce dernier importe
 * `next-auth`, qui résout `next/server` par un chemin que seul l'empaqueteur de Next sait
 * suivre, si bien que rien de ce qu'il contient ne s'importe hors de Next. Le fournisseur
 * de courrier, lui, s'importe seul. Sans cette séparation, le seul chemin
 * d'authentification du produit ne serait jouable par aucun scénario, et l'écran de
 * connexion rendant la même phrase qu'un lien parte ou non, une porte qui cesserait
 * d'écrire ne se verrait nulle part.
 */

/**
 * Les membres inactifs sont acceptés à dessein : quelqu'un dont la mission vient
 * d'expirer doit pouvoir ouvrir l'outil pour traiter son propre offboarding.
 * L'allowlist des opérateurs reste le seul filtre d'accès.
 */
export const espaceMembreProvider = EspaceMembreProvider({
  fetch,
  fetchOptions: { next: { revalidate: 300 } },
  authOptions: { allowInactive: true },
});

/**
 * Trente minutes, contre vingt-quatre heures par défaut. Un lien de connexion est un
 * porteur : le transférer transfère l'accès, et celui-ci existe pour être suivi tout de
 * suite. Deux bornes à ne pas confondre, le lien vaut une demi-heure, la session qu'il
 * ouvre vaut la durée du jeton.
 */
const LIEN_VALIDE_SECONDES = 30 * 60;

/**
 * Le serveur se paramètre, et lui seul : un scénario y substitue un transport qui compose
 * sans poster, là où l'expéditeur et la durée du lien restent ceux de la production. Les
 * laisser eux aussi au bon vouloir de l'appelant reviendrait à épingler autre chose que
 * ce que l'outil envoie.
 */
export function fournisseursDuLien(
  serveur: NodemailerConfig["server"] = webEnv.SMTP_URL,
): Provider[] {
  return [
    espaceMembreProvider.ProviderWrapper(
      Nodemailer({ server: serveur, from: webEnv.SMTP_EMAIL_FROM }),
    ),
    // Nu, sans le wrapper de l'espace-membre : celui-ci résout un username auprès de
    // l'annuaire beta.gouv, ce qu'une adresse ne sait pas faire. Il garde donc son
    // identifiant d'origine, et c'est par cet identifiant que les deux portes se
    // distinguent partout ailleurs.
    Nodemailer({
      server: serveur,
      from: webEnv.SMTP_EMAIL_FROM,
      maxAge: LIEN_VALIDE_SECONDES,
    }),
  ];
}
