"use client";

import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

import { type EtatTolerance, tolererConstat } from "./actions";

/**
 * La cible ne figure pas dans ce formulaire, et ce n'est pas un oubli : elle se déduit du
 * constat côté serveur. Un champ de plus ici laisserait poster une cible que personne n'a
 * regardée.
 *
 * `dernierJour` vient du serveur plutôt que d'un calcul au rendu : deux horloges qui ne
 * tombent pas sur le même jour feraient diverger le HTML servi de celui qu'hydrate le
 * navigateur.
 */
export function ToleranceConstat({
  dedupKey,
  dernierJour,
  onSucces,
}: {
  dedupKey: string;
  dernierJour: string;
  onSucces?: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatTolerance, FormData>(tolererConstat, null);

  useFermetureApresSucces(pending, etat?.erreur, onSucces);

  return (
    <form action={formAction}>
      <input type="hidden" name="dedupKey" value={dedupKey} />
      <Input
        label="Pourquoi cet écart est admis"
        hintText="Restera au journal, avec votre nom."
        nativeInputProps={{
          name: "raison",
          required: true,
          placeholder: "Compte partagé, conservé jusqu'à…",
          ...messageObligatoire("Dites pourquoi cet écart est admis."),
        }}
      />
      <Input
        label="Jusqu'au"
        hintText="Dernier jour couvert, compris. L'écart revient de lui-même le lendemain."
        nativeInputProps={{
          name: "jusquAu",
          type: "date",
          required: true,
          max: dernierJour,
          ...messageObligatoire("Choisissez jusqu'à quand cet écart est admis."),
        }}
        state={etat ? "error" : "default"}
        stateRelatedMessage={etat?.erreur}
      />
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Enregistrement…" : "Tolérer"}
      </Button>
    </form>
  );
}
