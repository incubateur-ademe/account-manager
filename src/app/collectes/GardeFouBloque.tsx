"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState, useId } from "react";

import type { BlocageInstalle } from "@/core/collecte";
import { messageObligatoire } from "@/ui/validation";

import { autoriserDatation, type EtatAutorisation } from "./actions";
import { REDACTION } from "./redaction";

/**
 * Un garde-fou dont le blocage tient depuis assez de passages ne décrit plus un
 * incident : il décrit un état que son propre refus entretient. Les données périmées
 * déclenchent la chute, la chute interdit de les dater comme disparues, et rien n'en
 * sort. Ce qui se compte en passages n'est pas le même d'une famille à l'autre, et
 * c'est la rédaction de chacune qui le dit : un système cible refuse à l'identique, le
 * plancher du périmètre laisse vieillir le relevé qui lui sert de référence.
 *
 * L'écran le dit, et offre d'en sortir une fois. Il ne le fait pas tout seul : une
 * chute peut aussi venir d'un système qui répond mal plusieurs nuits d'affilée, et
 * lever le garde-fou automatiquement ferait disparaître des accès bien vivants.
 *
 * Le formulaire poste les nombres qu'il affiche parce qu'une décision porte l'ampleur
 * qu'on avait sous les yeux, et sur elle seule. Ils ne sont pas crus sur parole : cette
 * page ne se rafraîchit pas, un passage de nuit peut avoir creusé la chute depuis
 * qu'elle est ouverte, et l'action les recalcule et refuse ce qui ne correspond plus.
 */
export function GardeFouBloque({ blocage }: { blocage: BlocageInstalle }) {
  const redaction = REDACTION[blocage.famille];
  const idRaison = useId();
  const [etat, formAction, pending] = useActionState<EtatAutorisation, FormData>(
    autoriserDatation,
    null,
  );

  return (
    <Alert
      className={fr.cx("fr-mb-3w")}
      severity="warning"
      title={`Sur ${blocage.provider}, plus aucune disparition ${redaction.quoi} n'est datée`}
      description={
        <>
          <p className={fr.cx("fr-mb-1w")}>{redaction.constat(blocage)}</p>
          <p className={fr.cx("fr-mb-1w")}>{redaction.consequence}</p>

          <form action={formAction}>
            <input type="hidden" name="provider" value={blocage.provider} />
            <input type="hidden" name="famille" value={blocage.famille} />
            <input type="hidden" name="observe" value={blocage.observe} />
            <input type="hidden" name="reference" value={blocage.reference} />

            <div className={fr.cx("fr-input-group")}>
              <label className={fr.cx("fr-label")} htmlFor={idRaison}>
                Pourquoi cette chute est légitime
                <span className={fr.cx("fr-hint-text")}>{redaction.suite}</span>
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
