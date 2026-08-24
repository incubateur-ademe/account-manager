"use client";

import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";
import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

import { annulerDossier, type EtatAction } from "./actions";

/**
 * Annuler, c'est dire « cela n'aura pas lieu, voici pourquoi ». Le motif est
 * obligatoire, comme la raison d'une clôture de constat : une décision sans motif est
 * une décision qu'on ne saura pas réexaminer.
 */
export function AnnulationDossier({
  dossierId,
  sens,
  visible,
  onSucces,
}: {
  dossierId: string;
  sens: SensDossier;
  /**
   * Monté même quand il ne se montre pas : c'est son effet de fermeture qui referme
   * la modale, et il doit survivre à la revalidation qui suit l'annulation.
   */
  visible: boolean;
  onSucces?: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    annulerDossier,
    null,
  );

  const mots = LIBELLE_DOSSIER[sens];

  useFermetureApresSucces(pending, etat?.erreur, onSucces);

  if (!visible) {
    return null;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <Input
        label={mots.motif}
        hintText="Restera au journal, avec votre nom."
        nativeInputProps={{
          name: "motif",
          required: true,
          placeholder: mots.motifExemple,
          ...messageObligatoire(mots.motifAttendu),
        }}
        state={etat?.erreur ? "error" : "default"}
        stateRelatedMessage={etat?.erreur}
      />
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Annulation…" : mots.annuler}
      </Button>
    </form>
  );
}
