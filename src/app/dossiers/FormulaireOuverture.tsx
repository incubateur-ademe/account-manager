"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { useActionState } from "react";
import type { SensDossier } from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";

import { type EtatDossier, ouvrirArrivee, ouvrirDepart } from "./actions";

const OUVERTURE = {
  ONBOARDING: ouvrirArrivee,
  OFFBOARDING: ouvrirDepart,
} as const;

/**
 * Ce que contient la modale d'ouverture, quel que soit l'écran qui l'ouvre.
 *
 * La fiche l'ouvre, la file des constats aussi : deux formulaires jumeaux finiraient
 * par ne plus dire la même chose de ce que le geste engage, et c'est précisément la
 * phrase « rien n'est exécuté » qu'on ne peut pas laisser diverger.
 */
export function FormulaireOuverture({ username, sens }: { username: string; sens: SensDossier }) {
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
        <Button type="submit" priority="primary" disabled={pending}>
          {pending ? "Calcul du plan…" : "Ouvrir le dossier"}
        </Button>
        {etat?.erreur ? (
          <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
            {etat.erreur}
          </p>
        ) : null}
      </form>
    </>
  );
}
