"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState, useId } from "react";

import type { BlocageInstalle } from "@/core/collecte";
import { messageObligatoire } from "@/ui/validation";

import { autoriserDatation, type EtatAutorisation } from "./actions";

const QUOI = {
  identites: "des comptes",
  ressources: "des ressources",
} as const;

/**
 * Un garde-fou qui refuse la même chose depuis assez de passages ne décrit plus un
 * incident : il décrit un état que son propre refus entretient. Les données périmées
 * déclenchent la chute, la chute interdit de les dater comme disparues, et rien n'en
 * sort.
 *
 * L'écran le dit, et offre d'en sortir une fois. Il ne le fait pas tout seul : une
 * chute peut aussi venir d'un système qui répond mal plusieurs nuits d'affilée, et
 * lever le garde-fou automatiquement ferait disparaître des accès bien vivants.
 */
export function GardeFouBloque({ blocage }: { blocage: BlocageInstalle }) {
  const idRaison = useId();
  const [etat, formAction, pending] = useActionState<EtatAutorisation, FormData>(
    autoriserDatation,
    null,
  );

  return (
    <Alert
      className={fr.cx("fr-mb-3w")}
      severity="warning"
      title={`Sur ${blocage.provider}, plus aucune disparition ${QUOI[blocage.famille]} n'est datée`}
      description={
        <>
          <p className={fr.cx("fr-mb-1w")}>
            La dernière lecture en a rendu {blocage.observe} là où {blocage.reference} sont tenues
            pour vivantes, une chute que le garde-fou juge trop forte pour conclure. Il refuse à
            l'identique depuis {blocage.repetitions} passages : ce n'est plus un incident, et il ne
            se dénouera pas seul, puisque ce qu'il refuse de dater est justement ce qui provoque la
            chute.
          </p>
          <p className={fr.cx("fr-mb-1w")}>
            Tant que cela dure, une disparition réelle sur ce système ne sera pas constatée, et les
            accès qu'elle emporte resteront tenus pour vivants.
          </p>

          <form action={formAction}>
            <input type="hidden" name="provider" value={blocage.provider} />
            <input type="hidden" name="famille" value={blocage.famille} />

            <div className={fr.cx("fr-input-group")}>
              <label className={fr.cx("fr-label")} htmlFor={idRaison}>
                Pourquoi cette chute est légitime
                <span className={fr.cx("fr-hint-text")}>
                  Recopié au journal avec votre nom. La prochaine collecte datera les disparitions
                  de ce système, une fois, puis le garde-fou reprendra.
                </span>
              </label>
              <input
                className={fr.cx("fr-input")}
                id={idRaison}
                type="text"
                required
                {...messageObligatoire("Indiquez pourquoi cette chute est légitime.")}
                name="raison"
              />
            </div>

            {etat?.erreur ? (
              <p className={fr.cx("fr-error-text")} role="alert">
                {etat.erreur}
              </p>
            ) : null}

            <Button type="submit" priority="secondary" disabled={pending}>
              {pending ? "En cours…" : "Autoriser la prochaine collecte à dater"}
            </Button>
          </form>
        </>
      }
    />
  );
}
