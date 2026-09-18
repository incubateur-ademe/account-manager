"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { Select } from "@codegouvfr/react-dsfr/Select";
import { useActionState } from "react";

import { REVUE_PAR_DEFAUT } from "@/core/compte-de-service";
import { useCleDOuverture } from "@/ui/modale";

import { declarerUnCompteDeService, type EtatDeclaration } from "./actions";

/**
 * Le propriétaire et la revue sont exigés au même titre que le nom. Ce sont eux, et non
 * l'identifiant du compte, qui rendent un accès permanent non humain gouvernable : les
 * rendre facultatifs reviendrait à créer des comptes que personne ne relira.
 *
 * Six champs derrière un bouton, et non posés sous la liste : déclarer est un geste rare,
 * la liste est ce qu'on vient lire. Dépliés, ils occupaient 736 pixels et près de la
 * moitié de l'écran, devant un tableau deux fois plus court. C'est aussi la forme que la
 * file des comptes isolés donne déjà au même geste.
 */
const modale = createModal({ id: "declarer-compte-de-service", isOpenedByDefault: false });

const TITRE = "Déclarer un compte de service";

export function Declarer({ systemes }: { systemes: readonly { key: string; label: string }[] }) {
  const [etat, declarer] = useActionState<EtatDeclaration, FormData>(
    declarerUnCompteDeService,
    null,
  );
  const ouverture = useCleDOuverture(modale);

  return (
    <>
      <Button priority="secondary" nativeButtonProps={modale.buttonProps}>
        {TITRE}
      </Button>

      <modale.Component titleAs="h2" title={TITRE} size="large">
        <form action={declarer} key={ouverture}>
          {/* Sans option pré-sélectionnée : le premier système de la liste n'a aucune raison
              d'être le bon, et un compte rangé sous lui par défaut se retrouverait sur la
              fiche d'un système qu'il ne sert pas. */}
          <Select
            label="Système"
            hint="Celui sur lequel le compte existe"
            nativeSelectProps={{ name: "provider", required: true, defaultValue: "" }}
          >
            <option value="" disabled>
              Choisir un système
            </option>
            {systemes.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Input
            label="Clé"
            hintText="L'identifiant du compte sur le système, tel qu'il s'y écrit"
            nativeInputProps={{ name: "key", required: true }}
          />
          <Input label="Libellé" nativeInputProps={{ name: "label", required: true }} />
          <Input
            label="Objet"
            hintText="Ce que ce compte fait, en une phrase"
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
          {/* Facultatif, parce que la plupart des comptes machine n'ont pas de terme. Il est
              en revanche la seule reprise qui existe pour un jeton restreint émis derrière le
              proxy, qui n'offre aucune révocation : sans lui, une telle fiche réclame une
              revue que personne ne peut éteindre. */}
          <Input
            label="Terme"
            hintText="Facultatif. Pour un jeton émis, la date à laquelle il meurt de lui-même, et la seule reprise qui existe."
            nativeInputProps={{ name: "expiresAt", type: "date" }}
          />

          {/* Au formulaire et non à un champ : une clé déjà prise ou un libellé manquant ne
              concernent pas la revue, et l'y accrocher désignerait le mauvais endroit, aux
              lecteurs d'écran comme aux autres. */}
          {etat?.erreur ? (
            <Alert severity="error" small description={etat.erreur} className={fr.cx("fr-mb-2w")} />
          ) : null}
          <Button type="submit">Déclarer</Button>
        </form>
      </modale.Component>
    </>
  );
}
