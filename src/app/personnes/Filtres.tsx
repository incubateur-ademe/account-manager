import { fr } from "@codegouvfr/react-dsfr";

import { VUES, type Vue } from "@/core/tri-personnes";

interface FiltresProps {
  vue: Vue;
  recherche: string;
  /** Reconduits en champs cachés : le tri se pilote par les en-têtes de colonnes. */
  tri: string;
  sens: string;
}

/**
 * Formulaire en GET : l'état de la liste tient dans l'URL, donc il se partage et
 * se met en favori. Aucun JavaScript n'est nécessaire pour s'en servir.
 */
export function Filtres({ vue, recherche, tri, sens }: FiltresProps) {
  return (
    <form method="get" className={fr.cx("fr-mb-4w")}>
      <input type="hidden" name="tri" value={tri} />
      <input type="hidden" name="sens" value={sens} />
      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-grid-row--bottom")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
          <search className={fr.cx("fr-search-bar")}>
            <label className={fr.cx("fr-label")} htmlFor="recherche">
              Rechercher
            </label>
            <input
              className={fr.cx("fr-input")}
              id="recherche"
              name="q"
              type="search"
              defaultValue={recherche}
              placeholder="Nom ou identifiant"
            />
          </search>
        </div>

        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <div className={fr.cx("fr-select-group")}>
            <label className={fr.cx("fr-label")} htmlFor="vue">
              Afficher
            </label>
            <select className={fr.cx("fr-select")} id="vue" name="vue" defaultValue={vue}>
              {VUES.map((option) => (
                <option key={option.valeur} value={option.valeur}>
                  {option.libelle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={fr.cx("fr-col-12", "fr-col-md-2")}>
          <button type="submit" className={fr.cx("fr-btn", "fr-btn--secondary")}>
            Appliquer
          </button>
        </div>
      </div>
    </form>
  );
}
