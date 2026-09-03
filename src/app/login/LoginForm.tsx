"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { loginAction } from "./actions";

export function LoginForm({ suite }: { suite?: string }) {
  const [message, formAction, pending] = useActionState(loginAction, null);

  return (
    <form action={formAction}>
      {suite ? <input type="hidden" name="suite" value={suite} /> : null}
      <Input
        label="Identifiant beta.gouv ou adresse électronique"
        hintText="prenom.nom pour un compte beta.gouv, ou l'adresse à laquelle vous attendez le lien."
        nativeInputProps={{ name: "username", autoComplete: "username", required: true }}
        // Le même état visuel que le même texte : distinguer l'envoi du refus par la
        // couleur du bandeau rendrait au regard l'oracle que la phrase unique ferme.
        state={message ? "info" : "default"}
        stateRelatedMessage={message ?? undefined}
      />
      <Button type="submit" disabled={pending} className={fr.cx("fr-mt-2w")}>
        {pending ? "Envoi en cours…" : "Recevoir un lien de connexion"}
      </Button>
    </form>
  );
}
