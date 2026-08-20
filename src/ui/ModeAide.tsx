"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Tooltip } from "@codegouvfr/react-dsfr/Tooltip";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

const CLE = "mode-aide";

const ModeAideContexte = createContext<{ actif: boolean; basculer: () => void }>({
  actif: true,
  basculer: () => undefined,
});

/**
 * Le mode d'aide, retenu d'une visite à l'autre.
 *
 * Il commence à vrai, et le premier rendu vaut toujours vrai côté serveur comme
 * côté client : lire `localStorage` avant l'hydratation ferait diverger les deux, et
 * React reconstruirait la page au lieu de l'hydrater. La préférence n'est donc lue
 * qu'une fois la page vivante.
 */
export function ModeAideProvider({ children }: { children: ReactNode }) {
  const [actif, setActif] = useState(true);

  useEffect(() => {
    setActif(window.localStorage.getItem(CLE) !== "off");
  }, []);

  const basculer = () => {
    setActif((precedent) => {
      const suivant = !precedent;
      window.localStorage.setItem(CLE, suivant ? "on" : "off");
      return suivant;
    });
  };

  return <ModeAideContexte value={{ actif, basculer }}>{children}</ModeAideContexte>;
}

export function useModeAide() {
  return useContext(ModeAideContexte);
}

/**
 * Le bouton qui allume et éteint les infobulles.
 *
 * Sa propre explication reste au survol et ne s'éteint jamais : sans elle, on ne
 * pourrait plus apprendre à quoi sert le mode qu'on vient de couper.
 */
export function BasculeModeAide() {
  const { actif, basculer } = useModeAide();

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
        onClick={basculer}
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
