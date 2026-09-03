import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import type { ReactNode } from "react";

import {
  type Acteur,
  type Declarant,
  type EtatEtape,
  type EtatPlan,
  type EtatValidation,
  estSoldee,
  peutPointer,
  type SensDossier,
} from "@/core/dossier";
import type { SaisieAttendue } from "@/core/modele-plan";

import { Pointage } from "./Pointage";

const ETAT: Record<EtatEtape, { libelle: string; severite: "success" | "warning" | "error" }> = {
  PENDING: { libelle: "à faire", severite: "warning" },
  SUCCEEDED: { libelle: "fait", severite: "success" },
  ALREADY_ABSENT: { libelle: "déjà absent", severite: "success" },
  ALREADY_PRESENT: { libelle: "déjà présent", severite: "success" },
  SKIPPED: { libelle: "écartée", severite: "warning" },
  FAILED: { libelle: "échec", severite: "error" },
  STALE: { libelle: "situation changée", severite: "warning" },
};

/**
 * À qui l'étape revient. Rien sous un opérateur : c'est le cas nominal d'un plan, et
 * décorer chaque ligne d'un badge que toutes portent n'apprend rien à personne, tout
 * en noyant les deux qui disent quelque chose.
 */
const ACTEUR: Record<Acteur, { libelle: string; severite: "info" } | null> = {
  OPERATOR: null,
  SUBJECT: { libelle: "à la personne concernée", severite: "info" },
  DELEGATE: { libelle: "à un délégué", severite: "info" },
};

/** Qui porte le second regard, dit dans une phrase. */
const CONTROLEUR: Record<Acteur, string> = {
  OPERATOR: "d'un opérateur",
  SUBJECT: "de la personne concernée",
  DELEGATE: "d'un délégué",
};

/**
 * Une étape réduite à ce qu'elle dit de celui qu'elle nomme.
 *
 * Ce type est la frontière, et c'est lui qu'on relit plutôt que mille lignes d'écran :
 * il n'a pas de place pour la note libre d'un opérateur, pour le nom d'un déclarant ou
 * d'un signataire, pour la marche à suivre d'un connecteur ni pour un terme d'accès.
 * Ce qui s'ajoutera demain à la page d'un opérateur ne peut donc pas atteindre celle
 * d'un participant par distraction : il faudrait élargir ce type pour cela.
 */
export interface EtapeNommee {
  id: string;
  label: string;
  state: string;
  expectedActor: string;
  validationBy: string | null;
  validation: string;
  reponse: string | null;
}

/**
 * Une étape figée, telle qu'elle se lit et telle qu'elle se pointe, sur les deux
 * écrans qui la montrent.
 *
 * Ce que chacun ajoute autour passe par un emplacement et jamais par un champ de plus :
 * la page d'un opérateur y verse ses badges techniques, sa marche à suivre et les noms
 * qui ont déclaré ou signé, la route d'un participant n'y verse rien. C'est ce qui
 * sépare ce composant d'un modèle de vue censuré, lequel laisse passer par
 * construction tout ce qu'on ajoutera sans y penser.
 */
export function Etape({
  etape,
  saisie,
  pointable,
  etatPlan,
  sens,
  declarant,
  badges,
  details,
  journal,
  controle,
}: {
  etape: EtapeNommee;
  /** Ce que l'étape réclame en plus d'une case cochée, ou rien. */
  saisie: SaisieAttendue | null;
  /** Le pointage a lieu d'être : le plan l'accepte, et l'étape est de celles que ce lecteur pointe. */
  pointable: boolean;
  etatPlan: EtatPlan;
  sens: SensDossier;
  /** Celui qui lit, tel que la garde de pointage a besoin de le connaître. */
  declarant: Declarant;
  /** Les badges que l'écran ajoute aux siens. */
  badges?: ReactNode;
  /** Ce que l'écran dit de l'étape avant la valeur demandée. */
  details?: ReactNode;
  /** Ce que l'écran dit de ce qui a déjà été déclaré. */
  journal?: ReactNode;
  /** Le second regard, quand l'écran l'offre. */
  controle?: ReactNode;
}) {
  const validation = etape.validation as EtatValidation;
  const etat = ETAT[etape.state as EtatEtape];
  const soldee = estSoldee({ etat: etape.state as EtatEtape, validation });
  const acteur = ACTEUR[etape.expectedActor as Acteur];
  const controleur = etape.validationBy ? CONTROLEUR[etape.validationBy as Acteur] : null;

  // Adossé à la garde comme la validation l'est déjà : offrir le pointage puis le
  // refuser au clic est exactement ce que cet écran évite partout ailleurs.
  const pointage = peutPointer(etatPlan, etape.expectedActor as Acteur, declarant);

  return (
    <li className={fr.cx("fr-mb-4w")}>
      <strong>{etape.label}</strong>{" "}
      <Badge severity={etat.severite} small noIcon>
        {etat.libelle}
      </Badge>{" "}
      {acteur ? (
        <>
          <Badge severity={acteur.severite} small noIcon>
            {acteur.libelle}
          </Badge>{" "}
        </>
      ) : null}
      {validation === "AWAITING" ? (
        <>
          <Badge severity="warning" small noIcon>
            en attente de validation
          </Badge>{" "}
        </>
      ) : null}
      {/* Un refus a renvoyé l'étape à faire : sans ce badge, elle se relit comme une
          étape que personne n'a jamais pointée. « Déclaration » et non « preuve » :
          le refus l'a remise à `PENDING`, si bien que plus rien ici ne dit si ce qui a
          été refusé était un geste donné pour fait ou la raison de l'avoir écarté. */}
      {validation === "REFUSED" ? (
        <>
          <Badge severity="error" small noIcon>
            déclaration refusée
          </Badge>{" "}
        </>
      ) : null}
      {badges}
      {details}
      {saisie ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          Valeur demandée : {saisie.libelle}
          {saisie.obligatoire ? " (sans elle, l'étape ne peut pas être donnée pour faite)" : ""}.
        </p>
      ) : null}
      {etape.reponse ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>Valeur saisie :</strong> {etape.reponse}
        </p>
      ) : null}
      {journal}
      {validation === "AWAITING" ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          Cette déclaration attend le regard {controleur ?? "de quelqu'un d'autre"}. Tant qu'il n'a
          pas eu lieu, l'étape reste à solder et le dossier ne se clôt pas.
        </p>
      ) : null}
      {pointable ? (
        <Pointage
          etapeId={etape.id}
          // Une déclaration en attente de contrôle a bel et bien eu lieu : le bouton
          // corrige ce qui a été dit, il n'enregistre pas une première parole.
          faite={soldee || validation === "AWAITING"}
          sens={sens}
          saisie={saisie}
          reponse={etape.reponse}
          // Dérivé et non reçu en prop : la règle est celle que `pointerEtape` refuse.
          ecartOffert={declarant.operateur}
          possible={pointage.possible}
          raison={pointage.possible ? null : pointage.raison}
        />
      ) : null}
      {controle}
    </li>
  );
}
