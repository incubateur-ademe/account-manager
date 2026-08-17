import { fr } from "@codegouvfr/react-dsfr";
import Link from "next/link";

import { ACTEUR_SYSTEME, auMoinsUnFiltre, type Criteres } from "./criteres";
import { libelleAction, RESULTATS } from "./libelles";

interface FiltresProps {
  criteres: Criteres;
  acteurs: readonly string[];
  actions: readonly string[];
}

/**
 * Formulaire en GET : l'état du journal tient dans l'URL, donc il se partage et se
 * met en favori. Il ne reconduit pas la page, changer un filtre ramène au début.
 */
export function Filtres({ criteres, acteurs, actions }: FiltresProps) {
  const actionsProposees = actions.includes(criteres.action)
    ? actions
    : [...actions, criteres.action].filter((action) => action !== "");

  return (
    <form method="get" className={fr.cx("fr-mb-2w")}>
      {criteres.execution === "" ? null : (
        <input type="hidden" name="execution" value={criteres.execution} />
      )}

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-grid-row--bottom")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
          <div className={fr.cx("fr-select-group")}>
            <label className={fr.cx("fr-label")} htmlFor="acteur">
              Acteur
            </label>
            <select
              className={fr.cx("fr-select")}
              id="acteur"
              name="acteur"
              defaultValue={criteres.acteur}
            >
              <option value="">Tous</option>
              <option value={ACTEUR_SYSTEME}>Le système</option>
              {acteurs.map((acteur) => (
                <option key={acteur} value={acteur}>
                  {acteur}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <div className={fr.cx("fr-select-group")}>
            <label className={fr.cx("fr-label")} htmlFor="action">
              Action
            </label>
            <select
              className={fr.cx("fr-select")}
              id="action"
              name="action"
              defaultValue={criteres.action}
            >
              <option value="">Toutes</option>
              {actionsProposees.map((action) => (
                <option key={action} value={action}>
                  {libelleAction(action)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
          <div className={fr.cx("fr-select-group")}>
            <label className={fr.cx("fr-label")} htmlFor="resultat">
              Résultat
            </label>
            <select
              className={fr.cx("fr-select")}
              id="resultat"
              name="resultat"
              defaultValue={criteres.resultat}
            >
              <option value="">Tous</option>
              {RESULTATS.map((resultat) => (
                <option key={resultat.valeur} value={resultat.valeur}>
                  {resultat.libelle}
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

      {auMoinsUnFiltre(criteres) ? (
        <p className={fr.cx("fr-mt-2w", "fr-mb-0")}>
          <Link href="/journal" className={fr.cx("fr-link", "fr-link--sm")}>
            Retirer tous les filtres
          </Link>
        </p>
      ) : null}
    </form>
  );
}
