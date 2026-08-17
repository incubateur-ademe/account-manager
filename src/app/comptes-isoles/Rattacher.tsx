"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { type EtatRattachement, rattacherIdentite } from "./actions";
import { creerFichePourCompte, type EtatCreation } from "./creer";

export function Rattacher({ id, listeId }: { id: string; listeId: string }) {
  const [etat, formAction, pending] = useActionState<EtatRattachement, FormData>(
    rattacherIdentite,
    null,
  );
  const [creation, creerAction, enCreation] = useActionState<EtatCreation, FormData>(
    creerFichePourCompte,
    null,
  );

  // Le refus n'est pas une erreur de saisie mais une question posée : la case ne
  // s'affiche qu'une fois qu'elle a un sens, pour ne pas proposer d'emblée de passer
  // outre un garde-fou qu'on n'a pas encore rencontré.
  const demandeConfirmation = etat?.erreur.includes("Confirmez pour continuer") === true;

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <Input
          label="Rattacher à"
          hintText="Username beta.gouv, même hors incubateur, ou clé d'un compte de service."
          nativeInputProps={{ name: "cible", required: true, list: listeId, autoComplete: "off" }}
          state={etat ? "error" : "default"}
          stateRelatedMessage={etat?.erreur}
        />
        {demandeConfirmation ? (
          <Checkbox
            small
            options={[
              {
                label: "Oui, c'est la même personne",
                nativeInputProps: { name: "confirme", value: "oui" },
              },
            ]}
          />
        ) : null}
        <Button type="submit" priority="secondary" size="small" disabled={pending}>
          {pending ? "Rattachement…" : "Rattacher"}
        </Button>
      </form>

      <form action={creerAction} className={fr.cx("fr-mt-2w")}>
        <input type="hidden" name="id" value={id} />
        <Input
          label="Ou créer une fiche"
          hintText="Nom, en dernier recours : pour qui n'a aucune fiche beta.gouv."
          nativeInputProps={{ name: "nom", autoComplete: "off" }}
          state={creation ? "error" : "default"}
          stateRelatedMessage={creation?.erreur}
        />
        <Button type="submit" priority="tertiary" size="small" disabled={enCreation}>
          {enCreation ? "Création…" : "Créer la fiche"}
        </Button>
      </form>
    </>
  );
}
