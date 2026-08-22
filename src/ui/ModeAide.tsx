"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Tooltip } from "@codegouvfr/react-dsfr/Tooltip";
import { useSyncExternalStore } from "react";

const CLE = "mode-aide";

const abonnes = new Set<() => void>();

let actifCourant: boolean | null = null;

function etatCourant(): boolean {
  actifCourant ??= window.localStorage.getItem(CLE) !== "off";
  return actifCourant;
}

/**
 * Éteint tant que la page n'est pas vivante, et c'est ce qui la garde hydratable.
 * Une infobulle du système de design posée dans le HTML initial diverge à
 * l'hydratation, le JS du DSFR l'instrumentant pendant que React la compare : React
 * constate l'écart et reconstruit la page au lieu de l'hydrater. Une aide qui ne
 * s'ouvre qu'au clic ne perd rien à n'apparaître qu'une fois le clic possible.
 */
function etatAuServeur(): boolean {
  return false;
}

function sAbonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => {
    abonnes.delete(rappel);
  };
}

function basculer(): void {
  actifCourant = !etatCourant();
  window.localStorage.setItem(CLE, actifCourant ? "on" : "off");
  for (const rappel of abonnes) {
    rappel();
  }
}

/**
 * Le mode d'aide, retenu d'une visite à l'autre.
 *
 * L'état vit dans le module et non dans un contexte React, parce que le contexte ne
 * servait que son premier rendu : la bascule changeait son propre bouton, dans la
 * coque, et laissait les infobulles de la page telles quelles, y compris quand la
 * préférence enregistrée disait l'inverse. Le mode s'affichait donc allumé sur une
 * page qui l'avait éteint. Un abonnement au module n'a pas d'arbre à redescendre :
 * chaque infobulle s'abonne pour elle-même et se rend quand la valeur change.
 */
export function useModeAide(): { actif: boolean; basculer: () => void } {
  const actif = useSyncExternalStore(sAbonner, etatCourant, etatAuServeur);
  return { actif, basculer };
}

/**
 * Le bouton qui allume et éteint les infobulles.
 *
 * Sa propre explication reste au survol et ne s'éteint jamais : sans elle, on ne
 * pourrait plus apprendre à quoi sert le mode qu'on vient de couper.
 */
export function BasculeModeAide() {
  const { actif, basculer: basculerLAide } = useModeAide();

  return (
    <Tooltip
      title={
        actif
          ? "Les points d'interrogation expliquent ce que fait chaque geste avant de le déclencher. Cliquez pour les masquer."
          : "Les explications des gestes sont masquées. Cliquez pour les rétablir."
      }
    >
      <button
        type="button"
        onClick={basculerLAide}
        aria-pressed={actif}
        className={fr.cx(
          "fr-btn",
          "fr-btn--tertiary-no-outline",
          actif ? "fr-icon-question-fill" : "fr-icon-question-line",
        )}
      >
        Mode aide
      </button>
    </Tooltip>
  );
}
