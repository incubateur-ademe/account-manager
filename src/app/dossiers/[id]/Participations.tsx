"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { DUREE_DEFAUT_JOURS, DUREE_MAX_JOURS } from "@/core/participation";
import { messageObligatoire } from "@/ui/validation";

import {
  type EtatParticipation,
  octroyerParticipation,
  revoquerParticipation,
} from "./participation";

/**
 * Un droit en cours, tel que l'écran a besoin de le lire.
 *
 * Le canal est nul quand plus rien ne résout : c'est le cas d'une fiche que la collecte
 * a adoptée sous un droit vivant, et il se dit plutôt que de se découvrir au lien qui
 * ne marche pas.
 */
export interface DroitAffiche {
  id: string;
  username: string;
  nom: string;
  motif: string;
  echeance: string;
  octroyePar: string;
  canal: { adresse: string; certain: boolean } | null;
  menace: boolean;
}

function Revocation({ participationId }: { participationId: string }) {
  const [etat, formAction, pending] = useActionState<EtatParticipation | null, FormData>(
    revoquerParticipation,
    null,
  );

  return (
    <form action={formAction} className={fr.cx("fr-mt-1w")}>
      <input type="hidden" name="participationId" value={participationId} />
      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <input
            className={fr.cx("fr-input")}
            name="motif"
            placeholder="Pourquoi, si vous voulez le dire"
            aria-label="Raison du retrait"
            autoComplete="off"
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Button type="submit" priority="secondary" size="small" disabled={pending}>
            {pending ? "Retrait…" : "Retirer ce droit"}
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

/**
 * Les deux origines d'adresse ne se rendent pas de la même façon, et c'est ce que le
 * canal achète : l'outil sait où le lien part quand il a lui-même écrit l'adresse,
 * il l'approxime quand il la déduit d'une fiche qu'une collecte peut lui reprendre.
 */
function Canal({ droit }: { droit: DroitAffiche }) {
  if (droit.canal === null) {
    return (
      <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
        <strong>Canal mort.</strong> L'octroi n'a déclaré aucune adresse, et sa fiche n'en offre
        aucune que l'outil puisse servir : soit elle n'en porte pas, soit la collecte ou la
        politique l'entretient à sa place. Ré-octroyez en déclarant une adresse, ou dites-lui
        d'entrer avec son identifiant beta.gouv.
      </p>
    );
  }

  return (
    <>
      <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
        {droit.canal.certain
          ? `Le lien partira sur ${droit.canal.adresse}, déclarée à l'octroi.`
          : `Le lien partira sans doute sur ${droit.canal.adresse}, lue sur sa fiche : personne ne l'a choisie pour ce dossier, et la collecte peut adopter cette fiche à tout moment, ce qui éteindrait ce canal.`}
      </p>
      {droit.menace ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>Cette boîte est de celles que ce départ coupe.</strong> Elle cessera de répondre,
          et le droit deviendra inutilisable avant son terme.
        </p>
      ) : null}
    </>
  );
}

function Octroi({ dossierId, domainesMenaces }: { dossierId: string; domainesMenaces: string }) {
  const [etat, formAction, pending] = useActionState<EtatParticipation | null, FormData>(
    octroyerParticipation,
    null,
  );

  return (
    <form action={formAction} className={fr.cx("fr-mt-2w")}>
      <input type="hidden" name="dossierId" value={dossierId} />

      <Input
        label="Identifiant de la personne"
        hintText="Son username beta.gouv, ou l'identifiant que sa fiche porte ici. Un opérateur de l'outil est refusé : ce dossier lui est déjà ouvert."
        nativeInputProps={{
          name: "identifiant",
          required: true,
          autoComplete: "off",
          ...messageObligatoire("Indiquez qui reçoit ce droit."),
        }}
      />

      <Input
        label="Pourquoi"
        hintText="Un droit dont personne ne sait plus pourquoi il a été posé ne se retire jamais."
        nativeInputProps={{
          name: "motif",
          required: true,
          minLength: 3,
          autoComplete: "off",
          ...messageObligatoire("Dites pourquoi ce droit est accordé."),
        }}
      />

      <Input
        label="Pour combien de jours"
        hintText={`Au plus ${DUREE_MAX_JOURS}. Passé ce terme, le droit s'éteint tout seul, et il se ré-octroie.`}
        nativeInputProps={{
          name: "jours",
          type: "number",
          min: 1,
          max: DUREE_MAX_JOURS,
          required: true,
          defaultValue: DUREE_DEFAUT_JOURS,
          ...messageObligatoire("Indiquez une durée."),
        }}
      />

      <Input
        label="Adresse à laquelle envoyer le lien (facultatif)"
        hintText={`Sans elle, le lien part sur l'adresse de contact de sa fiche, que l'outil ne maîtrise pas. Une boîte sur ${domainesMenaces} cessera de répondre avec ce départ.`}
        nativeInputProps={{
          name: "canal",
          type: "email",
          autoComplete: "off",
        }}
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Octroi…" : "Ouvrir ce dossier"}
      </Button>

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
      {etat?.avertissement ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mt-2w")}
          small
          description={etat.avertissement}
        />
      ) : null}
    </form>
  );
}

/**
 * Qui d'autre agit sur ce dossier, et jusqu'à quand.
 *
 * Rendue à un opérateur seul : elle nomme des personnes, leurs adresses et les raisons
 * qu'on a eues de les impliquer.
 */
export function Participations({
  dossierId,
  droits,
  domainesMenaces,
  ouvert,
}: {
  dossierId: string;
  droits: readonly DroitAffiche[];
  domainesMenaces: string;
  /** Un dossier clos, annulé ou seulement veillé ne s'ouvre plus à personne. */
  ouvert: boolean;
}) {
  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>Qui d'autre agit sur ce dossier</h2>

      {droits.length === 0 ? (
        <p className={fr.cx("fr-text--sm")}>
          Personne pour l'instant. Seule l'équipe transverse voit ce dossier.
        </p>
      ) : (
        <ul>
          {droits.map((droit) => (
            <li key={droit.id} className={fr.cx("fr-mb-3w")}>
              <strong>{droit.nom}</strong> ({droit.username}){" "}
              <Badge severity="info" small noIcon>
                jusqu'au {droit.echeance}
              </Badge>
              <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>
                « {droit.motif} », accordé par {droit.octroyePar}.
              </p>
              <Canal droit={droit} />
              <Revocation participationId={droit.id} />
            </li>
          ))}
        </ul>
      )}

      {ouvert ? (
        <Octroi dossierId={dossierId} domainesMenaces={domainesMenaces} />
      ) : (
        <p className={fr.cx("fr-text--sm")}>
          Ce dossier ne s'ouvre plus à personne : un droit ne se pose que sur un départ décidé et
          pas encore soldé.
        </p>
      )}
    </section>
  );
}
