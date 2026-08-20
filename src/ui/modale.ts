"use client";

import { useEffect, useRef } from "react";

/**
 * Ferme la modale quand l'action serveur vient d'aboutir.
 *
 * Ces actions rendent `null` en cas de succès, ce qui est aussi leur état initial :
 * le succès ne se lit donc pas dans l'état seul, il se lit dans la transition. On
 * observe la fin d'un envoi, et non l'état, sans quoi la modale se fermerait toute
 * seule avant même d'avoir servi.
 */
export function useFermetureApresSucces(
  pending: boolean,
  erreur: string | undefined,
  fermer: (() => void) | undefined,
): void {
  const envoiEnCours = useRef(false);

  useEffect(() => {
    if (envoiEnCours.current && !pending && erreur === undefined) {
      fermer?.();
    }
    envoiEnCours.current = pending;
  }, [pending, erreur, fermer]);
}
