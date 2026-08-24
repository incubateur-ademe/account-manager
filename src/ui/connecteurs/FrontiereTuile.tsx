"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { catchError, type ErrorInfo } from "next/error";

/**
 * Next ne promet pas que ce qui a été levé soit une `Error` : une tuile peut jeter
 * n'importe quoi, et la référence n'est lisible que si elle est bien là.
 */
function reference(erreur: unknown): string | undefined {
  return typeof erreur === "object" &&
    erreur !== null &&
    typeof (erreur as { digest?: unknown }).digest === "string"
    ? (erreur as { digest: string }).digest
    : undefined;
}

function Repli({ titre }: { titre: string }, { error }: ErrorInfo) {
  const citer = reference(error);

  return (
    <div className={fr.cx("fr-callout")}>
      <h3 className={fr.cx("fr-callout__title", "fr-text--lg")}>{titre}</h3>
      <p className={fr.cx("fr-callout__text", "fr-text--sm")}>
        Ce chiffre n'a pas pu s'afficher. Le reste de la page n'est pas concerné, et le détail est
        consigné dans les journaux du serveur.
        {citer ? (
          <>
            {" "}
            Référence à citer : <code>{citer}</code>.
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Le troisième filet, celui que `rendre-tuile` ne peut pas tendre : un noeud rendu par
 * une tuile qui lève pendant son propre rendu, après que la tuile a répondu. Sans cette
 * frontière, l'exception remonte jusqu'à `src/app/error.tsx` et remplace le tableau de
 * bord entier, files de travail comprises.
 *
 * Le message de l'erreur n'est jamais affiché : celui d'un appel échoué contient
 * parfois l'URL complète, jeton compris.
 */
export const FrontiereTuile = catchError(Repli);
