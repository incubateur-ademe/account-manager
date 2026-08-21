"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useActionState, useState } from "react";

import { AnnulationDossier } from "./AnnulationDossier";

import {
  cloreDossier,
  confirmerPlan,
  type EtatAction,
  pointerEtape,
  recalculerPlan,
} from "./actions";

// Hors du composant, comme partout ailleurs dans ce dépôt : `createModal` enregistre
// la modale une fois pour toutes, et un écran de dossier n'en porte qu'une.
const modaleAnnulation = createModal({ id: "annuler-depart", isOpenedByDefault: false });

/**
 * Le geste qui dit qu'un départ n'aura pas lieu.
 *
 * La modale se rend toujours, et seul son contenu dépend du verdict. Après
 * l'annulation, le chemin du dossier est revalidé et la page se re-rend avec un
 * verdict devenu défavorable : un composant qui disparaîtrait à ce moment emporterait
 * le dialogue ouvert avant qu'il ne se ferme, et laisserait le verrou de défilement du
 * système de design posé sur la page.
 */
export function BoutonAnnuler({
  dossierId,
  etapes,
  annulable,
}: {
  dossierId: string;
  etapes: number;
  annulable: boolean;
}) {
  return (
    <>
      {annulable ? (
        <Button
          className={fr.cx("fr-mt-1w")}
          priority="secondary"
          size="small"
          nativeButtonProps={modaleAnnulation.buttonProps}
        >
          Annuler ce départ
        </Button>
      ) : null}

      <modaleAnnulation.Component title="Annuler ce départ">
        {annulable ? (
          <>
            <p className={fr.cx("fr-text--sm")}>
              {etapes === 0
                ? "Ce dossier n'a aucune étape : rien n'a été proposé, et rien ne sera abandonné."
                : `Les ${etapes} étapes proposées seront abandonnées.`}{" "}
              Aucun accès n'est coupé ni rouvert par ce geste : l'outil n'a rien exécuté, il a
              seulement dit ce qu'il faudrait faire.
            </p>
            <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>
              Un nouveau départ restera ouvrable ensuite, et la fiche de la personne cessera
              d'annoncer celui-ci.
            </p>
            <AnnulationDossier dossierId={dossierId} onSucces={modaleAnnulation.close} />
          </>
        ) : (
          <p className={fr.cx("fr-text--sm")}>Ce dossier ne s'annule plus.</p>
        )}
      </modaleAnnulation.Component>
    </>
  );
}

export function BoutonConfirmer({ planId }: { planId: string }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    confirmerPlan,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Confirmation…" : "Confirmer ce plan"}
      </Button>
      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Quatre issues et pas deux : « déjà absent » est le cas nominal quand quelqu'un est
 * passé avant, et « écartée » doit porter sa raison, sans quoi l'étape devient un
 * accès oublié que plus rien ne rattrape.
 */
export function Pointage({ etapeId, faite }: { etapeId: string; faite: boolean }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    pointerEtape,
    null,
  );
  const [choix, setChoix] = useState("fait");
  const justification = choix === "ignoree" || choix === "echec";

  return (
    <form action={formAction} className={fr.cx("fr-mt-1w")}>
      <input type="hidden" name="etapeId" value={etapeId} />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <select
            className={fr.cx("fr-select")}
            name="pointage"
            value={choix}
            onChange={(evenement) => setChoix(evenement.target.value)}
            aria-label="Ce qui a été fait"
          >
            <option value="fait">C'est fait</option>
            <option value="deja-absent">Déjà absent</option>
            <option value="ignoree">Écartée</option>
            <option value="echec">Échec</option>
          </select>
        </div>

        {justification ? (
          <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
            <input
              className={fr.cx("fr-input")}
              name="note"
              placeholder={choix === "ignoree" ? "Pourquoi ?" : "Qu'est-ce qui a échoué ?"}
              aria-label="Raison"
            />
          </div>
        ) : null}

        <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
          <Button type="submit" priority="secondary" size="small" disabled={pending}>
            {pending ? "Enregistrement…" : faite ? "Corriger" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

export function BoutonClore({ dossierId }: { dossierId: string }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    cloreDossier,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Clôture…" : "Clore le dossier"}
      </Button>
      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

export function BoutonRecalculer({ planId }: { planId: string }) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    recalculerPlan,
    null,
  );

  return (
    <form action={formAction} className={fr.cx("fr-mt-1w")}>
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Recalcul…" : "Recalculer le plan"}
      </Button>
      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
