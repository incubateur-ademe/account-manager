"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { type EtatDepart, ouvrirDepart } from "@/app/departs/actions";

export function BoutonDepart({ username }: { username: string }) {
  const [etat, formAction, pending] = useActionState<EtatDepart | null, FormData>(
    ouvrirDepart,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="username" value={username} />
      <Button type="submit" priority="secondary" disabled={pending}>
        {pending ? "Calcul du plan…" : "Préparer le départ"}
      </Button>
      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
