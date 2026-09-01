import { Prisma } from "@/generated/prisma/client";

/** Ce qu'une action écrivait quand un index unique l'a refusée. */
export type EcritureEnCollision = "identifiant" | "adresse" | "fiche";

/**
 * La contrainte violée ne se lit pas dans l'erreur, et c'est pour ça que l'appelant
 * dit ce qu'il écrivait : `meta.target` ne porte pas la même valeur selon la base et
 * le pilote, et l'index de `communicationEmail`, posé à la main dans une migration
 * parce que Prisma ne sait pas déclarer un index partiel, n'y figure sous le nom
 * d'aucun champ du schéma. Une phrase adossée à ce champ tomberait en silence.
 *
 * Les trois phrases vivent côte à côte pour qu'une quatrième s'écrive ici plutôt que
 * dans un `catch`, où elle cesserait d'être relue avec les autres.
 */
const PHRASE: Record<EcritureEnCollision, (valeur: string) => string> = {
  identifiant: (valeur) =>
    `« ${valeur} » vient d'être pris, ou l'un de ses constats l'a été. Rien n'a été écrit : refaites la demande pour repartir de l'état courant.`,
  adresse: (valeur) =>
    `« ${valeur} » est déjà l'adresse de communication d'une autre fiche locale. Rien n'a été écrit : corrigez-la, ou reprenez l'autre fiche.`,
  fiche: (valeur) =>
    `Aucune fiche n'a été créée pour « ${valeur} » : une autre porte déjà son identifiant, son identifiant beta.gouv ou son adresse de communication. Rien n'a été écrit.`,
};

/**
 * Ce qu'une écriture refusée par un index unique vaut à l'écran, ou rien quand
 * l'erreur est d'une autre nature et doit remonter telle quelle.
 *
 * Sans cette traduction, l'exception sort de l'action serveur et l'écran générique de
 * Next remplace le `{ erreur }` que toutes les autres branches de la même action
 * rendent : l'opérateur perd à la fois sa saisie et la raison du refus.
 */
export function messageDeCollision(
  error: unknown,
  ecriture: EcritureEnCollision,
  valeur: string,
): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  return PHRASE[ecriture](valeur);
}
