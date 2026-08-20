"use client";

import type { ChangeEvent, InvalidEvent } from "react";

/**
 * Les messages de validation du navigateur suivent sa langue, pas celle du site :
 * un opérateur en anglais lit « Please fill in this field » sur un écran par
 * ailleurs entièrement français. `setCustomValidity` les remplace, à condition de
 * les vider à la saisie suivante, faute de quoi le champ resterait invalide une
 * fois corrigé.
 */
export function messageObligatoire(message = "Ce champ est obligatoire.") {
  return {
    onInvalid: (evenement: InvalidEvent<HTMLInputElement>) => {
      evenement.currentTarget.setCustomValidity(message);
    },
    onChange: (evenement: ChangeEvent<HTMLInputElement>) => {
      evenement.currentTarget.setCustomValidity("");
    },
  };
}
