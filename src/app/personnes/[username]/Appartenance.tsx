"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";
import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";
import { type EtatAppartenance, forcerAppartenance, libererAppartenance } from "./actions";

export interface SurchargePosee {
  sens: "INCLUDE" | "EXCLUDE";
  par: string;
  depuis: string;
  raison: string;
}

export function Appartenance({
  username,
  surcharge,
  onSucces,
}: {
  username: string;
  surcharge: SurchargePosee | null;
  onSucces?: () => void;
}) {
  const [pose, poserAction, enPose] = useActionState<EtatAppartenance, FormData>(
    forcerAppartenance,
    null,
  );
  const [retrait, retirerAction, enRetrait] = useActionState<EtatAppartenance, FormData>(
    libererAppartenance,
    null,
  );

  useFermetureApresSucces(enPose, pose?.erreur, onSucces);
  useFermetureApresSucces(enRetrait, retrait?.erreur, onSucces);

  return (
    <>
      <form action={poserAction}>
        <input type="hidden" name="username" value={username} />
        <Input
          label={surcharge ? "Changer la décision" : "Forcer son appartenance"}
          hintText="Raison obligatoire : sans motif, la décision ne se réexamine pas."
          nativeInputProps={{
            name: "raison",
            required: true,
            autoComplete: "off",
            ...messageObligatoire("Indiquez la raison de cette décision."),
          }}
          state={pose ? "error" : "default"}
          stateRelatedMessage={pose?.erreur}
        />
        <Button
          type="submit"
          priority="secondary"
          size="small"
          disabled={enPose}
          nativeButtonProps={{ name: "sens", value: "INCLUDE" }}
        >
          Forcer dans l'incubateur
        </Button>{" "}
        <Button
          type="submit"
          priority="secondary"
          size="small"
          disabled={enPose}
          nativeButtonProps={{ name: "sens", value: "EXCLUDE" }}
        >
          Déclarer hors incubateur
        </Button>
      </form>

      {surcharge ? (
        <form action={retirerAction} className={fr.cx("fr-mt-2w")}>
          <input type="hidden" name="username" value={username} />
          <Button type="submit" priority="tertiary" size="small" disabled={enRetrait}>
            {enRetrait ? "Retrait…" : "Retirer la surcharge"}
          </Button>
          {retrait ? (
            <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
              {retrait.erreur}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
