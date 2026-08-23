"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useActionState, useState } from "react";

import {
  type EtatRattachementStartup,
  rattacherAStartup,
} from "@/app/personnes/[username]/actions";
import style from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";
import { ChampAvecListe } from "@/ui/ChampAvecListe";
import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

export interface PersonneProposable {
  username: string;
  fullname: string;
  /** Fin de mission connue, au format AAAA-MM-JJ, ou null. */
  missionEnd: string | null;
  disparue: boolean;
}

/**
 * Identifiant distinct de celui de la modale de la fiche personne : le système de
 * design en tient un registre par identifiant, et deux modales qui le partagent sur
 * un même écran se rendent le focus l'une à l'autre.
 */
const modaleRattacherPersonne = createModal({
  id: "rattacher-personne-a-startup",
  isOpenedByDefault: false,
});

/**
 * Le frère du formulaire de la fiche personne, et non sa généralisation : celui-là
 * fixe la personne et fait varier la startup, celui-ci fait l'inverse. Un seul
 * composant pour les deux devrait tirer la fin de mission de la personne saisie
 * plutôt que de la recevoir, ce que le premier n'a pas à faire.
 */
function FormulaireRattachement({
  ghid,
  personnes,
  onSucces,
}: {
  ghid: string;
  personnes: readonly PersonneProposable[];
  onSucces: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatRattachementStartup, FormData>(
    rattacherAStartup,
    null,
  );
  const [jusquAu, setJusquAu] = useState("");
  const [username, setUsername] = useState("");

  const demandeConfirmation = etat?.confirmationRequise === true;

  useFermetureApresSucces(pending, etat?.erreur, onSucces);

  const saisie = personnes.find((personne) => personne.username === username);
  // L'écran avertit dès la saisie, le serveur refuse tant que la confirmation
  // manque. Les deux dispositifs ne se remplacent pas : le premier est du confort,
  // le second est la garantie.
  const missionEnd = saisie?.missionEnd ?? null;
  const prolonge = missionEnd !== null && jusquAu !== "" && jusquAu > missionEnd;

  return (
    <form action={formAction}>
      <input type="hidden" name="startup" value={ghid} />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <ChampAvecListe
            nom="username"
            label="Personne"
            hintText="Identifiant beta.gouv de la personne, parmi celles connues en base."
            suggestions={personnes.map((personne) => ({
              valeur: personne.username,
              libelle: personne.fullname,
              ...(personne.disparue ? { mention: "hors référentiel" } : {}),
            }))}
            requis
            onValeur={setUsername}
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
              ...messageObligatoire("Indiquez le dernier jour couvert.", (evenement) => {
                setJusquAu(evenement.target.value);
              }),
              value: jusquAu,
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
          description={`Cette date dépasse la fin de mission connue de ${saisie?.fullname ?? username} (${missionEnd}) : le rattachement fera courir ses accès au-delà.`}
        />
      ) : null}

      {saisie?.disparue === true ? (
        <Alert
          className={fr.cx("fr-mb-2w")}
          severity="info"
          small
          description="Cette personne n'est plus rendue par le référentiel à la dernière collecte. Le rattachement reste possible, il ne lui rend aucun accès par lui-même."
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

/**
 * Une seule modale pour toute la section, en tête et non par ligne : le geste porte
 * sur la startup, pas sur une personne déjà listée.
 */
export function RattacherPersonne({
  ghid,
  nomStartup,
  personnes,
}: {
  ghid: string;
  nomStartup: string;
  personnes: readonly PersonneProposable[];
}) {
  return (
    <>
      <span className={style["geste"]}>
        <Button
          className={fr.cx("fr-mr-1v")}
          priority="secondary"
          size="small"
          nativeButtonProps={modaleRattacherPersonne.buttonProps}
        >
          Rattacher une personne
        </Button>
        <Aide>
          {
            "Rattacher une personne à cette startup par une décision datée, qui survit aux collectes et porte le nom de qui l'a prise. Peut repousser son échéance."
          }
        </Aide>
      </span>

      <modaleRattacherPersonne.Component
        title={`Rattacher une personne à ${nomStartup}`}
        size="large"
      >
        <p className={fr.cx("fr-text--sm")}>
          Un rattachement manuel porte obligatoirement une date de fin et le nom de qui l'a posé. Il
          survit aux collectes, contrairement aux rattachements collectés, que l'espace-membre
          réécrit à chaque passage.
        </p>
        <FormulaireRattachement
          ghid={ghid}
          personnes={personnes}
          onSucces={modaleRattacherPersonne.close}
        />
      </modaleRattacherPersonne.Component>
    </>
  );
}
