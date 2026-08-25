"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState, useState } from "react";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import type { ChoixDeProfils } from "@/ui/profils";

import { type EtatDossier, ouvrirArrivee, ouvrirDepart } from "./actions";

const OUVERTURE = {
  ONBOARDING: ouvrirArrivee,
  OFFBOARDING: ouvrirDepart,
} as const;

const SANS_PROFIL = "";

/**
 * Le choix du profil, qui décide de ce que l'arrivée ouvrira sur les systèmes
 * couverts.
 *
 * Ce que le profil retenu ouvre s'affiche à côté de son nom, et son échéance avec :
 * une clé seule ne dit pas quel rôle elle accorde ni pour combien de temps, et
 * l'opérateur ne l'apprendrait qu'une fois le plan calculé.
 *
 * Les profils que la politique refuse restent visibles, hors du choix : les cacher
 * ferait chercher dans la liste un profil qu'on sait avoir déclaré, et le refus se
 * lirait après le clic plutôt qu'avant.
 */
function ChoixDeProfil({ profils }: { profils: ChoixDeProfils }) {
  const [choisi, setChoisi] = useState(SANS_PROFIL);

  const lus = profils.etat === "lus" ? profils : null;
  const retenu = lus?.offerts.find(({ cle }) => cle === choisi) ?? null;

  return (
    <>
      {lus === null ? (
        <p className={fr.cx("fr-text--sm")}>
          Le fichier de politique n'a pas pu être lu : aucun profil n'est proposé. Le dossier
          s'ouvre quand même, et son plan n'ouvrira alors rien sur les systèmes couverts.
        </p>
      ) : null}

      {lus !== null && lus.offerts.length === 0 ? (
        <p className={fr.cx("fr-text--sm")}>
          Aucun profil applicable n'est déclaré : ce dossier n'ouvrira rien sur les systèmes
          couverts, et son plan ne portera que ce que les modèles d'arrivée déclarent.
        </p>
      ) : null}

      {/* Un menu à une seule entrée demande de choisir ce qu'il n'offre pas : quand la
          politique ne déclare rien qui s'applique, la phrase remplace le contrôle. */}
      {lus && lus.offerts.length > 0 ? (
        <div className={fr.cx("fr-select-group", "fr-mb-1w")}>
          <label className={fr.cx("fr-label")} htmlFor="profil-arrivee">
            Profil appliqué
            <span className={fr.cx("fr-hint-text")}>
              Il dit quel accès ouvrir sur quel système. Sans lui, le plan ne portera que ce que les
              modèles déclarent.
            </span>
          </label>
          <select
            className={fr.cx("fr-select")}
            id="profil-arrivee"
            name="profil"
            value={choisi}
            onChange={(evenement) => setChoisi(evenement.target.value)}
          >
            <option value={SANS_PROFIL}>Aucun profil, rien sur les systèmes couverts</option>
            {lus.offerts.map((profil) => (
              <option key={profil.cle} value={profil.cle}>
                {profil.libelle}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {retenu ? (
        <ul className={fr.cx("fr-text--sm", "fr-mb-1w")}>
          {retenu.ouvre.map((acces) => (
            <li key={`${acces.systeme}:${acces.scope}`}>
              {acces.systeme} : <code>{acces.scope}</code>, {acces.echeance}.
            </li>
          ))}
        </ul>
      ) : null}

      {lus !== null && lus.refuses.length > 0 ? (
        <>
          <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
            Ces profils sont déclarés mais ne s'appliquent pas en l'état, ils ne sont donc pas
            proposés :
          </p>
          <ul className={fr.cx("fr-text--sm", "fr-mb-1w")}>
            {lus.refuses.map((profil) => (
              <li key={profil.cle}>
                {profil.libelle} (<code>{profil.cle}</code>) : {profil.refus.join(" ")}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={fr.cx("fr-text--sm")}>
        Les profils viennent du fichier de politique, lu une seule fois au démarrage du serveur : un
        profil ajouté ou corrigé depuis n'apparaîtra qu'après un redémarrage, et relire le même
        refus entre-temps ne veut pas dire que la correction est fausse.
      </p>
    </>
  );
}

type ProprietesDOuverture =
  | { username: string; sens: "OFFBOARDING" }
  | { username: string; sens: "ONBOARDING"; profils: ChoixDeProfils };

/**
 * Ce que contient la modale d'ouverture, quel que soit l'écran qui l'ouvre.
 *
 * La fiche l'ouvre, la file des constats aussi : deux formulaires jumeaux finiraient
 * par ne plus dire la même chose de ce que le geste engage, et c'est précisément la
 * phrase « rien n'est exécuté » qu'on ne peut pas laisser diverger.
 *
 * Le profil arrive par propriété, et seulement dans le sens de l'arrivée : la politique
 * vit dans un fichier, qu'un composant client ne peut pas lire, et un départ n'applique
 * aucun profil. Le type l'exige plutôt que de l'offrir : une arrivée dont le choix
 * serait absent ouvrirait sans un mot un dossier sans accès.
 */
export function FormulaireOuverture(proprietes: ProprietesDOuverture) {
  const { username, sens } = proprietes;
  const [etat, formAction, pending] = useActionState<EtatDossier | null, FormData>(
    OUVERTURE[sens],
    null,
  );
  const mots = LIBELLE_DOSSIER[sens];

  return (
    <>
      <p className={fr.cx("fr-text--sm")}>{mots.ouvertureExplication}</p>
      <p className={fr.cx("fr-text--sm")}>
        Le geste est tracé à votre nom. Si un dossier de ce sens est déjà ouvert sur cette personne,
        vous y serez ramené plutôt que d'en créer un second.
      </p>

      <form action={formAction}>
        <input type="hidden" name="username" value={username} />
        {proprietes.sens === "ONBOARDING" ? <ChoixDeProfil profils={proprietes.profils} /> : null}
        <Button type="submit" priority="primary" disabled={pending}>
          {pending ? "Calcul du plan…" : "Ouvrir le dossier"}
        </Button>
        {etat?.erreur ? (
          // Le refus de construction énumère un accès de profil par ligne : replié en
          // un seul paragraphe, il devient la bouillie qu'on cesse de lire, alors que
          // c'est exactement la liste qu'il faut corriger.
          <p
            className={fr.cx("fr-error-text", "fr-mt-1v")}
            style={{ whiteSpace: "pre-line" }}
            role="alert"
          >
            {etat.erreur}
          </p>
        ) : null}
      </form>
    </>
  );
}
