"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import style from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";

import { Appartenance, type SurchargePosee } from "./Appartenance";
import { BoutonDossier } from "./BoutonDossier";

// Hors du composant : `createModal` enregistre la modale une fois pour toutes, et
// une fiche n'en affiche qu'une à la fois.
const modaleAppartenance = createModal({ id: "appartenance", isOpenedByDefault: false });

/**
 * Les gestes qui portent sur la personne entière, sur une seule ligne, rangés par
 * priorité décroissante : ce qui vaut pour toutes les fiches d'abord, ce qui ne vaut
 * que pour une poignée en dernier.
 *
 * Chaque geste porte son infobulle, signalée par le point d'interrogation du système
 * de design : une conséquence qu'il faut deviner est une conséquence qu'on découvre
 * après coup.
 */
export function ActionsDePage({
  username,
  editable,
  raisonNonEditable,
  surcharge,
}: {
  username: string;
  editable: boolean;
  /** Pourquoi la fiche ne s'édite pas, à dire plutôt qu'à taire. */
  raisonNonEditable?: string;
  surcharge: SurchargePosee | null;
}) {
  return (
    <>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--right", "fr-grid-row--middle")}>
        <BoutonDossier username={username} sens="OFFBOARDING" />
        <BoutonDossier username={username} sens="ONBOARDING" priorite="secondary" />

        <span className={style["geste"]}>
          {/* Le bouton reste, même inerte : absent, il laissait chercher ce qui
            n'existait pas. Son infobulle porte la raison, la même que celle de
            l'alerte, pour qu'on ne l'apprenne pas deux fois différemment. */}
          <Button
            className={fr.cx("fr-mr-1v")}
            priority="secondary"
            size="small"
            {...(editable
              ? { linkProps: { href: `/personnes/${encodeURIComponent(username)}/edit` } }
              : { nativeButtonProps: { type: "button" as const, disabled: true } })}
          >
            Éditer
          </Button>
          <Aide>
            {editable
              ? "Corriger les champs de cette fiche, et son identifiant s'il a été fabriqué ici."
              : (raisonNonEditable ?? "")}
          </Aide>
        </span>

        <span className={style["geste"]}>
          <Button
            className={fr.cx("fr-mr-1v")}
            priority="tertiary no outline"
            size="small"
            nativeButtonProps={modaleAppartenance.buttonProps}
          >
            {surcharge ? "Changer l'appartenance" : "Forcer l'appartenance"}
          </Button>
          <Aide>
            {
              "Décider à quel titre cette personne relève de l'incubateur, contre ou faute de rattachement constaté. Ne coupe aucun accès."
            }
          </Aide>
        </span>
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
