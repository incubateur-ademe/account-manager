"use client";

import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

import type { RemiseDeCredential } from "@/lib/execution";

import { type EtatAction, lancerExecution } from "./actions";
import { Remises } from "./Remises";

type Lancement = (etat: EtatAction | null, formData: FormData) => Promise<EtatAction>;

const ContexteDuLancement = createContext<Lancement | null>(null);

/**
 * Garde les clés remises au-dessus de ce qu'un rafraîchissement démonte.
 *
 * Un plan que son lancement solde quitte la section qui portait son bouton, et n'importe
 * quelle action de la même page la rafraîchit. Une clé gardée dans l'état de ce bouton
 * disparaissait avec lui, sans que rien ne dise qu'elle était perdue. Le lancement passe
 * donc par ce porteur, qui reste monté tant que la page est ouverte.
 */
export function PorteurDeRemises({ titre, children }: { titre: "h2" | "h3"; children: ReactNode }) {
  const [remises, setRemises] = useState<readonly RemiseDeCredential[]>([]);

  const lancer = useCallback<Lancement>(async (etat, formData) => {
    const resultat = await lancerExecution(etat, formData);
    const neuves = resultat.execution?.remises ?? [];
    if (neuves.length > 0) {
      setRemises((avant) => [
        ...avant,
        ...neuves.filter((neuve) => !avant.some(({ key }) => key === neuve.key)),
      ]);
    }
    return resultat;
  }, []);

  return (
    <ContexteDuLancement.Provider value={lancer}>
      <Remises remises={remises} titre={titre} />
      {children}
    </ContexteDuLancement.Provider>
  );
}

/** Le lancement de la page, ou rien quand aucun porteur ne garde ses clés. */
export function useLancementPorte(): Lancement | null {
  return useContext(ContexteDuLancement);
}
