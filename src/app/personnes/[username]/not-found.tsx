import { fr } from "@codegouvfr/react-dsfr";
import Link from "next/link";

export default function PersonneIntrouvable() {
  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Personne introuvable</h1>
      <p className={fr.cx("fr-text--lead")}>
        Aucune personne suivie ne porte ce username. Elle n'a peut-être jamais été collectée, ou son
        username a changé côté beta.gouv.
      </p>
      <Link className={fr.cx("fr-link")} href="/personnes">
        Revenir à la liste des personnes
      </Link>
    </main>
  );
}
