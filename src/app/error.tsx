"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { ButtonsGroup } from "@codegouvfr/react-dsfr/ButtonsGroup";
import TechnicalError from "@codegouvfr/react-dsfr/picto/TechnicalError";
import { useEffect } from "react";

export default function ErreurApplication({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Erreur non rattrapée", error);
  }, [error]);

  return (
    <main className={fr.cx("fr-container")}>
      <div
        className={fr.cx(
          "fr-my-7w",
          "fr-mt-md-12w",
          "fr-mb-md-10w",
          "fr-grid-row",
          "fr-grid-row--gutters",
          "fr-grid-row--middle",
          "fr-grid-row--center",
        )}
      >
        <div className={fr.cx("fr-py-0", "fr-col-12", "fr-col-md-6")}>
          <h1>Cette page n'a pas pu s'afficher</h1>
          <p className={fr.cx("fr-text--sm", "fr-mb-3w")}>Erreur technique</p>
          <p className={fr.cx("fr-text--lead", "fr-mb-3w")}>
            Le problème vient de l'application, pas de votre poste. Rien de ce qui est affiché ici
            ne doit être tenu pour l'état réel des comptes.
          </p>
          <p className={fr.cx("fr-text--sm", "fr-mb-3w")}>
            Réessayez : la page est rechargée depuis le serveur, et la plupart de ces erreurs sont
            passagères. Si elle revient, repartez du tableau de bord, puis signalez-la au mainteneur
            en indiquant l'heure et la référence ci-dessous. Le détail de l'erreur est consigné dans
            les journaux du serveur, jamais à l'écran.
          </p>
          {error.digest ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-5w")}>
              Référence à citer : <code>{error.digest}</code>
            </p>
          ) : null}
          <ButtonsGroup
            inlineLayoutWhen="md and up"
            buttons={[
              { children: "Réessayer", iconId: "fr-icon-refresh-line", onClick: () => retry() },
              {
                children: "Retour à l'accueil",
                priority: "secondary",
                linkProps: { href: "/" },
              },
            ]}
          />
        </div>
        <div
          className={fr.cx(
            "fr-py-0",
            "fr-col-12",
            "fr-col-md-3",
            "fr-col-offset-md-1",
            "fr-px-6w",
            "fr-px-md-0",
          )}
        >
          <TechnicalError className={fr.cx("fr-responsive-img")} />
        </div>
      </div>
    </main>
  );
}
