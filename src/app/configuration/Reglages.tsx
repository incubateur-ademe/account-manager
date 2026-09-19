"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { Table } from "@codegouvfr/react-dsfr/Table";
import { useActionState, useState } from "react";

import type { Forme } from "@/core/configuration";
import { useCleDOuverture, useFermetureApresSucces } from "@/ui/modale";

import { type EtatReglage, leverUnReglage, reglerUneValeur } from "./actions";

export interface LigneDeReglage {
  chemin: string;
  variable: string;
  forme: Forme;
  valeur: string;
  niveau: "base" | "environnement" | "fichier" | "defaut";
  severite: "success" | "info" | "new";
  provenance: string;
}

/**
 * Une seule modale pour onze réglages, et non un champ de saisie par ligne.
 *
 * Le champ, son aide et ses deux boutons portaient chaque ligne à 164 pixels, pour un
 * tableau de 1858 qui occupait les deux tiers de l'écran. Un réglage se change
 * rarement, la liste est ce qu'on vient lire. C'est aussi la règle que le lot
 * d'interface a posée : une ligne de tableau porte un bouton, jamais une saisie.
 *
 * Une modale par ligne ferait onze enregistrements sous onze identifiants ; celle-ci
 * est unique et se paramètre sur le réglage choisi.
 */
const modale = createModal({ id: "regler-une-valeur", isOpenedByDefault: false });

export function Reglages({ lignes }: { lignes: readonly LigneDeReglage[] }) {
  const [choisi, setChoisi] = useState<LigneDeReglage | null>(null);
  const ouverture = useCleDOuverture(modale);

  return (
    <>
      <Table
        fixed
        caption="Réglages"
        headers={["Réglage", "Aujourd'hui", "D'où", "Régler"]}
        data={lignes.map((ligne) => [
          <span key="c">
            <strong>{ligne.chemin}</strong>
            <br />
            <span className={fr.cx("fr-text--sm")}>{ligne.variable}</span>
          </span>,
          <span key="v" className={fr.cx("fr-text--sm")}>
            {ligne.valeur}
          </span>,
          <Badge key="p" severity={ligne.severite} small noIcon>
            {ligne.provenance}
          </Badge>,
          <Button
            key="r"
            priority="tertiary"
            size="small"
            /* Le choix se pose avant l'ouverture : buttonProps porte data-fr-opened, que le
               script du DSFR lit au clic, donc la modale s'ouvre sur le réglage déjà retenu. */
            nativeButtonProps={{ ...modale.buttonProps, onClick: () => setChoisi(ligne) }}
          >
            Régler
          </Button>,
        ])}
      />

      <modale.Component titleAs="h2" title={choisi ? choisi.chemin : "Régler une valeur"}>
        {choisi ? <Regler key={`${ouverture}:${choisi.chemin}`} ligne={choisi} /> : null}
      </modale.Component>
    </>
  );
}

/**
 * Les deux états d'action vivent ici, et non dans `Reglages`, pour que la clé de montage
 * les emporte. Remontés d'un cran, ils survivraient au changement de réglage et le champ
 * afficherait le refus du précédent.
 *
 * La ligne est un instantané pris au clic, que la revalidation de l'écran ne suit pas.
 * Rester ouvert sur un réglage levé, c'est donc proposer de le lever encore, pour
 * s'entendre répondre qu'il n'y a rien à lever. La fermeture rend cet instantané sans
 * objet, le geste suivant repartant de la ligne que le serveur vient de rendre.
 */
function Regler({ ligne }: { ligne: LigneDeReglage }) {
  const [etatReglage, poser, reglageEnCours] = useActionState<EtatReglage, FormData>(
    reglerUneValeur,
    null,
  );
  const [etatLevee, lever, leveeEnCours] = useActionState<EtatReglage, FormData>(
    leverUnReglage,
    null,
  );

  useFermetureApresSucces(reglageEnCours, etatReglage?.erreur, modale.close);
  useFermetureApresSucces(leveeEnCours, etatLevee?.erreur, modale.close);

  return (
    <>
      <form action={poser}>
        <input type="hidden" name="chemin" value={ligne.chemin} />
        <Input
          label="Valeur"
          hintText={ligne.forme === "liste" ? "séparées par des virgules" : ligne.forme}
          nativeInputProps={{ name: "valeur", defaultValue: ligne.valeur }}
          state={etatReglage?.erreur ? "error" : "default"}
          stateRelatedMessage={etatReglage?.erreur}
        />
        <Button priority="primary" type="submit">
          Régler
        </Button>
      </form>

      {/* Le bouton de levée seulement là où quelque chose se lève : proposer de lever
          ce qui n'est pas réglé ferait croire qu'on peut effacer le fichier depuis ici. */}
      {ligne.niveau === "base" ? (
        <form action={lever} className={fr.cx("fr-mt-2w")}>
          <input type="hidden" name="chemin" value={ligne.chemin} />
          <Button type="submit" priority="tertiary no outline">
            Rendre au fichier
          </Button>
          {etatLevee?.erreur === undefined ? null : (
            <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
              {etatLevee.erreur}
            </p>
          )}
        </form>
      ) : null}
    </>
  );
}
