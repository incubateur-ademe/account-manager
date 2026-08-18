"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { loginAction } from "./actions";

export function LoginForm({ suite }: { suite?: string }) {
  const [error, formAction, pending] = useActionState(loginAction, null);

  return (
    <form action={formAction}>
      {suite ? <input type="hidden" name="suite" value={suite} /> : null}
      <Input
        label="Nom d'utilisateur beta.gouv"
        hintText="Par exemple prenom.nom, sans l'adresse électronique complète."
        nativeInputProps={{ name: "username", autoComplete: "username", required: true }}
        state={error ? "error" : "default"}
        stateRelatedMessage={error ?? undefined}
      />
      <Button type="submit" disabled={pending} className={fr.cx("fr-mt-2w")}>
        {pending ? "Envoi en cours…" : "Recevoir un lien de connexion"}
      </Button>
    </form>
  );
}
