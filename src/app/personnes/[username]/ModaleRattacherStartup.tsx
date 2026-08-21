"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import style from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";

import { RattacherStartup, type StartupProposable } from "./RattacherStartup";

/**
 * Exportée : le bloc « Ce qu'il y a à faire » ouvre cette modale plutôt que d'en
 * déclarer une seconde, sans quoi le formulaire et son explication vivraient en deux
 * exemplaires sur le même écran.
 */
export const modaleRattacherStartup = createModal({
  id: "rattacher-startup",
  isOpenedByDefault: false,
});

/**
 * Rattacher est une action de section, pas de page : son bouton vit dans l'en-tête de
 * la section Startups, là où on le cherche, et son formulaire cesse d'occuper un
 * tiers de la fiche.
 */
export function ModaleRattacherStartup({
  username,
  missionEnd,
  startups,
}: {
  username: string;
  missionEnd: string | null;
  startups: readonly StartupProposable[];
}) {
  return (
    <>
      <span className={style["geste"]}>
        <Button
          className={fr.cx("fr-mr-1v")}
          priority="secondary"
          size="small"
          nativeButtonProps={modaleRattacherStartup.buttonProps}
        >
          Rattacher à une startup
        </Button>
        <Aide>
          {
            "Rattacher cette personne à une startup par une décision datée, qui survit aux collectes et porte le nom de qui l'a prise. Peut repousser son échéance."
          }
        </Aide>
      </span>

      <modaleRattacherStartup.Component title="Rattacher à une startup" size="large">
        <p className={fr.cx("fr-text--sm")}>
          Un rattachement manuel porte obligatoirement une date de fin et le nom de qui l'a posé. Il
          survit aux collectes, contrairement aux startups collectées, que l'espace-membre réécrit à
          chaque passage.
        </p>
        <RattacherStartup
          username={username}
          missionEnd={missionEnd}
          startups={startups}
          onSucces={modaleRattacherStartup.close}
        />
      </modaleRattacherStartup.Component>
    </>
  );
}
