"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ce qui remonte les listes déroulantes d'un formulaire après chaque envoi.
 *
 * React remet un `<form action={...}>` à zéro quand l'action rend la main, et c'est son
 * comportement documenté. Les champs texte contrôlés s'en relèvent : React réapplique
 * leur valeur au commit suivant. Une liste déroulante, non : sa sélection se pose sur
 * les `<option>` au montage et à la mise à jour, et la remise à zéro la défait sans que
 * l'état de React ne bouge, donc sans qu'aucun rendu ne la rétablisse.
 *
 * Le formulaire affiche alors sa première option pendant que l'état tient toujours la
 * bonne valeur. Le défaut ne se voit pas toujours, une interaction ultérieure suffisant
 * à resynchroniser l'affichage, et c'est ce qui le rend dangereux : il ne se reproduit
 * pas à volonté, mais il est là.
 *
 * Et il est là où ça coûte, parce qu'un `FormData` se lit dans le DOM et non dans
 * l'état : qui corrige sa saisie après un refus et renvoie expédie la première option
 * sans l'avoir choisie. Sur un pointage, cela veut dire déclarer autre chose que ce
 * qu'on a fait.
 *
 * Cette clé change à la fin de chaque envoi, refus compris. Posée en `key` sur une
 * liste, elle la remonte, et un montage repose la sélection depuis l'état. Le remède
 * vit ici plutôt que dans chaque écran : trois formulaires du dépôt portent une liste,
 * et le prochain n'aura pas à retrouver ce raisonnement.
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
