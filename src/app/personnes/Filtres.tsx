"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { VUES, type Vue } from "@/core/tri-personnes";

interface FiltresProps {
  vue: Vue;
  recherche: string;
  /** Reconduits dans l'adresse : le tri se pilote par les en-têtes de colonnes. */
  tri: string;
  sens: string;
}

/** Le temps qu'une frappe se termine avant d'aller relire la liste. */
const ATTENTE_MS = 250;

/**
 * La liste se filtre à la frappe, et l'adresse suit.
 *
 * L'état continue de tenir dans l'URL, donc il se partage, se met en favori et
 * survit à un rechargement : c'est ce que le formulaire en GET garantissait, et on
 * ne le perd pas en gagnant l'instantané. Le bouton disparaît, il ne servait plus
 * qu'à valider ce qui se fait désormais tout seul.
 */
export function Filtres({ vue, recherche, tri, sens }: FiltresProps) {
  const router = useRouter();
  const chemin = usePathname();
  const [saisie, setSaisie] = useState(recherche);
  const [enCours, demarrer] = useTransition();

  // La liste vient du serveur : sans ce délai, chaque lettre déclencherait sa propre
  // navigation, et la dernière arrivée ne serait pas forcément la dernière tapée.
  useEffect(() => {
    if (saisie === recherche) {
      return;
    }
    const minuteur = setTimeout(() => {
      const parametres = new URLSearchParams({ tri, sens, vue });
      if (saisie.trim() !== "") {
        parametres.set("q", saisie.trim());
      }
      demarrer(() => {
        router.replace(`${chemin}?${parametres.toString()}`, { scroll: false });
      });
    }, ATTENTE_MS);

    return () => {
      clearTimeout(minuteur);
    };
  }, [saisie, recherche, tri, sens, vue, chemin, router]);

  const changerVue = (valeur: string) => {
    const parametres = new URLSearchParams({ tri, sens, vue: valeur });
    if (saisie.trim() !== "") {
      parametres.set("q", saisie.trim());
    }
    demarrer(() => {
      router.replace(`${chemin}?${parametres.toString()}`, { scroll: false });
    });
  };

  return (
    <div className={fr.cx("fr-mb-4w")}>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-grid-row--bottom")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
          <search className={fr.cx("fr-search-bar")}>
            <label className={fr.cx("fr-label")} htmlFor="recherche">
              Rechercher
            </label>
            <input
              className={fr.cx("fr-input")}
              id="recherche"
              name="q"
              type="search"
              value={saisie}
              onChange={(evenement) => {
                setSaisie(evenement.target.value);
              }}
              placeholder="Nom ou identifiant"
              autoComplete="off"
            />
          </search>
        </div>

        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <div className={fr.cx("fr-select-group")}>
            <label className={fr.cx("fr-label")} htmlFor="vue">
              Afficher
            </label>
            <select
              className={fr.cx("fr-select")}
              id="vue"
              name="vue"
              value={vue}
              onChange={(evenement) => {
                changerVue(evenement.target.value);
              }}
            >
              {VUES.map((option) => (
                <option key={option.valeur} value={option.valeur}>
                  {option.libelle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={fr.cx("fr-col-12", "fr-col-md-2")}>
          <p className={fr.cx("fr-text--sm", "fr-mb-0")} role="status">
            {enCours ? "Filtrage…" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
