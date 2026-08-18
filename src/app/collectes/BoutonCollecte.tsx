"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { type EtatLancement, lancerCollecte } from "./actions";

export function BoutonCollecte({ enCours }: { enCours: boolean }) {
  const [etat, formAction, pending] = useActionState<EtatLancement | null>(
    async () => lancerCollecte(),
    null,
  );

  return (
    <form action={formAction}>
      <Button type="submit" disabled={pending || enCours}>
        {pending ? "Lancement…" : "Lancer une collecte"}
      </Button>

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
      {etat?.message ? (
        <p className={fr.cx("fr-valid-text", "fr-mt-1v")} role="status">
          {etat.message}
        </p>
      ) : null}
    </form>
  );
}
