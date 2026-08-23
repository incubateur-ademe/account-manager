"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { VUES_STARTUPS, type VueStartups } from "@/core/startups";

interface FiltresProps {
  vue: VueStartups;
  recherche: string;
}

/** Le temps qu'une frappe se termine avant d'aller relire la liste. */
const ATTENTE_MS = 250;

/**
 * L'adresse est reconstruite à neuf à chaque changement : tout paramètre que l'index
 * reconnaît doit donc être reporté ici, sans quoi il disparaîtrait à la première
 * frappe. Ils sont deux, `vue` et `q`, et il n'y en a pas d'autre.
 */
function adresse(vue: string, recherche: string): string {
  const parametres = new URLSearchParams({ vue });
  if (recherche.trim() !== "") {
    parametres.set("q", recherche.trim());
  }
  return parametres.toString();
}

/**
 * La liste se filtre à la frappe, et l'adresse suit : l'état tient dans l'URL, donc
 * il se partage, se met en favori et survit à un rechargement.
 */
export function Filtres({ vue, recherche }: FiltresProps) {
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
      demarrer(() => {
        router.replace(`${chemin}?${adresse(vue, saisie)}`, { scroll: false });
      });
    }, ATTENTE_MS);

    return () => {
      clearTimeout(minuteur);
    };
  }, [saisie, recherche, vue, chemin, router]);

  const changerVue = (valeur: string) => {
    demarrer(() => {
      router.replace(`${chemin}?${adresse(valeur, saisie)}`, { scroll: false });
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
              {VUES_STARTUPS.map((option) => (
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
