import { fr } from "@codegouvfr/react-dsfr";

const LONGUEUR_RESUME = 60;

interface DetailJsonProps {
  titre: string;
  valeur: unknown;
}

/**
 * Un `details` natif plutôt qu'un accordéon DSFR : le journal doit rester utilisable
 * sans JavaScript, et une charge de collecte fait plusieurs kilo-octets une fois
 * dépliée, ce que la hauteur bornée empêche de faire déborder la ligne du tableau.
 */
export function DetailJson({ titre, valeur }: DetailJsonProps) {
  if (valeur === null || valeur === undefined) {
    return null;
  }

  const compact = JSON.stringify(valeur);
  const resume =
    compact.length > LONGUEUR_RESUME ? `${compact.slice(0, LONGUEUR_RESUME)}…` : compact;

  return (
    <details>
      <summary className={fr.cx("fr-text--sm")}>
        {titre} <span className={fr.cx("fr-text--xs")}>{resume}</span>
      </summary>
      <pre
        className={fr.cx("fr-text--xs")}
        style={{
          margin: 0,
          maxHeight: "18rem",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {JSON.stringify(valeur, null, 2)}
      </pre>
    </details>
  );
}
