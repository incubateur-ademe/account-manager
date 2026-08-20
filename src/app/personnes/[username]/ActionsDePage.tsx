"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";

import { Appartenance, type SurchargePosee } from "./Appartenance";
import { BoutonDepart } from "./BoutonDepart";

// Hors du composant : `createModal` enregistre la modale une fois pour toutes, et
// une fiche n'en affiche qu'une à la fois.
const modaleAppartenance = createModal({ id: "appartenance", isOpenedByDefault: false });

/**
 * Les gestes qui portent sur la personne entière, sur une seule ligne.
 *
 * Forcer l'appartenance concerne une poignée de fiches : elle reste sur la même ligne
 * que les autres, en priorité tertiaire, plutôt que de déplier son formulaire au
 * milieu des faits ou de disparaître derrière un geste supplémentaire.
 */
export function ActionsDePage({
  username,
  editable,
  surcharge,
}: {
  username: string;
  editable: boolean;
  surcharge: SurchargePosee | null;
}) {
  return (
    <>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--right", "fr-grid-row--middle")}>
        {editable ? (
          <Button
            className={fr.cx("fr-mr-2w")}
            priority="secondary"
            size="small"
            linkProps={{ href: `/personnes/${encodeURIComponent(username)}/edit` }}
          >
            Éditer
          </Button>
        ) : null}

        <div className={fr.cx("fr-mr-2w")}>
          <BoutonDepart username={username} />
        </div>

        <Button
          priority="tertiary no outline"
          size="small"
          nativeButtonProps={modaleAppartenance.buttonProps}
        >
          {surcharge ? "Changer l'appartenance" : "Forcer l'appartenance"}
        </Button>
      </div>

      <modaleAppartenance.Component
        title={surcharge ? "Changer son appartenance" : "Forcer son appartenance"}
      >
        <p className={fr.cx("fr-text--sm")}>
          Une décision d'appartenance dit à quel titre la personne relève de l'incubateur. Elle
          n'ordonne rien : aucun accès n'est coupé, ses comptes continuent d'être examinés, et un
          départ reste à instruire par un dossier.
        </p>
        <Appartenance
          username={username}
          surcharge={surcharge}
          onSucces={modaleAppartenance.close}
        />
      </modaleAppartenance.Component>
    </>
  );
}
