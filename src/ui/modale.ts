"use client";

import { useIsModalOpen } from "@codegouvfr/react-dsfr/Modal/useIsModalOpen";
import { useEffect, useRef } from "react";

/**
 * La clé qui remonte le contenu d'une modale à chaque ouverture.
 *
 * Une modale du système de design ne meurt jamais : enregistrée une fois pour toutes,
 * elle reste montée, et son contenu avec elle. `useActionState` et `useState` gardent
 * donc leur valeur d'une ouverture à l'autre, si bien qu'un geste rouvert rejoue
 * l'issue du précédent. Un refus périmé n'est qu'un bruit, mais une phrase de succès
 * au-dessus de champs vides est une affirmation fausse, et elle peut porter sur une
 * autre cible que celle qu'on vient de choisir.
 *
 * Elle vaut pour toute modale, y compris celles dont l'état du moment est inoffensif :
 * ce qui n'est qu'un refus périmé aujourd'hui devient une autre phrase demain, et une
 * hygiène qu'on applique au cas par cas est une hygiène qu'on oublie.
 */
export function useCleDOuverture(modale: { id: string; isOpenedByDefault: boolean }): string {
  return String(useIsModalOpen(modale));
}

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
