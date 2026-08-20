"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useState } from "react";

import type { Suggestion } from "@/ui/ChampAvecListe";
import { TableCustom } from "@/ui/TableCustom";

import { Rattacher } from "./Rattacher";

export interface LigneCompteIsole {
  id: string;
  provider: string;
  handle: string;
  ressemblance: boolean;
  acces: readonly string[];
  vuDepuis: string;
  vuEncore: string;
}

const modale = createModal({ id: "traiter-compte-isole", isOpenedByDefault: false });

/**
 * Les deux formulaires vivent dans une modale, et non dans chaque ligne.
 *
 * Dépliés, ils portaient leurs deux libellés et leurs deux textes d'aide sur chacune
 * des treize lignes, pour des hauteurs de près de trois cents pixels. La modale les
 * dit une fois.
 *
 * Elle porte aussi les accès constatés du compte : c'est en les regardant qu'on
 * décide, et les laisser dans la ligne obligerait à les mémoriser avant de cliquer.
 */
export function FileDesComptesIsoles({
  lignes,
  cibles,
}: {
  lignes: readonly LigneCompteIsole[];
  cibles: readonly Suggestion[];
}) {
  const [choisi, setChoisi] = useState<LigneCompteIsole | null>(null);

  return (
    <>
      <TableCustom
        header={[
          { children: "Système" },
          { children: "Compte" },
          { children: "Accès constatés" },
          { children: "Vu" },
          { children: "" },
        ]}
        body={lignes.map((ligne) => [
          { children: ligne.provider },
          {
            children: (
              <span>
                <strong>{ligne.handle}</strong>
                {ligne.ressemblance ? (
                  <>
                    <br />
                    <Badge severity="warning" small noIcon>
                      Ressemblance non confirmée
                    </Badge>
                  </>
                ) : null}
              </span>
            ),
          },
          {
            children: (
              <span className={fr.cx("fr-text--sm")}>
                {ligne.acces.length === 0 ? "aucun" : ligne.acces.join(", ")}
              </span>
            ),
          },
          {
            children: (
              <span className={fr.cx("fr-text--sm")}>
                depuis le {ligne.vuDepuis}
                <br />
                encore le {ligne.vuEncore}
              </span>
            ),
          },
          {
            children: (
              <Button
                priority="secondary"
                size="small"
                nativeButtonProps={{
                  ...modale.buttonProps,
                  onClick: () => {
                    setChoisi(ligne);
                  },
                }}
              >
                Traiter
              </Button>
            ),
          },
        ])}
      />

      <modale.Component title="À qui appartient ce compte" size="large">
        {choisi === null ? null : (
          <>
            <p className={fr.cx("fr-mb-1w")}>
              <strong>
                {choisi.provider} : {choisi.handle}
              </strong>
              {choisi.ressemblance ? (
                <>
                  {" "}
                  <Badge severity="warning" small noIcon>
                    Ressemblance non confirmée
                  </Badge>
                </>
              ) : null}
            </p>
            <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>
              Accès constatés : {choisi.acces.length === 0 ? "aucun" : choisi.acces.join(", ")}.
              Observé depuis le {choisi.vuDepuis}, encore le {choisi.vuEncore}.
            </p>
            <p className={fr.cx("fr-text--sm")}>
              Un compte rattaché à la main l'est de façon sûre, et pourra donc justifier une
              révocation : c'est un jugement, il est journalisé avec votre nom. Le plus souvent il
              manque une fiche, plutôt qu'il ne faut retirer un accès.
            </p>
            <Rattacher key={choisi.id} id={choisi.id} cibles={cibles} onSucces={modale.close} />
          </>
        )}
      </modale.Component>
    </>
  );
}
