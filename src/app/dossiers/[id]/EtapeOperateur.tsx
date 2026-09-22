import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import {
  type Acteur,
  type ActeurNomme,
  type Declarant,
  type EtatPlan,
  type EtatValidation,
  peutValider,
  type SensDossier,
} from "@/core/dossier";
import { motDuTier } from "@/core/lexique";
import type { SaisieAttendue } from "@/core/modele-plan";
import { dateLocale } from "@/ui/dates";
import { Etape } from "./Etape";
import { Validation } from "./Pointage";

/**
 * L'étape d'un plan telle qu'un opérateur la lit et l'actionne.
 *
 * Elle vit hors de l'écran du dossier parce qu'un plan n'a pas toujours de dossier : un
 * geste hors dossier en porte un, et il se rend ailleurs.
 */

interface MarcheASuivre {
  runbook?: string;
  deeplink?: string;
  doneWhen?: string;
}

/**
 * Champ par champ, et non par un cast sur l'objet entier : `manual` est une colonne
 * `Json` qu'un connecteur écrit, rien ne garantit ses types, et une valeur qui n'est pas
 * une chaîne finirait rendue telle quelle ou dans un `href`. Un champ fautif se perd
 * seul, les autres restant servis.
 */
function marche(valeur: unknown): MarcheASuivre {
  if (valeur === null || typeof valeur !== "object") {
    return {};
  }

  const lu = valeur as Record<string, unknown>;
  const chaine = (champ: keyof MarcheASuivre): string | undefined =>
    typeof lu[champ] === "string" ? lu[champ] : undefined;

  return {
    runbook: chaine("runbook"),
    deeplink: chaine("deeplink"),
    doneWhen: chaine("doneWhen"),
  };
}

export interface EtapeFigee {
  id: string;
  label: string;
  systemKey: string;
  capability: string;
  idempotencyKey: string;
  tier: string;
  riskLevel: string;
  state: string;
  validation: string;
  expectedActor: string;
  validationBy: string | null;
  declaredBy: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
  validationNote: string | null;
  manual: unknown;
  reponse: string | null;
  lastError: string | null;
  executedAt: Date | null;
  grantExpiresAt: Date | null;
}

export function EtapeOperateur({
  etape,
  saisie,
  voie,
  pointable,
  etatPlan,
  sens,
  declarant,
  valideur,
}: {
  etape: EtapeFigee;
  saisie: SaisieAttendue | null;
  /** L'écart entre le tier figé et la voie du jour, ou ce qui manque pour faire mieux. */
  voie: string | null;
  pointable: boolean;
  /** L'état du plan, tel que la garde de pointage a besoin de le lire. */
  etatPlan: EtatPlan;
  sens: SensDossier;
  /** Celui qui lit, tel que la garde de pointage a besoin de le connaître. */
  declarant: Declarant;
  /** Le même, tel que la garde de validation a besoin de le connaître. */
  valideur: ActeurNomme;
}) {
  const aide = marche(etape.manual);
  const tier = motDuTier(etape.tier);
  const validation = etape.validation as EtatValidation;

  // Adossé à la garde plutôt que rejoué ici : l'écran qui connaît la règle de son côté
  // est ce qui a muré ce dossier le jour où une étape a échoué.
  const controle =
    validation === "AWAITING"
      ? peutValider(
          {
            validation,
            validationBy: etape.validationBy as Acteur | null,
            declaredBy: etape.declaredBy,
          },
          valideur,
        )
      : null;

  return (
    <Etape
      etape={etape}
      saisie={saisie}
      pointable={pointable}
      etatPlan={etatPlan}
      sens={sens}
      declarant={declarant}
      badges={
        <>
          <Badge severity={tier.severite} small noIcon>
            {tier.libelle}
          </Badge>{" "}
          {etape.riskLevel === "HIGH" ? (
            <Badge severity="error" small noIcon>
              risque élevé
            </Badge>
          ) : null}
        </>
      }
      details={
        <>
          {voie ? <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>{voie}</p> : null}
          {aide.runbook ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>{aide.runbook}</p>
          ) : null}
          {aide.deeplink ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              <a
                href={aide.deeplink}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir la page concernée, nouvelle fenêtre"
              >
                Ouvrir la page concernée
              </a>
            </p>
          ) : null}
          {aide.doneWhen ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              <em>C'est fait quand : {aide.doneWhen}</em>
            </p>
          ) : null}
          {etape.grantExpiresAt ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              <strong>Accès accordé jusqu'au {dateLocale.format(etape.grantExpiresAt)}.</strong> Ce
              terme est compté depuis le calcul de ce plan. Une prolongation de mission ne le
              repousse pas, et reconduire cet accès demandera un nouveau plan.
            </p>
          ) : null}
        </>
      }
      journal={
        <>
          {etape.lastError ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              <strong>Note :</strong> {etape.lastError}
            </p>
          ) : null}
          {etape.executedAt ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              Déclarée le {dateLocale.format(etape.executedAt)}
              {etape.declaredBy ? ` par ${etape.declaredBy}` : ""}.
            </p>
          ) : null}
          {validation === "REFUSED" ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              <strong>Déclaration refusée</strong>
              {etape.validatedBy ? ` par ${etape.validatedBy}` : ""}
              {etape.validatedAt ? ` le ${dateLocale.format(etape.validatedAt)}` : ""}
              {etape.validationNote ? ` : ${etape.validationNote}` : ""}. L'étape est de nouveau à
              faire.
            </p>
          ) : null}
          {validation === "ACCEPTED" && etape.validatedBy ? (
            <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
              Validée par {etape.validatedBy}
              {etape.validatedAt ? ` le ${dateLocale.format(etape.validatedAt)}` : ""}.
            </p>
          ) : null}
        </>
      }
      controle={
        pointable && controle ? (
          <Validation
            etapeId={etape.id}
            ecart={etape.state === "SKIPPED"}
            possible={controle.possible}
            raison={controle.possible ? null : controle.raison}
          />
        ) : null
      }
    />
  );
}
