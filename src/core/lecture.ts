import type { z } from "zod";

/** Ce qu'une collecte a pu lire, et ce qu'elle a dû écarter faute de le comprendre. */
export interface Lecture<T> {
  items: T[];
  erreurs: string[];
}

/**
 * Une réponse dont un élément est illisible n'invalide pas les autres : écarter la
 * ligne fautive et signaler l'écart vaut mieux que de perdre tout le périmètre pour
 * un membre mal formé. L'erreur remonte, donc la collecte ne se dira pas complète,
 * donc elle ne datera aucune disparition.
 *
 * Vit dans le noyau parce que la règle ne tient pas à l'espace-membre : elle vaut
 * pour tout connecteur qui lit une liste dont un élément peut être mal formé.
 */
export function lireChaque<T>(valeurs: unknown, schema: z.ZodType<T>, quoi: string): Lecture<T> {
  if (!Array.isArray(valeurs)) {
    return { items: [], erreurs: [`${quoi} : une liste était attendue`] };
  }

  const items: T[] = [];
  const erreurs: string[] = [];

  for (const [index, valeur] of valeurs.entries()) {
    const lu = schema.safeParse(valeur);
    if (lu.success) {
      items.push(lu.data);
    } else {
      const details = lu.error.issues
        .map((issue) => `${issue.path.join(".") || "(racine)"} ${issue.message}`)
        .join(", ");
      erreurs.push(`${quoi} : élément ${index} illisible (${details})`);
    }
  }

  return { items, erreurs };
}
