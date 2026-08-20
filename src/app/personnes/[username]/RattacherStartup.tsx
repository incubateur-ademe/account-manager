"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState, useState } from "react";
import { ChampAvecListe } from "@/ui/ChampAvecListe";
import { useFermetureApresSucces } from "@/ui/modale";
import { type EtatRattachementStartup, rattacherAStartup } from "./actions";

export interface StartupProposable {
  ghid: string;
  name: string;
  disparue: boolean;
}

export function RattacherStartup({
  username,
  missionEnd,
  startups,
  onSucces,
}: {
  username: string;
  /** Fin de mission connue, au format AAAA-MM-JJ, ou null. */
  missionEnd: string | null;
  startups: readonly StartupProposable[];
  onSucces?: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatRattachementStartup, FormData>(
    rattacherAStartup,
    null,
  );
  const [jusquAu, setJusquAu] = useState("");
  const [startup, setStartup] = useState("");

  const demandeConfirmation = etat?.confirmationRequise === true;

  useFermetureApresSucces(pending, etat?.erreur, onSucces);

  // L'écran avertit dès la saisie, le serveur refuse tant que la confirmation
  // manque. Les deux dispositifs ne se remplacent pas : le premier est du confort,
  // le second est la garantie.
  const prolonge = missionEnd !== null && jusquAu !== "" && jusquAu > missionEnd;
  const disparue = startups.find((connue) => connue.ghid === startup)?.disparue === true;

  return (
    <form action={formAction}>
      <input type="hidden" name="username" value={username} />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <ChampAvecListe
            nom="startup"
            label="Startup"
            hintText="Identifiant beta.gouv de la startup, parmi celles connues en base."
            suggestions={startups.map((connue) => ({
              valeur: connue.ghid,
              libelle: connue.name,
              ...(connue.disparue ? { mention: "hors incubateur" } : {}),
            }))}
            requis
            onValeur={setStartup}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Input
            label="Jusqu'au"
            hintText="Dernier jour couvert, inclusif. La date de fin est obligatoire."
            nativeInputProps={{
              name: "jusquAu",
              type: "date",
              required: true,
              value: jusquAu,
              onChange: (event) => setJusquAu(event.target.value),
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Input
            label="Motif"
            hintText="Facultatif."
            nativeInputProps={{ name: "motif", autoComplete: "off" }}
          />
        </div>
      </div>

      {prolonge ? (
        <Alert
          className={fr.cx("fr-mb-2w")}
          severity="warning"
          small
          description={`Cette date dépasse la fin de mission connue (${missionEnd}) : le rattachement fera courir ses accès au-delà.`}
        />
      ) : null}

      {disparue ? (
        <Alert
          className={fr.cx("fr-mb-2w")}
          severity="info"
          small
          description="Cette startup ne fait plus partie de l'incubateur à la dernière collecte. Le rattachement reste possible, sa dernière phase connue continuant de faire foi."
        />
      ) : null}

      {etat && !demandeConfirmation ? (
        <p className={fr.cx("fr-error-text", "fr-mb-2w")} role="alert">
          {etat.erreur}
        </p>
      ) : null}

      {demandeConfirmation ? (
        <>
          <p className={fr.cx("fr-error-text")} role="alert">
            {etat?.erreur}
          </p>
          <Checkbox
            small
            options={[
              {
                label: "Oui, prolonger ses accès jusqu'à cette date",
                nativeInputProps: { name: "confirme", value: "oui" },
              },
            ]}
          />
        </>
      ) : null}

      <Button type="submit" priority="secondary" disabled={pending}>
        {pending ? "Rattachement…" : "Rattacher"}
      </Button>

      <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
        Le constat de startups terminées ne se lève ni ne se ferme sur ce geste : il est revu à la
        prochaine collecte, qui seule connaît les phases de toutes les startups.
      </p>
    </form>
  );
}
