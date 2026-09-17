import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";

import type { RemiseDeCredential } from "@/lib/execution";

import { LIBELLE_REMISE } from "./redaction-execution";

/**
 * Ce qu'une valeur à recopier vaut à l'écran, et rien de plus.
 *
 * Du texte, jamais un champ : une valeur de formulaire serait renvoyée au serveur à la
 * soumission suivante, et rejouée telle quelle par la revalidation. Elle ne prend pas
 * d'attribut non plus, ni `title`, ni `aria-label`, ni `data-`, que la première
 * capture d'écran d'un défaut ou le premier vidage de DOM emporterait.
 */
function ValeurARecopier({ intitule, valeur }: { intitule: string; valeur: string }) {
  return (
    <>
      <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>{intitule}</p>
      <pre
        className={fr.cx("fr-text--xs", "fr-mb-2w")}
        style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
      >
        <code>{valeur}</code>
      </pre>
    </>
  );
}

function Remise({ remise }: { remise: RemiseDeCredential }) {
  return (
    <>
      <Alert
        className={fr.cx("fr-mt-2w")}
        severity="warning"
        title={LIBELLE_REMISE.titre}
        description={
          <>
            <p>{LIBELLE_REMISE.unSeulAffichage}</p>
            <p>{LIBELLE_REMISE.aRemettre}</p>
            <p>{LIBELLE_REMISE.perdue}</p>
            <p className={fr.cx("fr-text--bold", "fr-mb-1v")}>{remise.label}</p>
            <ValeurARecopier intitule={LIBELLE_REMISE.cle} valeur={remise.aRemettre} />
            {remise.echecDeRangement === undefined ? (
              <p className={fr.cx("fr-text--sm", "fr-mb-0")}>
                {LIBELLE_REMISE.registre(remise.key)}
              </p>
            ) : null}
          </>
        }
      />

      {remise.echecDeRangement === undefined ? null : (
        <Alert
          className={fr.cx("fr-mt-2w")}
          severity="error"
          title={LIBELLE_REMISE.echec.titre}
          description={
            <>
              <p>{LIBELLE_REMISE.echec.raison(remise.echecDeRangement)}</p>
              <p>{LIBELLE_REMISE.echec.seuleCopie}</p>
              {remise.blob === undefined ? null : (
                <ValeurARecopier intitule={LIBELLE_REMISE.echec.jeton} valeur={remise.blob} />
              )}
            </>
          }
        />
      )}
    </>
  );
}

/**
 * La moitié périssable de ce qu'un passage vient d'émettre, montrée une seule fois.
 *
 * Vide sur la quasi-totalité des passages, et c'est la forme normale : seule une étape
 * qui fabrique un credential remet quelque chose.
 */
export function Remises({ remises }: { remises: readonly RemiseDeCredential[] }) {
  return (
    <>
      {remises.map((remise) => (
        <Remise key={remise.key} remise={remise} />
      ))}
    </>
  );
}
