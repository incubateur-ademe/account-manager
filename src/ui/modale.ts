"use client";

import { useEffect, useRef } from "react";

/**
 * Ferme la modale quand l'action serveur vient d'aboutir sans rien laisser à lire.
 *
 * Ces actions rendent `null` en cas de succès, ce qui est aussi leur état initial :
 * le succès ne se lit donc pas dans l'état seul, il se lit dans la transition. On
 * observe la fin d'un envoi, et non l'état, sans quoi la modale se fermerait toute
 * seule avant même d'avoir servi.
 *
 * La retenue est le refus le plus souvent, mais pas seulement : une phrase qu'un succès
 * rapporte et qui ne se lit qu'ici retient tout autant, la fermeture l'emporterait avec
 * elle.
 */
export function useFermetureApresSucces(
  pending: boolean,
  retenue: string | undefined,
  fermer: (() => void) | undefined,
): void {
  const envoiEnCours = useRef(false);

  useEffect(() => {
    if (envoiEnCours.current && !pending && retenue === undefined) {
      fermer?.();
    }
    envoiEnCours.current = pending;
  }, [pending, retenue, fermer]);
}
