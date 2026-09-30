import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";

import { type Masse, refusDeMasse } from "@/core/plan";
import { dateLocale } from "@/ui/dates";

import { BoutonExecuter } from "./Pointage";
import { LIBELLE_LANCEMENT } from "./redaction-execution";

export interface Echeance {
  id: string;
  label: string;
  terme: Date;
}

/**
 * Hors de l'empreinte, donc invisible à la confrontation qui garde l'exécution :
 * l'échéance se lit avant le lancement ou ne se lit pas du tout.
 */
export function echeancesDuPlan(
  etapes: readonly { id: string; label: string; grantExpiresAt: Date | null }[],
): Echeance[] {
  return etapes.flatMap((etape) =>
    etape.grantExpiresAt ? [{ id: etape.id, label: etape.label, terme: etape.grantExpiresAt }] : [],
  );
}

/**
 * Ce qu'un opérateur lit avant de lancer un plan confirmé, et le bouton qui le lance.
 *
 * Le niveau de titre suit l'écran qui le porte : une section à part sur celui d'un
 * dossier, une sous-section du geste sur la fiche d'une personne. La priorité du bouton
 * aussi : une fiche peut porter plusieurs gestes et un brouillon à confirmer, et un écran
 * n'a qu'un bouton primaire.
 */
export function Lancement({
  planId,
  masse,
  simulation,
  echeances,
  niveau,
  priorite,
}: {
  planId: string;
  masse: Masse;
  simulation: boolean;
  echeances: readonly Echeance[];
  niveau: 2 | 3;
  priorite: "primary" | "secondary";
}) {
  const Titre = niveau === 2 ? "h2" : "h3";
  const titreDAlerte = niveau === 2 ? "h3" : "h4";

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <Titre className={fr.cx(niveau === 2 ? "fr-h5" : "fr-h6")}>
        {simulation ? LIBELLE_LANCEMENT.titre.simulation : LIBELLE_LANCEMENT.titre.reel}
      </Titre>

      {/* Avant le bouton et non après : une simulation qui ressemble à une
          exécution réussie est un mensonge, et l'opérateur doit lire ce que son
          clic fera avant de le faire. */}
      {simulation ? (
        <Alert
          as={titreDAlerte}
          severity="info"
          className={fr.cx("fr-mb-2w")}
          small
          title={LIBELLE_LANCEMENT.simulation.titre}
          description={LIBELLE_LANCEMENT.simulation.description}
        />
      ) : (
        <Alert
          as={titreDAlerte}
          severity="warning"
          className={fr.cx("fr-mb-2w")}
          small
          title={LIBELLE_LANCEMENT.reel.titre}
          description={LIBELLE_LANCEMENT.reel.description}
        />
      )}

      <p className={fr.cx("fr-text--sm")}>{LIBELLE_LANCEMENT.verification}</p>

      {echeances.length > 0 ? (
        <>
          <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>{LIBELLE_LANCEMENT.termes}</p>
          <ul className={fr.cx("fr-text--sm")}>
            {echeances.map(({ id, label, terme }) => (
              <li key={id}>
                {label} : jusqu'au {dateLocale.format(terme)}.
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={fr.cx("fr-text--sm")}>
        {masse.executables === 0
          ? LIBELLE_LANCEMENT.masse.aucune
          : LIBELLE_LANCEMENT.masse.quelques(masse.executables, masse.seuil)}
      </p>

      <BoutonExecuter
        planId={planId}
        masse={masse}
        raisonDeMasse={refusDeMasse(masse, false)}
        simulation={simulation}
        priorite={priorite}
        titreDAlerte={titreDAlerte}
      />
    </section>
  );
}
