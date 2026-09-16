"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import type { Forme } from "@/core/configuration";

import { type EtatReglage, leverUnReglage, reglerUneValeur } from "./actions";

/**
 * Un champ par réglage, et le bouton de levée seulement là où quelque chose se lève :
 * proposer de lever ce qui n'est pas réglé ferait croire qu'on peut effacer le fichier
 * depuis ici.
 */
export function Reglage({
  chemin,
  forme,
  valeur,
  regle,
}: {
  chemin: string;
  forme: Forme;
  valeur: string;
  regle: boolean;
}) {
  const [etatReglage, poser] = useActionState<EtatReglage, FormData>(reglerUneValeur, null);
  const [etatLevee, lever] = useActionState<EtatReglage, FormData>(leverUnReglage, null);
  const erreur = etatReglage?.erreur ?? etatLevee?.erreur;

  return (
    <div>
      <form action={poser}>
        <input type="hidden" name="chemin" value={chemin} />
        <Input
          label=""
          hintText={forme === "liste" ? "séparés par des virgules" : forme}
          nativeInputProps={{ name: "valeur", defaultValue: valeur, "aria-label": chemin }}
          state={erreur ? "error" : "default"}
          stateRelatedMessage={erreur}
        />
        <Button type="submit" priority="secondary" size="small">
          Régler
        </Button>
      </form>

      {regle ? (
        <form action={lever} className={fr.cx("fr-mt-1w")}>
          <input type="hidden" name="chemin" value={chemin} />
          <Button type="submit" priority="tertiary no outline" size="small">
            Rendre au fichier
          </Button>
        </form>
      ) : null}
    </div>
  );
}
