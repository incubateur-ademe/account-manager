"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { Select } from "@codegouvfr/react-dsfr/Select";
import { useActionState } from "react";

import { REVUE_PAR_DEFAUT } from "@/core/compte-de-service";

import { declarerUnCompteDeService, type EtatDeclaration } from "./actions";

/**
 * Le propriétaire et la revue sont exigés au même titre que le nom. Ce sont eux, et non
 * l'identifiant du compte, qui rendent un accès permanent non humain gouvernable : les
 * rendre facultatifs reviendrait à créer des comptes que personne ne relira.
 */
export function Declarer({ systemes }: { systemes: readonly { key: string; label: string }[] }) {
  const [etat, declarer] = useActionState<EtatDeclaration, FormData>(
    declarerUnCompteDeService,
    null,
  );

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>Déclarer un compte de service</h2>

      <form action={declarer}>
        {/* Sans option pré-sélectionnée : le premier système de la liste n'a aucune raison
            d'être le bon, et un compte rangé sous lui par défaut se retrouverait sur la
            fiche d'un système qu'il ne sert pas. */}
        <Select
          label="Système"
          hint="Celui auquel ce compte machine donne accès."
          nativeSelectProps={{ name: "provider", required: true, defaultValue: "" }}
        >
          <option value="" disabled>
            Choisir un système
          </option>
          {systemes.map((systeme) => (
            <option key={systeme.key} value={systeme.key}>
              {systeme.label}
            </option>
          ))}
        </Select>
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
          nativeInputProps={{
            name: "reviewEveryDays",
            type: "number",
            defaultValue: REVUE_PAR_DEFAUT,
            min: 1,
          }}
        />

        {/* Au formulaire et non à un champ : une clé déjà prise ou un libellé manquant ne
            concernent pas la revue, et l'y accrocher désignerait le mauvais endroit, aux
            lecteurs d'écran comme aux autres. */}
        {etat?.erreur ? (
          <Alert severity="error" small description={etat.erreur} className={fr.cx("fr-mb-2w")} />
        ) : null}
        <Button type="submit">Déclarer</Button>
      </form>
    </section>
  );
}
