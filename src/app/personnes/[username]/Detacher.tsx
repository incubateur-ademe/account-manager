"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { detacherIdentite, type EtatDetachement } from "./actions";

export function Detacher({ id, compte }: { id: string; compte: string }) {
  const [etat, formAction, pending] = useActionState<EtatDetachement, FormData>(
    detacherIdentite,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        priority="tertiary no outline"
        size="small"
        disabled={pending}
        title={`Détacher ${compte} de cette personne`}
      >
        {pending ? "…" : "Détacher"}
      </Button>
      {etat ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
