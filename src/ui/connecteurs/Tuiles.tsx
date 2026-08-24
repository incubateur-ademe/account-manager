import { fr } from "@codegouvfr/react-dsfr";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { CONNECTEURS } from "@/connectors";

import type { TuileDeConnecteur } from "./contrat";
import { FrontiereTuile } from "./FrontiereTuile";
import { tuilesDe } from "./registre";
import { rendreTuile } from "./rendre-tuile";

const PROVENANCE = {
  base: "Lu en base : ce chiffre date de la dernière collecte.",
  systeme: "Interrogé à l'instant, sans laisser de trace.",
} as const;

function Cadre({
  titre,
  provenance,
  children,
}: {
  titre: string;
  provenance: TuileDeConnecteur["provenance"];
  children: ReactNode;
}) {
  return (
    <div className={fr.cx("fr-callout")}>
      <h3 className={fr.cx("fr-callout__title", "fr-text--lg")}>{titre}</h3>
      <div className={fr.cx("fr-callout__text", "fr-text--sm")}>{children}</div>
      <p className={fr.cx("fr-text--xs", "fr-mt-1w", "fr-mb-0")}>{PROVENANCE[provenance]}</p>
    </div>
  );
}

async function Une({ tuile, maintenant }: { tuile: TuileDeConnecteur; maintenant: Date }) {
  const resultat = await rendreTuile(tuile, maintenant);

  return (
    <Cadre titre={tuile.titre} provenance={tuile.provenance}>
      {resultat.etat === "ok" ? (
        resultat.contenu
      ) : (
        <>
          {resultat.message} Référence à citer : <code>{resultat.reference}</code>.
        </>
      )}
    </Cadre>
  );
}

/**
 * L'emplacement que les connecteurs remplissent, et dont le socle ignore le contenu.
 *
 * Chaque tuile est isolée deux fois. Un `Suspense` d'abord, pour qu'une tuile lente ne
 * retienne pas la page, servie sans elle puis complétée. Une frontière d'erreur
 * ensuite, pour qu'une tuile qui lève à son propre rendu ne remplace pas le tableau de
 * bord entier par l'écran technique. Le troisième filet, l'échéance, est dans
 * `rendreTuile`.
 */
export async function TuilesDeConnecteurs({ maintenant }: { maintenant: Date }) {
  const chargeurs = CONNECTEURS.flatMap((connecteur) => {
    const chargeur = tuilesDe(connecteur.contract.key);
    return chargeur ? [{ cle: connecteur.contract.key, chargeur }] : [];
  });

  if (chargeurs.length === 0) {
    return null;
  }

  const groupes = await Promise.all(
    chargeurs.map(async ({ cle, chargeur }) => ({ cle, tuiles: (await chargeur()).tuiles })),
  );

  return (
    <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-mt-2w")}>
      {groupes.flatMap((groupe) =>
        groupe.tuiles.map((tuile) => (
          <div className={fr.cx("fr-col-12", "fr-col-md-4")} key={`${groupe.cle}:${tuile.cle}`}>
            <Suspense
              fallback={
                <Cadre titre={tuile.titre} provenance={tuile.provenance}>
                  En cours…
                </Cadre>
              }
            >
              <FrontiereTuile titre={tuile.titre}>
                <Une tuile={tuile} maintenant={maintenant} />
              </FrontiereTuile>
            </Suspense>
          </div>
        )),
      )}
    </div>
  );
}
