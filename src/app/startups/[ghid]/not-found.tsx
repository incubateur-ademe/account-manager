import { fr } from "@codegouvfr/react-dsfr";
import Link from "next/link";

export default function StartupIntrouvable() {
  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Startup introuvable</h1>
      <p className={fr.cx("fr-text--lead")}>
        Aucune startup connue ne porte cet identifiant. Elle n'a peut-être jamais été collectée pour
        cet incubateur, ou son ghid a changé côté beta.gouv.
      </p>
      <p>
        Les identifiants sont en minuscules, et cette adresse est sensible à la casse : une
        majuscule de trop suffit à ne rien trouver, sans que rien ne soit en panne.
      </p>
      <Link className={fr.cx("fr-link")} href="/startups">
        Revenir à la liste des startups
      </Link>
    </main>
  );
}
