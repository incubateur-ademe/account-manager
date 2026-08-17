import { fr } from "@codegouvfr/react-dsfr";
import Link from "next/link";

import type { Colonne, Sens } from "@/core/tri-personnes";

interface EnteteTriProps {
  libelle: string;
  colonne: Colonne;
  colonneActive: Colonne;
  sens: Sens;
  parametres: Record<string, string>;
}

export function EnteteTri({ libelle, colonne, colonneActive, sens, parametres }: EnteteTriProps) {
  const active = colonne === colonneActive;
  // Recliquer sur la colonne active inverse le sens ; passer à une autre colonne
  // repart en croissant, sinon on hérite d'un sens qui n'a rien à voir.
  const prochainSens: Sens = active && sens === "asc" ? "desc" : "asc";

  const query = new URLSearchParams({ ...parametres, tri: colonne, sens: prochainSens });

  return (
    <Link
      href={`/personnes?${query.toString()}`}
      className={fr.cx("fr-link", "fr-link--sm")}
      aria-sort={active ? (sens === "asc" ? "ascending" : "descending") : "none"}
    >
      {libelle}
      {active ? <span aria-hidden="true">{sens === "asc" ? " ▲" : " ▼"}</span> : null}
    </Link>
  );
}
