"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { type EtatRattachementStartup, retirerRattachement } from "./actions";

export function RetirerRattachement({ id, startup }: { id: string; startup: string }) {
  const [etat, formAction, pending] = useActionState<EtatRattachementStartup, FormData>(
    retirerRattachement,
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
        title={`Retirer le rattachement à ${startup}`}
      >
        {pending ? "Retrait…" : "Retirer"}
      </Button>
      {etat ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
