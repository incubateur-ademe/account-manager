"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useActionState } from "react";
import { type EtatDossier, ouvrirArrivee, ouvrirDepart } from "@/app/dossiers/actions";
import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import style from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";

// Hors du composant, et une par sens : `createModal` enregistre la modale une fois
// pour toutes, sous un identifiant qui doit rester unique dans la page.
const MODALES: Record<SensDossier, ReturnType<typeof createModal>> = {
  ONBOARDING: createModal({ id: "preparer-arrivee", isOpenedByDefault: false }),
  OFFBOARDING: createModal({ id: "preparer-depart", isOpenedByDefault: false }),
};

const OUVERTURE = {
  ONBOARDING: ouvrirArrivee,
  OFFBOARDING: ouvrirDepart,
} as const;

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
  const [etat, formAction, pending] = useActionState<EtatDossier | null, FormData>(
    OUVERTURE[sens],
    null,
  );
  const mots = LIBELLE_DOSSIER[sens];
  const modale = MODALES[sens];

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
        <p className={fr.cx("fr-text--sm")}>{mots.ouvertureExplication}</p>
        <p className={fr.cx("fr-text--sm")}>
          Le geste est tracé à votre nom. Si un dossier de ce sens est déjà ouvert sur cette
          personne, vous y serez ramené plutôt que d'en créer un second.
        </p>

        <form action={formAction}>
          <input type="hidden" name="username" value={username} />
          <Button type="submit" priority="primary" disabled={pending}>
            {pending ? "Calcul du plan…" : "Ouvrir le dossier"}
          </Button>
          {etat?.erreur ? (
            <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
              {etat.erreur}
            </p>
          ) : null}
        </form>
      </modale.Component>
    </>
  );
}
