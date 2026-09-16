"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { declarerUnCompteDeService, type EtatDeclaration } from "./actions";

/**
 * Le propriétaire et la revue sont exigés au même titre que le nom. Ce sont eux, et non
 * l'identifiant du compte, qui rendent un accès permanent non humain gouvernable : les
 * rendre facultatifs reviendrait à créer des comptes que personne ne relira.
 */
export function Declarer() {
  const [etat, declarer] = useActionState<EtatDeclaration, FormData>(
    declarerUnCompteDeService,
    null,
  );

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>Déclarer un compte de service</h2>

      <form action={declarer}>
        <Input
          label="Clé"
          hintText="Identifiant court et stable, en minuscules"
          nativeInputProps={{ name: "key", required: true }}
        />
        <Input label="Libellé" nativeInputProps={{ name: "label", required: true }} />
        <Input
          label="Usage"
          hintText="Ce que ce compte fait, en une phrase lisible dans deux ans"
          nativeInputProps={{ name: "purpose", required: true }}
        />
        <Input
          label="Propriétaire"
          hintText="Username beta.gouv de qui en répond"
          nativeInputProps={{ name: "ownerUsername", required: true }}
        />
        <Input
          label="Revue tous les"
          hintText="En jours. Un compte machine n'a pas de fin de mission, c'est la revue qui le remet en question."
          nativeInputProps={{ name: "reviewEveryDays", type: "number", defaultValue: 180, min: 1 }}
          state={etat?.erreur ? "error" : "default"}
          stateRelatedMessage={etat?.erreur}
        />
        <Button type="submit">Déclarer</Button>
      </form>
    </section>
  );
}
