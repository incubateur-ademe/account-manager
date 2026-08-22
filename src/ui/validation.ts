"use client";

import type { ChangeEvent, ChangeEventHandler, InvalidEvent } from "react";

/**
 * Les messages de validation du navigateur suivent sa langue, pas celle du site :
 * un opérateur en anglais lit « Please fill in this field » sur un écran par
 * ailleurs entièrement français. `setCustomValidity` les remplace, à condition de
 * les vider à la saisie suivante, faute de quoi le champ resterait invalide une
 * fois corrigé.
 *
 * Vider occupe `onChange`, que le champ réclame souvent déjà pour son propre
 * compte. Le handler à conserver se passe donc en second argument : réécrit après
 * le spread, il faisait disparaître celui d'ici sans bruit, et spreadé après lui il
 * disparaissait à son tour, ce qui laissait un champ contrôlé refuser toute frappe.
 */
export function messageObligatoire(
  message = "Ce champ est obligatoire.",
  saisie?: ChangeEventHandler<HTMLInputElement>,
) {
  return {
    onInvalid: (evenement: InvalidEvent<HTMLInputElement>) => {
      evenement.currentTarget.setCustomValidity(message);
    },
    onChange: (evenement: ChangeEvent<HTMLInputElement>) => {
      evenement.currentTarget.setCustomValidity("");
      saisie?.(evenement);
    },
  };
}
