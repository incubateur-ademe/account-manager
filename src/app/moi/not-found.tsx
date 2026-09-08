import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import DocumentSearch from "@codegouvfr/react-dsfr/picto/DocumentSearch";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page non trouvée" };

/**
 * Le 404 de qui n'est pas de l'équipe, et il ne renvoie que là où il peut aller : le
 * 404 général offre l'accueil et les personnes suivies, deux écrans qui le ramèneraient
 * ici.
 *
 * Il ne dit rien du dossier demandé, et c'est le point : `/moi/dossiers/[id]` refuse par
 * `notFound` aussi bien l'identifiant mal recopié que le dossier d'autrui, et une page
 * qui distinguerait les deux apprendrait qu'un dossier existe à qui n'y a pas droit.
 * Les phrases sont donc écrites pour être vraies dans les deux cas.
 */
export default function PageNonTrouveeDuParticipant() {
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
          <p className={fr.cx("fr-text--lead", "fr-mb-3w")}>Cette page n'existe pas.</p>
          <p className={fr.cx("fr-text--sm", "fr-mb-5w")}>
            Si vous avez saisi l'adresse à la main, vérifiez-la. Votre espace liste les dossiers qui
            vous sont ouverts, avec la date à laquelle chaque accès s'arrête.
          </p>
          <Button linkProps={{ href: "/moi" }}>Revenir à mon espace</Button>
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
