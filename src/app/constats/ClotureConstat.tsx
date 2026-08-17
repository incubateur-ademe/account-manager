"use client";

import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { cloreConstat, type EtatCloture } from "./actions";

export function ClotureConstat({ dedupKey }: { dedupKey: string }) {
  const [etat, formAction, pending] = useActionState<EtatCloture, FormData>(cloreConstat, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="dedupKey" value={dedupKey} />
      <Input
        label="Ce qui a été fait"
        hintText="Restera au journal, avec votre nom."
        nativeInputProps={{ name: "raison", required: true, placeholder: "Accès coupés le…" }}
        state={etat ? "error" : "default"}
        stateRelatedMessage={etat?.erreur}
      />
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Clôture…" : "Clore"}
      </Button>
    </form>
  );
}
