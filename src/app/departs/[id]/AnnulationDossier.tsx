"use client";

import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";
import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

import { annulerDossier, type EtatAction } from "./actions";

/**
 * Annuler, c'est dire « ce départ n'aura pas lieu, voici pourquoi ». Le motif est
 * obligatoire, comme la raison d'une clôture de constat : une décision sans motif est
 * une décision qu'on ne saura pas réexaminer.
 */
export function AnnulationDossier({
  dossierId,
  onSucces,
}: {
  dossierId: string;
  onSucces?: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    annulerDossier,
    null,
  );

  useFermetureApresSucces(pending, etat?.erreur, onSucces);

  return (
    <form action={formAction}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <Input
        label="Pourquoi ce départ n'aura pas lieu"
        hintText="Restera au journal, avec votre nom."
        nativeInputProps={{
          name: "motif",
          required: true,
          placeholder: "Mission prolongée jusqu'en…",
          ...messageObligatoire("Dites pourquoi ce départ n'aura pas lieu."),
        }}
        state={etat?.erreur ? "error" : "default"}
        stateRelatedMessage={etat?.erreur}
      />
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Annulation…" : "Annuler ce départ"}
      </Button>
    </form>
  );
}
