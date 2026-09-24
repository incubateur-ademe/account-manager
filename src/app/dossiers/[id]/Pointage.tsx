"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useActionState, useState } from "react";
import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import type { SaisieAttendue } from "@/core/modele-plan";
import type { Masse } from "@/core/plan";
import { useListesApresEnvoi } from "@/ui/formulaire";
import { useCleDOuverture, useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

import { AnnulationDossier } from "./AnnulationDossier";
import {
  cloreDossier,
  confirmerPlan,
  type EtatAction,
  lancerExecution,
  pointerEtape,
  recalculerPlan,
  validerEtape,
} from "./actions";
import { Remises } from "./Remises";
import { compteRendu, LIBELLE_LANCEMENT, LIBELLE_PASSAGE_INCOMPLET } from "./redaction-execution";

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
  const ouverture = useCleDOuverture(modaleAnnulation);

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

      <modaleAnnulation.Component titleAs="h2" title={mots.annuler}>
        {/* Le formulaire reste monté quoi qu'il arrive : l'annulation fait basculer
            `annulable` à faux avant que son effet de fermeture n'ait eu son tour, et
            un formulaire démonté à cet instant emporte le dialogue ouvert avec lui,
            laissant le verrou de défilement du système de design posé sur la page. */}
        {annulable ? (
          <>
            <p className={fr.cx("fr-text--sm")}>
              {etapes === 0
                ? "Ce dossier n'a aucune étape, rien ne sera abandonné."
                : `${etapes} étape${etapes > 1 ? "s" : ""} proposée${etapes > 1 ? "s" : ""} ${etapes > 1 ? "seront abandonnées" : "sera abandonnée"}.`}{" "}
              {mots.annulationEffet}
            </p>
            <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>{mots.annulationSuite}</p>
          </>
        ) : (
          <p className={fr.cx("fr-text--sm")}>Ce dossier ne s'annule plus.</p>
        )}
        <AnnulationDossier
          key={ouverture}
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
      <Button priority="primary" type="submit" disabled={pending}>
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
 * Trois seulement pour qui n'est pas de l'équipe, et c'est `pointerEtape` qui dit
 * pourquoi.
 *
 * Ce constat se dit dans le sens du dossier, jamais dans les deux : proposer « déjà
 * absent » sous une étape d'octroi ferait signer l'inverse de ce qui a été fait.
 *
 * Le verdict vient du serveur et ne se rejoue pas ici, comme pour la validation.
 * Quand il refuse, les commandes restent affichées et désactivées avec sa raison :
 * un geste proposé puis refusé au clic est exactement ce que cet écran évite ailleurs,
 * et un geste absent sans explication se cherche.
 */
export function Pointage({
  etapeId,
  faite,
  sens,
  saisie,
  reponse,
  ecartOffert,
  possible,
  raison,
}: {
  etapeId: string;
  faite: boolean;
  sens: SensDossier;
  /** Ce que l'étape déclarée réclame en plus d'une case cochée, ou rien. */
  saisie: SaisieAttendue | null;
  reponse: string | null;
  /** L'écart n'est offert qu'à l'équipe transverse, et le serveur le refuse aux autres. */
  ecartOffert: boolean;
  possible: boolean;
  raison: string | null;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    pointerEtape,
    null,
  );
  const envoi = useListesApresEnvoi(pending);
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
            key={`pointage-${envoi}`}
            name="pointage"
            value={choix}
            disabled={!possible}
            onChange={(evenement) => setChoix(evenement.target.value)}
            aria-label="Ce qui a été fait"
          >
            <option value="fait">C'est fait</option>
            <option value={constat.valeur}>{constat.libelle}</option>
            {ecartOffert ? <option value="ignoree">Écartée</option> : null}
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
              disabled={!possible}
              placeholder={choix === "ignoree" ? "Pourquoi ?" : "Qu'est-ce qui a échoué ?"}
              aria-label="Raison"
              {...messageObligatoire(
                choix === "ignoree"
                  ? "Dites pourquoi cette étape est écartée."
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
              disabled={!possible}
              placeholder={saisie.libelle}
              aria-label={saisie.libelle}
              autoComplete="off"
              {...messageObligatoire(
                `Le champ « ${saisie.libelle} » est vide. Renseignez-le avant d'enregistrer.`,
              )}
            />
          </div>
        ) : null}

        <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
          <Button type="submit" priority="secondary" size="small" disabled={pending || !possible}>
            {pending ? "Enregistrement…" : faite ? "Corriger" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {raison ? <p className={fr.cx("fr-text--sm", "fr-mt-1v")}>{raison}</p> : null}

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Ce sur quoi le second regard porte, car les deux déclarations qui l'appellent ne
 * disent pas la même chose. Sous un geste donné pour fait, il dit si la preuve en est
 * faite. Sous une étape écartée, aucun geste n'est affirmé et il n'y a donc pas de
 * preuve à demander : ce qu'il juge est la raison de l'avoir écartée.
 *
 * Il désigne la déclaration et non le formulaire qui la porte : sur la route d'un
 * participant, celui qui contrôle une étape n'a pas le droit de la pointer, et rien
 * n'est affiché au-dessus de son avis.
 */
const AVIS = {
  geste: {
    objet:
      "ce qui a été déclaré au-dessus dit que le geste a eu lieu, celui-ci dit ce que cela vaut",
    accepter: "La preuve est faite",
    refuser: "La preuve n'est pas faite",
  },
  ecart: {
    objet:
      "ce qui a été déclaré au-dessus dit pourquoi cette étape est écartée, celui-ci dit si cette raison tient",
    accepter: "L'écart est justifié",
    refuser: "L'écart n'est pas justifié",
  },
} as const;

/**
 * Le second regard porté sur une déclaration : elle tient, ou elle ne tient pas. Rien
 * n'est exécuté ici non plus, pas davantage qu'au pointage.
 *
 * Le verdict de la garde vient du serveur et ne se rejoue pas ici : l'écran qui
 * connaissait la règle de son côté est exactement ce qui a muré un dossier ailleurs
 * dans cet écran. Quand elle refuse, les commandes restent affichées et désactivées,
 * avec sa raison : un geste absent sans explication se cherche, et celui qui a déclaré
 * l'étape croirait à une panne plutôt qu'à la règle qui lui interdit de se relire.
 */
export function Validation({
  etapeId,
  ecart,
  possible,
  raison,
}: {
  etapeId: string;
  /** La déclaration soumise au regard est un écart, et non un geste donné pour fait. */
  ecart: boolean;
  possible: boolean;
  raison: string | null;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    validerEtape,
    null,
  );
  const envoi = useListesApresEnvoi(pending);
  const [choix, setChoix] = useState("accepter");
  const refus = choix === "refuser";
  const mots = ecart ? AVIS.ecart : AVIS.geste;

  return (
    <form action={formAction} className={fr.cx("fr-mt-1w")}>
      <input type="hidden" name="etapeId" value={etapeId} />

      <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
        Votre avis sur cette déclaration : {mots.objet}.
      </p>

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <select
            className={fr.cx("fr-select")}
            key={`verdict-${envoi}`}
            name="verdict"
            value={choix}
            disabled={!possible}
            onChange={(evenement) => setChoix(evenement.target.value)}
            aria-label="Ce que vaut cette déclaration"
          >
            <option value="accepter">{mots.accepter}</option>
            <option value="refuser">{mots.refuser}</option>
          </select>
        </div>

        {refus ? (
          <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
            <input
              className={fr.cx("fr-input")}
              name="note"
              required
              minLength={3}
              disabled={!possible}
              placeholder="Qu'est-ce qui manque ?"
              aria-label="Motif du refus"
              {...messageObligatoire("Dites ce qui manque.")}
            />
          </div>
        ) : null}

        <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
          <Button type="submit" priority="secondary" size="small" disabled={pending || !possible}>
            {pending ? "Enregistrement…" : "Enregistrer cet avis"}
          </Button>
        </div>
      </div>

      {raison ? <p className={fr.cx("fr-text--sm", "fr-mt-1v")}>{raison}</p> : null}

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Le geste qui lance l'exécution.
 *
 * Au-delà du plafond de masse, il exige une seconde parole : une case que l'opérateur
 * coche lui-même, jamais pré-cochée, jamais un paramètre d'URL. Le bouton attend
 * qu'elle le soit, et le refus du serveur reste la vraie garde : ce qui se voit ici
 * n'empêche que le clic, pas l'appel.
 */
export function BoutonExecuter({
  planId,
  masse,
  raisonDeMasse,
  simulation,
}: {
  planId: string;
  masse: Masse;
  /** La phrase du plafond, telle que le noyau la rédige, ou rien si le plan tient dessous. */
  raisonDeMasse: string | null;
  simulation: boolean;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    lancerExecution,
    null,
  );
  const [confirmee, setConfirmee] = useState(false);
  const bloque = masse.depasse && !confirmee;

  return (
    <form action={formAction} className={fr.cx("fr-mt-2w")}>
      <input type="hidden" name="planId" value={planId} />

      {raisonDeMasse ? (
        <>
          <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>{raisonDeMasse}</p>
          <div className={fr.cx("fr-checkbox-group", "fr-mb-2w")}>
            <input
              type="checkbox"
              id="masse-confirmee"
              name="masse"
              value="confirmee"
              checked={confirmee}
              onChange={(evenement) => setConfirmee(evenement.target.checked)}
            />
            <label className={fr.cx("fr-label")} htmlFor="masse-confirmee">
              {LIBELLE_LANCEMENT.relecture(masse.executables)}
            </label>
          </div>
        </>
      ) : null}

      <Button priority="primary" type="submit" disabled={pending || bloque}>
        {pending
          ? simulation
            ? LIBELLE_LANCEMENT.bouton.enCours.simulation
            : LIBELLE_LANCEMENT.bouton.enCours.reel
          : simulation
            ? LIBELLE_LANCEMENT.bouton.simulation
            : LIBELLE_LANCEMENT.bouton.reel}
      </Button>

      {etat?.execution ? (
        <>
          <p className={fr.cx("fr-text--sm", "fr-mt-1w")} role="status">
            {compteRendu(etat.execution)}
          </p>
          {etat.execution.passageIncomplet === undefined ? null : (
            <Alert
              as="h3"
              className={fr.cx("fr-mt-2w")}
              severity="error"
              title={LIBELLE_PASSAGE_INCOMPLET.titre}
              description={
                <>
                  <p>{LIBELLE_PASSAGE_INCOMPLET.raison(etat.execution.passageIncomplet)}</p>
                  <p className={fr.cx("fr-mb-0")}>{LIBELLE_PASSAGE_INCOMPLET.suite}</p>
                </>
              }
            />
          )}
          <Remises remises={etat.execution.remises} />
        </>
      ) : null}

      {etat?.erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}

/*
 * Le seul geste de cet écran que l'outil ne sait pas défaire : aucun chemin ne rouvre un dossier
 * clos. C'est le critère qui décide d'une confirmation ici, et non la gravité ressentie : détacher
 * une identité ou retirer un rattachement se refont en trois clics et partent donc au clic unique.
 */
const modaleCloture = createModal({ id: "clore-le-dossier", isOpenedByDefault: false });

/**
 * Le formulaire de la clôture, et lui seul : la modale qui le porte ne meurt jamais, lui
 * renaît à chaque ouverture. Son état vivrait sinon aussi longtemps que l'écran, et un
 * refus se relirait sous une modale rouverte.
 */
function ClotureDossier({
  dossierId,
  visible,
  onSucces,
}: {
  dossierId: string;
  /**
   * Monté même quand il ne se montre pas : c'est son effet de fermeture qui referme la
   * modale, et il doit survivre à la revalidation qui suit la clôture.
   */
  visible: boolean;
  onSucces?: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatAction | null, FormData>(
    cloreDossier,
    null,
  );

  useFermetureApresSucces(pending, etat?.erreur, onSucces);

  if (!visible) {
    return null;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <Button priority="primary" type="submit" disabled={pending}>
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

/**
 * La modale se rend toujours, et seul son contenu dépend du verdict. La clôture fait
 * basculer `cloturable` à faux avant que l'effet de fermeture n'ait eu son tour, et un
 * composant démonté à cet instant emporte le dialogue ouvert avec lui, laissant le
 * verrou de défilement du système de design posé sur la page.
 */
export function BoutonClore({ dossierId, cloturable }: { dossierId: string; cloturable: boolean }) {
  const ouverture = useCleDOuverture(modaleCloture);

  return (
    <>
      {cloturable ? (
        <Button priority="primary" nativeButtonProps={modaleCloture.buttonProps}>
          Clore le dossier
        </Button>
      ) : null}

      <modaleCloture.Component titleAs="h2" title="Clore ce dossier ?">
        {cloturable ? (
          <p className={fr.cx("fr-text--sm")}>
            Un dossier clos ne se rouvre pas. Ce qui reste à faire devra passer par un nouveau
            dossier.
          </p>
        ) : (
          <p className={fr.cx("fr-text--sm")}>Ce dossier ne se clôt pas.</p>
        )}
        <ClotureDossier
          key={ouverture}
          dossierId={dossierId}
          visible={cloturable}
          onSucces={modaleCloture.close}
        />
      </modaleCloture.Component>
    </>
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
        // Le refus de construction énumère un accès de profil par ligne : replié en un
        // seul paragraphe, il devient la bouillie qu'on cesse de lire.
        <p
          className={fr.cx("fr-error-text", "fr-mt-1v")}
          style={{ whiteSpace: "pre-line" }}
          role="alert"
        >
          {etat.erreur}
        </p>
      ) : null}
    </form>
  );
}
