import { fr } from "@codegouvfr/react-dsfr";
import type { Metadata } from "next";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { suite } = await props.searchParams;
  const demandee = Array.isArray(suite) ? suite[0] : suite;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--center")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <h1>Connexion</h1>
          <p>
            Un lien de connexion vous est envoyé par courriel. Avec un identifiant beta.gouv, il
            part sur l'adresse déclarée dans votre fiche espace-membre ; avec une adresse, il part
            sur celle-ci, à condition qu'un dossier vous ait été ouvert.
          </p>
          <LoginForm suite={demandee} />
        </div>
      </div>
    </main>
  );
}
