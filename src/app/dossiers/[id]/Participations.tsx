"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useIsModalOpen } from "@codegouvfr/react-dsfr/Modal/useIsModalOpen";
import { useActionState } from "react";

import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { DUREE_DEFAUT_JOURS, DUREE_MAX_JOURS } from "@/core/participation";
import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

import {
  type EtatParticipation,
  octroyerParticipation,
  revoquerParticipation,
} from "./participation";
import {
  aideDuCanal,
  LIBELLE_DROITS,
  LIBELLE_OCTROI,
  retientLaModale,
} from "./redaction-participation";

// Hors du composant, comme l'annulation du dossier : `createModal` enregistre la modale
// une fois pour toutes, et un écran de dossier n'ouvre qu'un droit à la fois.
const modaleOctroi = createModal({ id: "octroyer-participation", isOpenedByDefault: false });

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
  /**
   * Un identifiant que l'outil a fabriqué n'ouvre aucune connexion : c'est ce qui
   * décide de l'issue qu'on propose quand plus rien ne mène à cette personne.
   */
  identifiantFabrique: boolean;
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
            placeholder={LIBELLE_DROITS.retrait.raison}
            aria-label={LIBELLE_DROITS.retrait.lecteurDEcran}
            autoComplete="off"
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Button type="submit" priority="secondary" size="small" disabled={pending}>
            {pending ? LIBELLE_DROITS.retrait.enCours : LIBELLE_DROITS.retrait.soumettre}
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
        <strong>{LIBELLE_DROITS.canal.absent}</strong>{" "}
        {LIBELLE_DROITS.canal.absentIssue(droit.identifiantFabrique)}
      </p>
    );
  }

  return (
    <>
      <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
        {droit.canal.certain
          ? LIBELLE_DROITS.canal.declare(droit.canal.adresse)
          : LIBELLE_DROITS.canal.deduit(droit.canal.adresse)}
      </p>
      {droit.menace ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>{LIBELLE_DROITS.canal.menace}</strong> {LIBELLE_DROITS.canal.menaceEffet}
        </p>
      ) : null}
    </>
  );
}

/**
 * Le formulaire du geste, et lui seul : la modale qui le porte ne meurt jamais, lui
 * renaît à chaque ouverture.
 *
 * `useActionState` garde son état tant que le composant vit. Rouvrir le geste
 * réaffichait donc l'issue du précédent, c'est-à-dire « Le droit est accordé » au-dessus
 * de quatre champs vides, sur une personne que l'opérateur n'a pas encore nommée. Un
 * refus périmé était un bruit, cette phrase-là est une affirmation fausse.
 *
 * La modale ne se ferme pas sur tout succès, seulement sur celui qui n'a rien à dire :
 * l'octroi rend un avertissement quand le lien ne partira pas où il faut, et cette
 * phrase-là n'a qu'un seul endroit où elle se lit, celui où l'opérateur vient de saisir
 * l'adresse. Une fermeture l'emporterait sans que personne ne la voie. Le refus reste au
 * même endroit, pour la même raison.
 */
function FormulaireOctroi({
  dossierId,
  domainesMenaces,
}: {
  dossierId: string;
  domainesMenaces: readonly string[];
}) {
  const [etat, formAction, pending] = useActionState<EtatParticipation | null, FormData>(
    octroyerParticipation,
    null,
  );

  useFermetureApresSucces(pending, retientLaModale(etat), modaleOctroi.close);

  return (
    <>
      <p className={fr.cx("fr-text--sm")}>{LIBELLE_OCTROI.effet}</p>

      <form action={formAction}>
        <input type="hidden" name="dossierId" value={dossierId} />

        <Input
          label={LIBELLE_OCTROI.identifiant.label}
          hintText={LIBELLE_OCTROI.identifiant.aide}
          nativeInputProps={{
            name: "identifiant",
            required: true,
            autoComplete: "off",
            ...messageObligatoire(LIBELLE_OCTROI.identifiant.manquant),
          }}
        />

        <Input
          label={LIBELLE_OCTROI.motif.label}
          hintText={LIBELLE_OCTROI.motif.aide}
          nativeInputProps={{
            name: "motif",
            required: true,
            minLength: 3,
            autoComplete: "off",
            placeholder: LIBELLE_OCTROI.motif.exemple,
            ...messageObligatoire(LIBELLE_OCTROI.motif.manquant),
          }}
        />

        <Input
          label={LIBELLE_OCTROI.duree.label}
          hintText={LIBELLE_OCTROI.duree.aide}
          nativeInputProps={{
            name: "jours",
            type: "number",
            min: 1,
            max: DUREE_MAX_JOURS,
            required: true,
            defaultValue: DUREE_DEFAUT_JOURS,
            ...messageObligatoire(LIBELLE_OCTROI.duree.manquant),
          }}
        />

        <Input
          label={LIBELLE_OCTROI.canal.label}
          hintText={aideDuCanal(domainesMenaces)}
          nativeInputProps={{
            name: "canal",
            type: "email",
            autoComplete: "off",
          }}
        />

        <Button type="submit" disabled={pending}>
          {pending ? LIBELLE_OCTROI.enCours : LIBELLE_OCTROI.soumettre}
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
    </>
  );
}

function Octroi({
  dossierId,
  domainesMenaces,
}: {
  dossierId: string;
  domainesMenaces: readonly string[];
}) {
  const ouverte = useIsModalOpen(modaleOctroi);

  return (
    <>
      {/* Secondaire comme les retraits de la liste : le seul bouton plein de cette
          zone est la clôture du dossier, qui suit le filet et n'appartient pas à
          cette section. */}
      <Button
        className={fr.cx("fr-mt-2w")}
        priority="secondary"
        nativeButtonProps={modaleOctroi.buttonProps}
      >
        {LIBELLE_OCTROI.declencheur}
      </Button>

      <modaleOctroi.Component title={LIBELLE_OCTROI.titre}>
        <FormulaireOctroi
          key={String(ouverte)}
          dossierId={dossierId}
          domainesMenaces={domainesMenaces}
        />
      </modaleOctroi.Component>
    </>
  );
}

/**
 * Qui d'autre agit sur ce dossier, et jusqu'à quand.
 *
 * Rendue à un opérateur seul : elle nomme des personnes, leurs adresses et les raisons
 * qu'on a eues de les impliquer.
 *
 * La section se ferme sur un filet : ce qui suit sur la page agit sur le dossier
 * lui-même, clôture comprise, et deux boutons qui se touchent sont un clic de travers.
 */
export function Participations({
  dossierId,
  droits,
  domainesMenaces,
  sens,
  ouvert,
}: {
  dossierId: string;
  droits: readonly DroitAffiche[];
  domainesMenaces: readonly string[];
  /** Le refus d'un dossier fermé nomme ce qu'il refuse, et les deux sens ne s'accordent pas. */
  sens: SensDossier;
  /** Un dossier clos, annulé ou seulement veillé ne s'ouvre plus à personne. */
  ouvert: boolean;
}) {
  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>{LIBELLE_DROITS.titre}</h2>

      {droits.length === 0 ? (
        <p className={fr.cx("fr-text--sm")}>{LIBELLE_DROITS.aucun}</p>
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
          {LIBELLE_DROITS.ferme(LIBELLE_DOSSIER[sens].droitPossibleSur)}
        </p>
      )}

      <hr className={fr.cx("fr-mt-4w")} />
    </section>
  );
}
