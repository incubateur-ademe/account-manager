"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import Link from "next/link";
import { useState } from "react";
import { ClotureConstat } from "@/app/constats/ClotureConstat";
import { FormulaireOuverture } from "@/app/dossiers/FormulaireOuverture";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import type { ChoixDeProfils } from "@/ui/profils";

import { modaleRattacherStartup } from "./ModaleRattacherStartup";
import type { Geste, MotifDAction } from "./motifs";

// Hors du composant : `createModal` enregistre la modale une fois pour toutes, et le
// bloc n'en ouvre qu'une à la fois. Les identifiants diffèrent de ceux de la file et
// de l'en-tête pour qu'un partage de chunk ne puisse pas enregistrer deux fois le
// même.
//
// Les boutons de geste portent les attributs d'ouverture du système de design plutôt
// que d'appeler `open()`. Sans eux, le système ne connaît d'autre déclencheur que le
// bouton caché que la modale monte elle-même, et rend le focus à un élément invisible
// à la fermeture. Leur identifiant est réécrit, sinon tous porteraient celui de la
// modale. Le bloc étant rendu avant la section Startups, son bouton est le premier
// déclencheur du document, donc celui à qui le focus revient.
//
// L'arrivée déclare la sienne pour cette raison même, plutôt que d'ouvrir celle de
// l'en-tête : l'en-tête est rendu avant le bloc, si bien que le focus reviendrait à
// son bouton, et l'opérateur reprendrait sa lecture au-dessus du motif qui l'avait
// appelé.
const modaleCloture = createModal({ id: "clore-constat-fiche", isOpenedByDefault: false });
const modaleArrivee = createModal({ id: "preparer-arrivee-fiche", isOpenedByDefault: false });

type GesteDeCloture = Extract<Geste, { nom: "clore" }>;

/**
 * Ce qui appelle un geste, et rien d'autre. Une information seulement notable qui
 * entrerait ici ferait apparaître le bloc sur chaque fiche, et un bloc qui paraît
 * partout ne signale plus rien.
 *
 * Composant client, comme la file des constats et pour la même raison : une modale du
 * système de design s'ouvre sur un état, et son identifiant doit rester unique dans la
 * page. Un bouton qui monterait chacun sa boîte de dialogue en poserait autant de même
 * identifiant.
 */
export function CeQuiAppelleUneAction({
  username,
  motifs,
  profils,
}: {
  username: string;
  motifs: readonly MotifDAction[];
  /** Les profils qu'une arrivée peut appliquer, lus par le serveur qui monte ce bloc. */
  profils: ChoixDeProfils;
}) {
  const [choisi, setChoisi] = useState<GesteDeCloture | null>(null);

  if (motifs.length === 0) {
    return null;
  }

  return (
    <section className={fr.cx("fr-mt-4w")} aria-labelledby="a-faire">
      <h2 className={fr.cx("fr-h5")} id="a-faire">
        Ce qu'il y a à faire
      </h2>
      {motifs.map((motif) => (
        <Alert
          key={motif.cle}
          className={fr.cx("fr-mb-2w")}
          severity={motif.severite}
          small
          description={
            <>
              <strong>{motif.titre}</strong> {motif.description}
              {motif.lien ? (
                <>
                  {" "}
                  <Link className={fr.cx("fr-link", "fr-text--sm")} href={motif.lien.href}>
                    {motif.lien.libelle}
                  </Link>
                </>
              ) : null}
              {motif.gestes && motif.gestes.length > 0 ? (
                <div className={fr.cx("fr-mt-1w")}>
                  {motif.gestes.map((geste) =>
                    geste.nom === "rattacher-startup" ? (
                      <Button
                        key={geste.nom}
                        className={fr.cx("fr-mr-1v")}
                        priority="tertiary"
                        size="small"
                        nativeButtonProps={{
                          ...modaleRattacherStartup.buttonProps,
                          id: `rattacher-${motif.cle}`,
                          type: "button",
                        }}
                      >
                        Rattacher à une startup
                      </Button>
                    ) : geste.nom === "ouvrir-arrivee" ? (
                      <Button
                        key={geste.nom}
                        className={fr.cx("fr-mr-1v")}
                        priority="tertiary"
                        size="small"
                        nativeButtonProps={{
                          ...modaleArrivee.buttonProps,
                          id: `arrivee-${motif.cle}`,
                          type: "button",
                        }}
                      >
                        {LIBELLE_DOSSIER.ONBOARDING.ouvrir}
                      </Button>
                    ) : (
                      <Button
                        key={geste.nom}
                        className={fr.cx("fr-mr-1v")}
                        priority="tertiary"
                        size="small"
                        nativeButtonProps={{
                          ...modaleCloture.buttonProps,
                          id: `clore-${geste.dedupKey}`,
                          type: "button",
                          onClick: () => setChoisi(geste),
                        }}
                      >
                        Clore
                      </Button>
                    ),
                  )}
                </div>
              ) : null}
            </>
          }
        />
      ))}

      <modaleCloture.Component title={choisi?.titre ?? "Clore ce constat"}>
        {choisi ? (
          <>
            <p className={fr.cx("fr-text--sm")}>{choisi.explication}</p>
            <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>{choisi.consigne}</p>
            {/* La fiche porte déjà le nom en titre : le redire ici serait la deuxième
                fois sur le même écran. */}
            <p className={fr.cx("fr-text--sm")}>
              Clore à la main dit qu'une situation qui dure a été traitée. La collecte ne le
              rouvrira pas tant qu'elle la constate, et votre nom reste au journal avec la raison.
            </p>
            <ClotureConstat
              key={choisi.dedupKey}
              dedupKey={choisi.dedupKey}
              onSucces={modaleCloture.close}
            />
          </>
        ) : null}
      </modaleCloture.Component>

      <modaleArrivee.Component title={LIBELLE_DOSSIER.ONBOARDING.ouvrir}>
        <FormulaireOuverture username={username} sens="ONBOARDING" profils={profils} />
      </modaleArrivee.Component>
    </section>
  );
}
