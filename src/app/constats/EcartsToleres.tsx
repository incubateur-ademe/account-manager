"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";

import { TableCustom } from "@/ui/TableCustom";

import { type EtatTolerance, leverDerogation } from "./actions";

export interface LigneTolerance {
  id: string;
  /** Ce que la cible désigne, en clair : un identifiant de fournisseur ne se lit pas. */
  cible: string;
  /** Vrai quand plus rien n'est observé sous cette cible, donc quand elle ne couvre rien. */
  introuvable: boolean;
  raison: string;
  responsable: string;
  permanente: boolean;
  jusquAu: string | null;
}

function Levee({ id }: { id: string }) {
  const [etat, formAction, pending] = useActionState<EtatTolerance, FormData>(
    leverDerogation,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="derogationId" value={id} />
      <Button type="submit" priority="tertiary" size="small" disabled={pending}>
        {pending ? "Levée…" : "Lever"}
      </Button>
      {etat ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v", "fr-mb-0")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Le registre vit sous la file plutôt que derrière une entrée de menu.
 *
 * Un mécanisme de silence se lit là où vit le bruit qu'il fait taire : un écran séparé se
 * visite une fois, puis s'oublie, et des tolérances oubliées sont exactement ce que
 * l'échéance existe pour empêcher.
 */
export function EcartsToleres({ lignes }: { lignes: readonly LigneTolerance[] }) {
  if (lignes.length === 0) {
    return null;
  }

  return (
    <section className={fr.cx("fr-mt-6w")} id="toleres">
      <h2 className={fr.cx("fr-h6")}>Écarts tolérés</h2>
      <p className={fr.cx("fr-text--sm")}>
        Ces écarts ne remontent plus dans la file tant que leur tolérance court. Chacun y revient de
        lui-même le lendemain du dernier jour couvert, sans que personne ait à s'en souvenir.
      </p>

      <TableCustom
        header={[
          { children: "Ce qui est toléré" },
          { children: "Pourquoi" },
          { children: "Qui répond" },
          { children: "Jusqu'au" },
          { children: "" },
        ]}
        body={lignes.map((ligne) => ({
          key: ligne.id,
          row: [
            {
              children: (
                <span>
                  {ligne.cible}
                  {ligne.introuvable ? (
                    <>
                      {" "}
                      <Badge severity="warning" noIcon small>
                        plus rien d'observé
                      </Badge>
                    </>
                  ) : null}
                </span>
              ),
            },
            { children: ligne.raison },
            { children: ligne.responsable },
            {
              children: ligne.permanente ? (
                <Badge severity="info" noIcon small>
                  déclarée en politique
                </Badge>
              ) : (
                ligne.jusquAu
              ),
            },
            // Une cellule vide plutôt qu'aucune : `TableCustom` retire celles dont le
            // contenu vaut `null`, et une ligne à quatre cellules sous cinq en-têtes
            // désaligne les colonnes pour qui lit la table autrement qu'à l'œil.
            { children: ligne.permanente ? "" : <Levee id={ligne.id} /> },
          ],
        }))}
      />
    </section>
  );
}
