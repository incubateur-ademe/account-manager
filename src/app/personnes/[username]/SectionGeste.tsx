import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import Link from "next/link";

import { EtapeOperateur } from "@/app/dossiers/[id]/EtapeOperateur";
import { BoutonConfirmer } from "@/app/dossiers/[id]/Pointage";
import type { ActeurNomme, Declarant } from "@/core/dossier";
import { SENS_D_UN_GESTE } from "@/core/geste";
import { instantLocal } from "@/ui/dates";

import type { GesteEnAttente } from "./geste-en-attente";
import { GESTE } from "./libelles";

/**
 * Le brouillon de geste qui attend sa confirmation, rendu là où il se confirme.
 *
 * Un plan de geste n'a pas de dossier, donc pas d'URL à lui : `confirmerPlan` revalide
 * déjà cette fiche, et c'est ici que le brouillon se lit plutôt que nulle part.
 *
 * Rien ne s'y pointe et aucune voie du jour ne s'y calcule. Un brouillon n'a aucune
 * étape à cocher, et sonder les connecteurs depuis une fiche les ferait sonder pour
 * chaque personne.
 */
export function SectionGeste({
  geste,
  nomDuSysteme,
  declarant,
  valideur,
}: {
  geste: GesteEnAttente;
  /** Le libellé du système d'où le geste est parti, pour nommer le chemin de retour. */
  nomDuSysteme: string;
  declarant: Declarant;
  valideur: ActeurNomme;
}) {
  const retour = `/systemes/${encodeURIComponent(geste.systeme)}`;
  const bloque = geste.perime || geste.ecarte;

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>{GESTE.titre}</h2>

      <p>{GESTE.terme(geste.expiresAt, instantLocal)}</p>

      {bloque ? (
        <Alert
          className={fr.cx("fr-mb-2w")}
          severity="warning"
          small
          description={geste.perime ? GESTE.perime(nomDuSysteme) : GESTE.ecarte(nomDuSysteme)}
        />
      ) : null}

      <ol>
        {geste.etapes.map((etape) => (
          <EtapeOperateur
            key={etape.id}
            etape={etape}
            saisie={null}
            voie={null}
            pointable={false}
            etatPlan="DRAFT"
            sens={SENS_D_UN_GESTE}
            declarant={declarant}
            valideur={valideur}
          />
        ))}
      </ol>

      {bloque ? null : (
        <>
          <p className={fr.cx("fr-text--sm")}>{GESTE.avantDeConfirmer}</p>
          <BoutonConfirmer planId={geste.planId} />
        </>
      )}

      <p className={fr.cx("fr-mt-2w")}>
        <Link className={fr.cx("fr-link")} href={retour}>
          {GESTE.reposer(nomDuSysteme)}
        </Link>
      </p>
    </section>
  );
}
