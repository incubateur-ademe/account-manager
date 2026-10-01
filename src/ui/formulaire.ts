"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ce qui rétablit les listes déroulantes d'un formulaire après chaque envoi.
 *
 * React remet un `<form action={...}>` à zéro quand l'action rend la main, refus compris,
 * et c'est son comportement documenté. Une liste déroulante contrôlée y perd sa sélection
 * dans le DOM sans que son état ne bouge, et rien ne la rétablit tant qu'aucun rendu ne
 * passe sur elle. Or un `FormData` se lit dans le DOM : qui corrige sa saisie après un
 * refus et renvoie expédie la première option sans l'avoir choisie. Sur un pointage, cela
 * veut dire déclarer autre chose que ce qu'on a fait.
 *
 * Ce compteur change à la fin de chaque envoi. Le rendu que ce changement provoque suffit
 * aujourd'hui, React réappliquant la valeur d'une liste contrôlée à chaque mise à jour.
 * Posé en `key` sur la liste, il la remonte en plus, ce qui tiendrait encore si elle était
 * un jour mémoïsée et qu'aucun rendu ne l'atteignait. Une liste non contrôlée, elle, ne
 * relit sa valeur par défaut qu'au montage, et la clé est alors ce qui la rétablit. Le
 * remède vit ici plutôt que dans chaque écran.
 */
export function useListesApresEnvoi(pending: boolean): number {
  const [envois, setEnvois] = useState(0);
  const envoiEnCours = useRef(false);

  useEffect(() => {
    // La fin d'un envoi, et non son état : `pending` vaut faux avant le premier clic
    // comme après le dernier, et seule la transition dit qu'une action vient de rendre.
    if (envoiEnCours.current && !pending) {
      setEnvois((precedents) => precedents + 1);
    }
    envoiEnCours.current = pending;
  }, [pending]);

  return envois;
}
