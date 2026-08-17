"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { type EtatRevue, enregistrerRevue } from "./actions";

export function BoutonRevue({ compteKey }: { compteKey: string }) {
  const [etat, formAction, pending] = useActionState<EtatRevue, FormData>(enregistrerRevue, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="key" value={compteKey} />
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Enregistrement…" : "Revue faite"}
      </Button>
      {etat ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
