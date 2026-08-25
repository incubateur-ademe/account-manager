"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useActionState, useState } from "react";
import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import type { SaisieAttendue } from "@/core/modele-plan";

import { messageObligatoire } from "@/ui/validation";

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
const modaleAnnulation = createModal({ id: "annuler-dossier", isOpenedByDefault: false });

/**
 * Le geste qui dit qu'un dossier n'aura pas lieu.
 *
 * La modale se rend toujours, et seul son contenu dépend du verdict. Après
 * l'annulation, le chemin du dossier est revalidé et la page se re-rend avec un
 * verdict devenu défavorable : un composant qui disparaîtrait à ce moment emporterait
 * le dialogue ouvert avant qu'il ne se ferme, et laisserait le verrou de défilement du
 * système de design posé sur la page.
 */
export function BoutonAnnuler({
  dossierId,
  sens,
  etapes,
  annulable,
}: {
  dossierId: string;
  sens: SensDossier;
  etapes: number;
  annulable: boolean;
}) {
  const mots = LIBELLE_DOSSIER[sens];

  return (
    <>
      {annulable ? (
        <Button
          className={fr.cx("fr-mt-1w")}
          priority="secondary"
          size="small"
          nativeButtonProps={modaleAnnulation.buttonProps}
        >
          {mots.annuler}
        </Button>
      ) : null}

      <modaleAnnulation.Component title={mots.annuler}>
        {/* Le formulaire reste monté quoi qu'il arrive : l'annulation fait basculer
            `annulable` à faux avant que son effet de fermeture n'ait eu son tour, et
            un formulaire démonté à cet instant emporte le dialogue ouvert avec lui,
            laissant le verrou de défilement du système de design posé sur la page. */}
        {annulable ? (
          <>
            <p className={fr.cx("fr-text--sm")}>
              {etapes === 0
                ? "Ce dossier n'a aucune étape : rien n'a été proposé, et rien ne sera abandonné."
                : `${etapes} étape${etapes > 1 ? "s" : ""} proposée${etapes > 1 ? "s" : ""} ${etapes > 1 ? "seront abandonnées" : "sera abandonnée"}.`}{" "}
              {mots.annulationEffet}
            </p>
            <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>{mots.annulationSuite}</p>
          </>
        ) : (
          <p className={fr.cx("fr-text--sm")}>Ce dossier ne s'annule plus.</p>
        )}
        <AnnulationDossier
          dossierId={dossierId}
          sens={sens}
          visible={annulable}
          onSucces={modaleAnnulation.close}
        />
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
 * Quatre issues et pas deux : le constat qu'un autre est passé avant est le cas
 * nominal, et « écartée » doit porter sa raison, sans quoi l'étape devient un accès
 * oublié que plus rien ne rattrape.
 *
 * Ce constat se dit dans le sens du dossier, jamais dans les deux : proposer « déjà
 * absent » sous une étape d'octroi ferait signer l'inverse de ce qui a été fait.
 */
export function Pointage({
  etapeId,
  faite,
  sens,
  saisie,
  reponse,
}: {
  etapeId: string;
  faite: boolean;
  sens: SensDossier;
  /** Ce que l'étape déclarée réclame en plus d'une case cochée, ou rien. */
  saisie: SaisieAttendue | null;
  reponse: string | null;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    pointerEtape,
    null,
  );
  const [choix, setChoix] = useState("fait");
  const justification = choix === "ignoree" || choix === "echec";
  const constat = LIBELLE_DOSSIER[sens].constat;
  // La valeur se demande sous « c'est fait » comme sous le constat : les deux disent
  // que le geste a eu lieu. Sous un échec ou un écart, il n'y a rien à en dire.
  const valeur = saisie !== null && !justification;

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
            <option value={constat.valeur}>{constat.libelle}</option>
            <option value="ignoree">Écartée</option>
            <option value="echec">Échec</option>
          </select>
        </div>

        {justification ? (
          <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
            <input
              className={fr.cx("fr-input")}
              name="note"
              required
              minLength={3}
              placeholder={choix === "ignoree" ? "Pourquoi ?" : "Qu'est-ce qui a échoué ?"}
              aria-label="Raison"
              {...messageObligatoire(
                choix === "ignoree"
                  ? "Dites pourquoi cette étape est écartée : sans raison, elle deviendra un accès oublié."
                  : "Dites ce qui a échoué, sinon personne ne saura quoi reprendre.",
              )}
            />
          </div>
        ) : null}

        {valeur && saisie ? (
          <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
            <input
              className={fr.cx("fr-input")}
              name="reponse"
              defaultValue={reponse ?? ""}
              required={saisie.obligatoire}
              placeholder={saisie.libelle}
              aria-label={saisie.libelle}
              autoComplete="off"
              {...messageObligatoire(
                `Renseignez « ${saisie.libelle} » : sans elle, personne ne saura ce qui a été fait.`,
              )}
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
