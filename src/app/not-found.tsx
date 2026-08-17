import { fr } from "@codegouvfr/react-dsfr";
import { ButtonsGroup } from "@codegouvfr/react-dsfr/ButtonsGroup";
import DocumentSearch from "@codegouvfr/react-dsfr/picto/DocumentSearch";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page non trouvée" };

export default function PageNonTrouvee() {
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
          <h1>Page non trouvée</h1>
          <p className={fr.cx("fr-text--sm", "fr-mb-3w")}>Erreur 404</p>
          <p className={fr.cx("fr-text--lead", "fr-mb-3w")}>
            La page demandée n'existe pas, ou n'existe plus.
          </p>
          <p className={fr.cx("fr-text--sm", "fr-mb-5w")}>
            Si vous avez saisi l'adresse à la main, vérifiez-la. Si vous suivez un lien reçu il y a
            quelque temps, la personne ou le constat qu'il désignait a pu sortir du référentiel
            depuis : un constat se referme dès qu'une collecte ne le vérifie plus. Le tableau de
            bord donne l'état du jour.
          </p>
          <ButtonsGroup
            inlineLayoutWhen="md and up"
            buttons={[
              { children: "Retour à l'accueil", linkProps: { href: "/" } },
              {
                children: "Personnes suivies",
                priority: "secondary",
                linkProps: { href: "/personnes" },
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
          <DocumentSearch className={fr.cx("fr-responsive-img")} />
        </div>
      </div>
    </main>
  );
}
