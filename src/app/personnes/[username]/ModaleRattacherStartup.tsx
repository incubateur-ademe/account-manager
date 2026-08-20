"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";

import { RattacherStartup, type StartupProposable } from "./RattacherStartup";

const modale = createModal({ id: "rattacher-startup", isOpenedByDefault: false });

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
      <Button priority="secondary" size="small" nativeButtonProps={modale.buttonProps}>
        Rattacher à une startup
      </Button>

      <modale.Component title="Rattacher à une startup" size="large">
        <p className={fr.cx("fr-text--sm")}>
          Un rattachement manuel porte obligatoirement une date de fin et le nom de qui l'a posé. Il
          survit aux collectes, contrairement aux startups collectées, que l'espace-membre réécrit à
          chaque passage.
        </p>
        <RattacherStartup
          username={username}
          missionEnd={missionEnd}
          startups={startups}
          onSucces={modale.close}
        />
      </modale.Component>
    </>
  );
}
