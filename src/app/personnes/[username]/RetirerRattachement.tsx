"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { type EtatRattachementStartup, retirerRattachement } from "./actions";

/**
 * `cible` nomme ce que la ligne montre, et change de sens d'un écran à l'autre : la
 * startup sur la fiche d'une personne, la personne sur la fiche d'une startup. Le
 * bouton se répète autant de fois qu'il y a de lignes, son intitulé ne les distingue
 * pas, et sans elle l'infobulle dirait la même chose partout.
 */
export function RetirerRattachement({ id, cible }: { id: string; cible: string }) {
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
        title={`Retirer le rattachement manuel : ${cible}`}
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
