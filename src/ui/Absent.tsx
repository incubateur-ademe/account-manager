import { fr } from "@codegouvfr/react-dsfr";

/**
 * Ce qu'on affiche là où une valeur manque, pour que l'absence se lise comme une absence et non
 * comme une donnée. La mention se précise quand le mot doit s'accorder, ou quand « non renseigné »
 * dirait moins que ce que la colonne attend.
 */
export function Absent({ mention = "non renseigné" }: { mention?: string }) {
  return <span className={fr.cx("fr-hint-text")}>{mention}</span>;
}
