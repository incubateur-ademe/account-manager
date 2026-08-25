"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { FormulaireOuverture } from "@/app/dossiers/FormulaireOuverture";
import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import style from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";

/**
 * Hors du composant, et une par sens : `createModal` enregistre la modale une fois
 * pour toutes, sous un identifiant qui doit rester unique dans la page.
 *
 * Elles restent locales à l'en-tête : le bloc « Ce qu'il y a à faire » déclare la
 * sienne, faute de quoi la fermeture rendrait le focus au bouton d'ici, qui est
 * rendu avant lui.
 */
const MODALES_DE_DOSSIER: Record<SensDossier, ReturnType<typeof createModal>> = {
  ONBOARDING: createModal({ id: "preparer-arrivee", isOpenedByDefault: false }),
  OFFBOARDING: createModal({ id: "preparer-depart", isOpenedByDefault: false }),
};

/**
 * Le geste passe par une confirmation, parce que rien ne le défait.
 *
 * Sans elle, le premier clic emmène sur un dossier qu'on n'a pas encore décidé
 * d'ouvrir, et le doute qui suit fait recliquer : le dossier ne se dédouble pas,
 * mais on ne l'apprend qu'après coup.
 */
export function BoutonDossier({
  username,
  sens,
  priorite = "primary",
}: {
  username: string;
  sens: SensDossier;
  priorite?: "primary" | "secondary";
}) {
  const mots = LIBELLE_DOSSIER[sens];
  const modale = MODALES_DE_DOSSIER[sens];

  return (
    <>
      <span className={style["geste"]}>
        <Button
          className={fr.cx("fr-mr-1v")}
          priority={priorite}
          size="small"
          nativeButtonProps={modale.buttonProps}
        >
          {mots.ouvrir}
        </Button>
        <Aide>{mots.aideOuverture}</Aide>
      </span>

      <modale.Component title={mots.ouvrir}>
        <FormulaireOuverture username={username} sens={sens} />
      </modale.Component>
    </>
  );
}
