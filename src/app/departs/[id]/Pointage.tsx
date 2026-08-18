"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState, useState } from "react";

import { cloreDossier, confirmerPlan, type EtatAction, pointerEtape } from "./actions";

export function BoutonConfirmer({ planId }: { planId: string }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    confirmerPlan,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Confirmation…" : "Confirmer ce plan"}
      </Button>
      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Quatre issues et pas deux : « déjà absent » est le cas nominal quand quelqu'un est
 * passé avant, et « écartée » doit porter sa raison, sans quoi l'étape devient un
 * accès oublié que plus rien ne rattrape.
 */
export function Pointage({ etapeId, faite }: { etapeId: string; faite: boolean }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    pointerEtape,
    null,
  );
  const [choix, setChoix] = useState("fait");
  const justification = choix === "ignoree" || choix === "echec";

  return (
    <form action={formAction} className={fr.cx("fr-mt-1w")}>
      <input type="hidden" name="etapeId" value={etapeId} />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <select
            className={fr.cx("fr-select")}
            name="pointage"
            value={choix}
            onChange={(evenement) => setChoix(evenement.target.value)}
            aria-label="Ce qui a été fait"
          >
            <option value="fait">C'est fait</option>
            <option value="deja-absent">Déjà absent</option>
            <option value="ignoree">Écartée</option>
            <option value="echec">Échec</option>
          </select>
        </div>

        {justification ? (
          <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
            <input
              className={fr.cx("fr-input")}
              name="note"
              placeholder={choix === "ignoree" ? "Pourquoi ?" : "Qu'est-ce qui a échoué ?"}
              aria-label="Raison"
            />
          </div>
        ) : null}

        <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
          <Button type="submit" priority="secondary" size="small" disabled={pending}>
            {pending ? "Enregistrement…" : faite ? "Corriger" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

export function BoutonClore({ dossierId }: { dossierId: string }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    cloreDossier,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Clôture…" : "Clore le dossier"}
      </Button>
      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
