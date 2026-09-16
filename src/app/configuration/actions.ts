"use server";

import type { z } from "zod";

import { cheminsConnus, convertir, lire } from "@/core/configuration";
import { policySchema } from "@/core/policy";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { loadPolicy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { chargerLesSurcharges } from "@/lib/surcharges";

export type EtatReglage = { erreur: string } | null;

/**
 * Régler une valeur, c'est décider que le fichier ne fait plus foi sur ce point. La trace
 * précède l'écriture, comme partout ailleurs : ce que `git log` donnait gratuitement quand
 * la politique vivait en dépôt, c'est le journal qui le donne désormais.
 *
 * La valeur est éprouvée avant d'être posée, sur le schéma entier et non sur le seul champ :
 * un seuil valide isolément peut rendre la politique incohérente, et la refuser ici vaut
 * mieux que de la voir tomber au prochain démarrage.
 */
export async function reglerUneValeur(
  _etat: EtatReglage,
  formData: FormData,
): Promise<EtatReglage> {
  await requireOperateur();

  const chemin = String(formData.get("chemin") ?? "").trim();
  const brut = String(formData.get("valeur") ?? "").trim();

  const connu = cheminsConnus(policySchema).find((candidat) => candidat.chemin === chemin);
  if (!connu) {
    return { erreur: `Aucun réglage ne porte le chemin « ${chemin} ».` };
  }

  const valeur = convertir(brut, connu.forme);

  const eprouve = eprouver(chemin, valeur);
  if (eprouve) {
    return { erreur: eprouve };
  }

  const avant = lire(loadPolicy() as Record<string, unknown>, chemin);

  await actionTracee({
    action: "configuration.reglage",
    targetType: "configuration",
    targetId: chemin,
    before: { valeur: avant },
    after: { valeur },
    revalider: ["/configuration"],
    ecrire: async (utilisateur) => {
      await prisma.configOverride.upsert({
        where: { path: chemin },
        update: { value: valeur as never, updatedBy: utilisateur.username },
        create: { path: chemin, value: valeur as never, updatedBy: utilisateur.username },
      });
      await chargerLesSurcharges();
    },
  });

  return null;
}

/**
 * Lever un réglage rend la valeur à qui la portait avant, fichier ou environnement, et
 * jamais au défaut du schéma : lever reviendrait sinon à effacer.
 */
export async function leverUnReglage(_etat: EtatReglage, formData: FormData): Promise<EtatReglage> {
  await requireOperateur();

  const chemin = String(formData.get("chemin") ?? "").trim();

  const existant = await prisma.configOverride.findUnique({ where: { path: chemin } });
  if (!existant) {
    return { erreur: `Aucun réglage à lever sur « ${chemin} ».` };
  }

  await actionTracee({
    action: "configuration.levee",
    targetType: "configuration",
    targetId: chemin,
    before: { valeur: existant.value },
    after: {},
    revalider: ["/configuration"],
    ecrire: async () => {
      await prisma.configOverride.delete({ where: { path: chemin } });
      await chargerLesSurcharges();
    },
  });

  return null;
}

/** Ce que le schéma dirait de la politique une fois cette valeur posée, et rien d'autre. */
function eprouver(chemin: string, valeur: unknown): string | null {
  const essai = structuredClone(loadPolicy()) as Record<string, unknown>;
  const segments = chemin.split(".");
  const dernier = segments.pop();
  if (dernier === undefined) {
    return "Chemin vide.";
  }

  let courant = essai;
  for (const segment of segments) {
    courant = courant[segment] as Record<string, unknown>;
  }
  courant[dernier] = valeur;

  const lu = policySchema.safeParse({ version: 1, ...essai });
  if (lu.success) {
    return null;
  }

  const fautif = lu.error.issues.find((issue) => issue.path.join(".") === chemin);

  return `Valeur refusée : ${(fautif ?? (lu.error.issues[0] as z.core.$ZodIssue)).message}`;
}
