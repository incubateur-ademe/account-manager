import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import Link from "next/link";

import { EtapeOperateur } from "@/app/dossiers/[id]/EtapeOperateur";
import { echeancesDuPlan, Lancement } from "@/app/dossiers/[id]/Lancement";
import type { ActeurNomme, Declarant } from "@/core/dossier";
import { SENS_D_UN_GESTE } from "@/core/geste";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { saisieAAfficher } from "@/core/modele-plan";
import { dateLocale } from "@/ui/dates";

import type { GesteEnCours, GesteSolde } from "./gestes-confirmes";
import { GESTE, GESTE_CONFIRME } from "./libelles";

/**
 * Un geste confirmé dont une étape au moins reste à solder, rendu là où il s'exécute et
 * se pointe.
 *
 * Quand l'exécution refuserait, le bouton cède la place à son refus. Hors d'un départ
 * ouvert, les étapes restent pointables : écarter une étape avec sa raison est alors la
 * seule façon de solder le geste, un plan sans dossier ne se recalculant ni ne s'annulant.
 */
export function SectionGesteEnCours({
  geste,
  nomDuSysteme,
  declarant,
  valideur,
  simulation,
}: {
  geste: GesteEnCours;
  nomDuSysteme: string;
  declarant: Declarant;
  valideur: ActeurNomme;
  simulation: boolean;
}) {
  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>{GESTE_CONFIRME.titre(nomDuSysteme)}</h2>

      <p>{GESTE_CONFIRME.confirme(geste.confirmeLe, geste.confirmePar, dateLocale)}</p>

      {geste.etat === "PARTIALLY_EXECUTED" ? (
        <Alert
          as="h3"
          className={fr.cx("fr-mb-2w")}
          severity="warning"
          small
          title={LIBELLE_DOSSIER[SENS_D_UN_GESTE].echecTitre}
          description={GESTE_CONFIRME.echec}
        />
      ) : null}

      <ol>
        {geste.etapes.map((etape) => (
          <EtapeOperateur
            key={etape.id}
            etape={etape}
            saisie={saisieAAfficher({ template: null, manual: etape.manual })}
            voie={etape.voie}
            pointable={geste.pointable}
            etatPlan={geste.etat}
            sens={SENS_D_UN_GESTE}
            declarant={declarant}
            valideur={valideur}
          />
        ))}
      </ol>

      {geste.refus ? (
        <>
          <Alert className={fr.cx("fr-mt-2w")} severity="warning" small description={geste.refus} />
          {geste.pointable ? (
            <p className={fr.cx("fr-mt-2w")}>
              <Link
                className={fr.cx("fr-link")}
                href={`/systemes/${encodeURIComponent(geste.systeme)}`}
              >
                {GESTE.reposer(nomDuSysteme)}
              </Link>
            </p>
          ) : null}
        </>
      ) : geste.masse ? (
        <Lancement
          planId={geste.planId}
          masse={geste.masse}
          simulation={simulation}
          echeances={echeancesDuPlan(geste.etapes)}
          niveau={3}
          priorite="secondary"
        />
      ) : null}
    </section>
  );
}

export function GestesSoldes({
  gestes,
  nomDuSysteme,
}: {
  gestes: readonly GesteSolde[];
  nomDuSysteme: (cle: string) => string;
}) {
  return (
    <Accordion
      className={fr.cx("fr-mt-4w")}
      titleAs="h2"
      label={GESTE_CONFIRME.soldes(gestes.length)}
    >
      <ul>
        {gestes.map((geste) => (
          <li key={geste.planId}>
            {GESTE_CONFIRME.solde(
              nomDuSysteme(geste.systeme),
              geste.etapes,
              geste.confirmeLe,
              geste.confirmePar,
              dateLocale,
            )}
            {geste.termes.map((terme) => (
              <span key={terme.toISOString()}> {GESTE_CONFIRME.terme(terme, dateLocale)}</span>
            ))}
          </li>
        ))}
      </ul>
    </Accordion>
  );
}
