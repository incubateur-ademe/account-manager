"use client";

import { fr } from "@codegouvfr/react-dsfr";
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
      />
      {/* Au niveau du formulaire et non sous un champ : le refus peut porter sur la
          raison, sur la date, ou sur la cible que ce formulaire ne montre pas. Rattaché
          à la date, il serait annoncé comme une erreur de la date, et il mentirait. */}
      {etat ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v", "fr-mb-2v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Enregistrement…" : "Tolérer"}
      </Button>
    </form>
  );
}
