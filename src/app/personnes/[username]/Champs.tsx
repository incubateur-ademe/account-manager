import { fr } from "@codegouvfr/react-dsfr";
import type { ReactNode } from "react";

export function Champ({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
      <dt className={fr.cx("fr-text--sm", "fr-mb-0")}>{libelle}</dt>
      <dd className={fr.cx("fr-text--bold", "fr-ml-0")}>{children}</dd>
    </div>
  );
}

export function Absent({ mention = "non renseigné" }: { mention?: string }) {
  return <span className={fr.cx("fr-hint-text")}>{mention}</span>;
}
